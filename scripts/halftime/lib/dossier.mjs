/**
 * dossier.mjs — THE FACT MINER for the fresh slice.
 *
 * The founder's bar, verbatim: "I need the LLM to be able to pull out really
 * interesting live questions to make the users seem genuinely impressed at what
 * they are seeing."
 *
 * The way to hit that bar is NOT to ask a model to be interesting. It is to mine
 * the interesting thing deterministically and let the model do nothing but phrase
 * it. So: this file computes candidate "reveals" from the confirmed XI using
 * nothing but structured SportMonks data, each with machine-checkable evidence
 * attached. The LLM (llm.mjs) may pick from and phrase these lines and NOTHING
 * else — it cannot introduce a fact, a name, or a number. Surprise comes from the
 * miner; correctness comes from the data; the model only supplies English.
 *
 * ── The as-of trap (this is the part that bites) ─────────────────────────────
 * Season aggregates (`statistics`) are a snapshot of "now". In LIVE operation
 * "now" is ~T-60, so they are pre-kickoff by construction and safe. But when you
 * test against a HISTORICAL fixture — which is the only way to test in the
 * off-season — the same endpoint returns totals that already include the match
 * you are pretending hasn't kicked off yet, and every appearance/goal count is
 * silently time-travelled.
 *
 * So every fact carries `asofSafe`:
 *   true  — derived only from data timestamped strictly before kickoff
 *           (H2H events, past fixtures, transfers, dates of birth, the
 *           confirmed sheet itself). Correct in live AND in replay.
 *   false — derived from a season aggregate. Correct in live; contaminated in
 *           replay.
 * `strictAsOf` (set by gen-fresh --historical) drops every asofSafe:false fact,
 * so a historical demo cannot cheat and cannot flatter itself.
 */

import * as sm from "./sm.mjs";

const DAY = 86400000;

/** Whole years between dob and a date. */
function ageAt(dob, at) {
  if (!dob) return null;
  const d = new Date(dob);
  const t = new Date(at);
  let a = t.getUTCFullYear() - d.getUTCFullYear();
  const m = t.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && t.getUTCDate() < d.getUTCDate())) a--;
  return a >= 0 && a < 60 ? a : null;
}

const ymd = (iso) => String(iso).slice(0, 10);
const prettyDate = (iso) =>
  new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

let seq = 0;
/**
 * `text`     — what the MODEL sees. May contain prompt scaffolding (ASK:, OPTIONS:).
 * `evidence` — what the FOUNDER sees in the veto message. Plain English, no
 *              scaffolding. These have to be different: the first version showed
 *              him the raw seed, "OPTIONS (use exactly these four; the FIRST is
 *              the answer and must NOT appear in your stem): Gab…", which is
 *              machinery, not evidence, and makes the gate useless to read.
 */
function fact({ kind, text, evidence, claims, surprise, asofSafe, names = [] }) {
  return { id: `f${++seq}`, kind, text, evidence: evidence ?? text, claims, surprise, asofSafe, names };
}

/**
 * Mine every reveal the confirmed XI supports.
 *
 * @param {object} opts
 * @param {number} opts.fixtureId
 * @param {string} opts.kickoffAt   ISO. THE hard boundary — nothing dated at or
 *                                  after this instant may inform a single fact.
 * @param {boolean} opts.strictAsOf drop facts that lean on season aggregates
 * @returns {{facts, whitelist, clubs, meta}}
 */
