/**
 * SportMonks client — Premier League ground-truth facts for the quiz factory.
 *
 * PL only (league 8), per the standing rule (Sportmonks FIRST for football data; non-PL →
 * the football-data skill). This is the cost fix: the fact-check gate's dominant cost is
 * a web search per question. For any fact SportMonks holds — final tables, points, title
 * winners, per-season top scorers — we ground the author AND the verifier in this data
 * instead, so those questions cost tokens, not searches.
 *
 * Past seasons never change, so every season's table + scorers is cached to disk
 * (scripts/data/sportmonks-cache/) and fetched exactly once.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://api.sportmonks.com/v3/football";
const PL_LEAGUE_ID = 8;
const GOALS_TYPE = 208; // topscorer type: goals (verified: Haaland 27 in 2023/24)
const CACHE_DIR = join(process.cwd(), "scripts/data/sportmonks-cache");

/**
 * Every competition the subscription covers (probed 2026-07-16, after the European upgrade).
 * PL is the league backbone; the European cups are where a club's honours live — and honours
 * were previously web-only, which is what made History & Honours expensive.
 */
export const COMPETITIONS = {
  8: { name: "Premier League", short: "PL", league: true },
  2: { name: "Champions League", short: "UCL", league: false },
  5: { name: "Europa League", short: "UEL", league: false },
  2286: { name: "Europa Conference League", short: "UECL", league: false },
  1328: { name: "UEFA Super Cup", short: "Super Cup", league: false },
};
const EURO_CUPS = [2, 5, 2286, 1328];

const key = () => {
  const k = process.env.SPORTMONKS_API_KEY;
  if (!k) throw new Error("SPORTMONKS_API_KEY not set (source .env.local)");
  return k;
};

// SportMonks team name ⇄ our club strings. SportMonks is canonical; this maps the aliases
// our bank/pack names use onto it so a club resolves regardless of which form is passed.
const CLUB_ALIASES = {
  "Man Utd": "Manchester United", "Man United": "Manchester United",
  "Man City": "Manchester City",
  "Spurs": "Tottenham Hotspur", "Tottenham": "Tottenham Hotspur",
  "Wolves": "Wolverhampton Wanderers",
  "Newcastle": "Newcastle United",
  "Nottingham Forest": "Nottingham Forest", "Forest": "Nottingham Forest",
  "Brighton": "Brighton & Hove Albion",
  "West Ham": "West Ham United",
  "Leeds": "Leeds United",
  "AFC Bournemouth": "Bournemouth",
  "Sheffield Utd": "Sheffield United",
};
export const canonicalClub = (name) => CLUB_ALIASES[name] ?? name;

