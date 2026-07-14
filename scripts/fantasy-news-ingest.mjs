#!/usr/bin/env node
/**
 * fantasy-news-ingest.mjs — fill the fantasy news hub with REAL content.
 *
 * Pulls verified sources (trusted journalists on X + football RSS), filters them
 * down to what a Premier League fantasy manager actually cares about, and POSTs
 * them to /api/fantasy/news-items.
 *
 * Deliberate design notes:
 * - We SURFACE these, we don't reword them. That's the whole point of the
 *   "verified source" layer — a Romano tweet is trusted BECAUSE it's his. The
 *   x-track/social pipeline rewords into original YourScore posts; that is a
 *   different product and must not be confused with this.
 * - Tweets carry MEDIA (photos). That's why the founder wanted embeds at all:
 *   images make the feed feel alive. We store the image URL and render a native
 *   card — never X's widgets.js (heavy, and availability is flaky).
 * - PL-ONLY relevance gate. Our SportMonks plan is PL-only and so is the fantasy
 *   game; a Serie A rumour is noise here.
 * - DEDUPE on source_key (tweet id / article guid). This runs hourly against the
 *   same accounts and feeds, so it WILL see the same item again — one persistent
 *   key per source item is the only thing keeping the feed clean
 *   (LOOP-STANDARD rule 4).
 *
 * Usage:
 *   node --env-file=.env.local scripts/fantasy-news-ingest.mjs [--dry] [--limit N]
 *   --dry    print what would be ingested, POST nothing
 */
import { readFileSync } from "node:fs";
import { resolveUser, fetchRecent, tweetUrl } from "./lib/x-watch.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || Infinity;

const BASE = process.env.NEWS_INGEST_BASE || "http://localhost:3003";
const SECRET = process.env.CRON_SECRET;

const cfg = JSON.parse(
  readFileSync(new URL("./data/fantasy-news-sources.json", import.meta.url), "utf8"),
);

/** The 20 PL clubs + the aliases people actually write. Relevance is decided on
 *  the TEXT, so it has to match how a journalist types, not how a DB stores it. */
const CLUBS = [
  ["arsenal", "gunners"], ["aston villa", "villa"], ["bournemouth"], ["brentford"],
  ["brighton"], ["burnley"], ["chelsea", "blues"], ["crystal palace", "palace"],
  ["everton", "toffees"], ["fulham"], ["leeds"], ["liverpool", "reds"],
  ["manchester city", "man city", "mancity"], ["manchester united", "man utd", "man united"],
  ["newcastle", "magpies"], ["nottingham forest", "forest"], ["sunderland"],
  ["tottenham", "spurs"], ["west ham", "hammers"], ["wolves", "wolverhampton"],
];
const TERMS = cfg.relevance.fantasyTerms;

/** Is this item about the Premier League / fantasy at all? */
export function isRelevant(text) {
  const t = (text || "").toLowerCase();
  const club = CLUBS.some((aliases) => aliases.some((a) => t.includes(a)));
  const term = TERMS.some((w) => t.includes(w));
  // A club alone is enough (a Liverpool story matters). A fantasy term alone is
  // enough (an FPL post). Neither → it isn't for this feed.
  return club || term;
}

/** Strip the trailing t.co link X appends — it's noise in a native card. */
const cleanTweet = (s) => (s || "").replace(/\s*https:\/\/t\.co\/\w+\s*$/g, "").trim();

