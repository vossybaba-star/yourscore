/**
 * send-wc-mastermind-launch.mjs
 *
 * Sends Email 19 (WC Mastermind launch) as a Resend BROADCAST to the main audience.
 * Uses the Marketing quota (unlimited on Pro) — NOT the Transactional quota.
 *
 * Prerequisite: run sync-all-to-audience.mjs --sync once to populate the audience.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-wc-mastermind-launch.mjs           # dry run
 *   node --env-file=.env.local scripts/send-wc-mastermind-launch.mjs --send    # FIRE
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

const SUBJECT = "World Cup Mastermind is live. Day 6 quiz is up.";
const LOCK_FILE = `/tmp/yourscore-send-wc-mastermind-launch.lock`;

async function main() {
  console.log(`\n🌍 YourScore — WC Mastermind Launch (Email 19) — BROADCAST`);
  console.log(`   Audience: ${AUDIENCE_ID}`);
  console.log(`   Subject:  ${SUBJECT}`);
  console.log(`   Mode:     ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — broadcast WILL fire"}\n`);

  if (!DRY_RUN) {
    try { await fs.writeFile(LOCK_FILE, String(process.pid), { flag: "wx" }); }
    catch { console.error(`\n❌ ABORTED — lock file exists at ${LOCK_FILE}\n`); process.exit(1); }
    process.on("exit", () => fs.unlink(LOCK_FILE).catch(() => {}));
  }

  const html = await fs.readFile(
    path.join(__dirname, "..", "emails", "lifecycle", "19-wc-mastermind-launch.html"),
    "utf-8"
  );

  // Verify no old-style tokens remain (Resend {{ ... }} vars with spaces/dots are fine)
  const bad = html.match(/\{\{[A-Z_][A-Z_0-9]*\}\}/g);
  if (bad) throw new Error(`Unresolved tokens in template: ${[...new Set(bad)].join(", ")}`);

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: AUDIENCE_ID,
    emails: null, // main audience — pre-populated via sync-all-to-audience.mjs
    name: `WC Mastermind Launch — ${new Date().toISOString().slice(0, 10)}`,
    from: FROM,
    replyTo: "hello@yourscore.app",
    subject: SUBJECT,
    html,
    dryRun: DRY_RUN,
  });

  if (!DRY_RUN) console.log(`\n🎉 Broadcast fired to entire audience.\n`);
  else console.log(`\n🛑 DRY RUN — pass --send to fire.\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
