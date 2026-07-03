/**
 * send-wc-quiz-daily.mjs — ONE parameterized sender for the WC Quiz Series.
 *
 * Replaces the per-day copy of send-wc-quiz-dayN.mjs. Reads a daily-quiz JSON,
 * derives everything (slug, title, image, link, Day N, blurb) and sends the
 * tokenized template emails/lifecycle/wc-quiz-daily.html to ALL users.
 *
 * Every locked rule is preserved verbatim from send-wc-quiz-day3.mjs:
 *   • Subject:  "WC 26 Quiz Series | Day N is live. Build your streak."
 *   • Target:   ALL signed-up users (no splitting)
 *   • Batches:  100 emails, staggered 45s
 *   • Lockfile: /tmp/yourscore-send-wc-quiz-dayN.lock (prevents double-send)
 *   • Suppressions: loadSuppressions() (bounces + manual)
 *   • Streak copy lives in the template ("build your streak", never "keep")
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-wc-quiz-daily.mjs --quiz content/daily-quizzes/<file>.json           # dry run
 *   node --env-file=.env.local scripts/send-wc-quiz-daily.mjs --quiz <file>.json --day 4                         # force Day N
 *   node --env-file=.env.local scripts/send-wc-quiz-daily.mjs --quiz <file>.json --send                          # FIRE
 *   ...optional overrides: --desc "..."  --preheader "..."  --fast (no stagger; testing only)
 */

import { createClient } from "@supabase/supabase-js";
import { syncAndBroadcast } from "./lib/broadcast.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuppressions } from "./load-suppressions.mjs";
import { loadQuiz, urls, titleParts, shortDescription, deriveDay } from "./lib/quiz-launch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const DRY_RUN = !args.includes("--send");
const FAST = args.includes("--fast");
const BATCH_DELAY_MS = FAST ? 0 : 45_000;
// --no-sync: broadcast to the audience exactly as it stands, without adding any
// new contacts. Use it to stay under the Resend marketing contact cap (5,000) —
// syncing the full sendable base would push the audience past it.
const NO_SYNC = args.includes("--no-sync");
// --segment engaged|active|cooling: route the daily to just that engagement tier
// via a fresh per-campaign audience, instead of the whole standing audience.
const SEGMENT = flag("--segment");
// --mode quiz|mastermind: quiz = WC Quiz Series daily (challenge link, for
// quiz-primary players); mastermind = 38-0 World Cup Mastermind daily (/38-0/wc,
// for wc/38-primary players). Picks template + subject + which game-cohort.
const MODE = (flag("--mode") || "quiz").toLowerCase();
if (!["quiz", "mastermind"].includes(MODE)) throw new Error("--mode must be quiz|mastermind");
const MASTERMIND = MODE === "mastermind";

const quizFile = flag("--quiz") || args.find((a) => a.endsWith(".json"));
const dayArg = flag("--day");
const descArg = flag("--desc");
const preheaderArg = flag("--preheader");

if (!quizFile) throw new Error("Pass --quiz <daily-quiz json path>");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";
const REPLY_TO = process.env.RESEND_REPLY_TO ?? "hello@yourscore.app";

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");
// Bulk sends go out as a Resend BROADCAST (marketing), not transactional
// batch.send — so the daily blast no longer burns the transactional quota.
if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");
if (!AUDIENCE_ID) throw new Error("Missing RESEND_AUDIENCE_ID");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Resolve the campaign fields from the quiz ────────────────────────────────
const quiz = loadQuiz(quizFile);
const { slug, challenge, shareImage } = urls(quiz);
const { title } = titleParts(quiz);
const properTitle = quiz.name; // mixed-case for the card heading

const DAY = dayArg ? Number(dayArg) : await deriveDay(supabase, quiz);
if (!DAY || Number.isNaN(DAY)) {
  throw new Error("Could not derive Day N — pass --day <n> explicitly.");
}

const DESC = descArg || shortDescription(quiz);
const PREHEADER = preheaderArg || (MASTERMIND
  ? `Today's World Cup Mastermind is live. Answer well, draft your XI.`
  : `Day ${DAY} of the World Cup Quiz Series is live. ${properTitle}.`);
const SUBJECT = MASTERMIND
  ? `World Cup Mastermind | Day ${DAY} is live. Draft your XI.`
  : `WC 26 Quiz Series | Day ${DAY} is live. Build your streak.`;
const TEMPLATE_TAG = MASTERMIND ? `wc-mastermind-day${DAY}` : `wc-quiz-day${DAY}`;
const LOCK_FILE = `/tmp/yourscore-send-${TEMPLATE_TAG}.lock`;

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Real given name from the OAuth identity (Google/Apple populate user_metadata),
// used for the {{{FIRST_NAME|there}}} greeting. We deliberately read the IDENTITY
// name, not the in-app display name, because the latter is usually a username/handle
// ("dreamteam", "rozay") — greeting a handle looks worse than the "there" default.
// Returns undefined for handles / missing names so Resend uses "there".
const firstName = (u) => {
  const m = u?.user_metadata ?? {};
  const n = String(m.given_name || m.full_name || m.name || "").trim().split(/\s+/)[0] || "";
  if (!n || n.length > 20 || /[\d@_]/.test(n) || !/^\p{L}/u.test(n)) return undefined;
  return n;
};

