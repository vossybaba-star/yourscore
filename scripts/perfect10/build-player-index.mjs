/**
 * build-player-index.mjs — one-off backfill of every Premier League player
 * SportMonks can see, 2003/04 → current, for "Perfect 10"'s guess typeahead.
 *
 * WHY 2003/04: verified via live calls — squads only return data from
 * 2003/2004 (season id 24256) onward; 2000/01–2002/03 return "No result(s)
 * found" and are skipped naturally.
 *
 * THE TRAP (verified live): some season ids ALIAS to the current season —
 * e.g. season id 1586, labelled "2005/2006", actually returns the CURRENT
 * Man Utd squad. A naive backfill would silently duplicate "today" under 20
 * different season labels. Fix: before trusting any season, fetch Man
 * United's squad for it and compare to Man United's CURRENT squad (fetched
 * once, upfront). Identical player-id sets ⇒ the season id is an alias, not
 * real history — skip it and log why. Man Utd is the fixed reference team
 * because it has been ever-present in the Premier League across the whole
 * 2003/04→now window.
 *
 * Output:
 *   (a) upsert into p10_players via the service-role client, batched ≤500 rows.
 *   (b) public/perfect10/players.json — compact [[id,"Display Name","normalized"],…]
 *       sorted by name. Names only, no ranks/answers — safe to be public; this
 *       is the client-side typeahead source.
 *
 * Usage:
 *   node --env-file=.env.local scripts/perfect10/build-player-index.mjs [--dry-run]
 *
 * Env: SPORTMONKS_API_KEY (grep -i sportmonk .env.local — never print the value).
 * If the DB isn't reachable, the JSON file is still written (that's what the
 * UI needs) and the DB upsert is reported as pending, not fatal.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const DRY_RUN = process.argv.includes("--dry-run");

const BASE = "https://api.sportmonks.com/v3/football";
const TOKEN = process.env.SPORTMONKS_API_KEY;
if (!TOKEN) {
  console.error("Missing SPORTMONKS_API_KEY — source .env.local (node --env-file=.env.local ...)");
  process.exit(1);
}

const PL_LEAGUE_ID = 8;
const REFERENCE_TEAM_NAME = "Manchester United"; // ever-present in the PL across our window
const DELAY_MS = 200; // polite pacing between calls

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with pagination — SportMonks pages via meta.pagination + `page` query param. */
async function smGet(path, params = {}) {
  const all = [];
  let page = 1;
  for (;;) {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("api_token", TOKEN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (page > 1) url.searchParams.set("page", String(page));

    const res = await fetch(url);
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.message ?? (await res.text().catch(() => ""));
      // "No result(s) found" is an expected empty-season response, not an error.
      if (res.status === 404 || /no result/i.test(String(msg))) return all;
      throw new Error(`SportMonks ${res.status} on ${path}: ${String(msg).slice(0, 200)}`);
    }
    const data = json?.data;
    if (Array.isArray(data)) all.push(...data);
    else if (data) all.push(data);

    const pag = json?.pagination;
    if (!pag || !pag.has_more) break;
    page++;
    await sleep(DELAY_MS);
  }
  return all;
}

// ── Name normalization (KEEP IN SYNC with src/lib/games/perfect10.ts and
// scripts/perfect10/generate-lists.mjs) ────────────────────────────────────
function normalizeName(raw) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer the fullest available name. SportMonks sometimes only populates
 * display_name as an abbreviated "A. Surname" for lesser-known/youth players —
 * fall back to a fuller field when that pattern is detected. */
function playerName(row) {
  const p = row.player ?? row;
  const candidates = [p.name, p.common_name, p.display_name, [p.firstname, p.lastname].filter(Boolean).join(" ")].filter(Boolean);
  const abbreviated = (s) => /^[A-Z]\.\s/.test(s);
  const full = candidates.find((c) => !abbreviated(c));
  return full || candidates[0] || null;
}

