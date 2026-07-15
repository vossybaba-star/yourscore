"use client";

/**
 * Matchweek → PL → News.
 *
 * DECISION (2026-07-15): the news feed is the fantasy news hub's, and it is wired
 * in when the fantasy branch MERGES — not copied across now. Reason: the feed
 * renders from a cron-built `fantasy_news_feed` row that only fills once the
 * fantasy ingest crons are deployed (they ship with that merge), so copying the
 * feed files here early would render an empty tab AND guarantee a merge conflict
 * (two copies of src/components/fantasy/*). At the merge, this component's body
 * is replaced by <NewsFeed …> reading loadFeedDoc() — one small swap, no conflict.
 *
 * Until then it shows what's coming, so the tab is honest, not broken.
 */

export function PlNews() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="rounded-2xl p-6 bg-surface text-center" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="text-2xl mb-2">📰</div>
        <p className="font-display text-sm text-white mb-1">Football news is on its way</p>
        <p className="font-body text-xs" style={{ color: "#8a948f" }}>
          Team news, transfer talk and the gameweek&apos;s talking points will land here.
        </p>
      </div>
    </div>
  );
}
