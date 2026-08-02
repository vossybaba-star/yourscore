/**
 * send-fantasy-launch.mjs
 *
 * Campaign: Fantasy Premier League launch (template 29)
 * Target:   ALL signed-up users (Resend Broadcast, marketing bucket)
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs                     # dry run
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs --test you@x.com    # single test email (transactional)
 *   node --env-file=.env.local scripts/send-fantasy-launch.mjs --send              # fire the broadcast
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

const LOCK_FILE = "/tmp/yourscore-send-fantasy-launch.lock";

async function main() {
  console.log(`\n⚽ YourScore — Fantasy Premier League launch`);
  console.log(`   Mode:   ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — broadcast WILL fire"}`);
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
  if (DRY_RUN) console.log(`   First 5: ${targets.slice(0, 5).map((u) => u.email).join(", ")}`);

  const html = await renderTemplate();

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: AUDIENCE_ID,
    emails: targets.map((u) => ({ email: u.email })),
    name: "Fantasy PL Launch (29-fantasy-launch)",
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
