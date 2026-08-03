/**
 * send-fantasy-launch.mjs
 *
 * Campaign: Fantasy Premier League launch (template 29)
 * Target:   top-5,000 most-engaged users (Resend Broadcast, marketing bucket).
 *           The Marketing plan caps contacts at 5,000, so the audience is pruned
 *           to exactly the segment before the broadcast fires. Ranking:
 *             1. fantasy participants (has a squad or a shortlist row)
 *             2. games played, most first (player_game_counts — the live counter
 *                the review-ask pacing maintains)
 *             3. tiebreak: most recent activity =
 *                max(auth last_sign_in_at, email last_clicked_at, last_opened_at)
 *           Suppressions (bounces/unsubs/manual) are excluded as always.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs                     # dry run (prints segment breakdown)
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs --test you@x.com    # single test email (transactional)
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs --send              # prune audience + fire the broadcast
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { syncAndBroadcast } from "./lib/broadcast.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuppressions } from "./load-suppressions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--send") && !args.includes("--test");
const TEST_TO = args.includes("--test") ? args[args.indexOf("--test") + 1] : null;
const FAST = args.includes("--fast");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const TRANSACTIONAL_KEY = process.env.RESEND_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@yourscore.app";

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");
if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");
if (!AUDIENCE_ID) throw new Error("Missing RESEND_AUDIENCE_ID");

const SUBJECT = "Fantasy Premier League is live on YourScore";

async function renderTemplate() {
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", "29-fantasy-launch.html");
  let html = await fs.readFile(filePath, "utf-8");
  // {{UNSUB_URL}} / {{PAUSE_URL}} stay in place for broadcasts — syncAndBroadcast
  // swaps them to Resend's managed {{{RESEND_UNSUBSCRIBE_URL}}}.
  const missing = html
    .replace(/\{\{(UNSUB_URL|PAUSE_URL)\}\}/g, "")
    .match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

// ── single test send (founder preview) — transactional, one recipient ──────
if (TEST_TO) {
  if (!TRANSACTIONAL_KEY) throw new Error("Missing RESEND_API_KEY for test send");
  const html = (await renderTemplate())
    .replace(/\{\{PAUSE_URL\}\}/g, "https://yourscore.app/settings/email")
    .replace(/\{\{UNSUB_URL\}\}/g, "https://yourscore.app/settings/email");
  const resend = new Resend(TRANSACTIONAL_KEY);
  const { data, error } = await resend.emails.send({
    from: FROM, to: TEST_TO, replyTo: REPLY_TO,
    subject: `[TEST] ${SUBJECT}`, html,
    headers: { "X-Entity-Ref-ID": `fantasy-launch-test-${Date.now()}` },
  });
  if (error) throw new Error(`Test send failed: ${error.message}`);
  console.log(`✅ Test email sent to ${TEST_TO} (id ${data?.id})`);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUPPRESSED_EMAILS = await loadSuppressions();
const BLOCKED_DOMAINS = new Set(["yourscore.fake", "example.com", "test.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isSendable(email) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  if (SUPPRESSED_EMAILS.has(e)) return false;
  return !BLOCKED_DOMAINS.has(e.split("@")[1]);
}

const CAP = 5000;

/** Rank all sendable users, return the top-CAP engaged segment. */
async function engagedSegment(users) {
  const fantasyIds = new Set();
  for (const table of ["fantasy_squads", "fantasy_shortlist"]) {
    const { data, error } = await supabase.from(table).select("user_id");
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    for (const r of data ?? []) fantasyIds.add(r.user_id);
  }

  const engagement = new Map();
  {
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("email_engagement")
        .select("email,last_opened_at,last_clicked_at")
        .range(from, from + 999);
      if (error) throw new Error(`email_engagement read failed: ${error.message}`);
      for (const r of data ?? []) engagement.set(r.email.trim().toLowerCase(), r);
      if ((data ?? []).length < 1000) break;
      from += 1000;
    }
  }

  const games = new Map();
  {
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("player_game_counts")
        .select("user_id,games")
        .range(from, from + 999);
      if (error) throw new Error(`player_game_counts read failed: ${error.message}`);
      for (const r of data ?? []) games.set(r.user_id, r.games ?? 0);
      if ((data ?? []).length < 1000) break;
      from += 1000;
    }
  }

  const ts = (v) => (v ? Date.parse(v) || 0 : 0);
  const scored = users.map((u) => {
    const eng = engagement.get(u.email.trim().toLowerCase());
    return {
      email: u.email,
      fantasy: fantasyIds.has(u.id),
      games: games.get(u.id) ?? 0,
      activity: Math.max(ts(u.last_sign_in_at), ts(eng?.last_clicked_at), ts(eng?.last_opened_at)),
    };
  });
  scored.sort((a, b) => (b.fantasy - a.fantasy) || (b.games - a.games) || (b.activity - a.activity));
  const seg = scored.slice(0, CAP);

  const fantasyCount = seg.filter((s) => s.fantasy).length;
  const cutoff = seg[seg.length - 1];
  console.log(`   Segment: ${seg.length} of ${scored.length} sendable`);
  console.log(`   · fantasy participants: ${fantasyCount}`);
  console.log(`   · 10+ games: ${seg.filter((s) => s.games >= 10).length} · 3+ games: ${seg.filter((s) => s.games >= 3).length} · 1+ games: ${seg.filter((s) => s.games >= 1).length}`);
  console.log(`   · least-recent activity included: ${cutoff.activity ? new Date(cutoff.activity).toISOString().slice(0, 10) : "none on record"}`);
  return seg;
}