async function main() {
  console.log(`Perfect 10 player index — ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  console.log("Fetching league 8 (Premier League) seasons...");
  const league = (await smGet(`/leagues/${PL_LEAGUE_ID}`, { include: "seasons;currentseason" }))[0];
  const seasons = league?.seasons ?? [];
  const currentSeasonId = league?.currentseason?.id ?? league?.current_season_id;
  if (!currentSeasonId) throw new Error("Could not determine current season id");
  console.log(`  ${seasons.length} seasons found, current = ${currentSeasonId}`);
  await sleep(DELAY_MS);

  console.log(`Fetching current-season teams to locate "${REFERENCE_TEAM_NAME}"...`);
  const currentTeams = await smGet(`/teams/seasons/${currentSeasonId}`);
  const refTeam = currentTeams.find((t) => (t.name ?? "").toLowerCase().includes("manchester united"));
  if (!refTeam) throw new Error(`Reference team "${REFERENCE_TEAM_NAME}" not found in current season teams`);
  await sleep(DELAY_MS);

  console.log(`Fetching current squad for ${refTeam.name} (id ${refTeam.id}) — the alias-detection baseline...`);
  const currentSquad = await smGet(`/squads/seasons/${currentSeasonId}/teams/${refTeam.id}`, { include: "player" });
  const currentSquadIds = new Set(currentSquad.map((r) => r.player_id).filter(Boolean));
  console.log(`  baseline squad: ${currentSquadIds.size} players`);
  await sleep(DELAY_MS);

  // ── Validate every other season against the alias trap ───────────────────
  const validSeasons = [];
  const skipped = [];
  for (const s of seasons) {
    if (String(s.id) === String(currentSeasonId)) {
      validSeasons.push(s);
      continue;
    }
    let squad;
    try {
      squad = await smGet(`/squads/seasons/${s.id}/teams/${refTeam.id}`, { include: "player" });
    } catch (e) {
      skipped.push({ season: s, reason: `fetch error: ${e.message}` });
      await sleep(DELAY_MS);
      continue;
    }
    await sleep(DELAY_MS);

    if (squad.length === 0) {
      skipped.push({ season: s, reason: "no squad data (pre-coverage)" });
      continue;
    }
    const ids = new Set(squad.map((r) => r.player_id).filter(Boolean));
    const identical = ids.size === currentSquadIds.size && [...ids].every((id) => currentSquadIds.has(id));
    if (identical) {
      skipped.push({ season: s, reason: "TRAP: identical to current squad — season id aliases to today" });
      continue;
    }
    validSeasons.push(s);
  }

  console.log(`  ${validSeasons.length} valid seasons, ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`    - ${s.season.name ?? s.season.id}: ${s.reason}`);

  // ── Walk every valid season × every team × every squad ────────────────────
  const players = new Map(); // id -> { id, name, source }
  let teamCalls = 0,
    squadCalls = 0;

  for (const season of validSeasons) {
    let teams;
    try {
      teams = await smGet(`/teams/seasons/${season.id}`);
    } catch (e) {
      console.warn(`  ${season.name ?? season.id}: team list failed — ${e.message}`);
      continue;
    }
    teamCalls++;
    await sleep(DELAY_MS);

    for (const team of teams) {
      let squad;
      try {
        squad = await smGet(`/squads/seasons/${season.id}/teams/${team.id}`, { include: "player" });
      } catch (e) {
        console.warn(`    ${season.name ?? season.id} / ${team.name ?? team.id}: squad failed — ${e.message}`);
        continue;
      }
      squadCalls++;
      await sleep(DELAY_MS);

      for (const row of squad) {
        const id = row.player_id;
        const name = playerName(row);
        if (!id || !name) continue;
        if (!players.has(id)) {
          players.set(id, { id, name, normalized: normalizeName(name), source: "sportmonks" });
        }
      }
    }
    console.log(`  ${season.name ?? season.id}: ${teams.length} teams, ${players.size} unique players so far`);
  }

  console.log(
    `\nDone: ${validSeasons.length} seasons, ${teamCalls} team-list calls, ${squadCalls} squad calls, ${players.size} unique players.`
  );

  if (DRY_RUN) {
    console.log("--dry-run: no writes performed.");
    return;
  }

  // ── (b) players.json — the client typeahead source ───────────────────────
  const outDir = join(ROOT, "public", "perfect10");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const sorted = [...players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const compact = sorted.map((p) => [p.id, p.name, p.normalized]);
  const outPath = join(outDir, "players.json");
  writeFileSync(outPath, JSON.stringify(compact));
  console.log(`Wrote ${compact.length} players → ${outPath}`);

  // ── (a) upsert into p10_players via service-role client ───────────────────
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, key, { auth: { persistSession: false } });

    const rows = sorted.map((p) => ({ id: p.id, name: p.name, normalized: p.normalized, source: p.source }));
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await db.from("p10_players").upsert(batch, { onConflict: "id" });
      if (error) throw error;
      console.log(`  upserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    }
    console.log("DB upsert complete.");
  } catch (e) {
    console.warn(`DB upsert PENDING (not fatal — players.json was still written): ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
