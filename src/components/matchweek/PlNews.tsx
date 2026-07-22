"use client";

/**
 * Matchweek → PL → News — the general football news feed.
 *
 * The latest around football: clubs, fixtures, what's trending. NOT fantasy
 * (tips + transfer advice live under the Fantasy tab). Fed by /api/pl/news,
 * which serves the RSS-aggregated `pl_news_feed` doc (scripts/pl-news-ingest.mjs).
 *
 * `now` is captured once on mount so the whole feed's "2h ago" labels and the
 * Trending window agree on a single clock.
 */

import { useEffect, useMemo, useState } from "react";
import { PlNewsFeed } from "@/components/matchweek/PlNewsFeed";
import type { PlNewsItem } from "@/lib/pl/news";

export function PlNews() {
  const [items, setItems] = useState<PlNewsItem[]>([]);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const now = useMemo(() => Date.now(), []);

  useEffect(() => {
    let live = true;
    fetch("/api/pl/news")
      .then((r) => r.json())
      .then((j) => { if (live) { setItems(j.doc?.items ?? []); setState("ready"); } })
      .catch(() => { if (live) setState("ready"); });
    return () => { live = false; };
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4 pt-4" style={{ display: "grid", gap: 14 }}>
      {state === "loading" ? (
        <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>Loading the feed…</p>
        </div>
      ) : (
        <PlNewsFeed items={items} now={now} />
      )}
    </div>
  );
}
