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
  BASELINE_CREDITS_PER_GW, BUDGET_TENTHS, CASH_POINTS, CREDIT_CAP,
  HIT_POINTS, MAX_PER_CLUB, SQUAD_QUOTA, SQUAD_SIZE, XI_SIZE,
} from "./engine";
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
    a: "One chip a month, your pick of three: Triple Captain, Bench Boost or Insight. A chip cannot come back until you have used the other two.",
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
];

/** A compact plain text rules document, built from the same constants and the
 *  FAQ above, used server side as the ONLY thing the rules bot's model is
 *  allowed to answer from (see rules-qa/route.ts). Nothing here is hand typed
 *  that the engine already exports. */
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
    "CHIPS: one chip a month, choice of Triple Captain, Bench Boost or Insight. A chip cannot return until the other two have been used.",
    "SCORING: every point comes from a real match fact, goals, assists, clean sheets, minutes, saves, cards and the rest. There is no bonus points panel and no judged score.",
    `TABLES: the season total is every gameweek added up. Each calendar month is also its own competition that resets. Level on points, the manager with the better round record wins, and ${KNOWLEDGE_NAME} is the final tiebreak.`,
    "SELLING A PLAYER: a player who has risen in price pays back half the rise. A player who has fallen sells for exactly what he is worth now.",
    "",
    "FREQUENTLY ASKED",
    ...FAQ.map((f) => `Q: ${f.q}\nA: ${f.a}`),
  ];
  return lines.join("\n");
}
