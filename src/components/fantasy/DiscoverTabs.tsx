"use client";
/**
 * Social → Discover (founder, 3 Aug; Phase 5b, AC2 — filter chips). Started as
 * two tabs (Leagues, "Players" = managers to follow); Phase 5b adds five more
 * feed-backed filters — Trending, Players (real footballers discussed in
 * posts), Polls, Squads, Games — as a scrollable chip row. The original
 * "Players" tab is relabelled Managers here so it doesn't collide with the
 * new, differently-meant Players chip; nothing about DiscoverManagers itself
 * changed, and it's still reachable (kept, not deleted, per spec).
 *
 * `initialSub` lets a "Find managers" entry point land straight on Managers.
 */
import { useState } from "react";
import Link from "next/link";
import { MUTED } from "@/components/fantasy/shared";
import { DiscoverLeagues } from "@/components/fantasy/DiscoverLeagues";
import { DiscoverManagers } from "@/components/fantasy/DiscoverManagers";
import { DiscoverFeedFilter, FilterChip, FEED_FILTER_CHIPS, type FeedFilter } from "@/components/fantasy/DiscoverFeedFilter";
import { trackDiscoverFilterSelected } from "@/lib/analytics/trackSocial";

// "managers" (not "players") for the original follow-suggestions tab — the
// new FeedFilter also has a "players" id (real footballers discussed in
// posts), and the two must never collide.
type Sub = "leagues" | "managers" | FeedFilter;
const CHIPS: { id: Sub; label: string }[] = [
  { id: "leagues", label: "Leagues" },
  { id: "managers", label: "Managers" },
  ...FEED_FILTER_CHIPS,
];

export function DiscoverTabs({ initialSub }: { initialSub?: "leagues" | "players" }) {
  // The external prop keeps its long-standing "players" value (SocialHome's
  // "Find managers" entry point passes it) — translated to the internal
  // "managers" id right here so callers never had to change.
  const [sub, setSub] = useState<Sub>(initialSub === "players" ? "managers" : (initialSub ?? "leagues"));

  const select = (s: Sub) => {
    setSub(s);
    trackDiscoverFilterSelected(s);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div role="tablist" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, flex: 1 }}>
          {CHIPS.map((c) => (
            <FilterChip key={c.id} active={c.id === sub} onClick={() => select(c.id)}>{c.label}</FilterChip>
          ))}
        </div>
        {/* Saved posts entry point (Social Phase 3b, AC2) — the lighter touch:
            a plain text link beside the chips rather than a new tab, sheet,
            or its own row in the Social tab bar. */}
        <Link href="/fantasy/social/saved" style={{
          flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: MUTED, textDecoration: "none",
          padding: "7px 4px",
        }}>🔖 Saved</Link>
      </div>

      {sub === "leagues" ? <DiscoverLeagues />
        : sub === "managers" ? <DiscoverManagers intro={false} />
        : <DiscoverFeedFilter filter={sub} />}
    </div>
  );
}
