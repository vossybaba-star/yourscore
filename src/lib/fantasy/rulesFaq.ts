/**
 * The canned rules Q&A — the honest floor under the rules bot. Every answer is
 * a template literal built from the engine's own exported constants, same
 * discipline as /fantasy/rules itself: this file drifting from the engine would
 * be worse than it not existing.
 *
 * Pure and client-safe on purpose (no "server-only", no imports beyond engine
 * and brand): RulesBot.tsx matches a typed question against this list with
 * ZERO network cost, and rules-qa/route.ts reads buildRulesDoc() as the only
 * grounding document the model is allowed to answer from.
 */
import {
  BASELINE_CREDITS_PER_GW, BUDGET_TENTHS, CASH_POINTS, CREDIT_CAP, HALF_SEASON_GW,
  HIT_POINTS, MAX_PER_CLUB, SQUAD_QUOTA, SQUAD_SIZE, XI_SIZE,
  creditsForRound,
} from "./engine";
import { pointsFor, ZERO_FACTS, type FantasyPos, type MatchFacts } from "./values";
import { KNOWLEDGE_NAME } from "./brand";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

export interface FaqItem { q: string; a: string }

export const FAQ: FaqItem[] = [
  {
    q: "How many players do I pick, and what is my budget?",
    a: `You pick ${SQUAD_SIZE} players for ${money(BUDGET_TENTHS)}: ${SQUAD_QUOTA.GK} keepers, ${SQUAD_QUOTA.DEF} defenders, ${SQUAD_QUOTA.MID} midfielders and ${SQUAD_QUOTA.FWD} forwards.`,
  },
  {
    q: "Is there a limit on players from one club?",
    a: `No more than ${MAX_PER_CLUB} players from any one club, so your squad cannot lean entirely on one team.`,
  },
  {
    q: "Who starts and who sits on the bench?",
    a: `${XI_SIZE} of your ${SQUAD_SIZE} players start each gameweek, and the rest sit on the bench. Your starting XI needs exactly one keeper, at least three defenders and at least one forward.`,
  },
  {
    q: "How does the captain work?",
    a: "One of your starters wears the armband and scores double. If he does not play, it passes to your vice captain.",
  },
  {
    q: "What happens if my captain does not play?",
    a: "If your captain does not play a single minute, the armband passes to your vice captain. If neither plays, it goes to whichever of your starters is in the best form, so a double is never wasted on someone who was never on the pitch.",
  },
  {
    q: "What is the deadline, and what happens if I miss it?",
    a: "Your team locks before the first match of the gameweek. Miss the deadline and your team simply plays as it stands, with whatever squad and captain you last set.",
  },
  {
    q: "How many free transfers do I get?",
    a: `Everyone gets ${BASELINE_CREDITS_PER_GW} free transfer every single gameweek, no strings attached.`,
  },
  {
    q: `How do I earn extra transfers with ${KNOWLEDGE_NAME}?`,
    a: `Play the ${KNOWLEDGE_NAME} round of eleven questions. Right answers earn you extra transfers on top of your free one. It is entirely optional, skip it and your team still plays the gameweek as normal.`,
  },
  {
    q: "Can unused transfers carry over?",
    a: `Yes. Transfers you do not use bank up to a maximum of ${CREDIT_CAP}.`,
  },
  {
    q: "What does an extra transfer cost once I am out of banked ones?",
    a: `Beyond what you hold, each extra transfer costs you ${HIT_POINTS} points off your gameweek score.`,
  },
  {
    q: "What happens if my bank is full and I earn even more transfers?",
    a: `If your bank is already at the cap of ${CREDIT_CAP}, anything further you earn cashes out at ${CASH_POINTS} points each, added straight onto your gameweek score, so a great round is never wasted.`,
  },
  {
    q: "What are the chips, and how often can I play one?",
    a: "One chip a month, your pick of three: Triple Captain, Bench Boost or Insight. A chip cannot come back until you have used the other two. The Wildcard is separate, on its own track: unlimited free transfers for one gameweek, one for each half of the season, use it or lose it at the halfway deadline.",
  },
  {
    q: "How does scoring work? Is there a bonus points panel?",
    a: "Every point traces to something that actually happened on the pitch, goals, assists, clean sheets, minutes and the rest. No panel decides your bonus.",
  },
  {
    q: "How do the monthly tables work, and what breaks a tie?",
    a: `Your season total is every gameweek added up, and each calendar month is also its own competition that resets. Level on points, the manager with the better round record wins, and ${KNOWLEDGE_NAME} is the final tiebreak.`,
  },
  {
    q: `Do I have to play the ${KNOWLEDGE_NAME} round every gameweek?`,
    a: "No. The round is a bonus, never a requirement. Your team scores on the real matches whether you answer a single question or not, and a gameweek you skip entirely still plays as it stands.",
  },
  {
    q: "What do I get for selling a player?",
    a: "Selling a player who has risen in price pays you back half the rise. A player who has fallen sells for exactly what he is worth now.",
  },
  {
    q: "When is my score final?",
    a: "Your score updates live while the matches are on, so it can move all weekend. It settles a few hours after the gameweek's last kickoff, and the gameweek finalises the day after, once the full match data is in.",
  },
  {
    q: "What happens in a blank or double gameweek?",
    a: "In a blank gameweek a club has no fixture, so its players simply score nothing that week, with no penalty, and your bench steps in where it legally can. In a double gameweek a club plays twice: each match is scored separately and the two scores add up.",
  },
];

