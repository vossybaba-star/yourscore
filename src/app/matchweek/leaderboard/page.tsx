"use client";

/**
 * Matchweek → Live Quiz → the FULL club-fan leaderboard, reached from the tile.
 * Just a header + the whole ClubTable (which already renders the ranked clubs and
 * the "nobody played" tail). Kept off the Live Quiz screen itself so that
 * screen stays a glanceable hub, not a wall of table.
 */

import Link from "next/link";
import { ClubTable } from "@/components/clubs/ClubTable";
import { BottomNav } from "@/components/ui/BottomNav";

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: 96 }}>
      <div className="max-w-lg mx-auto px-4 pt-8 pb-1">
        <Link href="/matchweek" className="font-body text-xs" style={{ color: "#8a948f" }}>← Matchweek</Link>
        <h1 className="font-display text-3xl text-white leading-none mt-2">CLUB-FAN LEADERBOARD</h1>
        <p className="font-body text-sm mt-1.5" style={{ color: "#8a948f" }}>
          Every club&apos;s fans, ranked by average football-knowledge score this gameweek.
        </p>
      </div>
      <ClubTable />
      <BottomNav />
    </div>
  );
}
