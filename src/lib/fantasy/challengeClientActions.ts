"use client";
/**
 * Client-side wrappers around the challenge lifecycle routes
 * (/api/fantasy/challenges/[id]/accept|decline|cancel) — the exact fetch
 * shape LeagueChatView's ChallengeCardMsg actions have used since Phase 3A,
 * factored out here (Phase 4A) so the Games tab calls the SAME code rather
 * than growing a second, potentially-divergent copy. Every function here is
 * a thin fetch + error-shape wrapper; callers (LeagueChatView, LeagueGamesView)
 * still own their own busy state and post-action reload/navigate — this file
 * holds no React state of its own.
 */
import { trackChallengeAccepted, trackChallengeDeclined, trackChallengeCancelled } from "@/lib/analytics/trackSocial";

/** Thrown on a 409 — someone else's tap already closed this challenge, or it
 *  expired between load and tap. A caller reloads instead of showing this as
 *  a hard error (the card just needs to catch up to reality). */
export class ChallengeActionConflict extends Error {}

/** One-tap accept (product decision, locked): the opponent's "Play" tap IS
 *  acceptance — no separate Accept step. Idempotent for a genuine repeat tap
 *  (see acceptChallenge in challenges.ts for the server-side half of that
 *  guarantee). */
export async function acceptChallengeAction(challengeId: string, gameType: string): Promise<{ h2hId: string | null }> {
  const res = await fetch(`/api/fantasy/challenges/${challengeId}/accept`, { method: "POST" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) throw new ChallengeActionConflict(j.error ?? "This challenge isn't open anymore");
    throw new Error(j.error ?? "Could not accept");
  }
  trackChallengeAccepted(gameType);
  return { h2hId: j.h2hId ?? null };
}

/** Decline is discreet (product decision, locked) — see declineChallenge in
 *  challenges.ts. Only the opponent, only while pending; a stale tap 409s. */
export async function declineChallengeAction(challengeId: string, gameType: string): Promise<void> {
  const res = await fetch(`/api/fantasy/challenges/${challengeId}/decline`, { method: "POST" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) throw new ChallengeActionConflict(j.error ?? "This challenge can't be declined anymore");
    throw new Error(j.error ?? "Could not decline");
  }
  trackChallengeDeclined(gameType);
}

/** Withdraw — only the challenger, only while pending; see cancelChallenge
 *  in challenges.ts. */
export async function cancelChallengeAction(challengeId: string, gameType: string): Promise<void> {
  const res = await fetch(`/api/fantasy/challenges/${challengeId}/cancel`, { method: "POST" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409) throw new ChallengeActionConflict(j.error ?? "This challenge can't be cancelled anymore");
    throw new Error(j.error ?? "Could not cancel");
  }
  trackChallengeCancelled(gameType);
}