/** Delete audience contacts that are NOT in the target set (frees cap headroom). */
async function pruneAudience(targetEmails) {
  const { Resend } = await import("resend");
  const resend = new Resend(CAMPAIGNS_KEY);
  const { data, error } = await resend.contacts.list({ audienceId: AUDIENCE_ID });
  if (error) throw new Error(`contacts.list failed: ${error.message}`);
  const contacts = data?.data ?? [];
  const keep = new Set(targetEmails.map((e) => e.trim().toLowerCase()));
  const toDelete = contacts.filter((c) => !keep.has((c.email ?? "").trim().toLowerCase()));
  console.log(`   Audience: ${contacts.length} contacts · pruning ${toDelete.length} not in segment`);
  let done = 0;
  for (const c of toDelete) {
    const { error: delErr } = await resend.contacts.remove({ audienceId: AUDIENCE_ID, id: c.id });
    if (delErr) throw new Error(`contact delete failed (${c.id}): ${delErr.message}`);
    done++;
    if (done % 250 === 0) console.log(`   · pruned ${done}/${toDelete.length}`);
    await new Promise((r) => setTimeout(r, 120));
  }
  if (toDelete.length) console.log(`   · pruned ${toDelete.length} ✓`);
}

const LOCK_FILE = "/tmp/yourscore-send-fantasy-launch.lock";

async function main() {
  console.log(`\n⚽ YourScore — Fantasy Premier League launch`);
  console.log(`   Mode:   ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — broadcast WILL fire"}`);
  console.log(`   Target: top ${CAP} most-engaged users\n`);

  if (!DRY_RUN) {
    try {
      await fs.writeFile(LOCK_FILE, String(process.pid), { flag: "wx" });
    } catch {
      console.error(`\n❌ ABORTED — lock file exists at ${LOCK_FILE}\n`);
      process.exit(1);
    }
    process.on("exit", () => fs.unlink(LOCK_FILE).catch(() => {}));
  }

  console.log(`📋 Fetching all auth users...`);
  const allAuthUsers = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
    if (error) throw new Error(`Supabase listUsers failed: ${error.message}`);
    allAuthUsers.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < 1000) break;
    page++;
  }

  const sendable = allAuthUsers.filter((u) => u.email && isSendable(u.email));
  const skipped = allAuthUsers.filter((u) => u.email).length - sendable.length;
  if (skipped > 0) console.log(`   ⚠️  Skipped ${skipped} (suppressed / test account)`);

  const targets = await engagedSegment(sendable);
  console.log(`   Sending to ${targets.length} users\n`);
  if (targets.length === 0) { console.log("✅ No targets. Done.\n"); return; }

  if (!DRY_RUN) await pruneAudience(targets.map((t) => t.email));

  const html = await renderTemplate();

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: AUDIENCE_ID,
    emails: targets.map((u) => ({ email: u.email })),
    name: "Fantasy PL Launch — engaged 5k (29-fantasy-launch)",
    from: FROM,
    replyTo: REPLY_TO,
    subject: SUBJECT,
    html,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) console.log("\n🛑 DRY RUN — pass --send to fire.\n");
  else console.log(`\n🎉 Broadcast fired (≈${targets.length} sendable contacts).\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
