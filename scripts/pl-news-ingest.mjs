#!/usr/bin/env node
/**
 * pl-news-ingest.mjs — manual/debug runner for Matchweek → PL → News.
 *
 * Reads the football desks, keeps the Premier League stories, dedupes by URL,
 * sorts newest-first, and writes ONE `pl_news_feed` doc that /api/pl/news reads.
 * No API key, no cost — public RSS.
 *
 * In production this work runs serverlessly from /api/cron/pl-news. This script
 * exists for running it by hand, printing what a pull would produce, or writing
 * to a local stub.
 *
 * It IMPORTS the real source list and the real gate from src/ (node strips the
 * types) rather than carrying its own copies. An earlier version duplicated
 * both and they drifted — the script was still reading two desks after the app
 * had moved to nine.
 *
 * Usage:
 *   node scripts/pl-news-ingest.mjs                       # write to SUPABASE_URL (env)
 *   PL_NEWS_TARGET=http://127.0.0.1:8792 node ...         # write to a stub
 *   node scripts/pl-news-ingest.mjs --print               # fetch + parse only, print, no write
 */
import { fetchFeeds } from "../src/lib/rss.ts";
import { PL_SOURCES, isPremierLeague } from "../src/lib/pl/news.ts";

const MAX_ITEMS = 40;
const PER_SOURCE = 8;
const PRINT_ONLY = process.argv.includes("--print");

async function main() {
  const { items, sources } = await fetchFeeds(PL_SOURCES, {
    keep: (i) => isPremierLeague(i.title, i.summary),
    perSource: PER_SOURCE,
    max: MAX_ITEMS,
  });
  for (const [name, result] of Object.entries(sources)) {
    console.log(typeof result === "number" ? `  ${name}: ${result} PL items` : `  ${name}: ${result}`);
  }

  console.log(
    `\n${items.length} items — ${items.filter((i) => i.image).length} with an image, ` +
      `${items.filter((i) => i.summary).length} with a summary`,
  );
  if (PRINT_ONLY) {
    for (const it of items.slice(0, 15)) {
      console.log(`  • [${it.source}] ${it.title}`);
      console.log(`      ${it.summary ?? "(no summary)"}`);
    }
    return;
  }

  const doc = { items, updatedAt: new Date().toISOString() };
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
