import "server-only";
import { contentSubjectId, fetchFeeds, type RssItem, type RssSource } from "@/lib/rss";
import { PL_SOURCES } from "./news";

/**
 * The live "what's happening now" feed (founder 8 Aug): recent football news +
 * embeddable YouTube videos, merged newest-first. News reuses the approved
 * PL_SOURCES (BBC / Guardian / Sky / etc., see ./news); video comes from
 * YouTube channel RSS (youtube.com/feeds/videos.xml?channel_id=…), which the
 * shared rss.ts parser already reads (Atom + yt:videoId).
 *
 * Serve edge-cached (see /api/feed/live) — RSS fetches take a few seconds, so a
 * ~10-min cache keeps it live-feeling without hammering the desks. No cron / no
 * table: if a fetch fails the next request re-tries.
 */

/** YouTube video sources — channel RSS. Verified: the official Premier League
 *  channel (high daily volume: clips, saves, highlights, features). Add more
 *  approved channels here as their channel_ids are confirmed (Sky Sports, ESPN
 *  FC, NBC, talkSPORT, Fabrizio Romano, FPL channels). */
export const PL_VIDEO_SOURCES: RssSource[] = [
  { name: "Premier League", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCG5qGWdu8nIRZqJ_GgDwQ-w" },
];

export interface LiveFeed {
  items: RssItem[];
  updatedAt: string;
  sources: Record<string, number | string>;
}

export async function fetchLiveFeed(): Promise<LiveFeed> {
  // News + video fetched separately so video (one very prolific channel) can be
  // capped, then merged by recency — otherwise a day of PL clips buries the news.
  const [news, video] = await Promise.all([
    fetchFeeds(PL_SOURCES, { perSource: 8, max: 60, summaryMax: 200 }),
    fetchFeeds(PL_VIDEO_SOURCES, { perSource: 10, max: 20 }),
  ]);

  // Weave, don't pure-recency-sort: the news desks post so often that a straight
  // recency merge buries the videos entirely. Each list stays newest-first, then
  // we interleave a video every few news items so video shows as you scroll.
  const byRecency = (a: RssItem, b: RssItem) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  const newsSorted = [...news.items].sort(byRecency);
  const vidsSorted = [...video.items].sort(byRecency);
  const items: RssItem[] = [];
  const seen = new Set<string>();
  let ni = 0, vi = 0;
  while (items.length < 50 && (ni < newsSorted.length || vi < vidsSorted.length)) {
    for (let k = 0; k < 4 && ni < newsSorted.length; k++) {
      const it = newsSorted[ni++]; if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
    if (vi < vidsSorted.length) {
      const it = vidsSorted[vi++]; if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
    }
  }

  // Attach the synthetic comments/reactions subject so every card is interactive
  // (founder 8 Aug — like/comment/share like the X feed) with no ingestion table.
  const withSubjects = items.slice(0, 50).map((it) => ({ ...it, subjectKey: contentSubjectId(it.id) }));
  return { items: withSubjects, updatedAt: new Date().toISOString(), sources: { ...news.sources, ...video.sources } };
}