/** A compact plain text rules document, built from the same constants and the
 *  FAQ above, used server side as the ONLY thing the rules bot's model is
 *  allowed to answer from (see rules-qa/route.ts). Nothing here is hand typed
 *  that the engine already exports. */
/** The scoring rows, read off the engine the same way the page's table is:
 *  score a baseline 90 minutes, apply one fact, take the difference. */
function scoringLines(): string[] {
  const POSITIONS: FantasyPos[] = ["GK", "DEF", "MID", "FWD"];
  const worth = (pos: FantasyPos, fact: Partial<MatchFacts>): number => {
    const base: MatchFacts = { ...ZERO_FACTS, minutes: 90 };
    return pointsFor(pos, { ...base, ...fact }) - pointsFor(pos, base);
  };
  const row = (label: string, fact: Partial<MatchFacts>) =>
    `${label}: ` + POSITIONS
      .map((p) => ({ p, v: worth(p, fact) }))
      .filter((r) => r.v !== 0)
      .map((r) => `${r.p} ${r.v > 0 ? "+" : ""}${r.v}`)
      .join(", ");
  return [
    `Playing 60 minutes or more: ${POSITIONS.map((p) => `${p} +${pointsFor(p, { ...ZERO_FACTS, minutes: 90 })}`).join(", ")}`,
    `Playing under 60 minutes: ${POSITIONS.map((p) => `${p} +${pointsFor(p, { ...ZERO_FACTS, minutes: 30 })}`).join(", ")}`,
    row("Goal", { goals: 1 }),
    row("Assist", { assists: 1 }),
    row("Clean sheet, 60 minutes or more", { cleanSheet: 1 }),
    row("Every 3 saves", { saves: 3 }),
    row("Penalty saved", { pensSaved: 1 }),
    row("Every 2 goals conceded", { conceded: 2 }),
    row("Penalty missed", { pensMissed: 1 }),
    row("Yellow card", { yellows: 1 }),
    row("Red card", { reds: 1 }),
    row("Own goal", { ownGoals: 1 }),
    "Defensive contribution (10 clearances, interceptions, tackles and blocks for a defender; 12 including recoveries for everyone else): " +
      POSITIONS.map((p) => ({ p, v: worth(p, p === "DEF" ? { dc: 10 } : { dcRec: 12 }) }))
        .filter((r) => r.v !== 0).map((r) => `${r.p} +${r.v}`).join(", "),
  ];
}

