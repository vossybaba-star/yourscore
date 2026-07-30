/**
 * Feed reading — the one place that knows how to turn a football desk's XML
 * into items we can render.
 *
 * Extracted from src/lib/pl/ingest.ts once a second consumer appeared (the
 * fantasy river) and the source list went from two desks to nine. Everything
 * here is generic: no PL vocabulary, no fantasy vocabulary, no DB. Callers add
 * their own filtering.
 *
 * Deliberately importable by plain node (`node --experimental-strip-types`) so
 * scripts/pl-news-ingest.mjs can use THIS file rather than carry a hand-synced
 * copy — the two drifted once already. Keep it dependency-free apart from
 * node:crypto, and never add `server-only` here.
 *
 * Handles both RSS (`<item>`) and Atom (`<entry>`) — SPORTbible publish Atom,
 * and the old parser silently returned zero items for it rather than failing.
 */
import { createHash } from "node:crypto";

export interface RssItem {
  /** Stable id — hash of the canonical url, so re-reading never duplicates. */
  id: string;
  title: string;
  url: string;
  source: string;
  image: string | null;
  /** The outlet's own standfirst, cleaned. Absent when the feed ships none. */
  summary?: string;
  publishedAt: string;
}

export interface RssSource {
  name: string;
  url: string;
  /**
   * Atom `<category term="…">` an entry must carry. Only for mixed-sport feeds
   * (SPORTbible run NBA and UFC through the same feed as football).
   */
  requireCategory?: string;
}

/** Roughly three lines on a phone. */
const SUMMARY_MAX = 200;
const BBC_TARGET_WIDTH = 976;

/**
 * Images that are furniture, not the story: WordPress emoji sprites, avatars,
 * and tracking pixels all appear as the first <img> in a content block and were
 * being picked as article art.
 */
const JUNK_IMAGE = /s\.w\.org|gravatar\.com|feedburner|pixel\.|\/emoji\/|\.svg($|\?)|stats\.wp\.com/i;

/** CDATA + entities. Separate from `strip` because an encoded description
 *  (`&lt;ul&gt;`) has to be decoded before any tag can be matched. */
export const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    // Numeric entities last: Sky ship prices as "&#163;51m" and a naked entity
    // in a headline reads as broken.
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

export const strip = (s: string, tagsAs = ""): string =>
  decode(s).replace(/<[^>]+>/g, tagsAs).replace(/\s+/g, " ").trim();

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/**
 * BBC serve the same image at any width from an unsigned path segment and only
 * ever advertise the 240px thumbnail, which upscaled to a full-width card looked
 * like a blurry mess. Guardian URLs are SIGNED (the hash covers the width), so
 * they must never be rewritten — for those we pick the biggest variant offered.
 */
function upscale(url: string): string {
  if (!/ichef\.bbci\.co\.uk/.test(url)) return url;
  return url.replace(/\/standard\/(\d+)\//, (m, w) =>
    Number(w) < BBC_TARGET_WIDTH ? `/standard/${BBC_TARGET_WIDTH}/` : m,
  );
}

/**
 * The BIGGEST image the item advertises — never the first. Guardian publish
 * three <media:content> per item (140 / 460 / 700) and taking the first handed
 * us a 140px thumbnail for a 343px card.
 *
 * Falls back to the first real <img> inside the content block: WordPress desks
 * (Sport Witness, the fantasy sites) ship no media tags at all, so without this
 * they render as a wall of text cards.
 */
export function pickImage(block: string): string | null {
  let best: string | null = null;
  let bestW = -1;
  for (const m of Array.from(block.matchAll(/<(?:media:thumbnail|media:content|enclosure)\b([^>]*)\/?>/g))) {
    const attrs = m[1];
    const url = attrs.match(/\burl="([^"]+)"/)?.[1];
    if (!url) continue;
    // enclosure is also used for audio/video — only take images.
    const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? "";
    if (type && !type.startsWith("image")) continue;
    const w = Number(attrs.match(/\bwidth="(\d+)"/)?.[1] ?? 0);
    if (w > bestW) { bestW = w; best = url; }
  }

  if (!best) {
    const body = decode(block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/)?.[1] ?? "")
      || decode(block.match(/<content\b[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? "");
    for (const m of Array.from(body.matchAll(/<img[^>]+src="([^"]+)"/gi))) {
      if (JUNK_IMAGE.test(m[1])) continue;
      best = m[1];
      break;
    }
  }

  // Entity-decode: feed URLs carry &amp;, and a raw &amp; in a query string is a
  // different URL — Guardian's signed links 401'd and the images silently vanished.
  return best ? upscale(strip(best)) : null;
}

