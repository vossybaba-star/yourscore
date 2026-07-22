/**
 * history.mjs — THE FACT MINER for the base slate (written the day before).
 *
 * Base questions must be unable to go stale. That rules out form, injuries,
 * squads, managers and league position — the exact class of claim this model has
 * already burned the founder on. So the base miner reads only two owned,
 * immutable sources:
 *
 *   1. SportMonks Historical Data — every prior meeting between these two clubs:
 *      the result, the scoreline, the goalscorers. A 2014 result is still a 2014
 *      result next August.
 *   2. The owned FIFA-ratings dataset (src/data/draft/player-seasons.json —
 *      10,051 player-seasons, 41 Premier League clubs, seasons 2006/07→2025/26,
 *      already shipped and already powering the draft game). A player's FIFA
 *      rating in a past season is frozen forever.
 *
 * There is no third source. In particular there is no "the LLM knows this" —
 * every base question, like every fresh question, must cite a claim the validator
 * can re-resolve. A fixture that cannot reach ten grounded questions produces
 * fewer, and the slate gate tells the founder so. It never invents the shortfall.
 *
 * COVERAGE IS NOT UNIFORM, and this matters for GW1. Measured against the real
 * 2026/27 opening round:
 *
 *     Arsenal v Coventry City     H2H  2 (from 2000)  FIFA 8sn / NONE   ← thinnest
 *     Hull City v Man United      H2H 10 (from 2008)  FIFA 1sn / 8sn
 *     Newcastle v Liverpool       H2H 48 (from 2000)  FIFA 7sn / 8sn
 *     Fulham v Chelsea            H2H 38 (from 2001)  FIFA 6sn / 8sn
 *
 * Coventry have not been in the Premier League since 2001 and the plan is
 * PL-only (their team record exposes exactly two seasons: 2000/01 and 2026/27),
 * so there is next to nothing to ask about them. That is a real product problem
 * for the season opener, not a bug — see the coverage report this miner emits.
 */

import { readFileSync } from "node:fs";
import * as sm from "./sm.mjs";
import { normName as norm2 } from "./claims.mjs";

const FIFA_PATH = "src/data/draft/player-seasons.json";

let fifaCache = null;
export function loadFifa(path = FIFA_PATH) {
  if (!fifaCache) {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    fifaCache = raw.players ?? [];
  }
  return fifaCache;
}

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(fc|afc|city|town|united|hotspur|albion|wanderers|rovers|athletic|county)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

/** Match a SportMonks club name to the FIFA dataset's club naming. */
export function fifaClubFor(clubName, players = loadFifa()) {
  const want = norm(clubName);
  if (!want) return null;
  const byClub = new Map();
  for (const p of players) {
    if (p.league !== "PL") continue;
    const key = norm(p.club);
    if (!key) continue;
    if (!byClub.has(key)) byClub.set(key, p.club);
  }
  if (byClub.has(want)) return byClub.get(want);
  for (const [key, orig] of byClub) {
    if (key.includes(want) || want.includes(key)) return orig;
  }
  return null;
}

const prettyDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

let seq = 0;
function fact({ kind, text, claims, source, difficulty, names = [] }) {
  return { id: `b${++seq}`, kind, text, claims, source, difficulty, names };
}

/**
 * Mine the historic/static facts available for one fixture.
 *
 * @param {number} fixtureId
 * @param {string} kickoffAt  ISO — the boundary. Every H2H meeting at or after
 *                            this instant is excluded, including this fixture.
 */
