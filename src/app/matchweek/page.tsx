"use client";

/**
 * /matchweek — the Premier League page (founder 8 Aug: a clean PL hub).
 *
 * One set of sub-tabs, nothing bolted underneath:
 *   News · Table · Fixtures · Feed
 *
 * The Gameday Quiz section that used to live here moved out (founder 8 Aug):
 * the packs are on the Play tab, and the full matchday experience lives at
 * /gameday-quiz. The club-fan leaderboard moved into Leagues (leagues are the
 * social home for every game now, not just fantasy). Route stays /matchweek so
 * no links break; the old ?section=live deep-link redirects to /gameday-quiz.
 *
 * Each sub-tab carries its own empty state, so no tab is ever a blank screen.
 */

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { PlFixtures } from "@/components/matchweek/PlFixtures";
import { PlTable } from "@/components/matchweek/PlTable";
import { PlNews } from "@/components/matchweek/PlNews";
import { BottomNav } from "@/components/ui/BottomNav";

// The live "what's happening now" feed — recent PL news + embeddable videos
// (founder 8 Aug). Heavy (media, embeds), so it only loads with the Feed tab.
const ContentFeed = dynamic(
  () => import("@/components/feed/ContentFeed").then((m) => m.ContentFeed),
  { ssr: false, loading: () => null }
);

const TEAL = "#00d8c0";

type PlTab = "news" | "table" | "fixtures" | "feed";

const PL_TABS: { key: PlTab; label: string }[] = [
  { key: "news", label: "News" },
  { key: "table", label: "Table" },
  { key: "fixtures", label: "Fixtures" },
  { key: "feed", label: "Feed" },
];

export default function MatchweekPage() {
  const router = useRouter();
  const [plTab, setPlTab] = useState<PlTab>("news");

  // Old deep-link to the gameday section now lives at its own route. Redirect so
  // any home tile / bookmark / push that still points at ?section=live lands in
  // the right place instead of a section that no longer exists.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("section") === "live") { router.replace("/gameday-quiz"); return; }
    const t = params.get("tab");
    if (t === "news" || t === "table" || t === "fixtures" || t === "feed") setPlTab(t);
  }, [router]);

  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: 96 }}>
      {/* /matchweek is the one main tab with no GamesNav above it, so clear the
          notch inset here or the title sits under the iOS status-bar clock. */}
      <div
        className="max-w-lg mx-auto px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 22px)" }}
      >
        <h1 className="font-display text-3xl text-white leading-none">PREMIER LEAGUE</h1>
        <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>
          News, table, fixtures and the football feed
        </p>
      </div>

      {/* Sub-tabs — News · Table · Fixtures · Feed */}
      <div className="max-w-lg mx-auto px-4 pt-1" data-tour="pl-sections">
        <div className="flex gap-6 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          {PL_TABS.map((t) => {
            const on = plTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setPlTab(t.key)}
                className="pb-2.5 font-body text-sm transition-colors relative"
                style={{ color: on ? "#fff" : "#8a948f" }}
              >
                {t.label}
                {on && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full" style={{ background: TEAL }} />}
              </button>
            );
          })}
        </div>
      </div>

      {plTab === "news" && <PlNews />}
      {plTab === "table" && <PlTable />}
      {plTab === "fixtures" && <PlFixtures />}
      {plTab === "feed" && (
        <div className="max-w-lg mx-auto px-4 pt-4">
          <ContentFeed />
        </div>
      )}

      <BottomNav />
    </div>
  );
}
