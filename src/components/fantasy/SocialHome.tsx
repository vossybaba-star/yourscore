"use client";
/**
 * The Social tab — a first-class Fantasy destination (founder, 3 Aug). The feed
 * is OPEN: it shows activity from everyone, not just who you follow, so there's
 * always something happening. Three segments:
 *   Feed      — everyone's activity (the default open feed), sortable Top / Recent.
 *   Following — narrowed to the managers you follow.
 *   Discover  — reason-ranked suggestions + username search (<DiscoverManagers/>).
 *
 * Feed/Following reuse <FeedStream/> in controlled mode (this shell owns the
 * scope + sort, so FeedStream draws no chrome of its own). The active segment
 * rides the URL (?tab=) and the nav trail, so opening a manager's profile and
 * pressing back returns to the segment you left.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { INK, LIME, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { DiscoverTabs } from "@/components/fantasy/DiscoverTabs";
import { CreatePostSheet } from "@/components/fantasy/CreatePostSheet";
import { useUser } from "@/hooks/useUser";
import { recordVisit } from "@/lib/nav";

const SIGN_IN = "/auth/sign-in?next=/fantasy/social";

type SocialTab = "live" | "following" | "discover";
const TABS: { id: SocialTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "following", label: "Following" },
  { id: "discover", label: "Discover" },
];

type FeedSort = "top" | "recent";

/** The Following empty state (spec §4) — the feed starts with people. */
function FollowingEmpty({ onFind }: { onFind: () => void }) {
  return (
    <div style={{ borderRadius: 16, background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, padding: 22, textAlign: "center" }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12.5, letterSpacing: "0.12em", color: LIME, marginBottom: 8 }}>
        FOLLOW MANAGERS TO NARROW YOUR FEED
      </div>
      <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
        Follow people to see just their squads, moves and gameweek results here. Everything else is over on Live.
      </p>
      <button onClick={onFind} style={{
        padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
        background: LIME, color: "#0b1400", border: "none",
      }}>Find managers</button>
    </div>
  );
}

export function SocialHome() {
  const router = useRouter();
  const { user } = useUser();
  const [tab, setTab] = useState<SocialTab>("live");
  const [feedSort, setFeedSort] = useState<FeedSort>("top");
  // Which Discover sub-tab to open on — "Find managers" jumps straight to Players.
  const [discoverSub, setDiscoverSub] = useState<"leagues" | "players" | undefined>(undefined);
  // The composer + a key that reloads the Live feed after a new post lands.
  const [composeOpen, setComposeOpen] = useState(false);
  const [liveKey, setLiveKey] = useState(0);

  // Restore the segment from the URL on mount (so links and a refresh land right).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "following" || t === "discover") setTab(t);
    } catch { /* no search params — Feed */ }
  }, []);

  const select = useCallback((t: SocialTab) => {
    setTab(t);
    const url = t === "live" ? "/fantasy/social" : `/fantasy/social?tab=${t}`;
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
          Fantasy moves, debates and matchday reactions.
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

      {tab === "live" && (
        <>
          {/* Composer entry point — write a post or a poll to the public feed.
              Guests can read but must sign in to contribute. */}
          <button onClick={() => (user ? setComposeOpen(true) : router.push(SIGN_IN))} style={{
            width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            padding: "11px 14px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, marginBottom: 12,
          }}>
            <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 999, background: tint(TEAL, "1e"), border: `1px solid ${tint(TEAL, "55")}`, color: TEAL, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>+</span>
            <span style={{ fontSize: 13.5, color: MUTED }}>What are you thinking?</span>
          </button>

          {/* Sort the open feed by engagement (Top) or newest (Recent). */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
            {([["top", "Top"], ["recent", "Recent"]] as [FeedSort, string][]).map(([s, label]) => {
              const active = feedSort === s;
              return (
                <button key={s} onClick={() => setFeedSort(s)} style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: active ? tint(TEAL, "18") : "transparent", color: active ? TEAL : MUTED,
                  border: `1px solid ${active ? tint(TEAL, "55") : LINE}`,
                }}>{label}</button>
              );
            })}
          </div>
          <FeedStream key={liveKey} controlledScope="global" controlledSort={feedSort} chrome={false} signInNext="/fantasy/social" />
        </>
      )}
      {tab === "following" && (
        user ? (
          <FeedStream controlledScope="following" controlledSort="recent" chrome={false} signInNext="/fantasy/social?tab=following"
            emptyFollowing={<FollowingEmpty onFind={() => { setDiscoverSub("players"); select("discover"); }} />} />
        ) : (
          <div style={{ borderRadius: 16, background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, padding: 22, textAlign: "center" }}>
            <div className="font-display tracking-widest" style={{ fontSize: 12.5, letterSpacing: "0.12em", color: LIME, marginBottom: 8 }}>YOUR FOLLOWING FEED</div>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
              Sign in to follow managers and see just their squads, moves and results here.
            </p>
            <button onClick={() => router.push(SIGN_IN)} style={{ padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer", background: LIME, color: "#0b1400", border: "none" }}>Sign in</button>
          </div>
        )
      )}
      {tab === "discover" && <DiscoverTabs initialSub={discoverSub} />}

      <CreatePostSheet open={composeOpen} onClose={() => setComposeOpen(false)} onPosted={() => setLiveKey((k) => k + 1)} />
    </div>
  );
}
