/**
 * Reset fake profile scores from live-match points and replace with
 * realistic quiz_attempts (challenge) scores.
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY=... node scripts/reseed-fake-profiles.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mznvuswzgkaupvaqznkm.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

// This script DELETES quiz_attempts and zeroes scores for the hardcoded FAKE_IDS
// against the production project. Guard against accidental runs.
if (process.env.CONFIRM_RESEED !== "yes") {
  console.error(
    "Refusing to run: this destructively reseeds PROD profiles.\n" +
      "Re-run with CONFIRM_RESEED=yes if you are certain."
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Fake profile IDs (all seeded; none are real users) ─────────────────────
const FAKE_IDS = [
  "d9d8e252-b5d1-4021-a817-85d7120fc826", // george_davi30
  "b43273b7-67ea-4d10-beca-87fbecb7d8d6", // Femi
  "5b2fe703-9ac1-40a8-8085-7fd50720406e", // George
  "2770753f-ed7e-4db1-b0b7-ec167595e7d8", // JackW
  "efe4e57d-a29a-4d68-89ae-9706e0a82961", // Mike Wilson
  "db9ffde5-020f-4854-ac06-55320fd63fb3", // Gbenga14
  "1b41f6a4-7c40-4f31-84de-dccf1fa6eb2b", // Rob Wood
  "be215b69-708b-4401-8fb0-15f4760a1bb5", // Dylan Allen
  "035de68a-1082-4b13-8167-b29baf3d199c", // Kweku14
  "dfe97345-29ab-4a21-abd6-db8e46f94494", // Ibe Ibrahim
  "8c9032a2-63d4-4ba2-b576-83f2be1c058d", // Chisom Mensah
  "87906369-c479-49ae-a884-abc16b7bc6c1", // chisom_ng
  "12bcfbe0-357a-4486-ba1c-b77ee71627ad", // Adam Wood
  "8aa108fb-13dc-428a-b22b-dc241c4e55f5", // Rafael Ferreira
  "7468e1c8-ea16-4c7c-b991-c319def023bc", // Conor Walker
  "0919f35a-219f-42e4-be14-5ab8ea792cda", // charlie_davi5
  "77e6f6eb-bf4a-4458-8da4-03400ec38867", // Oliver Hall
  "916a8b77-6c02-4669-a17e-f210667494e1", // jackFC
  "524060b9-79b4-44af-8bd5-9bfaff8c3872", // ricardo_ldn
  "a539cae9-56d7-4bea-af2c-fa02c2de2e6d", // Charlie16
  "b50d937f-33d7-4d9b-bf3f-dde7ffff7563", // OluwaseunM
  "2f157ec1-177f-4fe6-b8dc-26403dc70241", // Bruno Hernandez
  "e3f580ca-a3b6-48de-aea1-248bb4924d41", // Ahmed24
  "3fb3b9b5-893b-4133-8c31-3906419387c7", // lewis_hall30
  "d2b5d747-c216-4f11-aba1-d0ab725fb231", // Kojo Adeleke
  "b0de4250-825b-4ea5-8146-f1a33e7eb253", // carlos_silv79
  "ba39bd70-dc42-44d9-a08c-50c5b6066080", // ConorY
  "2d4adf26-b17b-44d5-9cf0-f4dd020c596f", // AlexanderN
  "775a7fae-f813-4e65-9922-5e29fa974fb2", // Cameron Wright
  "81f14d04-5527-4673-945c-6769d8bed53e", // Jayden22
];

// All available quiz pack IDs
const PACK_IDS = [
  "d76aed15-110e-4e31-a70c-0408bc74365d", // Bournemouth
  "fb02f109-0512-4e4e-a054-d959c9db3d57", // Aston Villa
  "97e30712-e2e1-4881-af55-6326fda22067", // Arsenal
  "45da3c82-466b-4f05-b175-b8b40ebe1fd7", // Brighton
  "1625d3c3-82e7-42ed-8ba5-a25b325e54bb", // Burnley
  "8b8a8a8d-eb93-4ba5-b0c9-7dd3a04f111f", // Brentford
  "9bbdbfd9-91df-439a-8e4c-621d57a14cca", // Chelsea
  "b4195191-9064-43ca-8cb4-e30fc2a775eb", // Everton
  "17c2b608-91f8-45fd-add3-27a3e009b1b7", // Crystal Palace
  "3d37ee1b-3773-41f6-b42d-c51cbb944ec4", // Leeds United
  "6c9140d4-be26-4a85-882b-44d02605a6de", // Fulham
  "86a6783d-ce28-4856-85bb-26712c06ebfd", // Liverpool
  "acafb43a-f5f6-45dd-83a5-e82854a5730a", // Manchester City
  "05072ebb-e1a8-4a65-8252-e44ab511f9d4", // Manchester United
  "918851c6-39cb-4365-b756-a58fd680c079", // Newcastle United
  "556f16f0-484f-4772-bd3c-3e8b5dfbafb0", // Nottingham Forest
  "7d91372b-6e91-44cc-b54e-9d84ea0c7c99", // Sunderland
  "bd662c21-90e4-494d-8366-06c0b8aa61de", // Tottenham Hotspur
  "cfbcec87-947e-4259-afcb-29805a4f6270", // Wolves
  "1b6106e9-f966-468c-a43a-da487f89afa9", // West Ham United
  "29b30a9a-55c6-4ebb-87dd-0e9ebeea05f9", // Premier League Records
  "861038fe-47ce-430d-97e1-ff501fe2b169", // Champions League Records
  "3eed4064-7bcf-4f37-8e51-1d9c8cfcca4c", // World Cup Records
  "dba818bc-0688-49e9-89b0-3aa684b74f02", // Euro Championship Records
  "a3c627a0-540f-4246-9e32-ea624a60a992", // Transfer Market Records
  "36ab7beb-2370-4d6c-8756-767833fe89c1", // Penalty Shootout Lore
  "2acb5e18-e681-4a44-8995-d2ea834eff0f", // Iconic Managers
  "75cba5b6-8531-41f5-8d65-fc3a287bbab6", // Legendary Club Seasons
  "1abdf0c2-3539-44ad-a7cb-8f099cfe2f4d", // Golden Boot & Individual Awards
  "b141972a-f199-4f1b-b689-95e8eb76d8bc", // The Derbies
  "c9f8362d-8481-439c-9fa1-e739874a9f09", // The Farewell Tour
  "5cb1173f-4b09-4385-a6a2-357c40256372", // Arsenal Are Champions
  "d30d97c5-9048-4ab3-ba3f-11e75b2a6250", // The Relegation Roulette
  "a95873d5-034b-486a-8b3b-80981ffa7d93", // The Race for Europe
  "f032457f-5080-41f2-8b62-cb8f5541d82f", // World Cup Countdown
];

const MAX_SCORE = 20_000; // 20 questions × 1000 pts max

// Seeded RNG so results are reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random date within the last 90 days
function recentDate(rng) {
  const daysAgo = randInt(rng, 0, 90);
  const hoursAgo = randInt(rng, 0, 23);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hoursAgo);
  return d.toISOString();
}

// Generate a realistic score for a player of a given skill level (0–1)
function generateScore(rng, skill) {
  // Skill 0.9 = top player (16k-19k), skill 0.3 = casual (5k-10k)
  const minPct = 0.25 + skill * 0.35;  // 0.25–0.60
  const maxPct = 0.55 + skill * 0.42;  // 0.55–0.97
  const pct = minPct + rng() * (maxPct - minPct);
  const score = Math.round(pct * MAX_SCORE / 50) * 50; // round to nearest 50
  const correct = Math.round(pct * 20);
  return { score, correct };
}

async function run() {
  console.log("── Reseed fake profiles ──────────────────────────────");

  // 1. Delete existing quiz_attempts for fake profiles
  console.log("Clearing old quiz_attempts for fake profiles...");
  const { error: delErr } = await sb
    .from("quiz_attempts")
    .delete()
    .in("user_id", FAKE_IDS);
  if (delErr) console.error("  delete error:", delErr.message);
  else console.log("  ✓ cleared");

  // 2. Reset total_score and games_played to 0
  console.log("Resetting total_score + games_played to 0...");
  for (const uid of FAKE_IDS) {
    const { error } = await sb
      .from("profiles")
      .update({ total_score: 0, games_played: 0 })
      .eq("id", uid);
    if (error) console.error(`  ${uid}: ${error.message}`);
  }
  console.log("  ✓ done");

  // 3. Generate quiz_attempts for each fake profile
  console.log("Generating quiz_attempts...");

  const allAttempts = [];

  FAKE_IDS.forEach((uid, idx) => {
    const rng = mulberry32(idx * 31337 + 1);

    // Each fake user has a consistent skill level (0.3–0.95)
    const skill = 0.3 + rng() * 0.65;

    // Each fake user has played 3–10 quizzes
    const numQuizzes = randInt(rng, 3, 10);

    // Pick a random subset of packs
    const packs = shuffle(PACK_IDS, rng).slice(0, numQuizzes);

    packs.forEach((packId) => {
      const { score, correct } = generateScore(rng, skill);
      allAttempts.push({
        user_id: uid,
        pack_id: packId,
        score,
        max_score: MAX_SCORE,
        correct_count: correct,
        answers: [],
        completed_at: recentDate(rng),
      });
    });
  });

  console.log(`  Inserting ${allAttempts.length} attempts across ${FAKE_IDS.length} profiles...`);
  const { error: insErr } = await sb.from("quiz_attempts").insert(allAttempts);
  if (insErr) {
    console.error("  insert error:", insErr.message);
    return;
  }
  console.log("  ✓ inserted");

  // 4. Update each profile's total_score = sum of their quiz scores, games_played = count
  console.log("Updating profile totals from quiz scores...");
  for (const uid of FAKE_IDS) {
    const userAttempts = allAttempts.filter((a) => a.user_id === uid);
    const total = userAttempts.reduce((s, a) => s + a.score, 0);
    const games = userAttempts.length;

    const { error } = await sb
      .from("profiles")
      .update({ total_score: total, games_played: games })
      .eq("id", uid);

    if (error) console.error(`  ${uid}: ${error.message}`);
  }
  console.log("  ✓ done");

  // 5. Print summary
  console.log("\n── Summary ───────────────────────────────────────────");
  const grouped = {};
  for (const a of allAttempts) {
    if (!grouped[a.user_id]) grouped[a.user_id] = [];
    grouped[a.user_id].push(a);
  }

  const { data: profiles } = await sb
    .from("profiles")
    .select("id, display_name, total_score, games_played")
    .in("id", FAKE_IDS)
    .order("total_score", { ascending: false });

  profiles?.forEach((p) => {
    console.log(`  ${p.display_name.padEnd(20)} ${p.games_played} quizzes  ${p.total_score.toLocaleString()} pts`);
  });

  console.log("\nDone ✓");
}

run().catch(console.error);
