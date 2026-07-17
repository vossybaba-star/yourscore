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

/**
 * ⚠️ SportMonks topscorer data is NOT trustworthy before 2005/06. Verified against known
 * Golden Boot winners (2026-07-16):
 *
 *   2000/01–2002/03  no data at all
 *   2003/04          Henry 17   — he actually scored 30
 *   2004/05          Henry 7    — he actually scored 25
 *   2005/06 onward   correct (Henry 27, Drogba 20, Ronaldo 31, Salah 32, Haaland 36/27 …)
 *
 * The early rows are PARTIAL, not absent, which is the dangerous case: a plausible-looking
 * number that is simply wrong. It poisoned a verification sweep — the fact sheet claimed
 * Henry's ceiling for 2003/04 was 17, so a CORRECT question answering 30 was contradicted and
 * retired. Anything derived from a bad fact inherits the error (the correlated-failure risk of
 * facts-first), so bad facts must never reach the sheet in the first place.
 *
 * A prior session hit this too — see the Perfect 10 work ("SportMonks topscorers UNRELIABLE").
 * Standings/points ARE reliable across the full range (Invincibles 90, City 100, Liverpool 99
 * all verified), so only topscorers are gated.
 */
export const TOPSCORER_MIN_YEAR = 2005;

/**
 * The Premier League has had exactly 20 clubs every season since 1995. A returned table with
 * any other row count is INCOMPLETE DATA, not a short league — treat the season as unknown.
 *
 * This is not hypothetical: SportMonks returns ZERO rows for 2005/06. Silently dropping it made
 * a fact sheet list four Chelsea titles instead of five, and a verification sweep then used that
 * to "disprove" a correct question about their 2005/06 title. Same failure as the topscorers:
 * a gap in the data reads as a fact about the world.
 *
 * Lesson, learned twice in one session: spot-checking three seasons and generalising is not
 * verification. Validate EVERY season, and make the sheet declare what it doesn't know.
 */
