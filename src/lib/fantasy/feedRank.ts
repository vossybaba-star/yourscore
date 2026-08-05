/**
 * Pure ranking for the Social "Top" feed (Phase 5b, AC1) — deterministic
 * scoring plus a post-sort diversity pass. Deliberately dependency-free (no
 * `server-only`, no Supabase, no other app imports) so it can be unit tested
 * standalone via node/tsx — see feedRank.test.ts.
 *
 * feed.ts (which IS server-only) imports these and calls them on the already-
 * hydrated FeedEvent[] it builds; FeedEvent satisfies RankableEvent
 * structurally, so no runtime import is needed here to stay fully typed.
 */

export interface RankableEvent {
  actorId: string;
  type: string;
  createdAt: string;
  reactions: { emoji: string; count: number }[];
  commentCount: number;
  repostCount: number;
  poll?: unknown | null;
  image?: string | null;
  images?: string[] | null;
  gif?: unknown | null;
}

export interface ScoreOptions {
  /** Epoch ms "now" — override in tests; defaults to Date.now(). */
  now?: number;
  /** Ids the viewer follows. A follow gets a 1.25x boost. Null/undefined = no
   *  viewer (never boosted) — matches AC1: "when a viewer is present". */
  followedIds?: Set<string> | null;
}

const TIME_DECAY_HALF_LIFE_HOURS = 24;
const FOLLOWED_MULTIPLIER = 1.25;

/** Raw (undecayed) engagement — reactions + comments + reposts. Used for the
 *  Trending threshold (AC2), which is a hard floor on ACTUAL engagement, not
 *  on the time-decayed score. */
export function rawEngagement<T extends RankableEvent>(e: T): number {
  const reactions = e.reactions.reduce((sum, r) => sum + r.count, 0);
  return reactions + e.commentCount + e.repostCount;
}

/** score = reactions + 2*comments + 3*reposts, decayed by a 24h half-life,
 *  boosted 1.25x for a followed author when a viewer is present (AC1). */
export function scoreFeedEvent<T extends RankableEvent>(e: T, opts: ScoreOptions = {}): number {
  const now = opts.now ?? Date.now();
  const reactions = e.reactions.reduce((sum, r) => sum + r.count, 0);
  const weighted = reactions + 2 * e.commentCount + 3 * e.repostCount;
  const ageHours = Math.max(0, (now - Date.parse(e.createdAt)) / 3_600_000);
  const decay = Math.pow(0.5, ageHours / TIME_DECAY_HALF_LIFE_HOURS);
  let score = weighted * decay;
  if (opts.followedIds && opts.followedIds.has(e.actorId)) score *= FOLLOWED_MULTIPLIER;
  return score;
}

export type ContentClass = "squad" | "poll" | "system-activity" | "media" | "text";

/** The diversity pass's content bucket for an event. A squad reveal is its
 *  own class (the richest tile); anything that isn't a user "post" is a
 *  system-activity line (transfer/captain/chip/haul/rank_jump/squad_update/
 *  shortlist_add/quiz_result); a post then splits into poll/media/text. */
export function contentClassOf<T extends Pick<RankableEvent, "type" | "poll" | "image" | "images" | "gif">>(
  e: T,
): ContentClass {
  if (e.type === "squad_complete") return "squad";
  if (e.type !== "post") return "system-activity";
  if (e.poll) return "poll";
  if (e.image || (e.images && e.images.length > 0) || e.gif) return "media";
  return "text";
}

/**
 * Post-sort diversity pass (AC1): no more than 2 consecutive posts by the
 * same author, and no more than 2 consecutive posts of the same content
 * class. A violator is DEMOTED — pushed down to the next slot where it no
 * longer violates — never dropped.
 *
 * Greedy, stable algorithm: `ranked` is assumed already score-sorted
 * (highest first). At each output slot, take the highest-ranked remaining
 * candidate that doesn't violate given the last two placed items. If every
 * remaining candidate would violate (e.g. everything left is by the same
 * author), fall back to the highest-ranked one anyway — that's the only way
 * to guarantee every item still gets placed (never dropped) and the loop
 * always terminates.
 */
export function applyDiversity<T extends RankableEvent>(ranked: T[]): T[] {
  const remaining = ranked.slice();
  const output: T[] = [];

  const violates = (candidate: T): boolean => {
    const n = output.length;
    if (n < 2) return false;
    const last1 = output[n - 1];
    const last2 = output[n - 2];
    if (last1.actorId === candidate.actorId && last2.actorId === candidate.actorId) return true;
    const cls = contentClassOf(candidate);
    if (contentClassOf(last1) === cls && contentClassOf(last2) === cls) return true;
    return false;
  };

  while (remaining.length) {
    let idx = remaining.findIndex((c) => !violates(c));
    if (idx === -1) idx = 0; // nothing valid left — place the best one anyway, never drop
    output.push(remaining[idx]);
    remaining.splice(idx, 1);
  }
  return output;
}

/** Score-sort (tiebreak: newest first) then run the diversity pass — the
 *  full AC1 "Top" ranking pipeline. */
export function rankTop<T extends RankableEvent>(events: T[], opts: ScoreOptions = {}): T[] {
  const scored = events.map((e) => ({ e, s: scoreFeedEvent(e, opts) }));
  scored.sort((a, b) => b.s - a.s || Date.parse(b.e.createdAt) - Date.parse(a.e.createdAt));
  return applyDiversity(scored.map((x) => x.e));
}
