/**
 * seed-public-leagues.mjs — fill the Leagues Discover tab for launch.
 *
 * Creates (idempotent, safe to re-run):
 *   • one official "YourScore" account owning the World Cup Daily League
 *     (is_public + featured);
 *   • a dozen seed fan accounts (deterministic seed-fan-* emails, immediately
 *     email-suppressed so no send script can ever mail them; no gameplay data,
 *     so they can't appear on the global rank, activity metrics or shadows);
 *   • three banter public leagues owned by seed fans, padded with seed members
 *     carrying plausible league stats (league_members aggregates only).
 *
 * Remove every trace once real leagues have traction:
 *   node scripts/seed-public-leagues.mjs --remove
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OFFICIAL = { email: "leagues@yourscore.app", name: "YourScore" };
const FANS = [
  { email: "seed-fan-01@yourscore.app", name: "sunday_league_legend" },
  { email: "seed-fan-02@yourscore.app", name: "deffo_not_offside" },
  { email: "seed-fan-03@yourscore.app", name: "top_bins_tony" },
  { email: "seed-fan-04@yourscore.app", name: "wengerboy_96" },
  { email: "seed-fan-05@yourscore.app", name: "stats_steve" },
  { email: "seed-fan-06@yourscore.app", name: "pub_quiz_pete" },
  { email: "seed-fan-07@yourscore.app", name: "agueroooo_2012" },
  { email: "seed-fan-08@yourscore.app", name: "casual_carl" },
  { email: "seed-fan-09@yourscore.app", name: "offside_ollie" },
  { email: "seed-fan-10@yourscore.app", name: "tekkers_tom" },
  { email: "seed-fan-11@yourscore.app", name: "big_cup_energy" },
  { email: "seed-fan-12@yourscore.app", name: "worldie_will" },
  { email: "seed-fan-13@yourscore.app", name: "nutmeg_nige" },
  { email: "seed-fan-14@yourscore.app", name: "false9_phil" },
  { email: "seed-fan-15@yourscore.app", name: "clean_sheet_kev" },
  { email: "seed-fan-16@yourscore.app", name: "hattrick_harri" },
  { email: "seed-fan-17@yourscore.app", name: "golazo_gaz" },
  { email: "seed-fan-18@yourscore.app", name: "injury_time_ian" },
  { email: "seed-fan-19@yourscore.app", name: "five_a_side_fi" },
  { email: "seed-fan-20@yourscore.app", name: "keeper_gloves_greg" },
  { email: "seed-fan-21@yourscore.app", name: "corner_flag_col" },
  { email: "seed-fan-22@yourscore.app", name: "bicycle_kick_ben" },
  { email: "seed-fan-23@yourscore.app", name: "screamer_sam" },
  { email: "seed-fan-24@yourscore.app", name: "row_z_ricky" },
];

// Leagues that used to be seeded but are now retired (e.g. superseded by an
// official board card in Discover) — the seed run deletes them if present.
const RETIRED_LEAGUES = ["World Cup Daily League"];

// name → { owner (fan name or OFFICIAL), featured, description, members: [name, score, games] }
const LEAGUES = [
  {
    name: "It's Never a Pen FC", owner: "deffo_not_offside", featured: false, daysAgo: 6,
    description: "Contact was minimal. VAR needs glasses. State your case after each quiz.",
    members: [
      ["deffo_not_offside", 3860, 7], ["offside_ollie", 3510, 6], ["clean_sheet_kev", 3190, 6],
      ["hattrick_harri", 2740, 5], ["top_bins_tony", 2050, 4], ["injury_time_ian", 1870, 4],
      ["golazo_gaz", 1420, 3], ["row_z_ricky", 1180, 3], ["tekkers_tom", 980, 2], ["five_a_side_fi", 610, 2],
    ],
  },
  {
    name: "xG Deniers Club", owner: "stats_steve", featured: false, daysAgo: 4,
    description: "The table doesn't lie. The stats absolutely do.",
    members: [
      ["stats_steve", 2980, 5], ["wengerboy_96", 2410, 5], ["false9_phil", 2260, 4],
      ["nutmeg_nige", 1930, 4], ["corner_flag_col", 1540, 3], ["casual_carl", 1170, 3],
      ["keeper_gloves_greg", 940, 2], ["sunday_league_legend", 720, 2], ["screamer_sam", 380, 1],
    ],
  },
  {
    name: "Agüerooooo 93:20", owner: "agueroooo_2012", featured: false, daysAgo: 3,
    description: "Still not over it. Never getting over it. Daily quizzes, bragging rights only.",
    members: [
      ["agueroooo_2012", 3240, 6], ["big_cup_energy", 2870, 5], ["bicycle_kick_ben", 2380, 5],
      ["pub_quiz_pete", 2140, 4], ["golazo_gaz", 1760, 4], ["worldie_will", 1490, 3],
      ["screamer_sam", 1250, 3], ["false9_phil", 880, 2], ["clean_sheet_kev", 540, 1], ["casual_carl", 760, 2],
    ],
  },
];

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const daysAgoIso = (d, jitterH = 0) => new Date(Date.now() - d * 86400_000 + jitterH * 3600_000).toISOString();

async function findUserByEmail(email) {
  // Admin listUsers has no email filter pre-v2 GoTrue REST; page through (tiny project scale is fine).
  for (let page = 1; page <= 40; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureAccount({ email, name }) {
  let user = await findUserByEmail(email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email, password: crypto.randomBytes(24).toString("base64url"), email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    console.log("created account", name, user.id);
  }
  await db.from("profiles").upsert({ id: user.id, display_name: name, notifications_opt_in: false }, { onConflict: "id" });
  await db.from("email_suppressions").upsert({ email, reason: "manual", detail: "seed account — never email" }, { onConflict: "email" });
  return user.id;
}

async function seed() {
  const ids = new Map();
  ids.set("OFFICIAL", await ensureAccount(OFFICIAL));
  for (const f of FANS) ids.set(f.name, await ensureAccount(f));

  // Retired seeds (superseded in the product) — remove if a past run made them.
  for (const name of RETIRED_LEAGUES) {
    const { data: gone } = await db.from("leagues").delete().eq("name", name).eq("created_by", ids.get("OFFICIAL")).select("id");
    if (gone?.length) console.log("retired league", name);
  }

  for (const lg of LEAGUES) {
    const ownerId = ids.get(lg.owner);
    let { data: existing } = await db.from("leagues").select("id, code").eq("name", lg.name).eq("created_by", ownerId).maybeSingle();
    if (!existing) {
      const { data, error } = await db.from("leagues").insert({
        name: lg.name, description: lg.description, code: code(), created_by: ownerId,
        is_public: true, featured: lg.featured, created_at: daysAgoIso(lg.daysAgo),
      }).select("id, code").single();
      if (error) throw error;
      existing = data;
      console.log("created league", lg.name, existing.code);
    }
    for (let i = 0; i < lg.members.length; i++) {
      const [name, score, games] = lg.members[i];
      const attempted = games * (11 + (i % 4));
      const correct = Math.round(attempted * (0.58 + ((score % 23) / 100)));
      // TWO steps: trg_sanitize_league_member_insert (mig 13, anti-cheat)
      // ZEROES every stat column on INSERT — so upsert the membership first,
      // then write the display stats with a plain UPDATE (insert-only trigger).
      const { error } = await db.from("league_members").upsert({
        league_id: existing.id, user_id: ids.get(name),
        joined_at: daysAgoIso(lg.daysAgo, 2 + i * 7),
      }, { onConflict: "league_id,user_id" });
      if (error) throw error;
      const { error: statErr } = await db.from("league_members").update({
        total_score: score, games_played: games,
        questions_attempted: attempted, questions_correct: Math.min(correct, attempted),
        current_streak: i === 0 ? 3 : i % 3, best_streak: 3 + (score % 5),
      }).eq("league_id", existing.id).eq("user_id", ids.get(name));
      if (statErr) throw statErr;
    }
    console.log("seeded", lg.name, "→", lg.members.length, "members");
  }
}

async function remove() {
  const emails = [OFFICIAL.email, ...FANS.map((f) => f.email)];
  for (const email of emails) {
    const user = await findUserByEmail(email);
    if (!user) continue;
    // Order matters: profiles.id → auth.users is NO ACTION (not cascade), so
    // clear app rows BEFORE the auth user. Owned leagues cascade their members.
    await db.from("leagues").delete().eq("created_by", user.id);
    await db.from("league_members").delete().eq("user_id", user.id);
    await db.from("profiles").delete().eq("id", user.id);
    await db.auth.admin.deleteUser(user.id);
    await db.from("email_suppressions").delete().eq("email", email);
    console.log("removed", email);
  }
}

if (process.argv.includes("--remove")) await remove();
else await seed();
console.log("done");
