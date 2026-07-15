/**
 * PL News — the GENERAL football news feed for Matchweek → PL → News.
 *
 * Deliberately NOT the fantasy feed: no tips, no fantasy transfer advice (those
 * live under the Fantasy tab). This is the latest around football — clubs,
 * fixtures, and what's trending — a stream of real articles from real outlets.
 *
 * Source: RSS from major football desks (BBC Sport, Guardian Football, …),
 * aggregated + deduped by the ingest (scripts/pl-news-ingest.mjs) into one
 * `pl_news_feed` doc that /api/pl/news reads. See that script for the source list.
 *
 * This module is pure (types + client-safe categorisation) so the chips can be
 * unit-tested and the component stays dumb.
 */

export interface PlNewsItem {
  /** Stable id — hash of the canonical url, so re-ingesting the same article
   *  never duplicates it. */
  id: string;
  title: string;
  url: string;
  /** Human source name, e.g. "BBC Sport". */
  source: string;
  image: string | null;
  /** ISO publish time from the feed. */
  publishedAt: string;
}

export interface PlNewsFeed {
  items: PlNewsItem[];
  updatedAt: string;
}

export type PlNewsCategory = "all" | "clubs" | "fixtures" | "trending";

export const PL_NEWS_CATEGORIES: { id: PlNewsCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "trending", label: "Trending" },
  { id: "clubs", label: "Clubs" },
  { id: "fixtures", label: "Fixtures" },
];

/** The 20 clubs + common short forms, for tagging club stories. Lower-cased. */
export const PL_CLUB_TERMS: string[] = [
  "arsenal", "aston villa", "villa", "bournemouth", "brentford", "brighton",
  "burnley", "chelsea", "crystal palace", "palace", "everton", "fulham",
  "leeds", "liverpool", "manchester city", "man city", "manchester united",
  "man united", "man utd", "newcastle", "nottingham forest", "forest",
  "sunderland", "tottenham", "spurs", "west ham", "wolves", "wolverhampton",
];

const FIXTURE_RE =
  /\b(v|vs)\b|preview|line-?ups?|team news|kick-?off|predicted xi|build-?up|starting xi|injury|suspend|doubt|ruled out/i;

/** Most-recent window that counts as "trending" (also capped by TRENDING_MAX). */
const TRENDING_WINDOW_MS = 10 * 60 * 60 * 1000; // 10h
const TRENDING_MAX = 8;

function mentionsClub(title: string): boolean {
  const t = title.toLowerCase();
  return PL_CLUB_TERMS.some((c) => t.includes(c));
}

/**
 * Filter a feed to one chip. Pure and deterministic given `now` (passed in so
 * it's testable and never touches Date.now() in a way that breaks snapshots).
 */
export function filterByCategory(
  items: PlNewsItem[],
  category: PlNewsCategory,
  now: number,
): PlNewsItem[] {
  const byRecency = (a: PlNewsItem, b: PlNewsItem) =>
    new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  switch (category) {
    case "all":
      // Preserve the SERVER order — it's newest-first with our blog posts
      // interleaved in. Re-sorting by date here would bury the evergreen blog
      // cards at the bottom, undoing the plug.
      return items;
    case "clubs":
      return items.filter((i) => mentionsClub(i.title));
    case "fixtures":
      return items.filter((i) => FIXTURE_RE.test(i.title));
    case "trending":
      return [...items]
        .sort(byRecency)
        .filter((i) => now - new Date(i.publishedAt).getTime() <= TRENDING_WINDOW_MS)
        .slice(0, TRENDING_MAX);
  }
}

/** "2h ago" — a feed without timestamps doesn't read as news. */
export function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