// ── HTTP with disk cache ────────────────────────────────────────────────────────
async function get(path, { cacheKey } = {}) {
  if (cacheKey) {
    const f = join(CACHE_DIR, `${cacheKey}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}api_token=${key()}`);
  if (!res.ok) throw new Error(`SportMonks ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (cacheKey) {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(join(CACHE_DIR, `${cacheKey}.json`), JSON.stringify(json));
  }
  return json;
}

// ── Seasons ─────────────────────────────────────────────────────────────────────
/** All PL seasons as [{ id, name, startYear }], oldest→newest. Cached. */
export async function plSeasons() {
  const d = await get(`/seasons?filters=seasonLeagues:${PL_LEAGUE_ID}&per_page=50`, { cacheKey: "pl-seasons" });
  return (d.data ?? [])
    .map((s) => ({ id: s.id, name: s.name, startYear: Number(String(s.name).slice(0, 4)) }))
    .sort((a, b) => a.startYear - b.startYear);
}

// ── Final table for a season ──────────────────────────────────────────────────────
/** [{ position, team, points }] for a completed season. Cached (past seasons are immutable). */
export async function finalTable(seasonId) {
  const d = await get(`/standings/seasons/${seasonId}?include=participant`, { cacheKey: `standings-${seasonId}` });
  return (d.data ?? [])
    .map((r) => ({ position: r.position, team: r.participant?.name, points: r.points }))
    .filter((r) => r.team != null)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

// ── Top scorers for a season ──────────────────────────────────────────────────────
/** [{ position, player, goals, team }] — goals only (type 208). Cached. */
export async function topScorers(seasonId) {
  const d = await get(
    `/topscorers/seasons/${seasonId}?include=player;participant&filters=seasonTopscorerTypes:${GOALS_TYPE}&per_page=50`,
    { cacheKey: `topscorers-${seasonId}` }
  );
  return (d.data ?? [])
    .filter((r) => r.type_id === GOALS_TYPE)
    .map((r) => ({ position: r.position, player: r.player?.name, goals: r.total, team: r.participant?.name }))
    .filter((r) => r.player != null)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

// ── European finals ───────────────────────────────────────────────────────────────
/** All seasons of any competition as [{ id, name, startYear }], oldest→newest. Cached. */
export async function seasonsOf(leagueId) {
  const d = await get(`/seasons?filters=seasonLeagues:${leagueId}&per_page=50`, { cacheKey: `seasons-${leagueId}` });
  return (d.data ?? [])
    .map((s) => ({ id: s.id, name: s.name, startYear: Number(String(s.name).slice(0, 4)) }))
    .sort((a, b) => a.startYear - b.startYear);
}

/**
 * The final of a knockout season → { winner, runnerUp, resultInfo } (null if not played yet).
 *
 * Two hops, because fixtures are paginated and the final is never on page 1: resolve the
 * "Final" stage id for the season, then fetch that stage's fixture. `participants[].meta.winner`
 * is the authoritative flag — verified against CL 2023/24 (Real Madrid beat Dortmund).
 */
export async function finalOf(seasonId) {
  const stages = await get(`/stages/seasons/${seasonId}`, { cacheKey: `stages-${seasonId}` });
  const final = (stages.data ?? []).find((s) => s.name === "Final");
  if (!final) return null;

  const fx = await get(`/fixtures?filters=fixtureStages:${final.id}&include=participants`, { cacheKey: `final-fx-${seasonId}` });
  const match = (fx.data ?? [])[0];
  if (!match) return null;

  const ps = match.participants ?? [];
  const winner = ps.find((p) => p.meta?.winner === true)?.name ?? null;
  const runnerUp = ps.find((p) => p.meta?.winner === false)?.name ?? null;
  if (!winner) return null; // not yet decided
  return { winner, runnerUp, resultInfo: match.result_info ?? null, fixture: match.name ?? null };
}

/**
 * Every European final since `fromYear`, across UCL/UEL/UECL/Super Cup.
 * Built once (~200 SportMonks calls), cached to disk, then free — past finals never change.
 * This is what makes a club's honours a lookup instead of a web search.
 */
export async function europeanFinalsIndex({ fromYear = 2000 } = {}) {
  const cacheFile = join(CACHE_DIR, `euro-finals-${fromYear}.json`);
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));

  const out = [];
  for (const leagueId of EURO_CUPS) {
    const seasons = (await seasonsOf(leagueId)).filter((s) => s.startYear >= fromYear && s.startYear <= 2025);
    for (const s of seasons) {
      try {
        const f = await finalOf(s.id);
        if (f) out.push({ competition: COMPETITIONS[leagueId].name, short: COMPETITIONS[leagueId].short, season: s.name, ...f });
      } catch { /* a season with no final (abandoned/format change) is not an error */ }
    }
  }
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(out));
  return out;
}

/** A club's European honours from the finals index: { won: [...], lost: [...] }. */
export async function clubEuropeanHonours(club, { fromYear = 2000 } = {}) {
  const canon = canonicalClub(club);
  const finals = await europeanFinalsIndex({ fromYear });
  return {
    won: finals.filter((f) => f.winner === canon).map((f) => ({ competition: f.short, season: f.season, beat: f.runnerUp })),
    lost: finals.filter((f) => f.runnerUp === canon).map((f) => ({ competition: f.short, season: f.season, lostTo: f.winner })),
  };
}

/**
 * A structured, verified fact sheet for one club from `fromYear` onward.
 * This is the GROUND TRUTH handed to the author and the verifier so those questions never
 * touch a web search. Everything here came straight from SportMonks.
 *
 * Returns:
 *   { club, seasons: [{ season, position, points, leagueTopScorer, clubTopScorer }],
 *     titles: [...], derived: { bestFinish, mostPoints, ... } }
 */
export async function clubFactSheet(club, { fromYear = 2000 } = {}) {
  const canon = canonicalClub(club);
  const seasons = (await plSeasons()).filter((s) => s.startYear >= fromYear && s.startYear <= 2025);

  const out = [];
  for (const s of seasons) {
    const [table, scorers] = await Promise.all([finalTable(s.id), topScorers(s.id)]);
    const row = table.find((r) => r.team === canon);
    if (!row) continue; // club not in the PL that season
    const clubScorer = scorers.find((r) => r.team === canon);
    out.push({
      season: s.name,
      position: row.position,
      points: row.points,
      champion: table.find((r) => r.position === 1)?.team,
      leagueTopScorer: scorers[0] ? { player: scorers[0].player, goals: scorers[0].goals, team: scorers[0].team } : null,
      clubTopScorer: clubScorer ? { player: clubScorer.player, goals: clubScorer.goals } : null,
    });
  }

  const titles = out.filter((r) => r.position === 1).map((r) => r.season);
  const derived = out.length ? {
    seasonsInPL: out.length,
    titles,
    bestFinish: Math.min(...out.map((r) => r.position)),
    mostPoints: Math.max(...out.map((r) => r.points ?? 0)),
    mostPointsSeason: out.reduce((a, b) => ((b.points ?? 0) > (a.points ?? 0) ? b : a)).season,
  } : {};

  // European honours — the subscription covers UCL/UEL/UECL/Super Cup as of 2026-07-16.
  // These were web-only before, which is what made History & Honours the expensive category.
  let european = { won: [], lost: [] };
  try {
    european = await clubEuropeanHonours(canon, { fromYear });
  } catch { /* Europe is a bonus; a failure here must not lose the league fact sheet */ }

  return { club: canon, fromYear, seasons: out, titles, derived, european };
}

/** Compact human/LLM-readable rendering of a fact sheet for a prompt. */
export function factSheetText(fs) {
  const lines = [`${fs.club} — verified record (SportMonks, ${fs.fromYear}→):`];
  if (fs.titles.length) lines.push(`Premier League titles won: ${fs.titles.join(", ")}`);

  const eu = fs.european ?? { won: [], lost: [] };
  if (eu.won.length)
    lines.push(`European trophies won: ${eu.won.map((w) => `${w.competition} ${w.season} (beat ${w.beat})`).join("; ")}`);
  if (eu.lost.length)
    lines.push(`European finals lost: ${eu.lost.map((l) => `${l.competition} ${l.season} (lost to ${l.lostTo})`).join("; ")}`);
  if (!eu.won.length && !eu.lost.length)
    lines.push(`European finals reached since ${fs.fromYear}: none.`);

  lines.push(`Best PL finish: ${fs.derived.bestFinish}; most points: ${fs.derived.mostPoints} (${fs.derived.mostPointsSeason}).`);
  lines.push(`\nPremier League season-by-season:`);
  for (const r of fs.seasons) {
    const cs = r.clubTopScorer ? `; their top scorer ${r.clubTopScorer.player} (${r.clubTopScorer.goals})` : "";
    const gb = r.leagueTopScorer ? `; league top scorer ${r.leagueTopScorer.player} (${r.leagueTopScorer.goals}, ${r.leagueTopScorer.team})` : "";
    lines.push(`  ${r.season}: finished ${r.position}, ${r.points} pts${cs}${gb}`);
  }
  return lines.join("\n");
}

/** Every European final in a season range — material for themed packs, not just clubs. */
export function finalsText(finals) {
  return finals.map((f) => `${f.competition} ${f.season} final: ${f.winner} beat ${f.runnerUp}${f.resultInfo ? ` (${f.resultInfo})` : ""}`).join("\n");
}
