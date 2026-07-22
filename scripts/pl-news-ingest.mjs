#!/usr/bin/env node
/**
 * pl-news-ingest.mjs — the SOURCE for Matchweek → PL → News.
 *
 * Aggregates RSS from major football desks, dedupes by URL, sorts newest-first,
 * and writes ONE `pl_news_feed` doc that /api/pl/news reads. No API key, no cost
 * — public RSS. Designed to run on a cron (every ~20 min) like the daily-quiz
 * jobs; also runnable by hand or against a demo stub.
 *
 * Sources (football-only feeds — a mixed-sport feed would leak cricket/F1 in):
 *   - BBC Sport Football   https://feeds.bbci.co.uk/sport/football/rss.xml
 *   - Guardian Football    https://www.theguardian.com/football/rss
 * Add more by extending SOURCES — each just needs a football-only RSS url.
 *
 * Usage:
 *   node scripts/pl-news-ingest.mjs                       # write to SUPABASE_URL (env)
 *   PL_NEWS_TARGET=http://127.0.0.1:8792 node ...         # write to a stub
 *   node scripts/pl-news-ingest.mjs --print               # fetch + parse only, print, no write
 */
import { createHash } from "node:crypto";

const SOURCES = [
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { name: "Guardian Football", url: "https://www.theguardian.com/football/rss" },
];

const MAX_ITEMS = 40;
const PRINT_ONLY = process.argv.includes("--print");

const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const strip = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;/g, "’")
    .replace(/<[^>]+>/g, "").trim();

/**
 * BBC serve the SAME image at any width via a path segment
 * (…/ace/standard/240/cpsprodpb/…). The RSS only ever advertises the 240px
 * thumbnail, which upscaled to a full-width card looked like a blurry mess.
 * There's no signature in the URL, so bumping the segment is safe — verified:
 * /240/ = 5KB, /976/ = 51KB, both 200.
 *
 * Guardian URLs are signed (`s=<hash>` covers the width param), so they must
 * NEVER be rewritten — for those we pick the biggest variant the feed offers
 * instead (see pickImage).
 */
const BBC_TARGET_WIDTH = 976;
function upscale(url) {
  if (!/ichef\.bbci\.co\.uk/.test(url)) return url;
  return url.replace(/\/standard\/(\d+)\//, (m, w) =>
    Number(w) < BBC_TARGET_WIDTH ? `/standard/${BBC_TARGET_WIDTH}/` : m,
  );
}

/**
 * The BIGGEST image the item advertises — not the first.
 * Guardian publish three <media:content> per item (140 / 460 / 700) and taking
 * the first handed us a 140px thumbnail for a 343px card.
 */
function pickImage(block) {
  let best = null;
  let bestW = -1;
  for (const m of block.matchAll(/<(?:media:thumbnail|media:content|enclosure)\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const url = attrs.match(/\burl="([^"]+)"/)?.[1];
    if (!url) continue;
    // enclosure is also used for audio/video — only take images.
    const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? "";
    if (type && !type.startsWith("image")) continue;
    const w = Number(attrs.match(/\bwidth="(\d+)"/)?.[1] ?? 0);
    if (w > bestW) { bestW = w; best = url; }
  }
  // Entity-decode: feed URLs carry &amp;, and a raw &amp; in a query string is a
  // different URL — Guardian's signed links 401'd and the images silently vanished.
  return best ? upscale(strip(best)) : null;
}

function parseItems(xml, sourceName) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/);
    const link = block.match(/<link>([\s\S]*?)<\/link>/);
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!title || !link) continue;
    const url = strip(link[1]);
    const publishedAt = date ? new Date(strip(date[1])).toISOString() : new Date().toISOString();
    items.push({
      id: sha1(url),
      title: strip(title[1]),
      url,
      source: sourceName,
      image: pickImage(block),
      publishedAt,
    });
  }
  return items;
}

async function fetchSource(src) {
  const res = await fetch(src.url, { headers: { "User-Agent": "YourScore-PLNews/1.0" } });
  if (!res.ok) throw new Error(`${src.name} → ${res.status}`);
  return parseItems(await res.text(), src.name);
}

async function main() {
  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const all = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") { console.log(`  ${SOURCES[i].name}: ${r.value.length} items`); all.push(...r.value); }
    else console.error(`  ${SOURCES[i].name}: FAILED ${r.reason?.message ?? r.reason}`);
  });

  // Dedupe by id (same URL from two feeds → keep one), newest first, cap.
  const byId = new Map();
  for (const it of all) if (!byId.has(it.id)) byId.set(it.id, it);
  const items = [...byId.values()]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, MAX_ITEMS);

  const doc = { items, updatedAt: new Date().toISOString() };
  console.log(`\n${items.length} unique items (of ${all.length} fetched)`);
  if (PRINT_ONLY) {
    for (const it of items.slice(0, 12)) console.log(`  • [${it.source}] ${it.title}`);
    return;
  }

  const target = (process.env.PL_NEWS_TARGET || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-role-key";
  if (!target) throw new Error("No PL_NEWS_TARGET / NEXT_PUBLIC_SUPABASE_URL to write to");

  // One row, id=1 (singleton doc). Upsert so the cron just overwrites.
  const res = await fetch(`${target}/rest/v1/pl_news_feed?on_conflict=id`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key, Authorization: `Bearer ${key}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ id: 1, doc, updated_at: doc.updatedAt }]),
  });
  if (!res.ok) throw new Error(`write pl_news_feed → ${res.status}: ${await res.text()}`);
  console.log(`wrote pl_news_feed (id=1) → ${target}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
