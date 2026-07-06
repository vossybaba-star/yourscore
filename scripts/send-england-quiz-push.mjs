/**
 * send-england-quiz-push.mjs — one-off push for the England WC history quiz campaign.
 *
 * Sends to all users with notifications_opt_in = true AND at least one device token.
 * Uses the same dedupeKey pattern as notifyUsers so a retry won't double-send.
 *
 * Usage:
 *   node --env-file=.env.local scripts/send-england-quiz-push.mjs        # dry run
 *   node --env-file=.env.local scripts/send-england-quiz-push.mjs --send # fire
 */

import { createClient } from "@supabase/supabase-js";

const DRY = !process.argv.includes("--send");
const DEDUPE_KEY = "england-quiz-campaign:2026-07-05";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env — run with --env-file=.env.local");

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const raw = db;

// 1. All opted-in users with at least one device token.
const { data: profiles } = await db
  .from("profiles")
  .select("id")
  .eq("notifications_opt_in", true);

const optedIn = (profiles ?? []).map((r) => r.id);
if (!optedIn.length) { console.log("No opted-in users."); process.exit(0); }

const { data: tokenRows } = await db
  .from("device_tokens")
  .select("user_id")
  .in("user_id", optedIn);

const hasToken = new Set((tokenRows ?? []).map((r) => r.user_id));
let targets = optedIn.filter((id) => hasToken.has(id));

// 2. Skip already-sent (dedupe).
const { data: sent } = await raw
  .from("notification_log")
  .select("user_id")
  .eq("key", DEDUPE_KEY)
  .in("user_id", targets);
const alreadySent = new Set((sent ?? []).map((r) => r.user_id));
targets = targets.filter((id) => !alreadySent.has(id));

console.log(`Targets: ${targets.length} users (opted-in with device token, not yet sent)`);
if (DRY) { console.log("DRY RUN — pass --send to fire."); process.exit(0); }
if (!targets.length) { console.log("All already sent."); process.exit(0); }

// 3. Log before delivery.
await raw.from("notification_log").insert(targets.map((user_id) => ({ user_id, key: DEDUPE_KEY })));

// 4. Deliver.
const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
  method: "POST",
  headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    userIds: targets,
    title: "England face Mexico tonight 🦁",
    body: "How well do you know England's World Cup history? 15 questions before kick-off.",
    url: "/challenges/three-lions-englands-world-cup-story",
  }),
});

console.log(`send-push → ${res.status}`, await res.text().catch(() => ""));
console.log(res.ok ? `✅ Pushed to ${targets.length} users.` : "❌ Delivery failed.");
