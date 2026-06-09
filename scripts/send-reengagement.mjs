/**
 * send-reengagement.mjs
 *
 * One-off campaign script: send the World Cup re-engagement email (template 11)
 * to users who signed up within the last N hours (default 48).
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-reengagement.mjs          # dry run (preview only)
 *   node --env-file=.env.local scripts/send-reengagement.mjs --send   # actually send
 *   node --env-file=.env.local scripts/send-reengagement.mjs --send --hours 72  # last 72h
 *
 * Safety:
 *   - Default is ALWAYS dry-run. You must pass --send to fire emails.
 *   - Logs every recipient before sending.
 *   - Resend batch API: up to 100 per call — script chunks automatically.
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--send");
const hoursIdx = args.indexOf("--hours");
const LOOKBACK_HOURS = hoursIdx !== -1 ? parseInt(args[hoursIdx + 1], 10) : 48;

// ── Env ───────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://yourscore.app";
const FROM = process.env.RESEND_FROM_EMAIL ?? "YourScore <hello@yourscore.app>";

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE env vars — run with --env-file=.env.local");
if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY — run with --env-file=.env.local");

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const resend = new Resend(RESEND_KEY);

// ── Days left until World Cup (June 11 2026) ──────────────────────────────────
function daysUntilWorldCup() {
  const WC_START = new Date("2026-06-11T00:00:00Z");
  const now = new Date();
  const diff = WC_START - now;
  if (diff <= 0) return "0";
  return String(Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

// ── Load + render template ────────────────────────────────────────────────────
async function renderTemplate(userId) {
  const filePath = path.join(__dirname, "..", "emails", "lifecycle", "11-reengagement-worldcup.html");
  let html = await fs.readFile(filePath, "utf-8");

  const tokens = {
    DAYS_LEFT: daysUntilWorldCup(),
    PAUSE_URL: `${APP_URL}/settings/email?pause=all&u=${encodeURIComponent(userId)}`,
    UNSUB_URL: `${APP_URL}/settings/email?unsub=all&u=${encodeURIComponent(userId)}`,
  };

  for (const [key, value] of Object.entries(tokens)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }

  // Catch any missed tokens
  const missing = html.match(/\{\{[A-Z_a-z][A-Z_a-z0-9]*\}\}/g);
  if (missing) throw new Error(`Unsubstituted tokens: ${[...new Set(missing)].join(", ")}`);

  return html;
}

// ── Chunk array into batches ──────────────────────────────────────────────────
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏆 YourScore — World Cup Re-engagement Campaign`);
  console.log(`   Mode:     ${DRY_RUN ? "DRY RUN (no emails sent)" : "⚡ LIVE — emails WILL be sent"}`);
  console.log(`   Lookback: ${LOOKBACK_HOURS} hours\n`);

  // 1. Fetch recent signups via admin API
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  console.log(`📋 Fetching users created since ${since}...`);

  const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw new Error(`Supabase listUsers failed: ${listError.message}`);

  const recentUsers = (usersPage?.users ?? []).filter(
    (u) => u.created_at >= since && u.email,
  );

  console.log(`   Found ${recentUsers.length} user(s) who signed up in the last ${LOOKBACK_HOURS}h\n`);

  if (recentUsers.length === 0) {
    console.log("✅ No users to email. Done.\n");
    return;
  }

  // 2. Log the recipient list
  console.log("Recipients:");
  for (const u of recentUsers) {
    console.log(`   ${u.email}  (id: ${u.id}, joined: ${u.created_at})`);
  }
  console.log();

  if (DRY_RUN) {
    console.log("🛑 DRY RUN — no emails sent. Pass --send to fire.\n");
    return;
  }

  // 3. Build + send in batches of 100
  const SUBJECT = "The World Cup starts Thursday. Your mates are already playing.";
  let sent = 0;
  let failed = 0;

  const batches = chunk(recentUsers, 100);
  for (const [batchIdx, batch] of batches.entries()) {
    console.log(`📤 Sending batch ${batchIdx + 1}/${batches.length} (${batch.length} emails)...`);

    // Build each email payload individually (different unsub URLs per user)
    const payloads = await Promise.all(
      batch.map(async (u) => ({
        from: FROM,
        to: u.email,
        replyTo: "hello@yourscore.app",
        subject: SUBJECT,
        html: await renderTemplate(u.id),
        headers: { "X-Entity-Ref-ID": `reengagement-wc2026-${u.id}` },
        tags: [
          { name: "category", value: "campaign" },
          { name: "template", value: "11-reengagement-worldcup" },
        ],
      })),
    );

    const { data, error } = await resend.batch.send(payloads);

    if (error) {
      console.error(`   ❌ Batch ${batchIdx + 1} error:`, error);
      failed += batch.length;
    } else {
      const batchSent = data?.data?.length ?? 0;
      sent += batchSent;
      console.log(`   ✅ Batch ${batchIdx + 1}: ${batchSent} sent`);
    }

    // Polite pause between batches
    if (batchIdx < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n🎉 Campaign complete: ${sent} sent, ${failed} failed\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
