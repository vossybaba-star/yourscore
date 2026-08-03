"use client";
/**
 * The Social tab — a first-class Fantasy destination (founder, 3 Aug). The feed
 * is OPEN: it shows activity from everyone, not just who you follow, so there's
 * always something happening. Three segments:
 *   Top       — everyone's activity, most-talked-about first (the default open feed).
 *   Following — narrowed to the managers you follow.
 *   Discover  — reason-ranked suggestions + username search (<DiscoverManagers/>).
 *
 * Top/Following reuse <FeedStream/> in controlled mode (this shell owns the
 * scope, so FeedStream draws no chrome of its own). The active segment rides the
 * URL (?tab=) and the nav trail, so opening a manager's profile and pressing back
 * returns to the segment you left.
 */
import { useCallback, useEffect, useState } from "react";
import { INK, LIME, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { DiscoverManagers } from "@/components/fantasy/DiscoverManagers";
import { recordVisit } from "@/lib/nav";

type SocialTab = "top" | "following" | "discover";
const TABS: { id: SocialTab; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "following", label: "Following" },
  { id: "discover", label: "Discover" },
];

/** The Following empty state (spec §4) — the feed starts with people. */
function FollowingEmpty({ onFind }: { onFind: () => void }) {
  return (
    <div style={{ borderRadius: 16, background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, padding: 22, textAlign: "center" }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12.5, letterSpacing: "0.12em", color: LIME, marginBottom: 8 }}>
        FOLLOW MANAGERS TO NARROW YOUR FEED
      </div>
      <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
        Follow people to see just their squads, moves and gameweek results here. Everything else is over on Top.
      </p>
      <button onClick={onFind} style={{
        padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
        background: LIME, color: "#0b1400", border: "none",
      }}>Find managers</button>
    </div>
  );
}

export function SocialHome() {
  const [tab, setTab] = useState<SocialTab>("top");

  // Restore the segment from the URL on mount (so links and a refresh land right).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "following" || t === "discover") setTab(t);
    } catch { /* no search params — Latest */ }
  }, []);

  const select = useCallback((t: SocialTab) => {
    setTab(t);
    const url = t === "top" ? "/fantasy/social" : `/fantasy/social?tab=${t}`;
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
          See what every manager is doing and join the conversation.
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

      {tab === "top" && (
        <FeedStream controlledScope="global" controlledSort="top" chrome={false} signInNext="/fantasy/social" />
      )}
      {tab === "following" && (
        <FeedStream controlledScope="following" controlledSort="recent" chrome={false} signInNext="/fantasy/social?tab=following"
          emptyFollowing={<FollowingEmpty onFind={() => select("discover")} />} />
      )}
      {tab === "discover" && <DiscoverManagers />}
    </div>
  );
}
