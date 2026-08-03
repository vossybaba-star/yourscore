"use client";
/**
 * The Social tab — a first-class Fantasy destination (founder, 3 Aug). The feed
 * no longer hides behind a Home sub-toggle; it lives here with its own three
 * segments:
 *   Following — activity from managers you follow (the payoff of the graph).
 *   Discover  — reason-ranked suggestions + username search (<DiscoverManagers/>).
 *   Top       — the most-engaged public activity (global feed, "top" sort).
 *
 * Following/Top reuse <FeedStream/> in controlled mode (this shell owns the
 * scope/sort, so FeedStream draws no chrome of its own). The active segment
 * rides the URL (?tab=) and the nav trail, so opening a manager's profile and
 * pressing back returns to the segment you left.
 */
import { useCallback, useEffect, useState } from "react";
import { INK, LIME, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { DiscoverManagers } from "@/components/fantasy/DiscoverManagers";
import { recordVisit } from "@/lib/nav";

type SocialTab = "following" | "discover" | "top";
const TABS: { id: SocialTab; label: string }[] = [
  { id: "following", label: "Following" },
  { id: "discover", label: "Discover" },
  { id: "top", label: "Top" },
];

/** The Following empty state (spec §4) — the feed starts with people. */
function FollowingEmpty({ onFind }: { onFind: () => void }) {
  return (
    <div style={{ borderRadius: 16, background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, padding: 22, textAlign: "center" }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12.5, letterSpacing: "0.12em", color: LIME, marginBottom: 8 }}>
        YOUR FEED STARTS WITH PEOPLE
      </div>
      <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
        Follow managers to see their squads, moves and gameweek results.
      </p>
      <button onClick={onFind} style={{
        padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
        background: LIME, color: "#0b1400", border: "none",
      }}>Find managers</button>
    </div>
  );
}

export function SocialHome() {
  const [tab, setTab] = useState<SocialTab>("following");

  // Restore the segment from the URL on mount (so the "Find managers" link and a
  // refresh land on the right one).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "discover" || t === "top") setTab(t);
    } catch { /* no search params — Following */ }
  }, []);

  const select = useCallback((t: SocialTab) => {
    setTab(t);
    const url = t === "following" ? "/fantasy/social" : `/fantasy/social?tab=${t}`;
    try {
      window.history.replaceState(null, "", url);
      recordVisit(url);
    } catch { /* history/storage unavailable — tab still switches */ }
  }, []);

  return (
    <div>
      <div style={{ margin: "0 2px 12px" }}>
        <h2 className="font-display" style={{ fontSize: 20, color: INK, margin: 0, lineHeight: 1.1 }}>Social</h2>
        <p style={{ fontSize: 13, color: MUTED, margin: "4px 0 0", lineHeight: 1.45 }}>
          See what other managers are doing and join the conversation.
        </p>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.06)`, marginBottom: 14 }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => select(t.id)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              background: on ? tint(TEAL, "22") : "transparent", color: on ? TEAL : MUTED,
              border: `1px solid ${on ? tint(TEAL, "55") : "transparent"}`,
            }}>{t.label}</button>
          );
        })}
      </div>

      {tab === "following" && (
        <FeedStream controlledScope="following" controlledSort="recent" chrome={false} signInNext="/fantasy/social"
          emptyFollowing={<FollowingEmpty onFind={() => select("discover")} />} />
      )}
      {tab === "discover" && <DiscoverManagers />}
      {tab === "top" && (
        <FeedStream controlledScope="global" controlledSort="top" chrome={false} signInNext="/fantasy/social?tab=top" />
      )}
    </div>
  );
}
