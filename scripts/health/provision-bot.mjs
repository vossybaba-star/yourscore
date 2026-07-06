/**
 * provision-bot.mjs — ONE-TIME setup of the health-check bot account.
 *
 *   node --env-file=.env.local scripts/health/provision-bot.mjs <email> <password>
 *
 * Creates a confirmed auth user, gives it a deliberately boring display name,
 * and suppresses it from all marketing/lifecycle email. Prints the env lines
 * to paste into .env.local. Safe to re-run: existing user is reused.
 */

import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node --env-file=.env.local scripts/health/provision-bot.mjs <email> <password>");
  process.exit(1);
}

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let userId;
const { data, error } = await supa.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  if (/already.*registered|exists/i.test(error.message)) {
    // Reuse the existing account (idempotent re-run) — just reset the password.
    const { data: list, error: e2 } = await supa.auth.admin.listUsers({ perPage: 1000 });
    if (e2) { console.error(`✗ ${e2.message}`); process.exit(1); }
    const existing = list.users.find((u) => u.email === email);
    if (!existing) { console.error(`✗ user exists but not found via listUsers`); process.exit(1); }
    userId = existing.id;
    await supa.auth.admin.updateUserById(userId, { password, email_confirm: true });
    console.log(`· reusing existing user ${userId}`);
  } else {
    console.error(`✗ createUser: ${error.message}`);
    process.exit(1);
  }
} else {
  userId = data.user.id;
  console.log(`✓ created user ${userId}`);
}

// Boring, non-competitive display name — belt & braces on top of the structural
// leaderboard avoidance in the journeys layer.
const { error: pErr } = await supa.from("profiles").update({ display_name: "hc" }).eq("id", userId);
if (pErr) console.error(`⚠ profile display_name: ${pErr.message} (profile may not exist until first sign-in — rerun after step 3 below)`);
else console.log(`✓ display_name set to "hc"`);

// Keep the bot out of every campaign/lifecycle send.
const { error: sErr } = await supa.from("email_suppressions").upsert({ email, reason: "manual", detail: "health-check bot" }, { onConflict: "email" });
if (sErr) console.error(`⚠ email_suppressions: ${sErr.message}`);
else console.log(`✓ email suppressed`);

console.log(`
Add to .env.local:

HEALTH_BOT_EMAIL=${email}
HEALTH_BOT_PASSWORD=${password}
HEALTH_BOT_USER_ID=${userId}

Then verify: node --env-file=.env.local scripts/health/check.mjs --layer=journeys --no-telegram`);
