"use client";
/**
 * The fantasy activity feed — interesting moves by other managers. Two tabs:
 * Following (people you follow) and Global (everyone). Each move can be liked and
 * has its own comment/reply thread (the shipped discussion stack, subject type
 * "fantasy_feed"). Read-only until the season is moving; emitted on transfers,
 * chips, big hauls and big rank jumps.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, TEAL, tint, page } from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import type { BoardPlayer } from "@/lib/fantasy/board";
import { DiscussionThread } from "@/components/debate/DiscussionThread";
import { BottomNav } from "@/components/ui/BottomNav";

type FeedScope = "following" | "global";
interface FeedFace { name: string; avatarUrl: string | null; captain?: boolean }
interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  likeCount: number; likedByMe: boolean; commentCount: number;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
}
type FeedSort = "recent" | "top";

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const GOLD = "#ffc233";

function FeedCard({ ev }: { ev: FeedEvent }) {
  const [liked, setLiked] = useState(ev.likedByMe);
  const [likes, setLikes] = useState(ev.likeCount);
  const [open, setOpen] = useState(false);

  const toggleLike = useCallback(async () => {
    const next = !liked;
    setLiked(next); setLikes((n) => n + (next ? 1 : -1)); // optimistic
    try {
      const res = await fetch("/api/fantasy/feed/like", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: ev.id }),
      });
      if (!res.ok) { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
    } catch { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
  }, [liked, ev.id]);

  const shareSquad = useCallback(async () => {
    // Mint a share CARD for this manager's squad (an /s/<id> link that unfurls to
    // the fantasy-squad image), then hand it to the native share sheet.
    let url = `${window.location.origin}/profile/${ev.actorId}`;
    try {
      const res = await fetch("/api/fantasy/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "squad", userId: ev.actorId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.url) url = `${window.location.origin}${d.url}`;
    } catch { /* fall back to the profile link */ }
    const data = { title: `${ev.actorName}'s squad`, text: `${ev.actorName}'s YourScore Fantasy squad`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(url);
    } catch { /* user cancelled the share sheet */ }
  }, [ev.actorId, ev.actorName]);

  return (
    <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={34} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.35 }}>
            <Link href={`/profile/${ev.actorId}`} style={{ color: INK, fontWeight: 700, textDecoration: "none" }}>{ev.actorName}</Link>
            <span style={{ color: "#c7d0cb" }}> {ev.sentence}</span>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{timeAgo(ev.createdAt)}</div>
        </div>
      </div>

      {/* Squad-complete tiles render the real pitch board — positions + crests,
          exactly like the squad picker, captain ringed gold. The whole board is a
          link INTO this manager's profile squad, where each player is tappable and
          the back button retraces feed → profile → player. */}
      {ev.board && ev.board.xi.length > 0 && (
        <Link href={`/profile/${ev.actorId}#fantasy-xi`} style={{ display: "block", marginTop: 12, textDecoration: "none" }}>
          {/* paddingBottom reserves room for the keeper's name, which sits just
              past the square pitch edge — without it the caption overlaps it. */}
          <div style={{ paddingBottom: 12 }}>
            <SquadBoard
              mode="complete"
              players={ev.board.players}
              xi={ev.board.xi}
              bench={ev.board.bench}
              captain={ev.board.captain}
              vice={ev.board.vice}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: TEAL }}>
            See {ev.actorName}&apos;s squad <span aria-hidden>›</span>
          </div>
        </Link>
      )}

      {/* Shortlist / squad-update tiles show the one player — a link to their
          profile ROUTE, so back returns to the feed exactly where you left it. */}
      {ev.player && (
        ev.playerId != null ? (
          <Link
            href={`/fantasy/players/${ev.playerId}`}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textDecoration: "none", marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
            <PlayerAvatar name={ev.player.name} avatarUrl={ev.player.avatarUrl} size={40} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: INK }}>{ev.player.name}</span>
            <span style={{ color: MUTED, fontSize: 18 }}>›</span>
          </Link>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
            <PlayerAvatar name={ev.player.name} avatarUrl={ev.player.avatarUrl} size={40} />
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: INK }}>{ev.player.name}</span>
          </div>
        )
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 12, paddingLeft: 2 }}>
        <button onClick={toggleLike} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: liked ? GOLD : MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 15 }}>{liked ? "♥" : "♡"}</span>{likes > 0 && likes}
        </button>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: open ? TEAL : MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>💬</span>{ev.commentCount > 0 ? ev.commentCount : "Comment"}
        </button>
        {/* Share someone else's finished squad. */}
        {ev.board && (
          <button onClick={shareSquad} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: MUTED, fontSize: 13, fontWeight: 600 }}>
            <span style={{ fontSize: 14 }}>↗</span>Share
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
          <DiscussionThread subjectType="fantasy_feed" subjectId={ev.id} title="Comments" accent={TEAL} embedded signInNext="/fantasy/feed" />
        </div>
      )}
    </div>
  );
}