export async function mineBaseFacts({ fixtureId, kickoffAt, log = () => {} }) {
  seq = 0;
  const fx = await sm.fixture(fixtureId, "participants;round;league");
  if (!fx) throw new Error(`fixture ${fixtureId} not found`);
  const parts = sm.participants(fx);
  if (!parts) throw new Error(`fixture ${fixtureId} has no participants`);
  const { home, away } = parts;
  const kickoff = kickoffAt || fx.starting_at;

  const facts = [];
  const whitelist = [];

  // ── 1. Head-to-head history ────────────────────────────────────────────────
  const all = await sm.headToHead(home.id, away.id);
  const past = all
    .filter((f) => f.id !== Number(fixtureId) && new Date(f.starting_at) < new Date(kickoff))
    .filter((f) => sm.finalScore(f) !== null)
    .sort((a, b) => String(b.starting_at).localeCompare(String(a.starting_at)));

  log(`h2h: ${past.length} completed meetings on record before kick-off`);

  const windowFrom = past.length ? String(past[past.length - 1].starting_at).slice(0, 4) : null;

  if (past.length >= 6) {
    let wH = 0, wA = 0, d = 0;
    for (const m of past) {
      const p = sm.participants(m);
      const s = sm.finalScore(m);
      if (!p || !s) continue;
      // The H2H list mixes both venues — normalise to "did HOME-side-today win".
      const todayHomeWasHome = p.home.id === home.id;
      const goalsToday = todayHomeWasHome ? s.home : s.away;
      const goalsOpp = todayHomeWasHome ? s.away : s.home;
      if (goalsToday > goalsOpp) wH++;
      else if (goalsToday < goalsOpp) wA++;
      else d++;
    }
    facts.push(
      fact({
        kind: "h2h_tally",
        text:
          `In the ${past.length} meetings between ${home.name} and ${away.name} on record since ${windowFrom}, ` +
          `${home.name} have won ${wH}, ${away.name} have won ${wA}, and ${d} were drawn.`,
        claims: [
          {
            type: "h2h_tally",
            team_a: home.id,
            team_b: away.id,
            team_a_name: home.name,
            team_b_name: away.name,
            window_from: windowFrom,
            wins_a: wH,
            wins_b: wA,
            draws: d,
            played: past.length,
          },
        ],
        source: `SportMonks head-to-head, ${past.length} meetings since ${windowFrom}`,
        difficulty: "medium",
      }),
    );
  }

  // Individual past results — the most reliably answerable base questions there are.
  for (const m of past.slice(0, 6)) {
    const p = sm.participants(m);
    const s = sm.finalScore(m);
    if (!p || !s) continue;
    facts.push(
      fact({
        kind: "h2h_result",
        text:
          `${p.home.name} ${s.home}-${s.away} ${p.away.name}, ${prettyDate(m.starting_at)}` +
          (m.league?.name ? ` (${m.league.name})` : ""),
        claims: [
          {
            type: "h2h_result",
            fixture_id: m.id,
            date: String(m.starting_at).slice(0, 10),
            home: p.home.name,
            away: p.away.name,
            home_goals: s.home,
            away_goals: s.away,
          },
        ],
        source: `SportMonks fixture ${m.id}`,
        difficulty: "medium",
      }),
    );
  }

  // Biggest winning margin in the recorded H2H.
  if (past.length >= 8) {
    let best = null;
    for (const m of past) {
      const p = sm.participants(m);
      const s = sm.finalScore(m);
      if (!p || !s) continue;
      const margin = Math.abs(s.home - s.away);
      if (!best || margin > best.margin) best = { m, p, s, margin };
    }
    if (best && best.margin >= 3) {
      facts.push(
        fact({
          kind: "h2h_biggest",
          text:
            `The biggest winning margin in the recorded ${home.name} v ${away.name} history is ` +
            `${best.p.home.name} ${best.s.home}-${best.s.away} ${best.p.away.name} on ` +
            `${prettyDate(best.m.starting_at)}.`,
          claims: [
            {
              type: "h2h_result",
              fixture_id: best.m.id,
              date: String(best.m.starting_at).slice(0, 10),
              home: best.p.home.name,
              away: best.p.away.name,
              home_goals: best.s.home,
              away_goals: best.s.away,
            },
          ],
          source: `SportMonks fixture ${best.m.id}`,
          difficulty: "hard",
        }),
      );
    }
  }

  // Goalscorers in past meetings. Events only exist on modern fixtures — the
  // 2000/01 rows carry scores but no events, which is precisely why the Arsenal
  // v Coventry pack has so little to work with.
  // KEY ON THE NORMALISED NAME, not the raw string. SportMonks returns the same
  // scorer under several spellings across twenty years of events ("Mohamed Salah",
  // "M. Salah", and one with a trailing space), so a raw-string tally splits one
  // player into three and undercounts him. This is not hypothetical: the first run
  // of this miner had Salah on 7 and crowned Gerrard (8) the top scorer in the
  // fixture's history. Salah actually has 10. The validator — which normalises —
  // recomputed it and killed the question, which is the system working; but the
  // miner should not have been wrong in the first place.
  const scorerTally = new Map();
  for (const m of past) {
    for (const e of m.events ?? []) {
      if (e.type_id !== sm.EVENT_TYPE.GOAL && e.type_id !== sm.EVENT_TYPE.PENALTY) continue;
      if (!e.player_name) continue;
      const key = norm2(e.player_name);
      const rec = scorerTally.get(key) ?? { goals: 0, name: String(e.player_name).trim() };
      rec.goals++;
      // Prefer the fullest spelling for display ("Mohamed Salah" over "M. Salah").
      if (String(e.player_name).trim().length > rec.name.length) rec.name = String(e.player_name).trim();
      scorerTally.set(key, rec);
    }
  }
  // The top scorer in this fixture's history — with claim-checked wrong answers.
  //
  // The first version of this emitted three separate "X has scored N" lines and
  // let the model pick its own distractors from the whitelist. It wrote "Who has
  // scored the most in this fixture, with 8?  A) Steven Gerrard  B) Mohamed Salah
  // …" — and nothing anywhere had checked that Salah hadn't also scored 8. Same
  // two-correct-answers bug as everywhere else. So the miner supplies the options
  // and attaches each distractor's EXACT recomputed goal count as a claim.
  const ranked = [...scorerTally.values()].sort((a, b) => b.goals - a.goals);
  const top = ranked[0];
  if (top && top.goals >= 3 && ranked[1] && ranked[1].goals < top.goals) {
    const lower = ranked.filter((s) => s.goals < top.goals);
    if (lower.length >= 3) {
      const distractors = [lower[0], lower[Math.floor(lower.length / 2)], lower.at(-1)];
      if (new Set(distractors.map((s) => s.name)).size === 3) {
        whitelist.push(top.name, ...distractors.map((s) => s.name));
        facts.push(
          fact({
            kind: "h2h_top_scorer",
            text:
              `ASK: who has scored the most goals in recorded ${home.name} v ${away.name} meetings? ` +
              `(${top.name}, ${top.goals} — clear of the rest.) ` +
              `OPTIONS (use exactly these four; the FIRST is the answer and must NOT appear in your stem): ` +
              [top.name, ...distractors.map((s) => s.name)].join(" | "),
            claims: [
              {
                type: "player_goals_vs",
                player_id: null,
                name: top.name,
                opponent_team_id: null,
                opponent: `${home.name} v ${away.name}`,
                value: top.goals,
                window_from: windowFrom,
              },
              ...distractors.map((s) => ({
                type: "player_goals_vs",
                player_id: null,
                name: s.name,
                opponent_team_id: null,
                opponent: `${home.name} v ${away.name}`,
                value: s.goals,
                window_from: windowFrom,
              })),
            ],
            source: `SportMonks head-to-head goal events since ${windowFrom}`,
            difficulty: "hard",
            names: [top.name, ...distractors.map((s) => s.name)],
          }),
        );
      }
    }
  }

  // ── 2. The owned FIFA-ratings dataset ──────────────────────────────────────
  const players = loadFifa();
  const coverage = {};
  for (const club of [home, away]) {
    const fifaClub = fifaClubFor(club.name, players);
    coverage[club.name] = { fifaClub, seasons: [] };
    if (!fifaClub) {
      log(`FIFA dataset: NO coverage for ${club.name}`);
      continue;
    }
    const rows = players.filter((p) => p.club === fifaClub);
    const seasons = [...new Set(rows.map((p) => p.season))].sort();
    coverage[club.name].seasons = seasons;

    // Cap at three seasons per club, spread across the range. The dataset covers
    // eight seasons and the miner used to offer all of them, so on a rich fixture
    // the model had sixteen near-identical "highest-rated player" lines to choose
    // from and duly wrote five of them into one pack. Fewer, better-spread FIFA
    // facts leaves room for the head-to-head material, which is the stuff a fan of
    // THIS fixture actually wants.
    const picked =
      seasons.length <= 3
        ? seasons
        : [seasons[0], seasons[Math.floor(seasons.length / 2)], seasons.at(-1)];

    for (const season of picked) {
      const inSeason = rows.filter((p) => p.season === season).sort((a, b) => b.overall - a.overall);
      if (inSeason.length < 4) continue;
      const top = inSeason[0];

      // A TIE AT THE TOP MEANS THERE IS NO SINGLE ANSWER. Skip the fact entirely.
      // (The first version of this miner shipped free-form squad listings and the
      // model wrote "four players sat at 87 — which of these was one of them?",
      // with three distractors nobody had checked. Two of them could easily have
      // been on 87 as well. A question with two correct answers is a wrong answer.)
      if (inSeason[1].overall === top.overall) continue;

      // Distractors: three squad-mates rated STRICTLY LOWER. Each carries its own
      // exact-rating claim, so the validator re-checks the wrong answers too.
      const lower = inSeason.filter((p) => p.overall < top.overall);
      if (lower.length < 3) continue;
      const distractors = [lower[0], lower[Math.floor(lower.length / 2)], lower[lower.length - 1]];
      if (new Set(distractors.map((p) => p.name)).size !== 3) continue;

      whitelist.push(top.name, ...distractors.map((p) => p.name));
      facts.push(
        fact({
          kind: "fifa_top",
          text:
            `ASK: who was the highest-rated player in ${fifaClub}'s ${season} FIFA squad ratings? ` +
            `(${top.name}, ${top.overall} — clear of everyone else.) ` +
            `OPTIONS (use exactly these four; the FIRST is the answer and must NOT appear in your stem): ` +
            [top.name, ...distractors.map((p) => `${p.name}`)].join(" | "),
          claims: [
            { type: "fifa_top", club: fifaClub, season, name: top.name, overall: top.overall },
            ...distractors.map((p) => ({
              type: "fifa_rating",
              name: p.name,
              club: fifaClub,
              season,
              overall: p.overall,
            })),
          ],
          source: `owned FIFA-ratings dataset (${FIFA_PATH}), ${fifaClub} ${season}`,
          difficulty: top.overall >= 88 ? "easy" : "medium",
          names: [top.name, ...distractors.map((p) => p.name)],
        }),
      );
    }
  }

  // Cross-club: players the dataset shows at BOTH clubs. Genuinely good pub-quiz
  // material and completely immutable.
  const homeFifa = coverage[home.name]?.fifaClub;
  const awayFifa = coverage[away.name]?.fifaClub;
  if (homeFifa && awayFifa) {
    const atHome = new Set(players.filter((p) => p.club === homeFifa).map((p) => p.name));
    const both = [
      ...new Set(players.filter((p) => p.club === awayFifa && atHome.has(p.name)).map((p) => p.name)),
    ];
    // Distractors must be players recorded at the HOME club and NOWHERE NEAR the
    // away club — and each one carries a `fifa_absent` claim so the validator
    // proves it. Without that, one distractor who also turned out at both clubs
    // gives the question two correct answers.
    const bothSet = new Set(both);
    const homeOnly = [
      ...new Set(players.filter((p) => p.club === homeFifa && !bothSet.has(p.name)).map((p) => p.name)),
    ];

    if (both.length && homeOnly.length >= 3) {
      const answer = both[0];
      const distractors = [homeOnly[0], homeOnly[Math.floor(homeOnly.length / 2)], homeOnly.at(-1)];
      if (new Set(distractors).size === 3) {
        whitelist.push(answer, ...distractors);
        facts.push(
          fact({
            kind: "fifa_both_clubs",
            text:
              `ASK: which of these four is the only one the FIFA-ratings dataset records at BOTH ` +
              `${homeFifa} and ${awayFifa}? ` +
              `OPTIONS (use exactly these four; the FIRST is the answer and must NOT appear in your stem): ` +
              [answer, ...distractors].join(" | "),
            claims: [
              {
                type: "fifa_rating",
                name: answer,
                club: awayFifa,
                season: players.find((p) => p.name === answer && p.club === awayFifa)?.season,
                overall: players.find((p) => p.name === answer && p.club === awayFifa)?.overall,
              },
              ...distractors.map((name) => ({ type: "fifa_absent", name, club: awayFifa })),
            ],
            source: `owned FIFA-ratings dataset (${FIFA_PATH})`,
            difficulty: "hard",
            names: [answer, ...distractors],
          }),
        );
      }
    }
  }

  const report = {
    fixtureId: Number(fixtureId),
    home: home.name,
    away: away.name,
    kickoff,
    h2hOnRecord: all.length,
    h2hUsable: past.length,
    h2hWithEvents: past.filter((m) => (m.events ?? []).length > 0).length,
    fifa: Object.fromEntries(
      Object.entries(coverage).map(([club, c]) => [club, c.fifaClub ? c.seasons.length : 0]),
    ),
    factsMined: facts.length,
    smCalls: sm.calls(),
  };

  return { facts, whitelist: [...new Set(whitelist)], clubs: [home.name, away.name], report };
}
