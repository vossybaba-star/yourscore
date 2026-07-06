/**
 * send-wc-quiz-day3.mjs
 *
 * Campaign: WC Quiz Series — Day 3 (template 18)
 * Target:   ALL signed-up users
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-wc-quiz-day3.mjs          # dry run
 *   node --env-file=.env.local scripts/send-wc-quiz-day3.mjs --send   # fire
 */

import { createClient } from "@supabase/supabase-js";
import { syncAndBroadcast } from "./lib/broadcast.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuppressions } from "./load-suppressions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--send");
const FAST = args.includes("--fast");
const BATCH_DELAY_MS = FAST ? 0 : 45_000;

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

async function renderTemplate() {
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", "18-wc-quiz-day3.html");
  let html = await fs.readFile(filePath, "utf-8");
  // {{UNSUB_URL}} / {{PAUSE_URL}} are intentionally left in place — syncAndBroadcast
  // swaps them to Resend's managed {{{RESEND_UNSUBSCRIBE_URL}}} (broadcasts handle
  // unsubscribes at the audience level, so no per-user link is needed).
  const missing = html
    .replace(/\{\{(UNSUB_URL|PAUSE_URL)\}\}/g, "")
    .match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);
  return html;
}

const LOCK_FILE = "/tmp/yourscore-send-wc-quiz-day3.lock";

async function main() {
  console.log(`\n🧠 YourScore — WC Quiz Series: Day 3`);
  console.log(`   Mode:   ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — emails WILL be sent"}`);
  console.log(`   Target: ALL users\n`);

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

  const targets = allAuthUsers.filter((u) => u.email && isSendable(u.email));
  const skipped = allAuthUsers.filter((u) => u.email).length - targets.length;
  if (skipped > 0) console.log(`   ⚠️  Skipped ${skipped} (suppressed / test account)`);
  console.log(`   Sending to ${targets.length} users\n`);

  if (targets.length === 0) { console.log("✅ No targets. Done.\n"); return; }

  if (DRY_RUN) {
    console.log(`   First 5: ${targets.slice(0, 5).map((u) => u.email).join(", ")}`);
  }

  const SUBJECT = "WC 26 Quiz Series | Day 3 is live. Build your streak.";

  // One render for everyone (broadcasts aren't per-recipient), then send as a
  // single Resend Broadcast to the audience — marketing, not transactional.
  const html = await renderTemplate();

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: AUDIENCE_ID,
    emails: targets.map((u) => ({ email: u.email })),
    name: "WC Quiz Series — Day 3 (18-wc-quiz-day3)",
    from: FROM,
    replyTo: REPLY_TO,
    subject: SUBJECT,
    html,
    dryRun: DRY_RUN,
  });

  if (DRY_RUN) console.log("\n🛑 DRY RUN — pass --send to fire.\n");
  else console.log(`\n🎉 Broadcast fired to the audience (≈${targets.length} sendable contacts).\n`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
