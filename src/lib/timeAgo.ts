/**
 * The one "how long ago" formatter for the app's activity surfaces (feed
 * events, league chat rows, comments, completed games). Sprint 3
 * consolidation: six call sites (FantasyHome, FeedStream, ProfileSocialTabs,
 * LeagueGamesView, LeagueHistoryView, and one more) had each grown their own
 * copy, and they'd drifted in two ways — wording ("now" vs "just now" vs long
 * form) and granularity (some capped at compact "Nd", some capped at weeks,
 * so a 40 day old item read "40d" on one screen and "12 weeks ago" on
 * another; neither is what a human would say).
 *
 * Chosen behaviour: LONG FORM ("2 hours ago"), because that's what the league
 * surfaces already used and it reads better in a sentence than "2h". Buckets
 * extend past weeks into months and years so nothing far off ever prints as
 * a compact day count or a double-digit week count.
 *
 * No `server-only` import — this has no server dependency, so both client
 * components and server components can call it directly. Not merged into
 * shared.tsx: that module is "use client" (see newsUi.tsx's own note on the
 * same constraint), and this needs to be callable from anywhere.
 */
export function timeAgo(iso: string): string {
  // Clamp: a clock-skewed or just-written timestamp can read as a few
  // milliseconds in the future — treat that the same as "just now" rather
  // than print a negative count.
  const ms = Math.max(0, Date.now() - new Date(iso).getTime());
  if (ms < 60_000) return "just now";

  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;

  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(ms / 86_400_000);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }

  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }

  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
