/**
 * Fantasy pool faces — SportMonks headshots for the whole pool, keyed by pool id.
 *
 * The tactical pitch, the core-player chips and the add list all want a real
 * face. `faceFor(name)` only covers the Higher-or-Lower photo map (famous names);
 * everyone else monograms. The pool already carries every player's smId, and the
 * SM squad object ships `image_path` — so this bakes a { poolId: url } map that
 * pushes face coverage to ~everyone, with zero new API surface (the same squads
 * endpoint build-player-photos.mjs already hits).
 *
 * Output: src/data/fantasy/pool-faces.json. Re-run when the pool is rebuilt.
 * Read-only against SportMonks; writes one JSON file.
 *
 *   SPORTMONKS_API_KEY=… node --env-file=.env.local scripts/fantasy/build-pool-faces.mjs [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DRY = process.argv.includes("--dry");
const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) { console.error("SPORTMONKS_API_KEY not set"); process.exit(1); }

const pool = JSON.parse(readFileSync(join(root, "src/data/fantasy/pool.json"), "utf8"));
const SEASON = pool.smSeasonId;
console.log(`pool ${pool.version} · SM season ${SEASON} · ${pool.players.length} players`);

const sm = (path) => `https://api.sportmonks.com/v3/football/${path}${path.includes("?") ? "&" : "?"}api_token=${KEY}`;
const getJson = async (path) => {
  const r = await fetch(sm(path));
  if (!r.ok) throw new Error(`SM ${r.status} for ${path.split("?")[0]}`);
  return (await r.json()).data ?? [];
};

// smId -> image_path, gathered team by team so we never page the whole player table.
const teams = await getJson(`teams/seasons/${SEASON}`);
console.log(`teams in season: ${teams.length}`);
const bySmId = new Map();
for (const t of teams) {
  const squad = await getJson(`squads/seasons/${SEASON}/teams/${t.id}?include=player`);
  for (const row of squad) {
    const p = row.player ?? row; // include=player nests it; be defensive
    const id = p?.id ?? row.player_id;
    const img = p?.image_path;
    if (!id || !img || String(img).includes("placeholder")) continue;
    bySmId.set(id, img);
  }
}
console.log(`SM players with a real image: ${bySmId.size}`);

// Map onto pool ids. A pool player with no SM face just stays absent -> monogram.
const faces = {};
let covered = 0;
for (const pl of pool.players) {
  const url = bySmId.get(pl.smId);
  if (url) { faces[pl.id] = url; covered++; }
}
const pct = ((covered / pool.players.length) * 100).toFixed(1);
console.log(`face coverage: ${pct}% (${covered}/${pool.players.length})`);

// Spot the misses among premiums so we can see who monograms.
const misses = pool.players.filter((p) => !faces[p.id]).slice(0, 12).map((p) => p.name);
if (misses.length) console.log(`sample misses: ${misses.join(", ")}`);

if (DRY) { console.log("dry run — not writing"); process.exit(0); }
const out = { version: pool.version, smSeasonId: SEASON, generatedFrom: "sportmonks squads image_path", faces };
writeFileSync(join(root, "src/data/fantasy/pool-faces.json"), JSON.stringify(out, null, 0) + "\n");
console.log(`wrote src/data/fantasy/pool-faces.json (${Object.keys(faces).length} faces)`);
