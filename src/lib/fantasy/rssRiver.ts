import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFeeds, type RssSource } from "@/lib/rss";

/**
 * The fantasy editorial river — dedicated fantasy desks into `fantasy_news_items`.
 *
 * The hub spec always described an ingester reading "X accounts and RSS feeds"
 * hourly and POSTing to /api/fantasy/news-items, but only the X half was ever
 * built (on the VPS). This is the RSS half, running in-app: the cron already
 * fires hourly and the transfers section already rebuilds hourly off this table,
 * so it needs no new cron entry and no new trust boundary.
 *
 * These desks stay OUT of the PL news feed on purpose. That feed is general
 * football; team reveals and price talk belong to the Fantasy tab, and mixing
 * them was the split this codebase already made deliberately (see lib/pl/news).
 *
 * No PL gate here — a fantasy desk is Premier League by definition.
 */

export const FANTASY_SOURCES: RssSource[] = [
  { name: "Fantasy Football Scout", url: "https://www.fantasyfootballscout.co.uk/feed/" },
  { name: "FantasyFootball247", url: "https://www.fantasyfootball247.co.uk/feed/" },
];

/** Both desks publish in bursts; a cap keeps one from owning the section. */
const PER_SOURCE = 6;
const MAX_ITEMS = 12;
/**
 * FF247's feed still carries posts from May and June (a World Cup piece, a GW38
 * match chat). Without a cutoff those get stored once and then sit in a live
 * section pretending to be news, because nothing ever removes them.
 */
const MAX_AGE_DAYS = 14;

export async function ingestFantasyRss(
  db: SupabaseClient,
  now = Date.now(),
): Promise<{ stored: number; skipped: number; sources: Record<string, number | string> }> {
  const cutoff = now - MAX_AGE_DAYS * 86_400_000;
  const { items, sources } = await fetchFeeds(FANTASY_SOURCES, {
    keep: (i) => new Date(i.publishedAt).getTime() >= cutoff,
    perSource: PER_SOURCE,
    max: MAX_ITEMS,
  });
  if (items.length === 0) return { stored: 0, skipped: 0, sources };

  // Read-then-insert, not upsert-on-conflict: the unique index on source_key is
  // PARTIAL (`where source_key is not null`) and Postgres can't infer a conflict
  // target from a partial index. Same reasoning as the news-items route.
  const keys = items.map((i) => i.url);
  const { data: existing } = await db
    .from("fantasy_news_items").select("source_key").in("source_key", keys);
  const seen = new Set((existing ?? []).map((r) => r.source_key as string));

  const rows = items
    .filter((i) => !seen.has(i.url))
    .map((i) => ({
      kind: "article" as const,
      topic: "general" as const,
      source_key: i.url,
      payload: {
        title: i.title,
        url: i.url,
        source: i.source,
        ...(i.image ? { image: i.image } : {}),
        ...(i.summary ? { summary: i.summary } : {}),
      },
      // The feed sorts and labels by created_at, so it must be the story's OWN
      // publish time. Defaulting to now() would stamp a three-day-old post as
      // "just now" the first time the cron happened to see it.
      created_at: i.publishedAt,
    }));

  if (rows.length === 0) return { stored: 0, skipped: items.length, sources };
  const { error } = await db.from("fantasy_news_items").insert(rows);
  if (error) throw new Error(`fantasy rss insert: ${error.message}`);
  return { stored: rows.length, skipped: items.length - rows.length, sources };
}