const PL_CLUBS_PER_SEASON = 20;
export const isTableComplete = (table) => table.length === PL_CLUBS_PER_SEASON;
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
  const missingSeasons = [];
  for (const s of seasons) {
    // Topscorers before TOPSCORER_MIN_YEAR are absent or PARTIAL — never put them on the sheet.
    const scorersUsable = s.startYear >= TOPSCORER_MIN_YEAR;
    const [table, scorers] = await Promise.all([
      finalTable(s.id),
      scorersUsable ? topScorers(s.id) : Promise.resolve([]),
    ]);

    // An incomplete table means we know NOTHING about this season — not that the club wasn't in
    // it. Record the gap so the sheet can declare it; never let silence imply a fact.
    if (!isTableComplete(table)) { missingSeasons.push(s.name); continue; }

    const row = table.find((r) => r.team === canon);
    if (!row) continue; // club genuinely not in the PL that season (the table IS complete)
    const clubScorer = scorers.find((r) => r.team === canon);
    out.push({
      season: s.name,
      position: row.position,
      points: row.points,
      champion: table.find((r) => r.position === 1)?.team,
      scorersUsable,
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

  return { club: canon, fromYear, seasons: out, titles, derived, european, missingSeasons };
}

/**
 * Compact human/LLM-readable rendering of a fact sheet for a prompt.
 *
 * The SCOPE NOTES are load-bearing, not decoration. Without them a reader treats the sheet as
 * complete and "proves" things it cannot: it said "European finals reached since 2000: none"
 * for Aston Villa, which a verifier read as "Villa have never won a European trophy" and used
 * to contradict a CORRECT question about their 1982 European Cup. A fact sheet must state what
 * it does NOT know, or its silence gets read as evidence of absence.
 */
export function factSheetText(fs) {
  const lines = [`${fs.club} — verified record (SportMonks).`];
  lines.push(`SCOPE — read this before drawing conclusions:`);
  lines.push(`  · Covers the Premier League and European competitions from ${fs.fromYear}/01 ONWARDS ONLY.`);
  lines.push(`  · It does NOT cover: anything before ${fs.fromYear}, the FA Cup, the League Cup, transfers, or squads.`);
  lines.push(`  · Something being ABSENT here does NOT mean it didn't happen — it means this sheet doesn't know.`);
  lines.push(`    (e.g. a European Cup won in the 1980s is outside this range and simply won't appear.)`);
  if (fs.seasons.some((s) => !s.scorersUsable)) {
    lines.push(`  · Top-scorer data is unavailable before ${TOPSCORER_MIN_YEAR}/06, so those seasons show league position only.`);
    lines.push(`    Do NOT infer a goal ceiling for a season with no top scorer listed.`);
  }
  // Declaring the gaps is the whole point. A season silently absent gets read as "it didn't
  // happen" — that's how a missing 2005/06 turned Chelsea's five titles into four and got a
  // correct question retired.
  const missing = fs.missingSeasons ?? [];
  if (missing.length) {
    lines.push(`  · ⚠️ DATA IS MISSING for these seasons entirely: ${missing.join(", ")}.`);
    lines.push(`    Nothing below covers them. Any question about those seasons is UNKNOWN, never wrong.`);
    lines.push(`    Counts and lists below EXCLUDE them, so treat every total as a MINIMUM, not a final figure.`);
  }
  lines.push("");

  const caveat = missing.length ? ` — MINIMUM, excludes ${missing.join("/")} which is missing from the data` : "";
  if (fs.titles.length) lines.push(`Premier League titles won (${fs.fromYear}→)${caveat}: ${fs.titles.join(", ")}`);

  const eu = fs.european ?? { won: [], lost: [] };
  if (eu.won.length)
    lines.push(`European trophies won (${fs.fromYear}→): ${eu.won.map((w) => `${w.competition} ${w.season} (beat ${w.beat})`).join("; ")}`);
  if (eu.lost.length)
    lines.push(`European finals lost (${fs.fromYear}→): ${eu.lost.map((l) => `${l.competition} ${l.season} (lost to ${l.lostTo})`).join("; ")}`);
  if (!eu.won.length && !eu.lost.length)
    lines.push(`European finals reached ${fs.fromYear}→: none recorded IN THIS RANGE (earlier ones are not covered).`);

  // EVERY derived aggregate needs the caveat, not just the titles line. Missing 2005/06 made
  // Blackburn's "most points" read as 60 — their real best in range is 63, from the absent
  // season — and the sweep used that 60 as a ceiling to contradict a stored 63. An aggregate
  // computed over incomplete data is a floor, never a maximum.
  lines.push(
    `Best PL finish (${fs.fromYear}→): ${fs.derived.bestFinish}; most points: ${fs.derived.mostPoints} (${fs.derived.mostPointsSeason})${caveat}.`
  );
  if (missing.length) {
    lines.push(`  ⚠️ SCOPED WARNING — applies ONLY to the two aggregates on the line above.`);
    lines.push(`     Because ${missing.join("/")} is missing, "best finish" and "most points" are FLOORS: do not`);
    lines.push(`     use THOSE TWO to rule an answer out. This does NOT weaken anything else — the`);
    lines.push(`     per-season rows below are exact, and a season's listed top scorer IS a hard ceiling`);
    lines.push(`     for that season. Keep using it.`);
  }
  lines.push(`\nPremier League season-by-season:`);
  for (const r of fs.seasons) {
    const cs = r.clubTopScorer ? `; their top scorer ${r.clubTopScorer.player} (${r.clubTopScorer.goals})` : "";
    const gb = r.leagueTopScorer ? `; league top scorer ${r.leagueTopScorer.player} (${r.leagueTopScorer.goals}, ${r.leagueTopScorer.team})` : "";
    const noScorers = !r.scorersUsable ? `; (top-scorer data unavailable for this season)` : "";
    lines.push(`  ${r.season}: finished ${r.position}, ${r.points} pts${cs}${gb}${noScorers}`);
  }
  return lines.join("\n");
}

/** Every European final in a season range — material for themed packs, not just clubs. */
export function finalsText(finals) {
  return finals.map((f) => `${f.competition} ${f.season} final: ${f.winner} beat ${f.runnerUp}${f.resultInfo ? ` (${f.resultInfo})` : ""}`).join("\n");
}
