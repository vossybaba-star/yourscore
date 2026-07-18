import "server-only";
import { createHash } from "node:crypto";
import type { PlNewsItem } from "./news";

/**
 * PL news ingest — fetch + parse the football-desk RSS feeds into PlNewsItems.
 *
 * This is the TS twin of scripts/pl-news-ingest.mjs, extracted so the Vercel
 * cron (/api/cron/pl-news) can run the SAME logic serverlessly — the script
 * stays for manual runs and the local demo. The parsing rules carry the two
 * hard-won image fixes: pick the LARGEST media variant an item advertises
 * (Guardian ships 140/460/700 and the first is a thumbnail), and entity-decode
 * URLs (a raw &amp; in a signed Guardian query string 401s). BBC only ever
 * advertises 240px but serves any width from an unsigned path segment, so BBC
 * (and only BBC) is upscaled by URL rewrite.
 */

const SOURCES = [
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { name: "Guardian Football", url: "https://www.theguardian.com/football/rss" },
];

const MAX_ITEMS = 40;
const BBC_TARGET_WIDTH = 976;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/<[^>]+>/g, "")
    .trim();

function upscale(url: string): string {
  if (!/ichef\.bbci\.co\.uk/.test(url)) return url;
  return url.replace(/\/standard\/(\d+)\//, (m, w) =>
    Number(w) < BBC_TARGET_WIDTH ? `/standard/${BBC_TARGET_WIDTH}/` : m,
  );
}

/** The BIGGEST image the item advertises — never the first. */
function pickImage(block: string): string | null {
  let best: string | null = null;
  let bestW = -1;
  for (const m of Array.from(block.matchAll(/<(?:media:thumbnail|media:content|enclosure)\b([^>]*)\/?>/g))) {
    const attrs = m[1];
    const url = attrs.match(/\burl="([^"]+)"/)?.[1];
    if (!url) continue;
    const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? "";
    if (type && !type.startsWith("image")) continue;
    const w = Number(attrs.match(/\bwidth="(\d+)"/)?.[1] ?? 0);
    if (w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best ? upscale(strip(best)) : null;
}

function parseItems(xml: string, sourceName: string): PlNewsItem[] {
  const items: PlNewsItem[] = [];
  for (const m of Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g))) {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/);
    const link = block.match(/<link>([\s\S]*?)<\/link>/);
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!title || !link) continue;
    const url = strip(link[1]);
    items.push({
      id: sha1(url),
      title: strip(title[1]),
      url,
      source: sourceName,
      image: pickImage(block),
      publishedAt: date ? new Date(strip(date[1])).toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

/** Fetch all sources, dedupe by URL hash, newest first, capped. Partial feed
 *  failure is tolerated — one desk down must not empty the tab. */
export async function fetchPlNews(): Promise<{ items: PlNewsItem[]; sources: Record<string, number | string> }> {
  const sources: Record<string, number | string> = {};
  const all: PlNewsItem[] = [];
  await Promise.all(
    SOURCES.map(async (src) => {
      try {
        const res = await fetch(src.url, {
          headers: { "User-Agent": "YourScore-PLNews/1.0" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const parsed = parseItems(await res.text(), src.name);
        sources[src.name] = parsed.length;
        all.push(...parsed);
      } catch (err) {
        sources[src.name] = `failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }),
  );

  const byId = new Map<string, PlNewsItem>();
  for (const it of all) if (!byId.has(it.id)) byId.set(it.id, it);
  const items = Array.from(byId.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, MAX_ITEMS);

  return { items, sources };
}
