/**
 * studio-push.mjs — generalized push sender for the Studio dash.
 * Same targeting + safety pattern as send-england-quiz-push.mjs: opted-in users
 * with a device token, notification_log dedupe, DRY RUN unless --send.
 *
 * Usage (always: node --env-file=.env.local scripts/studio-push.mjs ...):
 *   --title "..." --body "..." [--url /path] [--key slug]   targeting: all opted-in
 *   --to <email|userId>                                     test: ONE user, bypasses opt-in + dedupe
 *   --send                                                  actually deliver (otherwise prints count)
 */
import { createClient } from "@supabase/supabase-js";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const SEND = argv.includes("--send");

const title = flag("title");
const body = flag("body");
const url = flag("url") || "/";
const to = flag("to");
if (!title || !body) { console.error('Need --title "..." and --body "..."'); process.exit(1); }
const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)) || "push";
const key = flag("key") || `studio:${new Date().toISOString().slice(0, 10)}:${slug}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env — run with --env-file=.env.local");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let targets = [];
if (to) {
  // Test mode: one user, bypass opt-in + dedupe (matches test-mastermind-push.mjs).
  let userId = to;
  if (to.includes("@")) {
    const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === to.toLowerCase());
    if (!u) { console.error(`No user with email ${to}`); process.exit(1); }
    userId = u.id;
  }
  const { data: tokens } = await db.from("device_tokens").select("platform").eq("user_id", userId);
  if (!tokens?.length) { console.error(`⚠ user has NO device tokens — open the app, grant notifications, retry.`); process.exit(1); }
  targets = [userId];
  console.log(`TEST target: ${userId} (${tokens.length} device token(s))`);
} else {
  const { data: profiles } = await db.from("profiles").select("id").eq("notifications_opt_in", true);
  const optedIn = (profiles ?? []).map((r) => r.id);
  const { data: tokenRows } = optedIn.length
    ? await db.from("device_tokens").select("user_id").in("user_id", optedIn)
    : { data: [] };
  const hasToken = new Set((tokenRows ?? []).map((r) => r.user_id));
  targets = optedIn.filter((id) => hasToken.has(id));
  // Dedupe: never double-send the same key.
  if (targets.length) {
    const { data: sent } = await db.from("notification_log").select("user_id").eq("key", key).in("user_id", targets);
    const done = new Set((sent ?? []).map((r) => r.user_id));
    targets = targets.filter((id) => !done.has(id));
  }
  console.log(`Targets: ${targets.length} users (opted-in, device token, not yet sent for key "${key}")`);
}

if (!SEND) { console.log("DRY RUN — pass --send to fire."); process.exit(0); }
if (!targets.length) { console.log("Nobody to send to."); process.exit(0); }

if (!to) await db.from("notification_log").insert(targets.map((user_id) => ({ user_id, key })));

const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
  method: "POST",
  headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
  body: JSON.stringify({ userIds: targets, title, body, url }),
});
const out = await res.text();
if (!res.ok) { console.error(`send-push failed ${res.status}: ${out.slice(0, 300)}`); process.exit(1); }
console.log(`✅ delivered to ${targets.length} user(s) — ${out.slice(0, 200)}`);
