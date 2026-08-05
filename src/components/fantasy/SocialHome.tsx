"use client";
/**
 * The Social tab — a first-class Fantasy destination (founder, 3 Aug). The feed
 * is OPEN: it shows activity from everyone, not just who you follow, so there's
 * always something happening. Three segments:
 *   For You  — everyone's activity (the default open feed), sortable Top / Latest.
 *   Following — narrowed to the managers you follow.
 *   Discover  — reason-ranked suggestions + username search (<DiscoverManagers/>).
 *
 * For You/Following reuse <FeedStream/> in controlled mode (this shell owns the
 * scope + sort, so FeedStream draws no chrome of its own). The active segment
 * rides the URL (?tab=) and the nav trail, so opening a manager's profile and
 * pressing back returns to the segment you left.
 *
 * Phase 1 visual pass (5 Aug): the internal tab id stays "live" (old ?tab=
 * links and the nav trail both key off it) even though the label now reads
 * "For You". Each segment mounts once, on first visit, and then stays mounted
 * — hidden with display:none rather than unmounted — so switching tabs never
 * refetches or drops you back at the top; only posting a new post bumps
 * `liveKey` to refresh For You.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LIME, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { DiscoverTabs } from "@/components/fantasy/DiscoverTabs";
import { CreatePostSheet } from "@/components/fantasy/CreatePostSheet";
import { SearchOverlay } from "@/components/fantasy/SearchOverlay";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { useUser } from "@/hooks/useUser";
import { recordVisit } from "@/lib/nav";
import { trackFeedSortChanged, trackFeedTabChanged } from "@/lib/analytics/trackSocial";

const SIGN_IN = "/auth/sign-in?next=/fantasy/social";
const TAB_KEY = "ys:social:tab";
const SORT_KEY = "ys:social:sort";

type SocialTab = "live" | "following" | "discover";
const TABS: { id: SocialTab; label: string }[] = [
  { id: "live", label: "For You" },
  { id: "following", label: "Following" },
  { id: "discover", label: "Discover" },
];

type FeedSort = "top" | "recent";

function isTab(v: string | null): v is SocialTab {
  return v === "live" || v === "following" || v === "discover";
}
function isSort(v: string | null): v is FeedSort {
  return v === "top" || v === "recent";
}

/** The Following empty state (spec §4) — the feed starts with people. */
function FollowingEmpty({ onFind }: { onFind: () => void }) {
  return (
    <div style={{ borderRadius: 16, background: PANEL, border: `1px solid ${tint(LIME, "3a")}`, padding: 22, textAlign: "center" }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12.5, letterSpacing: "0.12em", color: LIME, marginBottom: 8 }}>
        FOLLOW MANAGERS TO NARROW YOUR FEED
      </div>
      <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: "0 0 16px" }}>
        Follow people to see just their squads, moves and gameweek results here. Everything else is over on For You.
      </p>
      <button onClick={onFind} style={{
        padding: "11px 20px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
        background: LIME, color: "#0b1400", border: "none",
      }}>Find managers</button>
    </div>
  );
}

/** Sticky prompt for signed-out visitors — portaled to <body> so it escapes the
 *  `main[data-fantasy] > * { z-index:1 }` stacking context that traps a plain
 *  fixed overlay below the z-50 BottomNav (the same reason <Sheet/> portals).
 *
 *  The nav's real height isn't a constant 58px — the guest nav's five tabs
 *  wrap "Premier League" onto two lines at 375px, so measuring it live (and
 *  re-measuring on resize) is what actually keeps this bar from overlapping
 *  it, rather than a guess that's only right some of the time. The nav's own
 *  fixed/bottom-0/z-50 classes are the one stable selector every fantasy
 *  route already renders it with. */
function useBottomNavHeight(): number {
  const [h, setH] = useState(58);
  useEffect(() => {
    const nav = document.querySelector(".fixed.bottom-0.z-50") as HTMLElement | null;
    if (!nav) return;
    const measure = () => setH(nav.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return h;
}

function GuestPrompt() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The nav's own bottom padding already clears the home-indicator safe area
  // (see BottomNav), so the measured height needs no extra safe-area addition.
  const navHeight = useBottomNavHeight();
  if (!mounted) return null;

  return createPortal(
    <div style={{
      position: "fixed", left: 0, right: 0,
      bottom: navHeight,
      zIndex: 55, pointerEvents: "none",
    }}>
      <div style={{
        pointerEvents: "auto", maxWidth: 512, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        padding: "12px 16px", background: "rgba(8,13,10,0.97)", backdropFilter: "blur(20px)",
        borderTop: `1px solid ${LINE}`,
      }}>
        <span style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.35 }}>
          Join YourScore to vote, react and share your squad.
        </span>
        <button onClick={() => router.push(SIGN_IN)} style={{
          flexShrink: 0, padding: "10px 16px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          background: TEAL, color: "#03211d", border: "none", whiteSpace: "nowrap",
        }}>Join YourScore</button>
      </div>
    </div>,
    document.body,
  );
}

