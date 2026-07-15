import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { getAllPosts, SITE_URL } from "@/lib/blog";
import type { PlNewsFeed, PlNewsItem } from "@/lib/pl/news";

/**
 * GET /api/pl/news — PUBLIC. The general football news feed for Matchweek →
 * PL → News: RSS-aggregated headlines (pl_news_feed doc, written by
 * scripts/pl-news-ingest.mjs) with OUR OWN blog posts plugged in.
 *
 * Blog posts are interleaved (not just date-sorted, or our evergreen posts would
 * sink below the day's news and never show) — one near the top, then spaced
 * through the stream — tagged source "YourScore" so they read as ours.
 */

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const BLOG_EVERY = 5; // one blog card, then one per this many news items

export async function GET() {
  const db = createServiceClient() as unknown as SupabaseClient;

  let news: PlNewsItem[] = [];
  try {
    const { data } = await db.from("pl_news_feed").select("doc").eq("id", 1).maybeSingle();
    news = (((data as { doc?: PlNewsFeed } | null)?.doc?.items) ?? []) as PlNewsItem[];
  } catch (err) {
    console.error("[pl/news] feed read failed", err);
  }

  const blog = blogAsNews();
  const items = interleave(news, blog);

  return NextResponse.json({ doc: { items, updatedAt: new Date().toISOString() } }, { headers: cache() });
}

/** Our blog posts as feed items (newest first). */
function blogAsNews(): PlNewsItem[] {
  try {
    return getAllPosts().map((p) => ({
      id: `blog-${p.slug}`,
      title: p.title,
      url: `${SITE_URL}/blog/${p.slug}`,
      source: "YourScore",
      image: p.ogImage ?? null,
      publishedAt: new Date(p.date).toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Interleave blog posts through the news stream so ours stay visible. News is
 *  assumed newest-first; blog is spliced in at a fixed cadence. */
function interleave(news: PlNewsItem[], blog: PlNewsItem[]): PlNewsItem[] {
  if (blog.length === 0) return news;
  const out: PlNewsItem[] = [];
  let bi = 0;
  news.forEach((item, i) => {
    // A blog card near the very top (after the first news item), then every N.
    if (bi < blog.length && (i === 1 || (i > 1 && (i - 1) % BLOG_EVERY === 0))) {
      out.push(blog[bi++]);
    }
    out.push(item);
  });
  while (bi < blog.length) out.push(blog[bi++]); // any leftovers at the end
  return out;
}

function cache(): Record<string, string> {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };
}