export default function FantasyFeedPage() {
  const router = useRouter();
  // SSR-safe defaults (no window read here, or hydration mismatches); the URL is
  // restored in the mount effect below so back from a profile keeps the view.
  const [scope, setScope] = useState<FeedScope>("following");
  const [sort, setSort] = useState<FeedSort>("recent");
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

  // Restore scope+sort from the URL once on mount.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("scope") === "global") setScope("global");
    if (p.get("sort") === "top") setSort("top");
  }, []);

  // Keep scope+sort in the URL, so pressing back from a player/manager profile
  // returns to the SAME view (and Next restores the scroll position) instead of
  // resetting to the default tab.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("scope", scope); u.searchParams.set("sort", sort);
      window.history.replaceState(null, "", u);
    }
    let live = true;
    setEvents(null);
    fetch(`/api/fantasy/feed?scope=${scope}&sort=${sort}`)
      .then((r) => (r.ok ? r.json() : { events: [], followingCount: 0 }))
      .then((d) => {
        if (!live) return;
        setFollowingCount(d.followingCount ?? 0);
        // Not following anyone → there is no Following tab; show Global.
        if ((d.followingCount ?? 0) === 0 && scope === "following") { setScope("global"); return; }
        setEvents(d.events ?? []);
      })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [scope, sort]);

  const showScopeTabs = (followingCount ?? 0) > 0;

  return (
    <>
      <main data-fantasy style={page}>
        <FantasyHeader />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, margin: "2px 0 12px" }}>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: 0, flex: 1 }}>
            The moves your rivals are making. Follow managers to fill your feed.
          </p>
          <Link href="/fantasy/feed/discover" style={{
            flexShrink: 0, padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            textDecoration: "none", background: tint(TEAL, "22"), color: TEAL, border: `1px solid ${tint(TEAL, "66")}`, whiteSpace: "nowrap",
          }}>Find managers</Link>
        </div>

        {/* Following / Global — only when the viewer actually follows someone. */}
        {showScopeTabs && (
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {(["following", "global"] as FeedScope[]).map((s) => {
              const active = scope === s;
              return (
                <button key={s} onClick={() => setScope(s)} style={{
                  flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
                  border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
                }}>{s === "following" ? "Following" : "Global"}</button>
              );
            })}
          </div>
        )}

        {/* Sort — Recent or Top (most engaged), like the old Instagram. */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
          {(["recent", "top"] as FeedSort[]).map((s) => {
            const active = sort === s;
            return (
              <button key={s} onClick={() => setSort(s)} style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: active ? tint(TEAL, "18") : "transparent", color: active ? TEAL : MUTED,
                border: `1px solid ${active ? tint(TEAL, "55") : LINE}`,
              }}>{s === "recent" ? "Recent" : "Top"}</button>
            );
          })}
        </div>

        {events === null && <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>}

        {events !== null && events.length === 0 && (
          <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>
              {scope === "following"
                ? "Nothing here yet. Follow some managers and their moves show up here."
                : "No moves yet. Once managers start making transfers and playing chips, they land here."}
            </p>
            {scope === "following" && (
              <button onClick={() => router.push("/fantasy/feed/discover")} style={{
                marginTop: 14, padding: "10px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                background: TEAL, color: "#04231f", border: "none",
              }}>Find managers to follow</button>
            )}
          </div>
        )}

        {events?.map((ev) => <FeedCard key={ev.id} ev={ev} />)}
      </main>
      <BottomNav />
    </>
  );
}
