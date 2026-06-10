/**
 * delete-fake-profiles.mjs
 *
 * Permanently removes the seeded "fake" users that were created to pad the
 * leaderboard (all on the @yourscore.fake domain — never real inboxes, never
 * signed in). These were a deliverability liability (Supabase flagged a high
 * bounce rate, Jun 2026) and are no longer wanted.
 *
 * Scope: EVERY auth user whose email ends in @yourscore.fake, plus their
 * dependent rows (profiles, quiz_attempts). Verified footprint at time of
 * writing: 450 users, 450 profiles, 172 quiz_attempts, 0 rows elsewhere.
 *
 * This is the destructive counterpart to reseed-fake-profiles.mjs — fakes can
 * be regenerated from the seed scripts if ever needed, so this is reversible.
 *
 * Usage:
 *   node --env-file=.env.local scripts/delete-fake-profiles.mjs                 # DRY RUN (preview only)
 *   CONFIRM_DELETE=yes node --env-file=.env.local scripts/delete-fake-profiles.mjs   # actually delete
 *
 * Safety:
 *   - Default is ALWAYS dry-run. You must set CONFIRM_DELETE=yes to delete.
 *   - Matches ONLY the @yourscore.fake domain — real users can never match.
 *   - Refuses to run if it would match an implausibly large share of accounts.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://mznvuswzgkaupvaqznkm.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM = process.env.CONFIRM_DELETE === "yes";
const FAKE_DOMAIN = "@yourscore.fake";

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required — run with --env-file=.env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Page through ALL auth users (admin.listUsers caps at 1000/page).
async function listAllUsers() {
  const all = [];
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    all.push(...users);
    if (users.length < 1000) break;
  }
  return all;
}

async function run() {
  console.log("\n🗑  Delete fake (@yourscore.fake) seed profiles");
  console.log(`   Mode: ${CONFIRM ? "⚡ LIVE — rows WILL be deleted" : "DRY RUN (nothing deleted)"}\n`);

  const allUsers = await listAllUsers();
  const fakes = allUsers.filter((u) => (u.email ?? "").toLowerCase().endsWith(FAKE_DOMAIN));
  const fakeIds = fakes.map((u) => u.id);

  console.log(`   Total users in project: ${allUsers.length}`);
  console.log(`   Matching ${FAKE_DOMAIN}:    ${fakes.length}`);

  if (fakes.length === 0) {
    console.log("\n✅ No fake users found. Nothing to do.\n");
    return;
  }

  // Sanity guard: never nuke a majority of the user base, even if the filter is wrong.
  const share = fakes.length / Math.max(allUsers.length, 1);
  if (share > 0.6) {
    console.error(`\n🛑 Refusing: ${(share * 100).toFixed(0)}% of users matched — that looks wrong. Aborting.\n`);
    process.exit(1);
  }

  // Belt-and-braces: confirm none of them have ever signed in (real users would).
  const everSignedIn = fakes.filter((u) => u.last_sign_in_at).length;
  if (everSignedIn > 0) {
    console.warn(`   ⚠️  ${everSignedIn} matched account(s) have a last_sign_in_at — review before deleting.`);
  }

  console.log("\n   Sample:");
  fakes.slice(0, 5).forEach((u) => console.log(`     ${u.email}  (${u.id})`));

  if (!CONFIRM) {
    console.log(`\n🛑 DRY RUN — set CONFIRM_DELETE=yes to delete these ${fakes.length} users and their data.\n`);
    return;
  }

  // 1. Dependent rows first (FK-safe regardless of cascade config).
  console.log("\n   Deleting quiz_attempts...");
  const { error: qaErr, count: qaCount } = await sb
    .from("quiz_attempts")
    .delete({ count: "exact" })
    .in("user_id", fakeIds);
  if (qaErr) console.error(`     quiz_attempts: ${qaErr.message}`);
  else console.log(`     ✓ removed ${qaCount ?? 0} quiz_attempts`);

  console.log("   Deleting profiles...");
  const { error: pErr, count: pCount } = await sb
    .from("profiles")
    .delete({ count: "exact" })
    .in("id", fakeIds);
  if (pErr) console.error(`     profiles: ${pErr.message}`);
  else console.log(`     ✓ removed ${pCount ?? 0} profiles`);

  // 2. Auth users (one call each via admin API).
  console.log("   Deleting auth users...");
  let deleted = 0;
  let failed = 0;
  for (const id of fakeIds) {
    const { error } = await sb.auth.admin.deleteUser(id);
    if (error) { failed++; console.error(`     ${id}: ${error.message}`); }
    else deleted++;
  }
  console.log(`     ✓ deleted ${deleted} auth users (${failed} failed)`);

  console.log(`\n🎉 Done. Removed ${deleted}/${fakes.length} fake users and their data.\n`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
