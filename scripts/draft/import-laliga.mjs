#!/usr/bin/env node
/**
 * 38-0 — La Liga ratings importer.
 *
 * The La Liga sibling of import-fifa.mjs. The raw per-edition FIFA/EA-FC dumps in
 * scripts/draft/data/raw/ have INCONSISTENT schemas (some are league-labelled, some
 * are the Kaggle "complete player dataset" with no league column at all), so this
 * script carries a per-file column map and two filtering strategies:
 *   • league-labelled editions (fifa22, fc25) → filter by the La Liga league string;
 *   • no-league Kaggle dumps  (fifa18/19/21/23, fc24) → filter by a La Liga club
 *     allowlist (distinctive city/name tokens, matched on a normalised club string).
 *
 * Output: scripts/draft/data/players-laliga.csv (same columns as players.csv —
 * name,club,season,position,overall,nationality). build-dataset.mjs merges it in,
 * tagging every row league="LaLiga". Run: `node scripts/draft/import-laliga.mjs`.
 *
 * Season labels are the real edition years, giving a coherent 2017/18→2024/25 pool
 * whose latest season (2024/25) is the modern La Liga the season simulator plays.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, "data", "raw");
const OUT = join(__dirname, "data", "players-laliga.csv");

// FIFA position → our canonical Position (identical to import-fifa.mjs).
const POS_MAP = {
  GK: "GK", RB: "RB", RWB: "RWB", CB: "CB", LB: "LB", LWB: "LWB",
  CDM: "CDM", CM: "CM", CAM: "CAM", RM: "RW", LM: "LW", RW: "RW", LW: "LW",
  RF: "RW", LF: "LW", CF: "ST", ST: "ST",
};
const CANON = new Set(Object.values(POS_MAP));

// Per-file schema (0-based column indices) + the season label + La Liga filter.
//   league !== null → label-filter on that column; league === null → club-allowlist.
const FILES = [
  { file: "fifa18.csv", season: "2017/18", name: 3, overall: 7, club: 9, nat: 5, pos: 63, league: null },
  { file: "fifa19.csv", season: "2018/19", name: 2, overall: 7, club: 9, nat: 5, pos: 21, league: null },
  { file: "fifa21.csv", season: "2020/21", name: 2, overall: 7, club: 9, nat: 5, pos: 22, league: null },
  { file: "fifa22.csv", season: "2021/22", name: 2, overall: 5, club: 14, nat: 23, pos: 4, league: 15 },
  { file: "fifa23.csv", season: "2022/23", name: 1, overall: 2, club: 14, nat: 7, pos: 5, league: null },
  { file: "fc24.csv",   season: "2023/24", name: 1, overall: 6, club: 3, nat: 2, pos: 4, league: null, gender: 45 },
  { file: "fc25.csv",   season: "2024/25", name: 3, overall: 4, club: 50, nat: 48, pos: 40, league: 49 },
];

const LALIGA_LABEL = /la\s?liga|primera\s?division|laliga/i;
// LALIGA HYPERMOTION (fc25) / Segunda are second tier — keep only the top flight.
const SECOND_TIER = /hypermotion|smartbank|segunda|2|b\b/i;

// Distinctive La Liga club tokens (union of clubs seen across 2017/18–2024/25),
// matched as substrings of a normalised club string. City/name tokens are chosen to
// avoid colliding with clubs in the worldwide no-league dumps (e.g. "bilbao" not
// "athletic", which would catch Charlton/Wigan/Oldham Athletic).
const LALIGA_TOKENS = [
  "realmadrid", "atleticomadrid", "barcelona", "sevilla", "valencia", "villarreal",
  "bilbao", "realsociedad", "betis", "celta", "espanyol", "getafe", "levante", "eibar",
  "leganes", "alaves", "girona", "osasuna", "vallecano", "valladolid", "granada",
  "cadiz", "elche", "mallorca", "almeria", "palmas", "huesca", "malaga", "coruna",
  "gijon",
];

// Reserve / B sides share the parent club's name but play in the lower leagues — drop
// them (matched on the accent-stripped lowercase club string).
const RESERVE = [
  " b", "castilla", "mestalla", "sevilla atletico", "bilbao athletic", "promesas",
  "fabril", "juvenil", "atletico madrid b", "barcelona b", "villarreal b",
];
function isReserve(club) {
  const s = (club || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return RESERVE.some((r) => (r === " b" ? s.endsWith(" b") : s.includes(r)));
}

// Normalise a club string: strip accents, lowercase, drop generic club affixes,
// collapse to alphanumerics. "Atlético de Madrid"/"Atlético Madrid" → "atleticomadrid".
function coreClub(s) {
  const stripped = (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const tokens = stripped.split(/[^a-z0-9]+/).filter(Boolean);
  const NOISE = new Set(["cf", "fc", "ud", "cd", "sd", "rc", "rcd", "ca", "sad", "de", "club"]);
  return tokens.filter((t) => !NOISE.has(t)).join("");
}
function isLaLigaClub(club) {
  if (isReserve(club)) return false;
  const core = coreClub(club);
  if (!core) return false;
  if (core === "athletic") return true; // bare "Athletic Club" (Bilbao) in some editions
  return LALIGA_TOKENS.some((t) => core.includes(t));
}

function parseLine(line) {
  const out = []; let cur = "", q = false;
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

const csvSafe = (s) => (s || "").replace(/,/g, "").trim();
// position cell can be "RW, ST, CF" or "RW ST" or "RW " — take the first token.
const firstPos = (cell) => (cell || "").split(/[,\s/]+/).filter(Boolean)[0]?.toUpperCase() || "";

const rows = [];
const perFile = [];
const clubsSeen = new Set();
for (const cfg of FILES) {
  let lines;
  try { lines = readFileSync(join(RAW, cfg.file), "utf8").split(/\r?\n/); }
  catch { console.warn(`SKIP ${cfg.file} (missing)`); continue; }
  let kept = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseLine(lines[i]);
    // Men's game only — EA FC 24/25 dumps add women's teams under the same club name
    // (e.g. "FC Barcelona"); the Gender column is the only way to separate them.
    if (cfg.gender != null && (r[cfg.gender] || "").trim().toUpperCase() !== "M") continue;
    const club = (r[cfg.club] || "").trim();
    if (!club || isReserve(club)) continue;
    // La Liga membership: label editions filter on the league string; no-league
    // editions filter on the club allowlist.
    if (cfg.league !== null) {
      const lg = (r[cfg.league] || "").trim();
      if (!LALIGA_LABEL.test(lg) || SECOND_TIER.test(lg)) continue;
    } else {
      if (!isLaLigaClub(club)) continue;
    }
    const position = POS_MAP[firstPos(r[cfg.pos])];
    if (!position || !CANON.has(position)) continue;
    const name = csvSafe(r[cfg.name]);
    const nationality = csvSafe(r[cfg.nat]);
    const overall = parseInt(r[cfg.overall], 10);
    if (!name || !Number.isFinite(overall)) continue;
    rows.push(`${name},${csvSafe(club)},${cfg.season},${position},${overall},${nationality}`);
    clubsSeen.add(`${cfg.season}:${csvSafe(club)}`);
    kept++;
  }
  perFile.push(`  ${cfg.file.padEnd(11)} ${cfg.season}  ${cfg.league !== null ? "label" : "clubs"}  → ${kept}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, "name,club,season,position,overall,nationality\n" + rows.join("\n") + "\n");
console.log("La Liga import per edition:");
console.log(perFile.join("\n"));
console.log(`\nWrote ${rows.length} La Liga player-seasons → ${OUT}`);
console.log(`Distinct club-seasons: ${clubsSeen.size}`);
