/**
 * seed-users.ts — cold-start seed accounts. Creates realistic-looking managers
 * with valid squads, webs them into a follow graph, and gives them light feed
 * activity (transfers/chips), so the follow/discover surfaces, follower counts,
 * and the activity feed have something to show before real users arrive.
 *
 * GUARDRAIL (founder call): NO fabricated points or ranks. Seed users are
 * followable and make feed moves; standings fill honestly from GW1. Every seed
 * account is flagged `profiles.is_seed = true` (mig 229) so it is excludable
 * from prizes/analytics and wipeable in one delete (see teardown at the bottom).
 *
 * Uses the REAL engine (validateSquad/smartDefaults) and preset solver, so every
 * seeded squad is a legal £100m 15. Run compiled — see scripts/fantasy/seed-users.sh.
 *
 *   node --env-file=.env.local .tmp-seed/scripts/fantasy/seed-users.js --dry
 *   node --env-file=.env.local .tmp-seed/scripts/fantasy/seed-users.js --count 3
 *   node --env-file=.env.local .tmp-seed/scripts/fantasy/seed-users.js
 */
import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { validateSquad, smartDefaults, BASELINE_CREDITS_PER_GW, type PoolPlayer } from "../../src/lib/fantasy/engine";
import { solvePreset, PRESETS, type PresetPlayer } from "../../src/lib/fantasy/presets";

const DRY = process.argv.includes("--dry");
const TEARDOWN = process.argv.includes("--teardown");
const RENAME = process.argv.includes("--rename"); // re-handle existing seeds in place
const REFEED = process.argv.includes("--refeed"); // regenerate existing seeds' feed activity
const countArg = process.argv.indexOf("--count");
const COUNT = countArg >= 0 ? Number(process.argv[countArg + 1]) : 50;
const SEED_DOMAIN = "seed.yourscore.app";

// Deterministic PRNG so a re-run is reasoned-about, not a fresh dice roll.
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260730);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const shuffle = <T>(arr: T[]): T[] => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Realistic sign-up handles — the way people actually name themselves without much
// thought. Modelled on our own real usernames (harleysims, stevo123uk, oje17,
// dcgjones, spenny, efc, Nick, hallowedbeef): mostly lowercase, name + numbers,
// initials, the odd capitalised first name or club tag. NOT copies of real users.
const FIRST = [
  "jack", "tom", "sam", "dan", "ben", "harry", "josh", "luke", "adam", "ryan", "kyle", "connor",
  "jake", "callum", "lewis", "aaron", "nathan", "reece", "charlie", "george", "oli", "will", "matt",
  "rob", "dave", "steve", "chris", "alex", "jamie", "scott", "sean", "kai", "finn", "leo", "noah",
  "jude", "mason", "cole", "drew", "marcus", "liam", "owen", "joe", "max", "elliot", "rio", "tyler",
  "spencer", "beau", "kalvin", "raz", "russ", "nick", "greg", "phil", "ash", "jef", "moey", "harls",
];
const SUR = ["jones", "smith", "walker", "hughes", "benham", "sims", "melding", "pezzella", "qnnz", "h", "b", "tp", "rl", "s"];
const TAG = ["uk", "ldn", "efc", "cfc", "afc", "lfc", "mufc", "thfc", "07", "9", "10", "21", "88"];
const WORD = ["hallowedbeef", "sixtimes", "triplej", "ghostrl", "pumpinjumpin", "hardo", "beardo", "argo", "lesquared", "dubz", "sheffieldgunner", "theviewingcentre"];

function makeHandles(n: number): string[] {
  const out = new Set<string>();
  let guard = 0;
  while (out.size < n && guard++ < n * 40) {
    const r = rnd();
    let h: string;
    if (r < 0.30) h = pick(FIRST) + (rnd() < 0.6 ? String(1 + Math.floor(rnd() * 999)) : Math.floor(rnd() * 3000 + 1980));
    else if (r < 0.48) h = pick(FIRST);                                        // plain lowercase name
    else if (r < 0.62) h = pick(FIRST) + pick(SUR);                            // name + surname/initials
    else if (r < 0.74) { const f = pick(FIRST); h = f.charAt(0).toUpperCase() + f.slice(1); } // Capitalised
    else if (r < 0.86) h = pick(FIRST) + pick(TAG);                            // name + club/place tag
    else if (r < 0.93) { const f = pick(FIRST); h = f + f.slice(-1).repeat(1 + Math.floor(rnd() * 2)); } // doubled letter
    else h = pick(WORD) + (rnd() < 0.4 ? String(Math.floor(rnd() * 99)) : ""); // the odd word handle
    if (h.length >= 2 && h.length <= 18) out.add(h);
  }
  return Array.from(out);
}

const whenIso = () => new Date(Date.now() - Math.floor(rnd() * 12 * 864e5)).toISOString();

