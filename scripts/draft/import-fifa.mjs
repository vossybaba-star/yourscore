#!/usr/bin/env node
/**
 * Draft XI — FIFA ratings importer.
 *
 * Turns a SoFIFA-derived FIFA "complete player dataset" CSV (the same source
 * 38-0 uses — e.g. Stefano Leone's players_NN.csv on Kaggle/GitHub) into the
 * Premier-League-only `scripts/draft/data/players.csv` that build-dataset.mjs
 * merges in (columns: name,club,season,position,overall). Run build-dataset.mjs
 * afterwards.
 *
 * Usage: node scripts/draft/import-fifa.mjs <raw_fifa_csv> <season e.g. 2021/22>
 *
 * Real FIFA overalls are the source of truth; the curated overlay only wins on an
 * exact (player, club, season) id clash, so legends keep their hand-tuned feel.
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "data", "players.csv");

const [, , src, season] = process.argv;
if (!src || !season) {
  console.error("Usage: node scripts/draft/import-fifa.mjs <raw_fifa_csv> <season e.g. 2021/22>");
  process.exit(1);
}

// FIFA position → our canonical Position.
const POS_MAP = {
  GK: "GK", RB: "RB", RWB: "RWB", CB: "CB", LB: "LB", LWB: "LWB",
  CDM: "CDM", CM: "CM", CAM: "CAM", RM: "RW", LM: "LW", RW: "RW", LW: "LW",
  RF: "RW", LF: "LW", CF: "ST", ST: "ST",
};
const CANON = new Set(Object.values(POS_MAP));

// Minimal RFC-4180-ish CSV parser (handles quoted fields with embedded commas).
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(src, "utf8").split(/\r?\n/);
const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
const idx = (k) => header.indexOf(k);
const cName = idx("short_name"), cClub = idx("club_name"), cLeague = idx("league_name"),
  cPos = idx("player_positions"), cOvr = idx("overall");
// Nationality column varies by edition: modern EA FC = "nationality_name",
// older FIFA dumps = "nationality" or "nation".
const cNat = [idx("nationality_name"), idx("nationality"), idx("nation")].find((i) => i >= 0) ?? -1;
if ([cName, cClub, cLeague, cPos, cOvr].some((i) => i < 0)) {
  console.error("CSV missing expected columns (short_name, club_name, league_name, player_positions, overall)");
  process.exit(1);
}
if (cNat < 0) {
  console.error("CSV missing a nationality column (looked for: nationality_name, nationality, nation)");
  process.exit(1);
}

let kept = 0;
const rows = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const r = parseLine(lines[i]);
  // England only — FIFA also has Russian/Ukrainian "Premier League" + Scottish/SA.
  const lg = (r[cLeague] || "").trim().toLowerCase();
  if (lg !== "english premier league" && lg !== "premier league") continue;
  const fifaPos = (r[cPos] || "").split(",")[0].trim().toUpperCase();
  const position = POS_MAP[fifaPos];
  if (!position || !CANON.has(position)) continue;
  const name = (r[cName] || "").replace(/,/g, "").trim();
  const club = (r[cClub] || "").replace(/,/g, "").trim();
  const nationality = (r[cNat] || "").replace(/,/g, "").trim();
  const overall = parseInt(r[cOvr], 10);
  if (!name || !club || !nationality || !Number.isFinite(overall)) continue;
  rows.push(`${name},${club},${season},${position},${overall},${nationality}`);
  kept++;
}

mkdirSync(dirname(OUT), { recursive: true });
if (!existsSync(OUT)) writeFileSync(OUT, "name,club,season,position,overall,nationality\n");
appendFileSync(OUT, rows.join("\n") + "\n");
console.log(`Imported ${kept} Premier League players for ${season} → ${OUT}`);
