/**
 * A guest's chosen club, held locally.
 *
 * Signed-in players declare a club into `club_supporters`, which is a competition entry:
 * it decides whose leaderboard their halftime scores count for, and it is LOCKED for the
 * season (migration 94 — no update or delete policy). A guest has no row in `profiles`, so
 * they cannot be written there at all.
 *
 * Rather than shut guests out of 38-0 Pro's club questions, their pick lives here, in
 * localStorage, exactly like the in-progress XI does (lib/draft/local.ts). That keeps the
 * anonymous draft loop whole — and it's the point of asking them (founder, 2026-07-22): a
 * guest who has picked a club and played with it has a reason to make an account, namely
 * to keep it.
 *
 * ⚠️ The two are NOT the same promise, and the copy must not pretend otherwise:
 *   guest pick   → a local preference. Changeable, device-only, lost if they clear storage.
 *   account pick → a season-locked competition entry they cannot switch.
 * So a guest is never told "locked for the season". When they do sign up, ClubPrompt
 * pre-selects this pick and they confirm it — the lock is only ever taken deliberately.
 */

const KEY = "ys:guest-club:v1";

/** Read the guest's club, validated against `allowed` so a stale or hand-edited value
 *  (e.g. a club relegated since they picked) can never reach the question draw. */
export function loadGuestClub(allowed?: string[]): string | null {
  if (typeof window === "undefined") return null;
  try {
    const club = localStorage.getItem(KEY);
    if (!club) return null;
    if (allowed && allowed.length > 0 && !allowed.includes(club)) return null;
    return club;
  } catch {
    return null; // private mode / storage disabled
  }
}

export function saveGuestClub(club: string): void {
  try { localStorage.setItem(KEY, club); } catch { /* private mode — the pick just won't persist */ }
}

/** Cleared once the pick has been carried into a real account, so the two can't disagree. */
export function clearGuestClub(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
