/**
 * reengage.mjs — the ONGOING re-engagement drip.
 *
 * Designed to run every day (alongside the engaged daily). Each run touches a
 * CAPPED slice of dormant (played-then-quiet) and never-played users with a
 * win-back, sent as Resend Broadcasts — never transactional. It is:
 *   • frequency-capped  — nobody is touched again within COOLOFF_DAYS
 *   • sunset-limited     — after MAX_TOUCHES unanswered touches we stop (protects
 *                          sender reputation; dead addresses drop out)
 *   • volume-capped      — at most DAILY_CAP emails/day, spread across cohorts
 *   • self-healing       — anyone who plays again becomes "active/cooling", starts
 *                          getting the daily, and leaves this pool automatically
 *
 * Each user falls into the FIRST cohort they match, so they only ever get one
 * touch per cycle, with copy tuned to the game they first played.
 *
 *   node --env-file=.env.local scripts/reengage.mjs                     # dry run
 *   node --env-file=.env.local scripts/reengage.mjs --send              # FIRE
 *   ...optional: --cooloff 12  --max-touches 3  --daily-cap 350
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuppressions } from "./load-suppressions.mjs";
import { syncAndBroadcast } from "./lib/broadcast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const DRY_RUN = !args.includes("--send");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@yourscore.app";
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");
if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");

const COOLOFF_DAYS = Number(flag("--cooloff") ?? 12);
const MAX_TOUCHES = Number(flag("--max-touches") ?? 3);
const DAILY_CAP = Number(flag("--daily-cap") ?? 350);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Cohorts in PRIORITY order. A user is assigned to the first one they match, so
// dormant players get a win-back tuned to the game they first played; everyone
// else falls through to a generic comeback / activation.
const COHORTS = [
  { key: "reengage:first-38",   label: "dormant · first game 38-0", template: "24-winback-first-38.html",   subject: "Remember the team you built?",                pred: u => u.engagement_tier === "dormant" && u.first_game === "38" },
  { key: "reengage:first-wc",   label: "dormant · first game WC",   template: "25-winback-first-wc.html",   subject: "Your World Cup run is still going",           pred: u => u.engagement_tier === "dormant" && u.first_game === "wc" },
  { key: "reengage:first-quiz", label: "dormant · first game quiz", template: "26-winback-first-quiz.html", subject: "There's a fresh quiz on today",               pred: u => u.engagement_tier === "dormant" && u.first_game === "quiz" },
  { key: "reengage:comeback",   label: "dormant · other",           template: "23-comeback.html",           subject: "Been a minute",                               pred: u => u.engagement_tier === "dormant" },
  { key: "reengage:never",      label: "never played",              template: "01-welcome.html",            subject: "You're signed up, but you've not played yet", pred: u => u.engagement_tier === "never" },
];

const BLOCKED = new Set(["yourscore.fake", "example.com", "test.com"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadUsers() {
  const { data: rows, error } = await supabase.rpc("get_email_segments");
  if (error) throw new Error(`get_email_segments failed: ${error.message}`);
  const emailById = new Map();
  let page = 1;
  while (true) {
    const { data, error: e } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
    if (e) throw new Error(`listUsers failed: ${e.message}`);
    for (const u of data?.users ?? []) if (u.email) emailById.set(u.id, u.email.trim().toLowerCase());
    if ((data?.users ?? []).length < 1000) break;
    page++;
  }
  const suppressed = await loadSuppressions();
  const sendable = (e) => e && EMAIL_RE.test(e) && !suppressed.has(e) && !BLOCKED.has(e.split("@")[1]);
  const users = [];
  for (const r of rows ?? []) { const email = emailById.get(r.user_id); if (sendable(email)) users.push({ ...r, email }); }
  return users;
}

function firstName(name) {
  if (!name || typeof name !== "string") return undefined;
  const f = name.trim().split(/\s+/)[0];
  return f && f.length <= 40 ? f : undefined;
}

async function main() {
  console.log(`\n♻️  YourScore re-engagement drip  (${DRY_RUN ? "DRY RUN" : "⚡ LIVE"})`);
  console.log(`   cool-off ${COOLOFF_DAYS}d · sunset after ${MAX_TOUCHES} touches · cap ${DAILY_CAP}/day\n`);

  const users = await loadUsers();

  // Frequency + sunset gates from email_sends.
  const cutoff = new Date(Date.now() - COOLOFF_DAYS * 86400_000).toISOString();
  const { data: recent } = await supabase.from("email_sends").select("user_id").gte("sent_at", cutoff);
  const inCooloff = new Set((recent ?? []).map((r) => r.user_id));
  const { data: touchRows } = await supabase.from("email_sends").select("user_id").like("campaign_key", "reengage:%");
  const touches = new Map();
  for (const r of touchRows ?? []) touches.set(r.user_id, (touches.get(r.user_id) || 0) + 1);
  const eligible = (u) => !inCooloff.has(u.user_id) && (touches.get(u.user_id) || 0) < MAX_TOUCHES;

  // Assign each user to the first cohort they match (no double-touch).
  const assigned = new Set();
  for (const c of COHORTS) {
    c.elig = users.filter((u) => !assigned.has(u.user_id) && eligible(u) && c.pred(u));
    for (const u of c.elig) assigned.add(u.user_id);
  }

  // Spread the daily cap across cohorts proportionally to their eligible size.
  const totalElig = COHORTS.reduce((s, c) => s + c.elig.length, 0);
  let budget = DAILY_CAP;
  for (const c of COHORTS) {
    const share = totalElig ? Math.min(c.elig.length, Math.round(DAILY_CAP * c.elig.length / totalElig)) : 0;
    c.batch = c.elig.slice(0, Math.min(share, budget));
    budget -= c.batch.length;
  }
  for (const c of COHORTS) { // hand any leftover budget to cohorts with more eligible
    if (budget <= 0) break;
    const more = c.elig.slice(c.batch.length, c.batch.length + budget);
    c.batch = c.batch.concat(more); budget -= more.length;
  }

  const totalToday = COHORTS.reduce((s, c) => s + c.batch.length, 0);
  console.log(`   Eligible today: ${totalElig}   ·   Sending now: ${totalToday}\n`);
  for (const c of COHORTS) console.log(`   ${c.key.padEnd(20)} ${String(c.batch.length).padStart(4)} / ${String(c.elig.length).padStart(4)} eligible   (${c.label})`);
  console.log("");

  if (!totalToday) { console.log("Nothing due today. Done.\n"); return; }

  const today = new Date().toISOString().slice(0, 10);
  for (const c of COHORTS) {
    if (!c.batch.length) continue;
    const html = await fs.readFile(path.join(__dirname, "..", "emails", "lifecycle", c.template), "utf-8");
    console.log(`📣 ${c.key}: ${c.batch.length} → "${c.subject}"`);
    await syncAndBroadcast(CAMPAIGNS_KEY, {
      audienceName: `Reengage ${c.key} ${today}`,
      cleanupPrefix: `Reengage ${c.key}`,
      emails: c.batch.map((u) => ({ email: u.email, firstName: firstName(u.name) })),
      name: `Re-engagement ${c.key} — ${today}`,
      from: FROM, replyTo: REPLY_TO, subject: c.subject, html, dryRun: DRY_RUN,
    });
    if (!DRY_RUN) {
      const rows = c.batch.map((u) => ({ user_id: u.user_id, campaign_key: c.key }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("email_sends").insert(rows.slice(i, i + 500));
        if (error) console.warn("   ⚠️  log failed:", error.message);
      }
    }
  }
  console.log(DRY_RUN ? `\n🛑 DRY RUN — add --send to fire.\n` : `\n🎉 Re-engagement drip fired: ${totalToday} touches.\n`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