async function collectTweets() {
  const out = [];
  for (const acct of cfg.tweets.accounts) {
    try {
      const user = await resolveUser(acct.username);
      const tweets = await fetchRecent(user.id, { max: 10 });
      let taken = 0;
      for (const t of tweets) {
        if (taken >= cfg.tweets.perAccount) break;
        const text = cleanTweet(t.text);
        if (!text || !isRelevant(text)) continue;
        const img = (t.media || []).find((m) => m.url || m.preview_image_url);
        out.push({
          kind: "tweet",
          topic: acct.topic,
          source_key: `x:${t.id}`,
          payload: {
            text,
            handle: `@${user.username}`,
            author: user.name || user.username,
            url: tweetUrl(user.username, t.id),
            // Only stamped "true" when the SOURCE CONFIG explicitly marks this
            // account verified (fantasy-news-sources.json) — we never queried
            // X for live verified status, so the badge must not render by
            // default. Flip an account's "verified" field in the config once
            // confirmed, rather than assuming it here.
            ...(acct.verified ? { verified: "true" } : {}),
            ...(img ? { image: img.url || img.preview_image_url } : {}),
          },
        });
        taken++;
      }
      console.log(`  @${acct.username}: ${taken} relevant`);
    } catch (e) {
      // One dead account must not kill the run — the feed degrades, it doesn't break.
      console.log(`  @${acct.username}: FAILED (${e.message})`);
    }
  }
  return out;
}

/** Decode the handful of HTML entities that actually show up in RSS titles.
 *  Feed titles arrive entity-encoded ("Arsenal &amp; Chelsea", "Saka&#039;s
 *  return") and we render them as-is, so an undecoded title showed the raw
 *  "&amp;" / "&#039;" literally in the feed. */
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…");
}

/** Minimal RSS/Atom parse. A dependency-free regex reader is fine here: these are
 *  three known, stable feeds, not arbitrary user input. */
function parseFeed(xml, limit) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
  for (const b of blocks.slice(0, limit)) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    const title = decodeEntities(pick("title"));
    let url = pick("link");
    if (!url) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      url = m ? m[1] : "";
    }
    const guid = pick("guid") || pick("id") || url;
    // Media is where the article art comes from — several football feeds expose it.
    const media =
      b.match(/<media:thumbnail[^>]*url="([^"]+)"/i) ||
      b.match(/<media:content[^>]*url="([^"]+)"/i) ||
      b.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i);
    if (!title || !url) continue;
    items.push({ title, url, guid, image: media ? media[1] : undefined });
  }
  return items;
}

async function collectArticles() {
  const out = [];
  for (const feed of cfg.articles.feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { "user-agent": "YourScore/1.0 (fantasy news hub)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text(), cfg.articles.perFeed * 3);
      let taken = 0;
      for (const it of items) {
        if (taken >= cfg.articles.perFeed) break;
        if (!isRelevant(it.title)) continue;
        out.push({
          kind: "article",
          topic: feed.topic,
          source_key: `rss:${it.guid}`,
          payload: {
            title: it.title,
            url: it.url,
            source: feed.source,
            ...(it.image ? { image: it.image } : {}),
          },
        });
        taken++;
      }
      console.log(`  ${feed.source}: ${taken} relevant`);
    } catch (e) {
      console.log(`  ${feed.source}: FAILED (${e.message})`);
    }
  }
  return out;
}

const main = async () => {
  console.log("Tweets:");
  const tweets = await collectTweets();
  console.log("Articles:");
  const articles = await collectArticles();

  const items = [...tweets, ...articles].slice(0, LIMIT);
  console.log(`\n${items.length} items (${tweets.length} tweets, ${articles.length} articles)`);

  if (DRY) {
    for (const i of items) {
      const p = i.payload;
      console.log(`\n[${i.topic}/${i.kind}] ${p.handle || p.source}${p.image ? " 🖼" : ""}`);
      console.log(`  ${(p.text || p.title).slice(0, 100)}`);
    }
    console.log("\n(dry run — nothing posted)");
    return;
  }
  if (!items.length) return;

  const res = await fetch(`${BASE}/api/fantasy/news-items`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(items),
  });
  const body = await res.text();
  console.log(`POST ${res.status}: ${body}`);
  if (!res.ok) process.exit(1);
};

main().catch((e) => { console.error(e); process.exit(1); });