export async function mineFreshFacts({ fixtureId, kickoffAt, strictAsOf = false, log = () => {} }) {
  seq = 0;
  const fx = await sm.fixtureLineup(fixtureId);
  if (!fx) throw new Error(`fixture ${fixtureId} not found`);

  const parts = sm.participants(fx);
  if (!parts) throw new Error(`fixture ${fixtureId} has no participants`);
  const { home, away } = parts;
  const kickoff = kickoffAt || fx.starting_at;

  if (!sm.lineupsConfirmed(fx, home.id, away.id)) {
    return { facts: [], whitelist: [], clubs: [], meta: { confirmed: false, fixtureId } };
  }

  const sides = [
    { team: home, opponent: away, id: home.id, oppId: away.id },
    { team: away, opponent: home, id: away.id, oppId: home.id },
  ];

  const facts = [];
  const whitelist = [];

  // ── Shared history: every prior meeting (goal events + team sheets). ────────
  // ONE call. Every fixture at or after kickoff is filtered out immediately —
  // including today's own fixture, which the H2H endpoint happily returns and
  // which is exactly how a "he has scored past them" fact would leak a goal from
  // the match we are still pretending hasn't started.
  const h2hAll = await sm.headToHead(home.id, away.id);
  const h2h = h2hAll.filter(
    (f) => f.id !== Number(fixtureId) && new Date(f.starting_at) < new Date(kickoff),
  );
  log(`h2h: ${h2hAll.length} meetings on record, ${h2h.length} strictly before kick-off`);

  const goalsByPlayerVsOpp = new Map(); // player_id -> {goals, matches:Set, best:{fixture,goals}}
  for (const m of h2h) {
    const per = new Map();
    for (const e of m.events ?? []) {
      if (e.type_id !== sm.EVENT_TYPE.GOAL && e.type_id !== sm.EVENT_TYPE.PENALTY) continue;
      if (!e.player_id) continue;
      per.set(e.player_id, (per.get(e.player_id) ?? 0) + 1);
    }
    for (const [pid, n] of per) {
      const rec = goalsByPlayerVsOpp.get(pid) ?? { goals: 0, matches: new Set(), best: null };
      rec.goals += n;
      rec.matches.add(m.id);
      if (!rec.best || n > rec.best.goals) rec.best = { fixture: m, goals: n };
      goalsByPlayerVsOpp.set(pid, rec);
    }
  }

  for (const side of sides) {
    const xi = sm.starters(fx, side.id);
    const benchRows = sm.bench(fx, side.id);
    for (const l of [...xi, ...benchRows]) if (l.player_name) whitelist.push(l.player_name);

    // ── Team history this season, up to (not including) today. ───────────────
    // ONE paginated call per side. Gives the formation baseline AND the
    // start-together history, both strictly pre-kickoff.
    const from = ymd(new Date(new Date(kickoff).getTime() - 400 * DAY).toISOString());
    const to = ymd(new Date(new Date(kickoff).getTime() - DAY).toISOString());
    let past = [];
    try {
      past = (await sm.teamFixturesBetween(from, to, side.id)).filter(
        (f) => f.id !== Number(fixtureId) && new Date(f.starting_at) < new Date(kickoff),
      );
    } catch (e) {
      log(`team history unavailable for ${side.team.name}: ${e.message}`);
    }

    // ── REVEAL: formation anomaly ────────────────────────────────────────────
    const todayFormation = sm.formationOf(fx, side.id);
    const counts = new Map();
    for (const f of past) {
      const fm = sm.formationOf(f, side.id);
      if (fm) counts.set(fm, (counts.get(fm) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const mode = ranked[0];
    if (todayFormation && mode && mode[0] !== todayFormation && mode[1] >= 3) {
      const played = [...counts.values()].reduce((a, b) => a + b, 0);
      const timesToday = counts.get(todayFormation) ?? 0;
      facts.push(
        fact({
          kind: "formation_anomaly",
          text:
            `${side.team.name} line up in a ${todayFormation} today. Their most-used shape in the ${played} ` +
            `matches before this one was ${mode[0]} (${mode[1]} of ${played}); they had used ${todayFormation} ` +
            `${timesToday} time${timesToday === 1 ? "" : "s"}.`,
          claims: [
            { type: "formation", fixture_id: Number(fixtureId), team_id: side.id, formation: todayFormation },
          ],
          surprise: timesToday === 0 ? 78 : 55,
          asofSafe: true,
          names: [],
        }),
      );
    }

    // ── Per-starter reveals ──────────────────────────────────────────────────
    for (const l of xi) {
      let p = null;
      try {
        p = await sm.player(l.player_id);
      } catch (e) {
        log(`player ${l.player_id} unavailable: ${e.message}`);
        continue;
      }
      if (!p) continue;
      const name = l.player_name || sm.displayName(p);

      // ── REVEAL: scorer vs today's opponent (the money one) ──────────────────
      // Event-derived and strictly pre-kickoff, so it survives replay unchanged.
      //
      // THE TRAP THIS BLOCK EXISTS TO CLOSE: "Which of these starters has scored
      // against Everton?" is a lovely question and a lethal one, because the
      // model picks its three wrong options from the whitelist — and the
      // whitelist is the whole XI, several of whom have ALSO scored against
      // Everton. Two correct answers, shipped mid-match. The claim gate would not
      // have caught it: every claim in the question resolves fine; the bug is in
      // the options, which carry no claims.
      //
      // So the miner supplies the options itself: the scorer plus three starters
      // from the same XI with ZERO goals against this opponent — and it attaches
      // a `player_goals_vs value: 0` claim to each of them, which validate.mjs
      // RECOMPUTES from the head-to-head events. If a "safe" distractor turns out
      // to have scored, the question dies at the gate. The wrong answers are now
      // as checkable as the right one.
      const rec = goalsByPlayerVsOpp.get(l.player_id);
      if (rec && rec.goals >= 1) {
        const hat = rec.best && rec.best.goals >= 3;
        const window_from = ymd(h2h.map((m) => m.starting_at).sort()[0] ?? "");
        const nonScorers = xi.filter(
          (o) => o.player_id !== l.player_id && !goalsByPlayerVsOpp.has(o.player_id),
        );
        // Deterministic pick (seeded by fixture) — same fixture, same options.
        const distractors = nonScorers
          .slice()
          .sort((a, b) => ((a.player_id * 7 + Number(fixtureId)) % 97) - ((b.player_id * 7 + Number(fixtureId)) % 97))
          .slice(0, 3);
        if (distractors.length === 3) {
          facts.push(
            fact({
              kind: hat ? "hat_trick_vs_opponent" : "scorer_vs_opponent",
              // Phrased as a SEED, not as a sentence. The first version of this
              // line read "Bukayo Saka is the only one of these four who has
              // scored against Everton" and the model dutifully copied it into
              // the stem and appended "Who is it?" — a question that answers
              // itself. Hand the model the ASK and the OPTIONS separately, and
              // keep the answer's name out of the framing it is tempted to reuse.
              text:
                `ASK: exactly one of these four ${side.team.name} starters has ever scored against ` +
                `${side.opponent.name}. Which one?` +
                (hat
                  ? ` (He has ${rec.goals} against them in ${rec.matches.size} meeting` +
                    `${rec.matches.size === 1 ? "" : "s"} on record, including ${rec.best.goals} in one match on ` +
                    `${prettyDate(rec.best.fixture.starting_at)}.)`
                  : ` (${rec.goals} goal${rec.goals === 1 ? "" : "s"} in ${rec.matches.size} meeting` +
                    `${rec.matches.size === 1 ? "" : "s"} on record.)`) +
                ` OPTIONS (use exactly these four; the FIRST is the answer and must NOT appear in your stem): ` +
                [name, ...distractors.map((d) => d.player_name)].join(" | "),
              evidence:
                `${name} has scored ${rec.goals} goal${rec.goals === 1 ? "" : "s"} against ` +
                `${side.opponent.name} in ${rec.matches.size} meeting${rec.matches.size === 1 ? "" : "s"} on record` +
                (hat ? `, including ${rec.best.goals} in one match on ${prettyDate(rec.best.fixture.starting_at)}` : "") +
                `. The other three options have never scored against them (recomputed from head-to-head goal events).`,
              claims: [
                { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
                {
                  type: "player_goals_vs",
                  player_id: l.player_id,
                  name,
                  opponent_team_id: side.oppId,
                  opponent: side.opponent.name,
                  value: rec.goals,
                  matches: rec.matches.size,
                  best_in_match: rec.best?.goals ?? null,
                  window_from,
                },
                // The distractors are claims too. This is the whole point.
                ...distractors.map((d) => ({
                  type: "player_goals_vs",
                  player_id: d.player_id,
                  name: d.player_name,
                  opponent_team_id: side.oppId,
                  opponent: side.opponent.name,
                  value: 0,
                  window_from,
                })),
              ],
              surprise: hat ? 92 : 55 + Math.min(30, rec.goals * 10),
              asofSafe: true,
              names: [name, ...distractors.map((d) => d.player_name)],
            }),
          );
        }
      }

      // REVEAL: facing a former club. Transfer/contract history — immutable.
      const clubs = sm.careerClubIds(p);
      if (clubs.has(Number(side.oppId))) {
        const move = (p.transfers ?? [])
          .filter((t) => Number(t.from_team_id) === Number(side.oppId))
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        facts.push(
          fact({
            kind: "faces_former_club",
            text:
              `${name} starts for ${side.team.name} today against ${side.opponent.name} — a club he has previously ` +
              `been on the books at` +
              (move?.date ? `, leaving them on ${prettyDate(move.date)}.` : "."),
            claims: [
              { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
              {
                type: "player_career_club",
                player_id: l.player_id,
                name,
                team_id: Number(side.oppId),
                club: side.opponent.name,
              },
            ],
            surprise: 70,
            asofSafe: true,
            names: [name],
          }),
        );
      }

      // REVEAL: youngest / age. Date of birth — immutable.
      const age = ageAt(p.date_of_birth, kickoff);
      if (age !== null && age <= 20) {
        facts.push(
          fact({
            kind: "young_starter",
            text: `${name} starts for ${side.team.name} today at ${age} years old (born ${prettyDate(p.date_of_birth)}).`,
            claims: [
              { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
              { type: "player_age", player_id: l.player_id, name, dob: ymd(p.date_of_birth), age, at: ymd(kickoff) },
            ],
            surprise: age <= 18 ? 80 : 55,
            asofSafe: true,
            names: [name],
          }),
        );
      }

      // REVEAL: first start since <date> / first start of the campaign.
      // Derived from real past team sheets, so strictly pre-kickoff.
      const withSheets = past.filter((f) => (f.lineups ?? []).length > 0);
      if (withSheets.length >= 5) {
        const startedIn = withSheets
          .filter((f) =>
            (f.lineups ?? []).some(
              (x) => x.player_id === l.player_id && x.type_id === sm.LINEUP_TYPE.STARTER,
            ),
          )
          .sort((a, b) => String(b.starting_at).localeCompare(String(a.starting_at)));

        if (startedIn.length === 0) {
          facts.push(
            fact({
              kind: "first_start_in_window",
              text:
                `${name} starts for ${side.team.name} today. He had not started any of their previous ` +
                `${withSheets.length} matches on record going into this one.`,
              claims: [
                { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
              ],
              surprise: 68,
              asofSafe: true,
              names: [name],
            }),
          );
        } else {
          const last = startedIn[0];
          const gapDays = Math.round(
            (new Date(kickoff) - new Date(last.starting_at)) / DAY,
          );
          if (gapDays >= 60) {
            facts.push(
              fact({
                kind: "first_start_since",
                text:
                  `${name} starts for ${side.team.name} today for the first time since ` +
                  `${prettyDate(last.starting_at)} — ${gapDays} days ago.`,
                claims: [
                  { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
                ],
                surprise: 66,
                asofSafe: true,
                names: [name],
              }),
            );
          }
        }
      }

      // ── Season-aggregate reveals (asofSafe: false) ───────────────────────────
      // Correct at T-60 in live operation; time-travelled if you point them at a
      // fixture that has already been played. strictAsOf drops them.
      if (!strictAsOf) {
        const apps = sm.statTotal(p, sm.STAT.APPEARANCES, { teamId: side.id });
        if (apps === 0 || apps === null) {
          facts.push(
            fact({
              kind: "club_debut",
              text: `${name} makes his first recorded appearance for ${side.team.name} today.`,
              claims: [
                { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
                { type: "player_debut_club", player_id: l.player_id, name, team_id: side.id, club: side.team.name },
              ],
              surprise: 85,
              asofSafe: false,
              names: [name],
            }),
          );
        } else if (apps !== null) {
          const next = apps + 1;
          if (next % 100 === 0 || next % 50 === 0) {
            facts.push(
              fact({
                kind: "milestone_appearance",
                text:
                  `${name} had made ${apps} appearances for ${side.team.name} before kick-off today. ` +
                  `Today is number ${next}.`,
                claims: [
                  { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
                  {
                    type: "player_stat",
                    player_id: l.player_id,
                    name,
                    stat: "appearances",
                    value: apps,
                    team_id: side.id,
                    club: side.team.name,
                  },
                ],
                surprise: next % 100 === 0 ? 88 : 62,
                asofSafe: false,
                names: [name],
              }),
            );
          }
        }

        const hats = sm.statTotal(p, sm.STAT.HATTRICKS, { teamId: side.id });
        if (hats && hats >= 1) {
          const goals = sm.statTotal(p, sm.STAT.GOALS, { teamId: side.id });
          facts.push(
            fact({
              kind: "hat_trick_club_record",
              text:
                `${name}, in today's ${side.team.name} XI, had ${hats} hat-trick${hats === 1 ? "" : "s"} ` +
                `for the club before kick-off (${goals ?? "?"} goals in all).`,
              claims: [
                { type: "player_in_lineup", player_id: l.player_id, name, fixture_id: Number(fixtureId), team_id: side.id },
                {
                  type: "player_stat",
                  player_id: l.player_id,
                  name,
                  stat: "hattricks",
                  value: hats,
                  team_id: side.id,
                  club: side.team.name,
                },
              ],
              surprise: 72,
              asofSafe: false,
              names: [name],
            }),
          );
        }
      }
    }
  }

  // The whitelist is the ONLY set of people the LLM may name — the confirmed XIs
  // plus both benches. Anything outside it is, by construction, a hallucination.
  const clubs = [home.name, away.name];
  const kept = strictAsOf ? facts.filter((f) => f.asofSafe) : facts;
  kept.sort((a, b) => b.surprise - a.surprise);

  return {
    facts: kept,
    whitelist: [...new Set(whitelist)],
    clubs,
    meta: {
      confirmed: true,
      fixtureId: Number(fixtureId),
      kickoff,
      home: home.name,
      away: away.name,
      homeId: home.id,
      awayId: away.id,
      h2hOnRecord: h2hAll.length,
      h2hBeforeKickoff: h2h.length,
      strictAsOf,
      dropped: facts.length - kept.length,
      smCalls: sm.calls(),
    },
  };
}
