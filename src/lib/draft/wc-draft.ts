/**
 * 38-0 World Cup — server-authoritative RANKED draft.
 *
 * The ranked daily run must be earned, not crafted. So for ranked runs the server — not the
 * client — owns the draft: it serves the day's questions WITHOUT the answer, grades each one,
 * and spins the slate of candidate players for every pick from a SERVER-SECRET seed
 * (pensSeed's HMAC pepper) so a client can't precompute the slates offline even though it has
 * the spin code. On submit, `verifyRankedDraft` replays the whole draft and rejects any XI
 * whose picks weren't legitimate, server-offered options for the band the answers earned.
 *
 * Practice runs are unaffected — they stay fully client-side (see /38-0/wc page).
 */

import "server-only";
import { spinWorld, getPlayer } from "./pool";
import { playerIdentity, seededRng } from "./score";
import { slotsFor } from "./formations";
import { dailyQuestions } from "./wc-quiz";
import { gradeAnswer } from "./draft-quiz";
import { pensSeed } from "./pens-server";
import type { Formation, PlayerSeason } from "./types";

/** The ranked draft is always a 4-3-3 World XI — fixed server-side so the client can't
 *  reshape the slot positions to fish for better candidates. */
export const WC_DRAFT_FORMATION: Formation = "4-3-3";

export type DraftPick = { slot: string; player_season_id: string };
export type PublicQ = { id: string; prompt: string; options: string[]; category: string };
/** A candidate player as sent to the client for a slate (no hidden fields). */
export type SlatePlayer = { id: string; name: string; club: string; position: string; overall: number };

const draftQuestionCount = () => slotsFor(WC_DRAFT_FORMATION).length;

/** The slot ids/positions a ranked draft fills, in order. */
export function draftSlots(): { id: string; pos: string }[] {
  return slotsFor(WC_DRAFT_FORMATION).map((s) => ({ id: s.id, pos: s.pos }));
}

/** Today's ranked questions WITHOUT the correct index — the client never receives the
 *  answer; the server grades it on the slate/submit calls. */
export function rankedQuestions(date: string): PublicQ[] {
  return dailyQuestions(date, draftQuestionCount())
    .map((q) => ({ id: q.id, prompt: q.prompt, options: q.options, category: q.category }));
}

/** Fold the answers through the streak/band logic up to pick `k`; also report whether the
 *  k-th answer was correct (+ its index, safe to reveal once the player has answered). */
function bandAfter(date: string, answers: number[], k: number): { band: { minOverall: number; maxOverall: number }; correct: boolean; correctIndex: number } {
  const qs = dailyQuestions(date, draftQuestionCount());
  let streak = 0;
  let band = { minOverall: 0, maxOverall: 99 };
  let correct = false;
  for (let j = 0; j <= k && j < qs.length; j++) {
    correct = answers[j] === qs[j].correctIndex;
    const g = gradeAnswer(streak, correct);
    streak = g.streak;
    band = g.band;
  }
  return { band, correct, correctIndex: qs[k]?.correctIndex ?? -1 };
}

export type DraftStep = { correct: boolean; correctIndex: number; nation: string; crest?: string; era?: string; players: PlayerSeason[] };

/**
 * The slate for pick `k`: spin the still-open positions within the band that answers[0..k]
 * earned, from a server-secret seed so it's reproducible on the server (per-pick + verify)
 * but unpredictable to the client. `priorPicks` are the players already taken this draft.
 *
 * `salt` (the player's user id) makes the slates PER-PLAYER: everyone answers the same
 * questions, but the teams/players offered differ from player to player — no two squads are
 * drawn from the same options. The band still rises with correct answers (better players),
 * and the secret pepper still hides the seed from the client (anti-cheat).
 *
 * `targetSlot` (optional) narrows the spin to ONE chosen open slot's position — the player
 * tapped a pitch slot to scout for it. It's folded into the seed so a targeted slate is its
 * own reproducible draw; an untargeted step keeps the exact pre-target seed string, so
 * drafts from clients that never send a target verify unchanged. An invalid/filled target
 * is ignored (falls back to all open positions) — identically at slate time and at verify.
 */
