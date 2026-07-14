/**
 * Fantasy pool build — FPL prices ∩ SportMonks squads, smId BAKED IN.
 *
 * The full game scores SportMonks entities; the pool is where FPL element ids
 * (prices) meet SM player ids (match facts), matched ONCE here with the gates
 * module's conservative name+club matcher — never at scoring time.
 *
 * Replay mode (default): 25/26 bootstrap cache ∩ SM season 25583 — clubs align
 * (same season both sides), so coverage should be near-total.
 * Live mode (post FPL flip): live bootstrap ∩ SM 28083.
 *
 * Run via build-pool.sh (compiles the gates modules first).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const base = new URL("../../.tmp-fantasy-pool/lib/gates/", import.meta.url);
const { fetchFplBootstrap } = await import(new URL("fpl.js", base));
const { fetchSmSeasonSquads, matchClubs, buildEnrichment } = await import(new URL("sportmonks.js", base));

const KEY = process.env.SPORTMONKS_API_KEY;
if (!KEY) { console.error("SPORTMONKS_API_KEY not set"); process.exit(1); }

const LIVE = process.env.FANTASY_POOL_MODE === "live";
const SM_SEASON = LIVE ? 28083 : 25583;
const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

const boot = LIVE
  ? await fetchFplBootstrap()
  : JSON.parse(readFileSync(join(root, "scripts/data/fpl-bootstrap-cache.json"), "utf8"));
console.log(`mode ${LIVE ? "live" : "replay"} · SM season ${SM_SEASON} · ${boot.elements.length} FPL players`);

// Display name = what fans call him. ONE rule, shared with the gates pool so the
// squad screen and the question screen never disagree. See scripts/lib/player-name.mjs.
import { displayName, assertNames } from "../lib/player-name.mjs";

// FPL Player shape the gates matcher expects (subset used by buildEnrichment)
const players = boot.elements.map((e) => ({
  id: e.id,
  name: e.web_name, // web_name kept as the MATCH key (buildEnrichment uses lastToken)
  display: displayName(e),
  fullName: `${e.first_name} ${e.second_name}`.trim(),
  position: POS[e.element_type],
  club: boot.teams.find((t) => t.id === e.team)?.short_name ?? "",
  clubId: e.team,
  price: e.now_cost / 10,
  minutes: e.minutes ?? 0,
}));

const { teams, players: smPlayers } = await fetchSmSeasonSquads(SM_SEASON, KEY);
const clubMap = matchClubs(boot.teams.map((t) => ({ id: t.id, name: t.name ?? t.short_name })), teams);
console.log(`SM squad players: ${smPlayers.length} · clubs mapped ${clubMap.size}/20`);
const enrichment = buildEnrichment(players, smPlayers, clubMap, new Date());

// Second pass: FPL web_names are often nicknames ("Virgil", "Enzo", "Bernardo")
// whose last token doesn't appear in the SM display name. Retry unmatched players
// on the FULL name's last token — same conservative uniqueness rules, restricted
// to SM players not already claimed in pass one.
{
  const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").trim();
  const lastTok = (s) => norm(s).split(/\s+/).filter(Boolean).at(-1) ?? "";
  const claimed = new Set(Array.from(enrichment.values()).map((e) => e.smId));
  const smIndex = new Map();
  for (const s of smPlayers) {
    if (claimed.has(s.smId)) continue;
    const k = `${s.clubId}:${lastTok(s.name)}`;
    smIndex.set(k, smIndex.has(k) ? "AMBIG" : s);
  }
  const fplCount = new Map();
  for (const p of players) {
    if (enrichment.has(p.id)) continue;
    const smClub = clubMap.get(p.clubId);
    const k = `${smClub}:${lastTok(p.fullName)}`;
    fplCount.set(k, (fplCount.get(k) ?? 0) + 1);
  }
  let second = 0;
  for (const p of players) {
    if (enrichment.has(p.id)) continue;
    const smClub = clubMap.get(p.clubId);
    if (smClub === undefined) continue;
    const tok = lastTok(p.fullName);
    if (!tok) continue;
    const k = `${smClub}:${tok}`;
    if (fplCount.get(k) !== 1) continue;
    const s = smIndex.get(k);
    if (!s || s === "AMBIG") continue;
    enrichment.set(p.id, { smId: s.smId });
    second++;
  }
  console.log(`second-pass (full-name) matches: +${second}`);
}

// Third pass: mononym players — FPL uses the SURNAME as web_name (Alisson =
// "A.Becker", Ederson, Bernardo) but SM lists them by the mononym, so no token
// overlaps. Match on the FPL FIRST-name token against any SM name token, unique
// per club, among still-unclaimed SM players. Same precision-over-coverage rule.
{
  const norm = (s) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").trim();
  const firstTok = (s) => norm(s).split(/\s+/).filter(Boolean)[0] ?? "";
  const claimed = new Set(Array.from(enrichment.values()).map((e) => e.smId));
  // SM index: every significant token (len≥4) → the player, at each club (ambiguous if 2+).
  const smIndex = new Map();
  for (const s of smPlayers) {
    if (claimed.has(s.smId)) continue;
    for (const t of new Set(norm(s.name).split(/\s+/).filter((t) => t.length >= 4))) {
      const k = `${s.clubId}:${t}`;
      smIndex.set(k, smIndex.has(k) ? "AMBIG" : s);
    }
  }
  const fplCount = new Map();
  for (const p of players) {
    if (enrichment.has(p.id)) continue;
    const k = `${clubMap.get(p.clubId)}:${firstTok(p.fullName)}`;
    fplCount.set(k, (fplCount.get(k) ?? 0) + 1);
  }
  let third = 0;
  for (const p of players) {
    if (enrichment.has(p.id)) continue;
    const smClub = clubMap.get(p.clubId);
    if (smClub === undefined) continue;
    const tok = firstTok(p.fullName);
    if (tok.length < 4) continue; // avoid short/ambiguous first names
    const k = `${smClub}:${tok}`;
    if (fplCount.get(k) !== 1) continue;
    const s = smIndex.get(k);
    if (!s || s === "AMBIG") continue;
    enrichment.set(p.id, { smId: s.smId });
    third++;
  }
  console.log(`third-pass (mononym/first-name) matches: +${third}`);
}

const fullClubName = new Map(boot.teams.map((t) => [t.id, t.name ?? t.short_name]));
// INTERSECTION rule (the Díaz precedent): a player without a baked smId can't be
// scored, so he can't be picked — drop him rather than let him silently score 0.
const pool = players
  .filter((p) => p.price >= 3.8 && enrichment.get(p.id)?.smId)
  .map((p) => ({
    id: p.id,
    smId: enrichment.get(p.id)?.smId ?? null,
    name: p.display, // "First Surname" (falls back to FPL web_name when unwieldy)
    club: fullClubName.get(p.clubId) ?? p.club,
    clubId: p.clubId,
    pos: p.position,
    price: p.price,
  }));

// Coverage: smId must exist for effectively every player who actually plays
const relevant = pool.filter((p) => (players.find((q) => q.id === p.id)?.minutes ?? 0) >= 450);
const covered = relevant.filter((p) => p.smId !== null).length;
const coverage = covered / Math.max(1, relevant.length);
console.log(`pool: ${pool.length} players · smId coverage among regulars (450+ min): ${(coverage * 100).toFixed(1)}% (${covered}/${relevant.length})`);
const unmatched = relevant.filter((p) => p.smId === null).slice(0, 15);
if (unmatched.length) console.log("  unmatched regulars:", unmatched.map((p) => `${p.name} (${p.club})`).join(", "));

// Names must be what fans call them — throws if FPL introduces a player the rule
// can't name (new bare-surname or abbreviation), so a bad pool can never ship.
assertNames(pool.map((p) => ({
  name: p.name, club: p.club, minutes: players.find((q) => q.id === p.id)?.minutes ?? 0,
})));

const clubs = new Set(pool.map((p) => p.clubId));
if (clubs.size !== 20) console.error(`⚠ expected 20 clubs, got ${clubs.size}`);
if (coverage < 0.95) { console.error(`❌ smId coverage ${(coverage * 100).toFixed(1)}% < 95% — do not ship this pool`); process.exit(1); }

const out = join(root, "src/data/fantasy/pool.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({
  version: new Date().toISOString().slice(0, 10),
  mode: LIVE ? "live" : "replay",
  smSeasonId: SM_SEASON,
  players: pool,
}));
console.log(`✅ wrote ${out}`);
