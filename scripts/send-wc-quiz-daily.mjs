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
import { Resend } from "resend";
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

const quizFile = flag("--quiz") || args.find((a) => a.endsWith(".json"));
const dayArg = flag("--day");
const descArg = flag("--desc");
const preheaderArg = flag("--preheader");

if (!quizFile) throw new Error("Pass --quiz <daily-quiz json path>");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");
if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const resend = new Resend(RESEND_KEY);

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
const PREHEADER = preheaderArg || `Day ${DAY} of the World Cup Quiz Series is live. ${properTitle}.`;
const SUBJECT = `WC 26 Quiz Series | Day ${DAY} is live. Build your streak.`;
const TEMPLATE_TAG = `wc-quiz-day${DAY}`;
const LOCK_FILE = `/tmp/yourscore-send-wc-quiz-day${DAY}.lock`;

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

async function renderTemplate(userId) {
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", "wc-quiz-daily.html");
  let html = await fs.readFile(filePath, "utf-8");
  const tokens = {
    DAY: String(DAY),
    SUBJECT: escHtml(SUBJECT),
    PREHEADER: escHtml(PREHEADER),
    QUIZ_TITLE: escHtml(properTitle),
    QUIZ_DESC: escHtml(DESC),
    QUIZ_URL: challenge,
    IMAGE_URL: shareImage,
    PAUSE_URL: `${APP_URL}/settings/email?pause=all&u=${encodeURIComponent(userId)}`,
    UNSUB_URL: `${APP_URL}/settings/email?unsub=all&u=${encodeURIComponent(userId)}`,
  };
  for (const [key, value] of Object.entries(tokens)) html = html.replaceAll(`{{${key}}}`, value);
  const missing = html.match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

async function main() {
  console.log(`\n🧠 YourScore — WC Quiz Series: Day ${DAY}`);
  console.log(`   Quiz:    ${properTitle}  (${slug})`);
  console.log(`   Subject: ${SUBJECT}`);
  console.log(`   Image:   ${shareImage}`);
  console.log(`   Link:    ${challenge}`);
  console.log(`   Mode:    ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — emails WILL be sent"}`);
  console.log(`   Target:  ALL users\n`);

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
  await renderTemplate("preflight-check");

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

  if (DRY_RUN) {
    console.log(`   First 5: ${targets.slice(0, 5).map((u) => u.email).join(", ")}`);
    console.log("\n🛑 DRY RUN — pass --send to fire.\n");
    return;
  }

  console.log(`⚙️  Pre-rendering ${targets.length} emails...`);
  const payloads = await Promise.all(
    targets.map(async (u) => ({
      from: FROM,
      to: u.email,
      replyTo: "hello@yourscore.app",
      subject: SUBJECT,
      html: await renderTemplate(u.id),
      headers: { "X-Entity-Ref-ID": `${TEMPLATE_TAG}-${u.id}` },
      tags: [
        { name: "category", value: "campaign" },
        { name: "template", value: TEMPLATE_TAG },
      ],
    }))
  );

  const batches = chunk(payloads, 100);
  const estMins = FAST ? "<1" : Math.ceil((batches.length * BATCH_DELAY_MS) / 60_000);
  console.log(`🚀 Sending ${batches.length} batch(es) of 100 — staggered every ${BATCH_DELAY_MS / 1000}s (~${estMins} min total)\n`);

  const start = Date.now();
  let sent = 0;
  for (const [i, batch] of batches.entries()) {
    const { data, error } = await resend.batch.send(batch);
    if (error) { console.error(`   ❌ Batch ${i + 1}/${batches.length} error:`, error.message); }
    else {
      sent += data?.data?.length ?? 0;
      console.log(`   ✅ Batch ${i + 1}/${batches.length}: ${data?.data?.length ?? 0} sent (${sent} total, ${((Date.now() - start) / 1000).toFixed(0)}s elapsed)`);
    }
    if (!FAST && i < batches.length - 1) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\n🎉 Done: ${sent}/${targets.length} sent in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
