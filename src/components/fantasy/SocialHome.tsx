"use client";
/**
 * The Fantasy Feed — the first Fantasy tab (founder, 8 Aug). ONE feed, no
 * sub-tabs: it's the open "For You" stream — activity + conversation from ALL
 * fantasy players (global scope), the place managers talk to each other. The old
 * Following / Discover segments are gone (founder: "all it should be is the For
 * You tab… no need for a subtab at all"). Finding managers still lives behind the
 * search button; posting behind the composer.
 *
 * Sortable Top / Latest. Reads are open; posting or reacting needs an account.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { FeedStream } from "@/components/fantasy/FeedStream";
import { CreatePostSheet } from "@/components/fantasy/CreatePostSheet";
import { SearchOverlay } from "@/components/fantasy/SearchOverlay";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { useUser } from "@/hooks/useUser";
import { trackFeedSortChanged } from "@/lib/analytics/trackSocial";

const SIGN_IN = "/auth/sign-in?next=/fantasy";
const SORT_KEY = "ys:social:sort";

type FeedSort = "top" | "recent";
function isSort(v: string | null): v is FeedSort {
  return v === "top" || v === "recent";
}

/** The nav's real height isn't a constant — the guest nav wraps to two lines at
 *  375px — so measure it live to keep the guest prompt from overlapping it. */
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
  const navHeight = useBottomNavHeight();
  if (!mounted) return null;

  return createPortal(
    <div style={{ position: "fixed", left: 0, right: 0, bottom: navHeight, zIndex: 55, pointerEvents: "none" }}>
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
  const [feedSort, setFeedSort] = useState<FeedSort>("top");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitialText, setComposeInitialText] = useState<string | undefined>(undefined);
  const [liveKey, setLiveKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);

  // Restore the sort from localStorage on mount (default Top).
  useEffect(() => {
    try {
      const storedSort = localStorage.getItem(SORT_KEY);
      if (isSort(storedSort)) setFeedSort(storedSort);
    } catch { /* storage unavailable — default Top */ }
  }, []);

  // ?compose=@username — the member sheet's "Mention in a post" destination.
  useEffect(() => {
    if (loading) return;
    let compose: string | null = null;
    try { compose = new URLSearchParams(window.location.search).get("compose"); } catch { /* no window */ }
    if (!compose) return;
    if (user) { setComposeInitialText(compose); setComposeOpen(true); }
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("compose");
      window.history.replaceState(null, "", u);
    } catch { /* history unavailable */ }
  }, [loading, user]);

  const selectSort = useCallback((s: FeedSort) => {
    setFeedSort(s);
    trackFeedSortChanged(s);
    try { localStorage.setItem(SORT_KEY, s); } catch { /* storage unavailable */ }
  }, []);

  const guestPromptShown = !loading && !user;

  return (
    <div style={{ paddingBottom: guestPromptShown ? 56 : 0 }}>
      {/* Composer + search — no sub-tabs (founder 8 Aug). The composer is the main
          affordance; the search button opens manager/league search. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={() => (user ? setComposeOpen(true) : router.push(SIGN_IN))} style={{
          flex: 1, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`,
        }}>
          <PlayerAvatar
            name={user?.user_metadata?.display_name ?? "You"}
            avatarUrl={user?.user_metadata?.avatar_url ?? null}
            size={30}
          />
          <span style={{ fontSize: 13.5, color: MUTED }}>What’s happening?</span>
        </button>
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

      <FeedStream key={liveKey} controlledScope="global" controlledSort={feedSort} chrome={false} signInNext="/fantasy" />

      <CreatePostSheet open={composeOpen} initialText={composeInitialText}
        onClose={() => { setComposeOpen(false); setComposeInitialText(undefined); }}
        onPosted={() => setLiveKey((k) => k + 1)} />
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}

      {guestPromptShown && <GuestPrompt />}
    </div>
  );
}
