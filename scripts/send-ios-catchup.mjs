/**
 * send-ios-catchup.mjs
 *
 * Sends Email 21 (iOS App Store launch + WC catch-up announcement) as a
 * Resend Broadcast to the main audience.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-ios-catchup.mjs        # dry run
 *   node --env-file=.env.local scripts/send-ios-catchup.mjs --send # FIRE
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncAndBroadcast } from "./lib/broadcast.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--send");

const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const AUDIENCE_ID   = process.env.RESEND_AUDIENCE_ID;
const FROM          = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";

if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");
if (!AUDIENCE_ID)   throw new Error("Missing RESEND_AUDIENCE_ID");

const SUBJECT   = "YourScore is on the App Store. WC26 38-0 Catchup is live!";
const LOCK_FILE = `/tmp/yourscore-send-ios-catchup.lock`;

async function main() {
  console.log(`\n📱 YourScore — iOS + Catch-Up (Email 21) — BROADCAST`);
  console.log(`   Subject: ${SUBJECT}`);
  console.log(`   Mode:    ${DRY_RUN ? "DRY RUN" : "⚡ LIVE"}\n`);

  if (!DRY_RUN) {
    try { await fs.writeFile(LOCK_FILE, String(process.pid), { flag: "wx" }); }
    catch { console.error(`\n❌ ABORTED — lock file exists at ${LOCK_FILE}\n`); process.exit(1); }
    process.on("exit", () => fs.unlink(LOCK_FILE).catch(() => {}));
  }

  const html = await fs.readFile(
    path.join(__dirname, "..", "emails", "lifecycle", "21-ios-catchup.html"),
    "utf-8"
  );

  const bad = html.match(/\{\{[A-Z_][A-Z_0-9]*\}\}/g);
  if (bad) throw new Error(`Unresolved tokens: ${[...new Set(bad)].join(", ")}`);

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: AUDIENCE_ID,
    emails: null,
    name: `iOS + WC Catch-Up — Email 21`,
    from: FROM,
    replyTo: "hello@yourscore.app",
    subject: SUBJECT,
    html,
    dryRun: DRY_RUN,
  });

  if (!DRY_RUN) console.log(`\n🎉 Broadcast fired.\n`);
  else console.log(`\n🛑 DRY RUN — pass --send to fire.\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
