"use client";

/**
 * Matchweek → PL → News — the LIVE feed.
 *
 * Renders the fantasy news hub's real <NewsFeed> (team news · transfers · tips),
 * fed by the cron-built `fantasy_news_feed` doc via /api/pl/news. Same document
 * the fantasy hub reads — one feed, two surfaces.
 *
 * The News tab is wired to the fantasy pipeline on purpose (founder, 2026-07-15):
 * the Fantasy section itself isn't launching yet, so the coupling is free, and
 * this way the tab shows the real stream instead of a placeholder. When there's
 * no doc yet (pre-cron), <NewsFeed> renders its own "nothing here yet" state, so
 * the tab is always honest, never broken.
 */

import { useEffect, useState } from "react";
import { NewsFeed } from "@/components/matchweek/NewsFeed";
import type { NewsDoc } from "@/lib/fantasy/news-types";

export function PlNews() {
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [state, setState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let live = true;
    fetch("/api/pl/news")
      .then((r) => r.json())
      .then((j) => { if (live) { setDoc(j.doc ?? null); setState("ready"); } })
      .catch(() => { if (live) setState("ready"); });
    return () => { live = false; };
  }, []);

  return (
    <div className="max-w-lg mx-auto px-4 pt-4" style={{ display: "grid", gap: 14 }}>
      {doc?.deadline && new Date(doc.deadline).getTime() > Date.now() && (
        <div className="font-body text-xs" style={{ color: "#E3B54C" }}>
          Gameweek {doc.gw} · deadline {ukTime(doc.deadline)}
        </div>
      )}

      {state === "loading" ? (
        <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-body text-xs" style={{ color: "#8a948f" }}>Loading the feed…</p>
        </div>
      ) : (
        <NewsFeed
          tips={doc?.tips}
          doubts={doc?.teamNews?.doubts ?? []}
          insights={doc?.insights?.items ?? []}
          teamItems={doc?.teamNews?.items ?? []}
          transferItems={doc?.transfers?.items ?? []}
        />
      )}
    </div>
  );
}

function ukTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}