async function renderTemplate() {
  const file = MASTERMIND ? "wc-mastermind-daily.html" : "wc-quiz-daily.html";
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", file);
  let html = await fs.readFile(filePath, "utf-8");
  const tokens = {
    DAY: String(DAY),
    SUBJECT: escHtml(SUBJECT),
    PREHEADER: escHtml(PREHEADER),
    QUIZ_TITLE: escHtml(properTitle),
    QUIZ_DESC: escHtml(DESC),
    QUIZ_URL: challenge,
    MASTERMIND_URL: `${APP_URL}/38-0/wc`,
    IMAGE_URL: shareImage,
  };
  for (const [key, value] of Object.entries(tokens)) html = html.replaceAll(`{{${key}}}`, value);
  // {{UNSUB_URL}} / {{PAUSE_URL}} are intentionally left in place — syncAndBroadcast
  // swaps them to Resend's managed {{{RESEND_UNSUBSCRIBE_URL}}} (broadcasts handle
  // unsubscribes at the audience level, so no per-user link is needed).
  const missing = html
    .replace(/\{\{(UNSUB_URL|PAUSE_URL)\}\}/g, "")
    .match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

async function main() {
  console.log(`\n🧠 YourScore — WC Quiz Series: Day ${DAY}`);
  console.log(`   Quiz:    ${properTitle}  (${slug})`);
  console.log(`   Subject: ${SUBJECT}`);
  console.log(`   Image:   ${shareImage}`);
  console.log(`   Email:   ${MASTERMIND ? "Mastermind daily" : "Quiz daily"}  →  ${MASTERMIND ? `${APP_URL}/38-0/wc` : challenge}`);
  console.log(`   Mode:    ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — emails WILL be sent"}`);
  console.log(`   Target:  ${SEGMENT ? `${SEGMENT} · ${MODE}` : "ALL users"}\n`);

  if (!DRY_RUN) {
    try {
      await fs.writeFile(LOCK_FILE, String(process.pid), { flag: "wx" });
    } catch {
      console.error(`\n❌ ABORTED — lock file exists at ${LOCK_FILE}\n`);
      process.exit(1);
    }
    process.on("exit", () => fs.unlink(LOCK_FILE).catch(() => {}));
  }

  // Fail fast if the template can't render (catches a missing token before we
  // page through thousands of users).
  await renderTemplate();

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

  const targets = allAuthUsers.filter((u) => u.email && isSendable(u.email));
  const skipped = allAuthUsers.filter((u) => u.email).length - targets.length;
  if (skipped > 0) console.log(`   ⚠️  Skipped ${skipped} (suppressed / test account)`);
  console.log(`   Sending to ${targets.length} users\n`);

  if (targets.length === 0) { console.log("✅ No targets. Done.\n"); return; }

  // Resolve recipients + target audience. Default: the whole standing audience.
  // With --segment, route to just that engagement tier via a fresh per-campaign
  // audience so only those people get it (the segments built in segments.mjs).
  const todayStr = new Date().toISOString().slice(0, 10);
  let recipients = targets;
  let audienceOpts = { audienceId: AUDIENCE_ID, emails: NO_SYNC ? null : targets.map((u) => ({ email: u.email })) };

  if (SEGMENT) {
    const tiers = { engaged: ["active", "cooling"], active: ["active"], cooling: ["cooling"] }[SEGMENT];
    if (!tiers) throw new Error(`Unknown --segment "${SEGMENT}" (use: engaged | active | cooling)`);
    // Split the tier by game so each person gets exactly ONE daily: quiz-primary
    // players get the Quiz daily; everyone else (wc / 38) gets the Mastermind daily.
    const gameOk = MASTERMIND ? (r) => r.primary_game !== "quiz" : (r) => r.primary_game === "quiz";
    const { data: segRows, error: segErr } = await supabase.rpc("get_email_segments");
    if (segErr) throw new Error(`get_email_segments failed: ${segErr.message}`);
    const inSeg = new Set((segRows ?? []).filter((r) => tiers.includes(r.engagement_tier) && gameOk(r)).map((r) => r.user_id));
    recipients = targets.filter((u) => inSeg.has(u.id));
    console.log(`   🎯 ${SEGMENT} · ${MODE} (${MASTERMIND ? "wc/38" : "quiz"}-primary): ${recipients.length} of ${targets.length} sendable`);
    if (!recipients.length) { console.log("✅ No recipients in this cohort. Done.\n"); return; }
    // Mode-specific name + cleanup prefix so the quiz and mastermind sends never
    // delete each other's audience (only their own prior-day one). firstName feeds
    // the {{{FIRST_NAME|there}}} greeting merge (Resend fills it per recipient).
    audienceOpts = { audienceName: `WC Daily ${MODE} ${DAY} — ${todayStr}`, cleanupPrefix: `WC Daily ${MODE}`, emails: recipients.map((u) => ({ email: u.email, firstName: firstName(u) })) };
  }

  if (DRY_RUN) console.log(`   First 5: ${recipients.slice(0, 5).map((u) => u.email).join(", ")}`);

  // One render for everyone (broadcasts aren't per-recipient).
  const html = await renderTemplate();

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    ...audienceOpts,
    name: `WC Quiz Series — Day ${DAY} (${TEMPLATE_TAG})${SEGMENT ? ` · ${SEGMENT}` : ""}`,
    from: FROM,
    replyTo: REPLY_TO,
    subject: SUBJECT,
    previewText: PREHEADER,
    html,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) console.log("\n🛑 DRY RUN — pass --send to fire.\n");
  else console.log(`\n🎉 Broadcast fired to ${SEGMENT ? `segment "${SEGMENT}"` : "the audience"} (${recipients.length} recipients).\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
