"use client";
/**
 * A profile's social content — Posts / Replies / Media (Social Phase 3b,
 * AC7). Sits BELOW the existing profile content (player card, ladder,
 * medals — untouched). Lazy: each tab's data is fetched on first open, from
 * /api/fantasy/social/profile-tab, which works signed out too (guests can
 * view). Posts reuses FeedStream's <FeedCard/> so a post here looks and acts
 * exactly like it does everywhere else in Social.
 *
 * `isOwner` gates the pin/unpin control — only the profile's own owner sees
 * it, and only here (see FeedCard's pinControl prop / CardMenu).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { FeedCard, type FeedEvent } from "@/components/fantasy/FeedStream";

type Tab = "posts" | "replies" | "media";
const TABS: { id: Tab; label: string }[] = [
  { id: "posts", label: "Posts" },
  { id: "replies", label: "Replies" },
  { id: "media", label: "Media" },
];

interface UserReply {
  id: string; body: string; createdAt: string;
  postId: string; postText: string | null; postActorName: string;
}
interface UserMediaItem { postId: string; thumbUrl: string }

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
      <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>{children}</p>
    </div>
  );
}

export function ProfileSocialTabs({ userId, isOwner, signInNext }: {
  userId: string; isOwner: boolean; signInNext: string;
}) {
  const [tab, setTab] = useState<Tab>("posts");
  const [loaded, setLoaded] = useState<Record<Tab, boolean>>({ posts: false, replies: false, media: false });
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState<FeedEvent | null>(null);
  const [posts, setPosts] = useState<FeedEvent[]>([]);
  const [replies, setReplies] = useState<UserReply[]>([]);
  const [media, setMedia] = useState<UserMediaItem[]>([]);

  const fetchTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/fantasy/social/profile-tab?userId=${userId}&tab=${t}`);
      const d = res.ok ? await res.json() : {};
      if (t === "posts") { setPinned(d.pinned ?? null); setPosts(d.posts ?? []); }
      if (t === "replies") setReplies(d.replies ?? []);
      if (t === "media") setMedia(d.media ?? []);
      setLoaded((l) => ({ ...l, [t]: true }));
    } catch { setLoaded((l) => ({ ...l, [t]: true })); }
    setLoading(false);
  }, [userId]);

  // Posts loads eagerly (it's the default open tab); Replies/Media wait for
  // their first visit.
  useEffect(() => { void fetchTab("posts"); }, [fetchTab]);

  const select = (t: Tab) => {
    setTab(t);
    if (!loaded[t]) void fetchTab(t);
  };

  const togglePin = useCallback(async (ev: FeedEvent) => {
    const wasPinned = pinned?.id === ev.id;
    try {
      const res = await fetch("/api/fantasy/feed/pin", {
        method: wasPinned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: ev.id }),
      });
      if (!res.ok) return;
      if (wasPinned) {
        setPinned(null);
        setPosts((p) => [ev, ...p]);
      } else {
        setPosts((p) => (pinned ? [pinned, ...p.filter((x) => x.id !== ev.id)] : p.filter((x) => x.id !== ev.id)));
        setPinned(ev);
      }
    } catch { /* pin is best-effort from here — the button just stays as it was */ }
  }, [pinned]);

  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 14 }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => select(t.id)} style={{
              flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: on ? tint(TEAL, "22") : "transparent", color: on ? TEAL : MUTED,
              border: `1px solid ${on ? tint(TEAL, "55") : "transparent"}`,
            }}>{t.label}</button>
          );
        })}
      </div>

      {loading && !loaded[tab] && <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>}

      {tab === "posts" && loaded.posts && (
        posts.length === 0 && !pinned ? (
          <Empty>No posts yet.</Empty>
        ) : (
          <div>
            {pinned && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: MUTED, margin: "0 0 2px" }}>
                  <span aria-hidden>📌</span>Pinned
                </div>
                <FeedCard ev={pinned} signInNext={signInNext}
                  pinControl={isOwner ? { pinned: true, onTogglePin: () => togglePin(pinned) } : undefined} />
              </div>
            )}
            {posts.map((p) => (
              <FeedCard key={p.rowKey} ev={p} signInNext={signInNext}
                pinControl={isOwner ? { pinned: false, onTogglePin: () => togglePin(p) } : undefined} />
            ))}
          </div>
        )
      )}

      {tab === "replies" && loaded.replies && (
        replies.length === 0 ? (
          <Empty>No comments yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {replies.map((r) => (
              <Link key={r.id} href={`/fantasy/social/post/${r.postId}`} style={{
                display: "block", padding: "10px 12px", borderRadius: 10,
                background: PANEL, border: `1px solid ${LINE}`, textDecoration: "none",
              }}>
                <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>
                  Replying to {r.postActorName}
                  {r.postText ? `: "${r.postText.slice(0, 60)}${r.postText.length > 60 ? "…" : ""}"` : ""}
                  {" · "}{timeAgo(r.createdAt)}
                </div>
                <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.4 }}>{r.body}</div>
              </Link>
            ))}
          </div>
        )
      )}

      {tab === "media" && loaded.media && (
        media.length === 0 ? (
          <Empty>No photos or GIFs yet.</Empty>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {media.map((m) => (
              <Link key={m.postId} href={`/fantasy/social/post/${m.postId}`} style={{
                display: "block", aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 6, background: PANEL_2,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.thumbUrl} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}