/**
 * pubDate → ISO. Sky stamp theirs "…13:00:00 BST", which Node parses to an
 * Invalid Date, and .toISOString() on that THROWS — one bad date took the whole
 * Sky feed down with it. Named UK zones map to an offset; anything still
 * unparseable falls back to now rather than losing the item.
 */
const TZ: Record<string, string> = { BST: "+0100", GMT: "+0000", UTC: "+0000" };
export function parseDate(raw: string): string {
  const s = raw.replace(/\b(BST|GMT|UTC)\s*$/, (m) => TZ[m.trim()]);
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/**
 * The outlet's standfirst as one readable paragraph.
 *
 * Guardian wrap a <ul> of bullet points around the real standfirst and close
 * with a "Continue reading…" link — dropping both leaves the paragraph a reader
 * actually wants. WordPress desks append "The post X appeared first on Y". Tags
 * collapse to a SPACE, not to nothing: `</p><p>` with no space glues two
 * sentences into one word.
 */
export function summarise(raw: string): string | undefined {
  const html = decode(raw)
    .replace(/<ul>[\s\S]*?<\/ul>/gi, " ")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  let text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/\s*The post .*?appeared first on .*$/i, "").trim();
  if (text.length < 20) return undefined; // a stub is worse than no body at all
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:]$/, "")}…`;
}

/** RSS `<item>` or Atom `<entry>` → items. Pure, so it can be tested on a
 *  cached feed without touching the network. */
export function parseFeed(xml: string, source: RssSource): RssItem[] {
  const rss = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map((m) => m[1]);
  const blocks = rss.length
    ? rss
    : Array.from(xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)).map((m) => m[1]);

  const items: RssItem[] = [];
  for (const block of blocks) {
    if (source.requireCategory && !new RegExp(`<category[^>]*term="${source.requireCategory}"`, "i").test(block)) {
      continue;
    }
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    // RSS puts the url in <link>text</link>; Atom in <link href="…" />.
    const url = strip(
      block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ??
        block.match(/<link[^>]*\bhref="([^"]+)"/)?.[1] ??
        "",
    );
    if (!title || !url) continue;

    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]
      ?? block.match(/<published>([\s\S]*?)<\/published>/)?.[1]
      ?? block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1];
    const desc = block.match(/<description>([\s\S]*?)<\/description>/)?.[1]
      ?? block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1];

    items.push({
      id: sha1(url),
      title: strip(title[1]),
      url,
      source: source.name,
      image: pickImage(block),
      summary: desc ? summarise(desc) : undefined,
      publishedAt: date ? parseDate(strip(date)) : new Date().toISOString(),
    });
  }
  return items;
}

/**
 * Fetch every source in parallel and merge. Partial failure is tolerated — one
 * desk being down must not empty the tab — and each source's outcome is
 * reported so a silently dead feed is visible in the cron response.
 *
 * `perSource` caps how many items any ONE desk contributes before the merge.
 * Without it Sports Mole (148 items a pull) simply buries the other eight.
 */
export async function fetchFeeds(
  sources: RssSource[],
  opts: { keep?: (item: RssItem) => boolean; perSource?: number; max?: number } = {},
): Promise<{ items: RssItem[]; sources: Record<string, number | string> }> {
  const { keep = () => true, perSource = Infinity, max = 40 } = opts;
  const report: Record<string, number | string> = {};
  const all: RssItem[] = [];

  await Promise.all(
    sources.map(async (src) => {
      try {
        const res = await fetch(src.url, {
          // Some desks 403 an obviously-bot agent; a browser-shaped one with our
          // name in it is honest and gets served.
          headers: { "User-Agent": "Mozilla/5.0 (compatible; YourScore-News/1.0; +https://yourscore.app)" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const kept = parseFeed(await res.text(), src)
          .filter(keep)
          .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
          .slice(0, perSource);
        report[src.name] = kept.length;
        all.push(...kept);
      } catch (err) {
        report[src.name] = `failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }),
  );

  const byId = new Map<string, RssItem>();
  for (const it of all) if (!byId.has(it.id)) byId.set(it.id, it);
  const items = Array.from(byId.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, max);

  return { items, sources: report };
}