/** Pre-season activity — what managers actually do before GW1: finalise their
 *  squad, add a player, shortlist someone. NO transfers/chips (the season hasn't
 *  started). squad_complete carries the XI so the tile can show it. */
function makePreseasonEvents(
  entries: { id: string; xi?: number[]; captain?: number }[],
  pool: PoolPlayer[],
): { actor_id: string; type: string; gw: number | null; payload: Record<string, unknown>; created_at: string }[] {
  const events: ReturnType<typeof makePreseasonEvents> = [];
  for (const e of entries) {
    if (e.xi && e.xi.length && rnd() < 0.85)
      events.push({ actor_id: e.id, type: "squad_complete", gw: null, payload: { xi: e.xi, captain: e.captain ?? null }, created_at: whenIso() });
    const shortlists = Math.floor(rnd() * 3); // 0-2 shortlisted players
    for (let s = 0; s < shortlists; s++)
      events.push({ actor_id: e.id, type: "shortlist_add", gw: null, payload: { player: pick(pool).id }, created_at: whenIso() });
    if (rnd() < 0.4) // some reshaped their squad
      events.push({ actor_id: e.id, type: "squad_update", gw: null, payload: { player: pick(pool).id }, created_at: whenIso() });
  }
  return events;
}

interface PoolFile { players: { id: number; smId: number; name: string; club: string; clubId: number; pos: PoolPlayer["pos"]; price: number }[] }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Teardown: remove every seed account + everything they wrote. The whole point
  // of the is_seed flag — one command wipes them, real users are untouched.
  if (TEARDOWN) {
    const { data: seeds } = await db.from("profiles").select("id").eq("is_seed", true);
    const ids = ((seeds ?? []) as { id: string }[]).map((s) => s.id);
    console.log(`Tearing down ${ids.length} seed accounts…`);
    if (ids.length) {
      await db.from("fantasy_feed_events").delete().in("actor_id", ids);
      await db.from("user_follows").delete().in("follower_id", ids);
      await db.from("user_follows").delete().in("followee_id", ids);
      await db.from("fantasy_squads").delete().in("user_id", ids);
      await db.from("fantasy_entries").delete().in("user_id", ids);
      await db.from("profiles").delete().in("id", ids);
      for (const id of ids) { try { await db.auth.admin.deleteUser(id); } catch { /* already gone */ } }
    }
    console.log("Teardown done.");
    return;
  }

  // Rename: re-handle existing seeds in place (keeps their ids, squads, follow
  // graph and feed events intact) — for when the naming style changes.
  if (RENAME) {
    const { data: seeds } = await db.from("profiles").select("id").eq("is_seed", true);
    const ids = ((seeds ?? []) as { id: string }[]).map((s) => s.id);
    const handles = makeHandles(ids.length);
    console.log(`${DRY ? "[DRY] " : ""}Renaming ${ids.length} seeds…`);
    for (let i = 0; i < ids.length; i++) {
      if (DRY) { if (i < 8) console.log(`  ${ids[i].slice(0, 8)} → ${handles[i]}`); continue; }
      await db.from("profiles").update({ display_name: handles[i], username: null }).eq("id", ids[i]);
    }
    console.log(DRY ? "[DRY] sample above." : "Rename done.");
    return;
  }

  const poolFile = JSON.parse(readFileSync(join(process.cwd(), "src/data/fantasy/pool.json"), "utf8")) as PoolFile;
  const pool: PoolPlayer[] = poolFile.players.map((p) => ({
    id: p.id, smId: p.smId, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos,
    priceTenths: Math.round(p.price * 10),
  }));
  const presetPool: PresetPlayer[] = pool.map((p) => ({ id: p.id, pos: p.pos, clubId: p.clubId, priceTenths: p.priceTenths }));
  const premiums = shuffle(pool.filter((p) => p.priceTenths >= 90)).map((p) => p.id); // anchor candidates for variety
  const nameById = new Map(pool.map((p) => [p.id, p.name]));

  // Refeed: swap existing seeds' feed activity for pre-season events (finalised
  // squads, shortlists) — for when the activity model changes.
  if (REFEED) {
    const { data: seeds } = await db.from("profiles").select("id").eq("is_seed", true);
    const ids = ((seeds ?? []) as { id: string }[]).map((s) => s.id);
    const { data: squads } = await db.from("fantasy_squads").select("user_id, xi, captain").in("user_id", ids);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const squadOf = new Map((squads ?? []).map((s: any) => [s.user_id, { xi: s.xi as number[], captain: s.captain as number }]));
    const events = makePreseasonEvents(ids.map((id) => ({ id, xi: squadOf.get(id)?.xi, captain: squadOf.get(id)?.captain })), pool);
    console.log(`${DRY ? "[DRY] " : ""}Refeeding ${ids.length} seeds → ${events.length} pre-season events`);
    if (!DRY) {
      await db.from("fantasy_feed_events").delete().in("actor_id", ids); // likes cascade (mig 226)
      const { error } = await db.from("fantasy_feed_events").insert(events);
      if (error) console.error(`  ! insert: ${error.message}`);
    }
    console.log(DRY ? "[DRY] no writes." : "Refeed done.");
    return;
  }

  const n = COUNT;
  const handles = makeHandles(n);
  console.log(`${DRY ? "[DRY] " : ""}Seeding ${n} users…`);

  const created: { id: string; name: string; squadOk: boolean; xi?: number[]; captain?: number }[] = [];

  for (let i = 0; i < n; i++) {
    const name = handles[i];
    const email = `seed-${i}-${Math.floor(rnd() * 1e6)}@${SEED_DOMAIN}`;
    const avatar = `/avatars/fan-${String((i % 16) + 1).padStart(2, "0")}.webp`;

    // Build a valid squad: a preset shape + 1-2 premium anchors for variety.
    const shape = PRESETS[i % PRESETS.length];
    const anchors = shuffle(premiums).slice(0, 1 + Math.floor(rnd() * 2));
    const pickIds = solvePreset(shape, presetPool, 1000, anchors);
    let squadOk = false;
    let row: Record<string, unknown> | null = null;
    try {
      const squad = validateSquad(pickIds, pool);
      const sel = smartDefaults(squad, pool);
      squadOk = true;
      row = {
        picks: squad.picks, bank_tenths: squad.bankTenths, credits: BASELINE_CREDITS_PER_GW,
        xi: sel.xi, bench: sel.bench, captain: sel.captain, vice: sel.vice,
        created_gw: 1, version: 0, chip_log: [],
      };
    } catch (e) {
      console.error(`  ! squad invalid for ${name}: ${(e as Error).message}`);
    }

    if (DRY) {
      created.push({ id: `dry-${i}`, name, squadOk });
      continue;
    }

    // Auth user (profiles.id FKs auth.users). Confirmed so it's a normal account.
    const { data: userRes, error: uErr } = await db.auth.admin.createUser({
      email, password: `Seed!${Math.floor(rnd() * 1e9)}aZ`, email_confirm: true,
      user_metadata: { display_name: name, is_seed: true },
    });
    if (uErr || !userRes?.user) { console.error(`  ! createUser failed for ${name}: ${uErr?.message}`); continue; }
    const uid = userRes.user.id;

    const createdAt = new Date(Date.now() - Math.floor(rnd() * 20 + 1) * 864e5).toISOString();
    const { error: pErr } = await db.from("profiles").upsert({
      id: uid, display_name: name, username: null,
      avatar_url: avatar, is_seed: true, source: "seed", notifications_opt_in: false, created_at: createdAt,
    });
    if (pErr) console.error(`  ! profile failed for ${name}: ${pErr.message}`);

    if (row) {
      const { error: sErr } = await db.from("fantasy_squads").upsert({ user_id: uid, ...row }, { onConflict: "user_id" });
      if (sErr) console.error(`  ! squad row failed for ${name}: ${sErr.message}`);
    }

    created.push({ id: uid, name, squadOk, xi: row?.xi as number[] | undefined, captain: row?.captain as number | undefined });
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const realIds = created.filter((c) => !c.id.startsWith("dry-")).map((c) => c.id);
  console.log(`Created ${realIds.length} accounts (${created.filter((c) => c.squadOk).length} valid squads).`);

  if (DRY || realIds.length === 0) {
    console.log(DRY ? "[DRY] no follows/feed written." : "no accounts to link.");
    return;
  }

  // Follow graph — each seed follows 4-12 others, so counts are non-zero and the
  // graph looks established. Real users can follow them on top.
  const follows: { follower_id: string; followee_id: string }[] = [];
  for (const c of realIds) {
    const others = shuffle(realIds.filter((x) => x !== c)).slice(0, 4 + Math.floor(rnd() * 9));
    for (const o of others) follows.push({ follower_id: c, followee_id: o });
  }
  const { error: fErr } = await db.from("user_follows").upsert(follows, { onConflict: "follower_id,followee_id" });
  console.log(fErr ? `  ! follows: ${fErr.message}` : `Follow edges: ${follows.length}`);

  // Pre-season feed activity — finalised squads (tile shows the XI), shortlisted
  // players, the odd squad reshuffle. NO transfers/chips: the season hasn't started.
  const events = makePreseasonEvents(
    created.filter((c) => !c.id.startsWith("dry-")).map((c) => ({ id: c.id, xi: c.xi, captain: c.captain })),
    pool,
  );
  const { error: eErr } = await db.from("fantasy_feed_events").insert(events);
  console.log(eErr ? `  ! feed: ${eErr.message}` : `Feed events: ${events.length}`);
  void nameById; // reserved for future richer payloads
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
