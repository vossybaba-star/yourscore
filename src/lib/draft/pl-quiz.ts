/**
 * Premier League quiz pool — the questions that gate draft quality in 38-0's PL Pro mode.
 *
 * The pool is bundled at build time from an approved slice of the `questions` bank
 * (src/data/draft/pl-quiz.json, produced by scripts/draft/build-pl-quiz.mjs) so there are
 * no runtime DB reads. Each question is stored in canonical A–D order with the correct
 * index; `gateQuestion` re-shuffles the options per serve so the answer is never in a
 * fixed slot.
 *
 * SERVER-ONLY, for the same reason as wc-quiz.ts (audit C1): this module carries every
 * answer. Bundling it client-side would let anyone read the answer to the question they
 * were just asked. Clients get questions through /api/draft/pl/gate-quiz; the types they
 * need live in wc-quiz-public.ts (shared — the shape is identical).
 *
 * ── WHO SEES WHAT ────────────────────────────────────────────────────────────
 * Founder rule (2026-07-22): a player is only ever asked about football they could
 * reasonably know — league-wide Premier League material, plus their OWN club. So every
 * question carries a `scope`:
 *
 *   scope "neutral"  → Premier League records, history and league-wide moments. Everyone.
 *   scope "club"     → about one specific club; only that club's own supporters see it.
 *
 * `eligiblePool(club)` is therefore the whole of the gate's fairness model. A guest, or a
 * signed-in player who hasn't picked a club, simply draws from the neutral pool — no
 * special-casing needed, and no club's trivia ever leaks into another fan's draft.
 *
 * Unlike the World Cup gate there is NO `dailyQuestions` here. PL Pro is replayable, not a
 * dated daily competition, so there is no same-test-for-everyone rule to honour.
 */

import "server-only";
import bundle from "@/data/draft/pl-quiz.json";
import { seededRng } from "./score";
import type { ServedQuestion } from "./wc-quiz-public";

/** A question as stored in the bundle (canonical option order, `answer` = index). */
export type PLQuizQuestion = {
  id: string;
  q: string;
  options: string[];
  answer: number;
  difficulty: string;
  category: string;
  /** "neutral" = every player. "club" = only supporters of `club`. */
  scope: "neutral" | "club";
  /** The bank entity this question is about, or null when scope is "neutral". */
  club: string | null;
};

const DOC = bundle as {
  questions: PLQuizQuestion[];
  neutralCount: number;
  clubAliases: Record<string, string>;
};

const POOL = DOC.questions;
const NEUTRAL = POOL.filter((q) => q.scope === "neutral");

/** Club questions indexed by bank entity, so a draw doesn't re-scan the whole pool. */
const BY_CLUB = new Map<string, PLQuizQuestion[]>();
for (const q of POOL) {
  if (q.scope !== "club" || !q.club) continue;
  const arr = BY_CLUB.get(q.club);
  if (arr) arr.push(q); else BY_CLUB.set(q.club, [q]);
}

/** How many distinct PL gate questions exist in total (all scopes). */
export const PL_QUIZ_COUNT = POOL.length;

/** How many a player with no club sees — the floor for everybody. */
export const PL_NEUTRAL_COUNT = NEUTRAL.length;

/**
 * Map a `club_supporters.club` value to the bank's `entity` spelling.
 *
 * These are two independently-authored name spaces and a few disagree ("AFC Bournemouth"
 * vs "Bournemouth", "Brighton & Hove Albion" vs "Brighton"). A missed mapping doesn't
 * throw — it silently returns zero club questions, i.e. exactly the bug this scoping
 * exists to fix — so the alias table is generated into the bundle alongside the questions
 * rather than being duplicated by hand here.
 *
 * Returns null for no club / a club the bank has nothing for (e.g. Coventry City); the
 * caller then draws neutral-only, which is the correct behaviour, not an error.
 */
export function resolveClubEntity(supporterClub: string | null | undefined): string | null {
  if (!supporterClub) return null;
  const entity = DOC.clubAliases[supporterClub] ?? supporterClub;
  return BY_CLUB.has(entity) ? entity : null;
}

/**
 * The questions a given player may be asked: the neutral pool plus their own club's.
 *
 * Uncapped and un-weighted by deliberate choice (founder, 2026-07-22): a fan simply draws
 * from everything they're entitled to, so the share of own-club questions falls out of how
 * much material that club has. An Arsenal fan (62 own + 96 neutral) meets their club more
 * often than a Sunderland fan (6 + 96) — that's accepted, not a bug to tune away.
 */
export function eligiblePool(clubEntity: string | null): PLQuizQuestion[] {
  const own = clubEntity ? BY_CLUB.get(clubEntity) : undefined;
  return own ? [...NEUTRAL, ...own] : NEUTRAL;
}

/** Prepare a stored question for display: shuffle its options, track the correct slot. */
function serve(base: PLQuizQuestion, rng: () => number): ServedQuestion {
  const order = base.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    id: base.id,
    prompt: base.q,
    options: order.map((i) => base.options[i]),
    correctIndex: order.indexOf(base.answer),
    category: base.category,
  };
}

/**
 * The gate question for a seed, drawn from what this player is eligible for.
 *
 * Deterministic, so the server can re-derive the same question (and grade the answer) on
 * the follow-up call without persisting anything — the same trick the WC practice quiz and
 * tie-deciders use. Callers strip `correctIndex` before sending to the client and reveal it
 * only after the answer is locked.
 *
 * ⚠️ `clubEntity` is part of the derivation, not a filter applied afterwards: the same seed
 * with a different club yields a DIFFERENT question. The grade call must therefore be given
 * the identical club the draw used, which is why the route signs the pair (see the route's
 * HMAC) instead of trusting the client to send it back honestly.
 */
export function gateQuestion(seed: string, clubEntity: string | null = null): ServedQuestion {
  const pool = eligiblePool(clubEntity);
  const rng = seededRng(seed);
  return serve(pool[Math.floor(rng() * pool.length)], rng);
}
