/**
 * segments.mjs — the email segmentation engine.
 *
 * Reads per-user context from the `user_email_segments` view (migration 58) via
 * get_email_segments(), joins emails from auth.users, drops suppressed addresses,
 * then exposes named segments you can inspect or broadcast to. Segments ARE the
 * personalisation: the right people get the right email, with {{{FIRST_NAME}}}
 * merge on top.
 *
 * Usage (always: node --env-file=.env.local scripts/segments.mjs ...):
 *   (no args)                         → snapshot: every segment + sendable count
 *   <segment>                         → context for one segment (breakdowns + sample)
 *   send <segment> --template <html> --subject "..." [--from "..."]
 *        [--preview-text "..."] [--send]   → broadcast to that segment (dry-run unless --send)
 *
 * Each send spins up a fresh per-campaign Resend audience (only that segment) and
 * fires one Broadcast — never transactional. See scripts/lib/broadcast.mjs.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuppressions } from "./load-suppressions.mjs";
import { syncAndBroadcast } from "./lib/broadcast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@yourscore.app";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Segment catalogue ────────────────────────────────────────────────────────
// Each: a one-line description (the email angle) + a predicate over a user row.
const SEGMENTS = {
  // Engagement spine (mutually exclusive — every user is in exactly one)
  "never-played":     { angle: "Activate: first game ever (point them at today's WC Mastermind)", pred: u => u.engagement_tier === "never" },
  "active":           { angle: "Retain + deepen: leagues, friends, streaks (go easy on volume)", pred: u => u.engagement_tier === "active" },
  "cooling":          { angle: "Pull back now: today's board is live in their game", pred: u => u.engagement_tier === "cooling" },
  "dormant":          { angle: "Win back, sparingly: what's new, the £100 board, streak waiting", pred: u => u.engagement_tier === "dormant" },

  // Game affinity (content selector — any tier)
  "wc-players":       { angle: "Daily WC Mastermind content", pred: u => u.plays_wc },
  "38-players":       { angle: "38-0 league / H2H / results content", pred: u => u.plays_38 },
  "quiz-players":     { angle: "Quiz series content", pred: u => u.plays_quiz },
  "multi-game":       { angle: "Broad content — they play across modes", pred: u => u.multi_game },

  // Tier x affinity — the personalised win-backs
  "dormant-wc":       { angle: "WC Mastermind misses you — today's quiz + your streak", pred: u => u.engagement_tier === "dormant" && u.plays_wc },
  "dormant-38":       { angle: "Your 38-0 squad is waiting — new comp / rematch", pred: u => u.engagement_tier === "dormant" && u.plays_38 },
  "cooling-wc":       { angle: "Don't break the streak — today's WC board is live", pred: u => u.engagement_tier === "cooling" && u.plays_wc },

  // First-game win-backs — lure them back with what they came in for
  "dormant-started-38":   { angle: "Built an XI on day one — remember your first squad?", pred: u => u.engagement_tier === "dormant" && u.first_game === "38" },
  "dormant-started-wc":   { angle: "Came for the WC Mastermind — it's still going daily", pred: u => u.engagement_tier === "dormant" && u.first_game === "wc" },
  "dormant-started-quiz": { angle: "Started on the quiz — a fresh one's live today", pred: u => u.engagement_tier === "dormant" && u.first_game === "quiz" },

  // Re-engagement campaign (dormant + cooling; partitions the base by game history)
  // wc-run-no-mastermind: played the open World Cup Run ("XI") but never the ranked
  // daily Mastermind — the "you've never tried the ranked one" explainer.
  "wc-run-no-mastermind": { angle: "Played open WC XI, never the ranked Mastermind — explain the difference", pred: u => (u.engagement_tier === "dormant" || u.engagement_tier === "cooling") && u.plays_wc && !u.played_wc_ranked },
  // wc-mastermind-lapsed: played a ranked Mastermind run before, now drifted — "it's still live daily".
  "wc-mastermind-lapsed": { angle: "Lapsed Mastermind player — the World Cup's still live daily + new Versus", pred: u => (u.engagement_tier === "dormant" || u.engagement_tier === "cooling") && u.played_wc_ranked },
  // dormant-versus: non-WC dormant/cooling (38-0 or quiz primary) — the new head-to-head hub.
  "dormant-versus": { angle: "Non-WC dormant — meet Versus, go head-to-head (Quiz Battle + shadow)", pred: u => (u.engagement_tier === "dormant" || u.engagement_tier === "cooling") && (u.primary_game === "38" || u.primary_game === "quiz") },

  // Cross-sell + social plays
  "38-never-quizzed": { angle: "Biggest cross-sell: good at 38-0, try today's quiz", pred: u => u.plays_38 && !u.plays_quiz },
  "active-no-league": { angle: "Retention engine: start a league with your mates", pred: u => u.engagement_tier === "active" && !u.in_league },
  "league-no-play":   { angle: "Warm: joined a league but never played — get them their first game", pred: u => u.in_league && u.engagement_tier === "never" },
  "has-friends":      { angle: "Friend / H2H hooks", pred: u => u.has_friends },

  // Lifecycle
  "new-7d":           { angle: "Onboarding: signed up this week", pred: u => u.is_new },
  "new-no-play":      { angle: "Just signed up, no game yet — nudge in fast", pred: u => u.is_new && u.engagement_tier === "never" },
};

const BLOCKED_DOMAINS = new Set(["yourscore.fake", "example.com", "test.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Load context + emails, joined and filtered to sendable users.
async function loadUsers() {
  const { data: rows, error } = await supabase.rpc("get_email_segments");
  if (error) throw new Error(`get_email_segments failed: ${error.message}`);

  const emailById = new Map();
  const metaNameById = new Map();
  let page = 1;
  while (true) {
    const { data, error: e } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
    if (e) throw new Error(`listUsers failed: ${e.message}`);
    for (const u of data?.users ?? []) {
      if (u.email) emailById.set(u.id, u.email.trim().toLowerCase());
      const mn = metaFirstName(u.user_metadata);
      if (mn) metaNameById.set(u.id, mn);
    }
    if ((data?.users ?? []).length < 1000) break;
    page++;
  }

  const suppressed = await loadSuppressions();
  const isSendable = (e) => e && EMAIL_RE.test(e) && !suppressed.has(e) && !BLOCKED_DOMAINS.has(e.split("@")[1]);

  const users = [];
  for (const r of rows ?? []) {
    const email = emailById.get(r.user_id);
    if (!isSendable(email)) continue;
    users.push({ ...r, email, metaFirstName: metaNameById.get(r.user_id) });
  }
  return users;
}

// Real first name from OAuth identity metadata (given_name/full_name/name).
// Rejects handles/usernames: anything with digits, @, _, over 20 chars, or not
// starting with a letter. Returns undefined so the greeting falls back to "there".
function metaFirstName(meta) {
  const m = meta ?? {};
  const n = String(m.given_name || m.full_name || m.name || "").trim().split(/\s+/)[0] || "";
  if (!n || n.length > 20 || /[\d@_]/.test(n) || !/^\p{L}/u.test(n)) return undefined;
  return n;
}

// Prefer the real OAuth first name; fall back to the profile name (may be a handle).
function firstName(name) {
  if (!name || typeof name !== "string") return undefined;
  const f = name.trim().split(/\s+/)[0];
  return f && f.length <= 40 ? f : undefined;
}

function snapshot(users) {
  console.log(`\n📊 YourScore email segments — ${users.length} sendable users\n`);
  const pad = Math.max(...Object.keys(SEGMENTS).map(s => s.length));
  for (const [name, { pred, angle }] of Object.entries(SEGMENTS)) {
    const n = users.filter(pred).length;
    console.log(`  ${name.padEnd(pad)}  ${String(n).padStart(5)}   ${angle}`);
  }
  console.log(`\nContext for one: node --env-file=.env.local scripts/segments.mjs <segment>\n`);
}

function context(users, name) {
  const seg = SEGMENTS[name];
  if (!seg) { console.error(`Unknown segment "${name}". Run with no args to list.`); process.exit(1); }
  const m = users.filter(seg.pred);
  const by = (key) => m.reduce((a, u) => { const k = u[key] ?? "—"; a[k] = (a[k] || 0) + 1; return a; }, {});
  const days = m.map(u => u.days_since_active).filter(d => d != null).sort((a, b) => a - b);
  const median = days.length ? days[Math.floor(days.length / 2)] : null;

  console.log(`\n🎯 Segment: ${name}  (${m.length} sendable)`);
  console.log(`   Angle: ${seg.angle}\n`);
  console.log(`   Primary game:`, by("primary_game"));
  console.log(`   First game (entry point):`, by("first_game"));
  console.log(`   Engagement tier:`, by("engagement_tier"));
  console.log(`   In a league: ${m.filter(u => u.in_league).length}  ·  Has friends: ${m.filter(u => u.has_friends).length}  ·  Opted into push: ${m.filter(u => u.notifications_opt_in).length}`);
  console.log(`   Median days since last play: ${median ?? "n/a"}`);
  console.log(`   Sample: ${m.slice(0, 5).map(u => `${u.name ?? "?"} <${u.email}>`).join(", ")}`);
  console.log(`\n   Send: node --env-file=.env.local scripts/segments.mjs send ${name} --template <html> --subject "..."\n`);
}

async function send(users, name, args) {
  const seg = SEGMENTS[name];
  if (!seg) { console.error(`Unknown segment "${name}".`); process.exit(1); }
  if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");

  const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
  const DRY_RUN = !args.includes("--send");
  const templatePath = flag("--template");
  const subject = flag("--subject");
  const previewText = flag("--preview-text");
  const from = flag("--from") || FROM;
  if (!templatePath) throw new Error("Pass --template <html path>");
  if (!subject) throw new Error('Pass --subject "..."');

  const html = await fs.readFile(path.isAbsolute(templatePath) ? templatePath : path.join(process.cwd(), templatePath), "utf-8");
  let m = users.filter(seg.pred);
  if (!m.length) { console.log("No sendable users in this segment. Done."); return; }

  // Frequency cap — exclude anyone ANY campaign emailed within the window, so the
  // "max N campaign emails per person" guardrail is enforced, not just hoped.
  // Pass --cap-days 0 to opt out (e.g. the daily backbone, which is its own send).
  const capDays = Number(flag("--cap-days") ?? 4);
  const campaignKey = flag("--key") || `seg:${name}`;
  if (capDays > 0) {
    const cutoff = new Date(Date.now() - capDays * 86_400_000).toISOString();
    const { data: recent, error: re } = await supabase
      .from("email_sends").select("user_id").gte("sent_at", cutoff);
    if (re) throw new Error(`email_sends read failed: ${re.message}`);
    const capped = new Set((recent ?? []).map((r) => r.user_id));
    const before = m.length;
    m = m.filter((u) => !capped.has(u.user_id));
    if (before - m.length) console.log(`   ⏳ Frequency cap (${capDays}d): held back ${before - m.length}, ${m.length} remain`);
  }
  if (!m.length) { console.log("All recipients are within the frequency cap. Nothing to send.\n"); return; }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n📣 Segment "${name}" → ${m.length} recipients  (${DRY_RUN ? "DRY RUN" : "⚡ LIVE"})`);
  console.log(`   ${seg.angle}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Cap key: ${campaignKey}  (cap ${capDays}d)`);

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceName: `seg:${name} ${today}`,
    emails: m.map(u => ({ email: u.email, firstName: u.metaFirstName ?? firstName(u.name) })),
    name: `Segment ${name} — ${today}`,
    from, replyTo: REPLY_TO, subject, previewText, html, dryRun: DRY_RUN,
  });

  // Record the send so the cap holds for the next campaign (live sends only).
  if (!DRY_RUN) {
    const rows = m.map((u) => ({ user_id: u.user_id, campaign_key: campaignKey }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: le } = await supabase.from("email_sends").insert(rows.slice(i, i + 500));
      if (le) console.warn(`   ⚠️  email_sends log failed: ${le.message}`);
    }
    console.log(`   📝 Logged ${rows.length} sends under "${campaignKey}"`);
  }

  console.log(DRY_RUN ? `\n🛑 DRY RUN — add --send to fire.\n` : `\n🎉 Broadcast fired to "${name}".\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const users = await loadUsers();

  if (argv[0] === "send") return send(users, argv[1], argv.slice(2));
  if (argv[0] && SEGMENTS[argv[0]]) return context(users, argv[0]);
  if (argv[0]) { console.error(`Unknown segment "${argv[0]}".`); }
  return snapshot(users);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
