/**
 * test-mastermind-push.mjs — fire the WC Mastermind push to ONE user (you),
 * to confirm end-to-end delivery on a real device before flipping the
 * all-users cron gate. Bypasses opt-in + dedup (it's a manual test).
 *
 * Prereq: the generalised send-push function must be DEPLOYED
 *   supabase functions deploy send-push
 * and the target user must have an iOS device token (opened the app + granted).
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-mastermind-push.mjs <userId>
 *   node --env-file=.env.local scripts/test-mastermind-push.mjs <email>
 */
import { createClient } from "@supabase/supabase-js";

const arg = process.argv[2];
if (!arg) { console.error("Pass a userId or email: node scripts/test-mastermind-push.mjs <userId|email>"); process.exit(1); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env — run with --env-file=.env.local");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Resolve email → userId if needed.
let userId = arg;
if (arg.includes("@")) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === arg.toLowerCase());
  if (!u) { console.error(`No user with email ${arg}`); process.exit(1); }
  userId = u.id;
  console.log(`Resolved ${arg} → ${userId}`);
}

// Sanity: does this user even have a device token?
const { data: tokens } = await db.from("device_tokens").select("platform").eq("user_id", userId);
if (!tokens?.length) {
  console.error(`⚠ user ${userId} has NO device tokens — open the app on your phone, grant notifications, then retry.`);
  process.exit(1);
}
console.log(`User has ${tokens.length} device token(s): ${tokens.map((t) => t.platform).join(", ")}`);

const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
  method: "POST",
  headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({
    userIds: [userId],
    title: "World Cup Mastermind is live 🧠",
    body: "Today's quiz is up. Nail it and top the board before everyone else gets their shot.",
    url: "/38-0/wc",
  }),
});
console.log(`send-push → ${res.status}`, await res.text().catch(() => ""));
console.log(res.ok ? "✅ Sent — check your phone." : "❌ Delivery failed — see status above.");
