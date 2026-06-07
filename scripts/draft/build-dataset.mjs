#!/usr/bin/env node
/**
 * Draft XI — dataset builder.
 *
 * The pool is built ENTIRELY from real FIFA ratings — no hand-made estimates.
 * Source: scripts/draft/data/players.csv (columns: name,club,season,position,
 * overall), produced from the latest EA Sports FC ratings via
 * scripts/draft/import-fifa.mjs (fifaindex.com FC26 / 2025-26 Premier League).
 *
 * Each spin deals one (club, season) bucket. Run: `node scripts/draft/build-dataset.mjs`.
 *
 * Canonical positions: GK RB CB LB RWB LWB CDM CM CAM RW LW ST
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "src", "data", "draft", "player-seasons.json");
const CSV = join(__dirname, "data", "players.csv");

const POSITIONS = new Set(["GK", "RB", "CB", "LB", "RWB", "LWB", "CDM", "CM", "CAM", "RW", "LW", "ST"]);

function slugify(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const seasonSlug = (s) => s.replace("/", "-");

function normalize(name, club, season, position, overall) {
  if (!POSITIONS.has(position)) throw new Error(`bad position ${position} for ${name}`);
  const clubSlug = slugify(club);
  const id = `${slugify(name)}-${clubSlug}-${seasonSlug(season)}`;
  return { id, name, club, clubSlug, season, position, overall: Math.round(overall), curated: false };
}

// ── Load real FIFA ratings from the CSV ─────────────────────────────────────
if (!existsSync(CSV)) {
  console.error(`Missing ${CSV} — run scripts/draft/import-fifa.mjs first.`);
  process.exit(1);
}
const byId = new Map();
const rows = readFileSync(CSV, "utf8").trim().split(/\r?\n/);
const header = rows.shift().split(",").map((h) => h.trim().toLowerCase());
const col = (r, k) => r[header.indexOf(k)]?.trim();
for (const line of rows) {
  const r = line.split(",");
  const position = (col(r, "position") || "").toUpperCase();
  if (!POSITIONS.has(position)) continue;
  try {
    const p = normalize(col(r, "name"), col(r, "club"), col(r, "season"), position, Number(col(r, "overall")));
    byId.set(p.id, p);
  } catch { /* skip malformed row */ }
}

const players = [...byId.values()].sort((a, b) => b.overall - a.overall);

// ── Spinnable buckets: (club, season) with enough players to draft from ─────
const bucketMap = new Map();
for (const p of players) {
  const key = `${p.clubSlug}__${seasonSlug(p.season)}`;
  if (!bucketMap.has(key)) bucketMap.set(key, { club: p.club, clubSlug: p.clubSlug, season: p.season, playerIds: [] });
  bucketMap.get(key).playerIds.push(p.id);
}
const MIN_BUCKET = 4; // never deal a club-season too thin to draft from
const buckets = [...bucketMap.values()].filter((b) => b.playerIds.length >= MIN_BUCKET);

// Club strength = mean overall of each club's best XI — the real rivals the season
// simulator plays against, derived from FIFA data (no hand-made numbers).
const clubStrength = (playerIds) => {
  const ovrs = playerIds.map((id) => byId.get(id).overall).sort((a, b) => b - a).slice(0, 11);
  return Math.round(ovrs.reduce((a, b) => a + b, 0) / ovrs.length);
};
const clubs = buckets
  .map((b) => ({ name: b.club, clubSlug: b.clubSlug, season: b.season, strength: clubStrength(b.playerIds) }))
  .sort((a, b) => b.strength - a.strength);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: "fifa",
  counts: { players: players.length, buckets: buckets.length, csvAdded: players.length },
  players,
  buckets,
  clubs,
}, null, 0) + "\n");

console.log(`Draft XI dataset: ${players.length} player-seasons, ${buckets.length} spinnable buckets (FIFA only).`);
console.log(`Wrote ${OUT}`);