/** The credit curve as steps, read off creditsForRound rather than restated. */
function creditLines(): string {
  const steps: string[] = [];
  let last = 0;
  for (let c = 0; c <= 11; c++) {
    const credits = creditsForRound(c);
    if (credits !== last) { steps.push(`${c} right answers earn ${credits}`); last = credits; }
  }
  return steps.join("; ");
}

export function buildRulesDoc(): string {
  const lines = [
    "YOURSCORE FANTASY, THE RULES",
    "",
    `SQUAD: ${SQUAD_SIZE} players for ${money(BUDGET_TENTHS)}. ${SQUAD_QUOTA.GK} keepers, ${SQUAD_QUOTA.DEF} defenders, ${SQUAD_QUOTA.MID} midfielders, ${SQUAD_QUOTA.FWD} forwards. No more than ${MAX_PER_CLUB} players from one club.`,
    `STARTING XI: ${XI_SIZE} players start, the rest sit on the bench. One keeper, at least three defenders, at least one forward.`,
    "CAPTAIN: your captain scores double. Your vice captain steps up if the captain does not play. If neither plays, the armband goes to whichever starter is in the best form.",
    "DEADLINE: your team locks before the first match of the gameweek. Miss it and the team plays as it stands.",
    `TRANSFERS: ${BASELINE_CREDITS_PER_GW} free transfer every gameweek, always, no strings attached. The optional ${KNOWLEDGE_NAME} round of eleven questions earns extra transfers for right answers. Unused transfers bank up to ${CREDIT_CAP}. Beyond that, each extra transfer costs ${HIT_POINTS} points. If the bank is already full, further earned transfers cash out at ${CASH_POINTS} points each, straight onto the gameweek score.`,
    `THE KNOWLEDGE ROUND: optional, never required. Skipping it still lets the team play and score the gameweek normally.`,
    `THE CREDIT CURVE: ${creditLines()}. If the bank is full, further earned transfers cash out at ${CASH_POINTS} points each.`,
    `CHIPS: one chip a month, choice of Triple Captain, Bench Boost or Insight. A chip cannot return until the other two have been used. Triple Captain makes the captain score triple instead of double for that gameweek. Bench Boost makes all ${SQUAD_SIZE} players score, bench included. Insight removes two wrong answers from one question of the ${KNOWLEDGE_NAME} round.`,
    `WILDCARD: a separate chip on its own track, not part of the monthly rotation. It gives unlimited free transfers for one gameweek, no points hits. You get one for each half of the season and it is use it or lose it, expiring at the gameweek ${HALF_SEASON_GW} deadline for the first half.`,
    "SCORING: every point comes from a real match fact. There is no bonus points panel and no judged score. The exact values by position (GK, DEF, MID, FWD):",
    ...scoringLines(),
    "The captain's points count double after all facts are scored.",
    "ASSISTS AND MATCH FACTS: goals, assists and every other fact come from the official match data the game scores from. An assist is whatever that data credits, including the touch before a goal and a won penalty that is scored.",
    "LIVE SCORES: scores update live while matches are on and can move all weekend. The score settles a few hours after the gameweek's last kickoff, and the gameweek finalises the day after, once the full match data is in. Only then do season totals and the transfer tray bank.",
    "BLANK GAMEWEEK: a club with no fixture that week scores nothing, with no penalty; the bench steps in where it legally can. DOUBLE GAMEWEEK: a club that plays twice has each match scored separately and the two scores add up.",
    "PRICES: set once when a gameweek opens and held for the whole week. Nothing moves mid week.",
    `TABLES: the season total is every gameweek added up. Each calendar month is also its own competition that resets. Level on points, the manager with the better round record wins, and ${KNOWLEDGE_NAME} is the final tiebreak.`,
    "SELLING A PLAYER: a player who has risen in price pays back half the rise. A player who has fallen sells for exactly what he is worth now.",
    "",
    "FREQUENTLY ASKED",
    ...FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`),
  ];
  return lines.join("\n");
}
