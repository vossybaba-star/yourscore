/**
 * send-wc-mastermind-lapsed.mjs
 *
 * Sends Email 20 (lapsed re-engagement) as a Resend BROADCAST to a targeted
 * audience of users who played WC Mastermind on p_played_date but not p_today_date.
 * Uses the Marketing quota (unlimited on Pro) — NOT the Transactional quota.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-wc-mastermind-lapsed.mjs           # dry run
 *   node --env-file=.env.local scripts/send-wc-mastermind-lapsed.mjs --send    # FIRE
 *   node --env-file=.env.local scripts/send-wc-mastermind-lapsed.mjs --played 2026-06-20 --today 2026-06-21 --send
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

function utcDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const PLAYED_DATE = flag("--played") ?? utcDate(-1);
const TODAY_DATE  = flag("--today")  ?? utcDate(0);

const CAMPAIGNS_KEY = process.env.RESEND_CAMPAIGNS_API_KEY;
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FROM          = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";

if (!CAMPAIGNS_KEY) throw new Error("Missing RESEND_CAMPAIGNS_API_KEY");
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUBJECT = "You played yesterday — today's run is ready.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED  = new Set(["yourscore.fake", "example.com", "test.com"]);

function isSendable(email, suppressed) {
  if (!email || typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  if (suppressed.has(e)) return false;
  return !BLOCKED.has(e.split("@")[1]);
}

async function main() {
  console.log(`\n🔔 YourScore — WC Mastermind Lapsed (Email 20) — BROADCAST`);
  console.log(`   Played:  ${PLAYED_DATE}`);
  console.log(`   Missing: ${TODAY_DATE}`);
  console.log(`   Subject: ${SUBJECT}`);
  console.log(`   Mode:    ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — broadcast WILL fire"}\n`);

  const suppressed = await loadSuppressions();
  console.log(`   ${suppressed.size} suppressed addresses loaded`);

  console.log(`   Querying lapsed players...`);
  const { data, error } = await supabase.rpc("get_wc_lapsed_players", {
    p_played_date: PLAYED_DATE,
    p_today_date: TODAY_DATE,
  });
  if (error) throw new Error(`RPC failed: ${error.message}`);

  const targets = (data ?? []).filter(u => isSendable(u.email, suppressed));
  const skipped = (data?.length ?? 0) - targets.length;
  if (skipped > 0) console.log(`   ⚠️  Skipped ${skipped} (suppressed / invalid)`);
  console.log(`   ${targets.length} recipients\n`);

  if (targets.length === 0) { console.log("✅ No targets. Done.\n"); return; }

  if (DRY_RUN) {
    console.log(`   First 5: ${targets.slice(0, 5).map(u => u.email).join(", ")}`);
    console.log(`\n🛑 DRY RUN — pass --send to fire.\n`);
    return;
  }

  const html = await fs.readFile(
    path.join(__dirname, "..", "emails", "lifecycle", "20-wc-mastermind-lapsed.html"),
    "utf-8"
  );

  const bad = html.match(/\{\{[A-Z_][A-Z_0-9]*\}\}/g);
  if (bad) throw new Error(`Unresolved tokens in template: ${[...new Set(bad)].join(", ")}`);

  const emails = targets.map(u => u.email.trim().toLowerCase());
  const audienceName = `WC Lapsed ${TODAY_DATE}`;

  await syncAndBroadcast(CAMPAIGNS_KEY, {
    audienceId: null,         // create a fresh targeted audience for this send
    audienceName,
    emails,
    name: audienceName,
    from: FROM,
    replyTo: "hello@yourscore.app",
    subject: SUBJECT,
    html,
    deleteTempAudience: false, // keep for analytics; delete manually if desired
    dryRun: false,
  });

  console.log(`\n🎉 Broadcast fired to ${targets.length} lapsed players.\n`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