export function rankedDraftStep(date: string, salt: string, answers: number[], priorPicks: DraftPick[], k: number, targetSlot?: string | null): DraftStep {
  const { band, correct, correctIndex } = bandAfter(date, answers, k);
  const slots = slotsFor(WC_DRAFT_FORMATION);
  const usedSlots = new Set(priorPicks.map((p) => p.slot));
  const target = targetSlot ? slots.find((s) => s.id === targetSlot && !usedSlots.has(s.id)) : undefined;
  const openPositions = target
    ? [target.pos]
    : slots.filter((s) => !usedSlots.has(s.id)).map((s) => s.pos);
  const usedIds = new Set(priorPicks.map((p) => p.player_season_id));
  const usedIdentities = new Set(
    priorPicks.map((p) => { const pl = getPlayer(p.player_season_id); return pl ? playerIdentity(pl.name) : ""; }),
  );
  const seed = pensSeed(`wc-draft:${date}:${salt}:step:${k}${target ? `:target:${target.id}` : ""}`);
  const sp = spinWorld(openPositions, usedIds, usedIdentities, { count: 6, minOverall: band.minOverall, maxOverall: band.maxOverall }, seededRng(seed));
  return { correct, correctIndex, nation: sp.nation, crest: sp.crest, era: sp.era, players: sp.players };
}

export const toSlatePlayer = (p: PlayerSeason): SlatePlayer =>
  ({ id: p.id, name: p.name, club: p.club, position: p.position, overall: p.overall });

/** Grade a ranked run's quiz: how many of the day's questions the player answered
 *  correctly (server-side — the client never had the correct indices). Recorded on the
 *  run row at submit so it can be shown on the season-board history. */
export function rankedQuizScore(date: string, answers: number[]): { correct: number; total: number } {
  const qs = dailyQuestions(date, draftQuestionCount());
  let correct = 0;
  for (let j = 0; j < qs.length; j++) if (answers[j] === qs[j].correctIndex) correct++;
  return { correct, total: qs.length };
}

/** Per-question record of a ranked gate, stored on the run row (migration 76) for the
 *  content pipeline (Question Guru / hardest-question stats). Pack-compatible shape:
 *  letter-keyed options + letter answer. Questions and option order are deterministic
 *  per date (same-test rule), so the objects aggregate cleanly across players. */
export function rankedQuizDetail(date: string, answers: number[]): Array<Record<string, unknown>> {
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  return dailyQuestions(date, draftQuestionCount()).map((q, j) => ({
    question: q.prompt,
    options: Object.fromEntries(q.options.map((o, i) => [LETTERS[i] ?? String(i), o])),
    answer: LETTERS[q.correctIndex] ?? null,
    category: q.category,
    selected: LETTERS[answers[j]] ?? null,
    correct: answers[j] === q.correctIndex,
  }));
}

/**
 * Replay the whole ranked draft and confirm every pick was a legitimate option the server
 * would have offered for the band its answers earned (and lands in a valid, unused slot).
 * `targets[k]` is the slot the player aimed pick k at (null = untargeted) — it must match
 * what the slate call used, or the replayed slate won't contain the pick. Returns the
 * validated `{slot, player_season_id}` list to build the XI from, or null if anything
 * fails to reconcile (tampering, stale client, wrong length).
 */
export function verifyRankedDraft(date: string, salt: string, answers: number[], picks: DraftPick[], targets?: (string | null)[]): DraftPick[] | null {
  const slots = slotsFor(WC_DRAFT_FORMATION);
  const n = slots.length;
  if (!Array.isArray(answers) || !Array.isArray(picks) || answers.length !== n || picks.length !== n) return null;

  const usedSlots = new Set<string>();
  for (let k = 0; k < n; k++) {
    const pick = picks[k];
    if (!pick || typeof pick.slot !== "string" || typeof pick.player_season_id !== "string") return null;
    if (usedSlots.has(pick.slot) || !slots.some((s) => s.id === pick.slot)) return null;
    const step = rankedDraftStep(date, salt, answers, picks.slice(0, k), k, targets?.[k] ?? null);
    if (!step.players.some((p) => p.id === pick.player_season_id)) return null; // not a server-offered option
    usedSlots.add(pick.slot);
  }
  return picks.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id }));
}
