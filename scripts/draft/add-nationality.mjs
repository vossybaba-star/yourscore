#!/usr/bin/env node
/**
 * Draft XI — attach nationality to the existing pool (for the World Cup Run mode).
 *
 * IMPORTANT: this does NOT regenerate the player pool — it leaves every player's
 * name/club/season/position/overall exactly as shipped, and only ADDS a `nationality`
 * column to scripts/draft/data/players.csv by matching player NAME (+ club) against
 * source Kaggle FIFA CSVs in scripts/draft/data/raw/. Nationality is per-person and
 * time-invariant, so a union of any editions suffices; build-dataset.mjs then backfills
 * the rest by player identity across editions.
 *
 * Source CSVs (scripts/draft/data/raw/*.csv) may use either schema:
 *   - sofifa:   short_name, nationality_name, club_name
 *   - old Kaggle: Name, Nationality, Club
 *
 * Run: node scripts/draft/add-nationality.mjs   (then: node scripts/draft/build-dataset.mjs)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, "data", "raw");
const PLAYERS = join(__dirname, "data", "players.csv");

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");

// Tokenise a name to lowercase ASCII tokens.
const tokens = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Match keys for a name, covering both "E. Haaland" (pool/short) and "Erling
// Haaland" (FC24/full) styles: the full concatenation AND a first-initial+surname
// short form. Both styles collapse to the same short key.
function keysFor(name) {
  const t = tokens(name);
  if (t.length === 0) return [];
  const full = t.join("");
  if (t.length === 1) return [full];
  const short = t[0][0] + t.slice(1).join("");
  return full === short ? [full] : [full, short];
}

// RFC-4180-ish line parser (quoted fields w/ embedded commas).
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

if (!existsSync(RAW_DIR)) {
  console.error(`Missing ${RAW_DIR} — drop Kaggle FIFA CSVs there first.`);
  process.exit(1);
}

// ── Build name→nationality lookups from every raw CSV ───────────────────────
const byNameClub = new Map(); // `${name}|${club}` → nationality
const byName = new Map();      // name → Set<nationality> (collision detection)
let srcRows = 0;
const files = readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
if (files.length === 0) { console.error(`No CSVs in ${RAW_DIR}.`); process.exit(1); }

for (const f of files) {
  const lines = readFileSync(join(RAW_DIR, f), "utf8").split(/\r?\n/);
  const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/^﻿/, ""));
  const idx = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const cName = idx("short_name", "name");
  const cNat = idx("nationality_name", "nationality", "nation");
  const cClub = idx("club_name", "club");
  if (cName < 0 || cNat < 0) { console.warn(`Skipping ${f}: no name/nationality columns.`); continue; }
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = parseLine(lines[i]);
    const nat = (r[cNat] || "").trim();
    if (!nat) continue;
    const club = cClub >= 0 ? norm(r[cClub]) : "";
    const keys = keysFor(r[cName]);
    if (keys.length === 0) continue;
    for (const k of keys) {
      if (club) byNameClub.set(`${k}|${club}`, nat);
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k).add(nat);
    }
    srcRows++;
  }
}
console.log(`Loaded ${srcRows} source rows from ${files.length} CSV(s): ${files.join(", ")}`);

// ── Attach nationality to players.csv ───────────────────────────────────────
const lines = readFileSync(PLAYERS, "utf8").trim().split(/\r?\n/);
const header = parseLine(lines[0]).map((h) => h.trim().toLowerCase());
const hasNat = header.includes("nationality");
const pName = header.indexOf("name"), pClub = header.indexOf("club");

let matched = 0, byClub = 0, byUnique = 0, collision = 0, miss = 0;
const out = [hasNat ? lines[0] : `${lines[0]},nationality`];
for (let i = 1; i < lines.length; i++) {
  const r = parseLine(lines[i]);
  const club = norm(r[pClub]);
  const keys = keysFor(r[pName]);
  let nat;
  for (const k of keys) { const v = byNameClub.get(`${k}|${club}`); if (v) { nat = v; byClub++; break; } }
  if (!nat) {
    const nats = new Set();
    for (const k of keys) { const s = byName.get(k); if (s) for (const v of s) nats.add(v); }
    if (nats.size === 1) { nat = [...nats][0]; byUnique++; }
    else if (nats.size > 1) { collision++; }
    else { miss++; }
  }
  if (nat) matched++;
  // Rebuild row with nationality as the final column (strip any existing one first).
  const base = hasNat ? r.slice(0, -1) : r;
  out.push(`${base.join(",")},${nat || ""}`);
}

writeFileSync(PLAYERS, out.join("\n") + "\n");
const total = lines.length - 1;
console.log(`players.csv rows: ${total}`);
console.log(`  matched: ${matched} (${(100 * matched / total).toFixed(1)}%) — by name+club: ${byClub}, by unique name: ${byUnique}`);
console.log(`  unmatched: name collisions ${collision}, no source ${miss}`);
console.log(`Wrote ${PLAYERS}. Next: node scripts/draft/build-dataset.mjs`);
