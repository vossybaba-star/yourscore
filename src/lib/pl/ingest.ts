import "server-only";
import { fetchFeeds } from "@/lib/rss";
import { isPremierLeague, PL_SOURCES, type PlNewsItem } from "./news";

/**
 * PL news ingest — which desks we read, and what counts as a PL story.
 *
 * All the feed mechanics (RSS + Atom parsing, image picking, standfirst
 * cleanup, dates) live in src/lib/rss.ts and are shared with the fantasy river.
 * What's left here is the wiring: the caps, and the gate applied to the shared
 * source list (PL_SOURCES lives in ./news so the plain-node script can read it).
 */

const MAX_ITEMS = 40;
/**
 * Per-desk cap, applied before the merge. Sports Mole publish ~148 items a pull
 * against BBC's ~30, so without this one desk simply owns the feed.
 */
const PER_SOURCE = 8;

/** Fetch every desk, keep only PL stories, dedupe, newest first, capped.
 *  Partial feed failure is tolerated — one desk down must not empty the tab. */
export async function fetchPlNews(): Promise<{ items: PlNewsItem[]; sources: Record<string, number | string> }> {
  const { items, sources } = await fetchFeeds(PL_SOURCES, {
    // The gate runs per-source, BEFORE the per-desk cap — otherwise a desk's 8
    // slots get spent on non-PL stories that are then thrown away, and the feed
    // comes back half empty.
    keep: (i) => isPremierLeague(i.title, i.summary),
    perSource: PER_SOURCE,
    max: MAX_ITEMS,
  });
  return { items: items as PlNewsItem[], sources };
}
