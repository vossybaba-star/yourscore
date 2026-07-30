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
 * unit-tested and the component stays dumb. Keep it that way: the only import
 * is a TYPE, which node erases, so plain scripts can load this file.
 */

import type { RssSource } from "../rss";

export interface PlNewsItem {
  /** Stable id — hash of the canonical url, so re-ingesting the same article
   *  never duplicates it. */
  id: string;
  title: string;
  /** Absolute for outlets; a relative app path (/blog/…) when internal. */
  url: string;
  /** Human source name, e.g. "BBC Sport". */
  source: string;
  image: string | null;
  /**
   * The outlet's OWN standfirst, from the feed's <description>. This is what
   * the half-view sheet reads, so a reader gets the gist without leaving the
   * app. Optional: a few Sky items ship no description, and the sheet degrades
   * to headline-only rather than inventing words we can't source.
   */
  summary?: string;
  /** ISO publish time from the feed. */
  publishedAt: string;
  /**
   * OUR OWN post — read it in the app, never punt the reader out to a browser
   * tab. Only set for /blog links, which the app already renders.
   */
  internal?: boolean;
}

export interface PlNewsFeed {
  items: PlNewsItem[];
  updatedAt: string;
}

/**
 * The desks we read. Lives HERE rather than in ingest.ts because ingest.ts is
 * `server-only` and uses the `@/` alias — neither of which plain node can load,
 * and scripts/pl-news-ingest.mjs imports this list so the manual runner and the
 * cron can never disagree about where the news comes from.
 */
export const PL_SOURCES: RssSource[] = [
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { name: "Guardian Football", url: "https://www.theguardian.com/football/rss" },
  // Sky's 11661 is their Premier League desk.
  { name: "Sky Sports", url: "https://www.skysports.com/rss/11661" },
  { name: "The Standard", url: "https://www.standard.co.uk/sport/football/rss" },
  { name: "FootballLondon", url: "https://www.football.london/?service=rss" },
  { name: "Football365", url: "https://www.football365.com/rss" },
  { name: "Sports Mole", url: "https://www.sportsmole.co.uk/feeds/rss.xml" },
  { name: "Sport Witness", url: "https://sportwitness.co.uk/feed/" },
  // SPORTbible publish ATOM, not RSS, from index.rss — and they run NBA and UFC
  // through the same feed, hence the category requirement.
  { name: "SPORTbible", url: "https://www.sportbible.com/index.rss", requireCategory: "Football" },
];

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

/** Competition-level phrasing, for PL stories that name no club. */
const PL_COMP_RE = /premier league|\bprem\b|\bepl\b|matchweek|gameweek/i;

/**
 * Another competition wearing PL club names. A WSL fixture list says "Manchester
 * United" and sailed straight through the club match — so a headline that names
 * one of these is out regardless of who it mentions.
 */
const OTHER_COMP_RE =
  /women'?s super league|\bwsl\b|\bwomen'?s\b|scottish premiership|\bu2[13]s?\b|youth cup/i;

/**
 * Is this story about the Premier League?
 *
 * The tab is PL, so the feed must be PL — the desks we pull are football-wide
 * and were leaking World Cup, Scottish Prem, and La Liga into it. Matching on
 * headline AND standfirst (not headline alone) is what makes this usable: a
 * headline like "Sources: Howe set to leave" names no club, but the standfirst
 * always does. Measured on a live pull: 186 items in, 102 PL out.
 */
export function isPremierLeague(title: string, summary?: string): boolean {
  if (OTHER_COMP_RE.test(title)) return false;
  const hay = `${title} ${summary ?? ""}`.toLowerCase();
  return PL_CLUB_TERMS.some((c) => hay.includes(c)) || PL_COMP_RE.test(hay);
}

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
