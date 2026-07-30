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
import { INK, LINE, MUTED, PANEL, TEAL, tint, page } from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { DiscussionThread } from "@/components/debate/DiscussionThread";
import { BottomNav } from "@/components/ui/BottomNav";

type FeedScope = "following" | "global";
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  likeCount: number; likedByMe: boolean; commentCount: number;
}

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

      <div style={{ display: "flex", gap: 16, marginTop: 10, paddingLeft: 2 }}>
        <button onClick={toggleLike} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: liked ? GOLD : MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 15 }}>{liked ? "♥" : "♡"}</span>{likes > 0 && likes}
        </button>
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: open ? TEAL : MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>💬</span>{ev.commentCount > 0 ? ev.commentCount : "Comment"}
        </button>
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
  const [scope, setScope] = useState<FeedScope>("following");
  const [events, setEvents] = useState<FeedEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    setEvents(null);
    fetch(`/api/fantasy/feed?scope=${scope}`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => { if (live) setEvents(d.events ?? []); })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [scope]);

  return (
    <>
      <main data-fantasy style={page}>
        <FantasyHeader />
        <p style={{ fontSize: 13, color: MUTED, margin: "2px 0 12px", lineHeight: 1.5 }}>
          The moves your rivals are making. Follow managers to fill your feed.
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
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

        {events === null && <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>}

        {events !== null && events.length === 0 && (
          <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>
              {scope === "following"
                ? "Nothing here yet. Follow some managers and their moves show up here."
                : "No moves yet. Once managers start making transfers and playing chips, they land here."}
            </p>
          </div>
        )}

        {events?.map((ev) => <FeedCard key={ev.id} ev={ev} />)}
      </main>
      <BottomNav />
    </>
  );
}