export function SocialHome() {
  const router = useRouter();
  const { user, loading } = useUser();
  const [tab, setTab] = useState<SocialTab>("live");
  const [feedSort, setFeedSort] = useState<FeedSort>("top");
  // Which panes have ever been shown — mounted lazily on first visit, then kept
  // mounted (hidden) forever after so switching tabs never refetches or loses
  // scroll position.
  const [visited, setVisited] = useState<Record<SocialTab, boolean>>({ live: true, following: false, discover: false });
  // Which Discover sub-tab to open on — "Find managers" jumps straight to Players.
  const [discoverSub, setDiscoverSub] = useState<"leagues" | "players" | undefined>(undefined);
  // Bumped to force Discover to remount on a specific sub-tab even if it was
  // already visited (and would otherwise stay on whatever sub-tab it was on).
  const [discoverKey, setDiscoverKey] = useState(0);
  // The composer + a key that reloads the For You feed after a new post lands.
  const [composeOpen, setComposeOpen] = useState(false);
  const [liveKey, setLiveKey] = useState(0);
  // The full-screen search overlay (Phase 5b, AC3).
  const [searchOpen, setSearchOpen] = useState(false);

  // Single window-level scroll, shared across all three panes — capture it on
  // the way out of a tab and restore it on the way back in, so a switch never
  // reads as a scroll-to-top even though the panes share one scroll container.
  const scrollPositions = useRef<Record<SocialTab, number>>({ live: 0, following: 0, discover: 0 });
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    if (pendingScroll.current != null) {
      window.scrollTo(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [tab]);

  // Restore the segment + sort from the URL/localStorage on mount. URL ?tab=
  // wins (old shared links keep working); otherwise fall back to whatever was
  // last picked, then the "live" (For You) default.
  useEffect(() => {
    let initialTab: SocialTab = "live";
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "following" || t === "discover") {
        initialTab = t;
      } else {
        const stored = localStorage.getItem(TAB_KEY);
        if (isTab(stored)) initialTab = stored;
      }
    } catch { /* no search params / storage unavailable — For You */ }
    if (initialTab !== "live") {
      setTab(initialTab);
      setVisited((v) => (v[initialTab] ? v : { ...v, [initialTab]: true }));
    }
    try {
      const storedSort = localStorage.getItem(SORT_KEY);
      if (isSort(storedSort)) setFeedSort(storedSort);
    } catch { /* storage unavailable — default Top */ }
  }, []);

  const select = useCallback((t: SocialTab) => {
    if (t === tab) return;
    try { scrollPositions.current[tab] = window.scrollY; } catch { /* no window */ }
    pendingScroll.current = scrollPositions.current[t] ?? 0;
    setTab(t);
    setVisited((v) => (v[t] ? v : { ...v, [t]: true }));
    trackFeedTabChanged(t);
    const url = t === "live" ? "/fantasy/social" : `/fantasy/social?tab=${t}`;
    try {
      window.history.replaceState(null, "", url);
      recordVisit(url);
      localStorage.setItem(TAB_KEY, t);
    } catch { /* history/storage unavailable — tab still switches */ }
  }, [tab]);

  const selectSort = useCallback((s: FeedSort) => {
    setFeedSort(s);
    trackFeedSortChanged(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* storage unavailable */ }
  }, []);

  const findManagers = useCallback(() => {
    setDiscoverSub("players");
    setDiscoverKey((k) => k + 1);
    select("discover");
  }, [select]);

  const guestPromptShown = !loading && !user;

  return (
    <div style={{ paddingBottom: guestPromptShown ? 56 : 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.06)`, flex: 1 }}>
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
        {/* Search (Phase 5b, AC3) — opens the full-screen search overlay. */}
        <button onClick={() => setSearchOpen(true)} aria-label="Search" style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          width: 44, height: 44, borderRadius: 999, cursor: "pointer",
          background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.06)`, color: MUTED,
        }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </div>

      <div style={{ display: tab === "live" ? "block" : "none" }}>
        {visited.live && (
          <>
            {/* Composer entry point — write a post or a poll to the public feed.
                Guests can read but must sign in to contribute. */}
            <button onClick={() => (user ? setComposeOpen(true) : router.push(SIGN_IN))} style={{
              width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, marginBottom: 12,
            }}>
              <PlayerAvatar
                name={user?.user_metadata?.display_name ?? "You"}
                avatarUrl={user?.user_metadata?.avatar_url ?? null}
                size={30}
              />
              <span style={{ fontSize: 13.5, color: MUTED }}>What’s happening?</span>
            </button>

            {/* Sort the open feed by engagement (Top) or newest (Latest). */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
              {([["top", "Top"], ["recent", "Latest"]] as [FeedSort, string][]).map(([s, label]) => {
                const active = feedSort === s;
                return (
                  <button key={s} onClick={() => selectSort(s)} style={{
                    padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                    background: active ? tint(TEAL, "18") : "transparent", color: active ? TEAL : MUTED,
                    border: `1px solid ${active ? tint(TEAL, "55") : LINE}`,
                  }}>{label}</button>
                );
              })}
            </div>
            <FeedStream key={liveKey} controlledScope="global" controlledSort={feedSort} chrome={false} signInNext="/fantasy/social" onExplore={() => select("discover")} />
          </>
        )}
      </div>

      <div style={{ display: tab === "following" ? "block" : "none" }}>
        {visited.following && (
          user ? (
            <FeedStream controlledScope="following" controlledSort="recent" chrome={false} signInNext="/fantasy/social?tab=following" onExplore={() => select("discover")}
              emptyFollowing={<FollowingEmpty onFind={findManagers} />} />
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
      </div>

      <div style={{ display: tab === "discover" ? "block" : "none" }}>
        {visited.discover && <DiscoverTabs key={discoverKey} initialSub={discoverSub} />}
      </div>

      <CreatePostSheet open={composeOpen} onClose={() => setComposeOpen(false)} onPosted={() => setLiveKey((k) => k + 1)} />
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      {guestPromptShown && <GuestPrompt />}
    </div>
  );
}
