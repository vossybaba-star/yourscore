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
import { ErrorState, INK, LINE, Loading, MUTED, PANEL, PANEL_2, Skel, TEAL, tint } from "@/components/fantasy/shared";
import { FeedCard, type FeedEvent } from "@/components/fantasy/FeedStream";
import { timeAgo } from "@/lib/timeAgo";

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
interface UserMediaItem {
  postId: string;
  /** Null only for a video post whose poster capture failed — the tile falls
   *  back to a dark placeholder rather than being skipped. */
  thumbUrl: string | null;
  /** Present (and "video") only for a video post (Phase 2c). */
  kind?: "video";
  durationMs?: number;
}

function fmtMediaDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
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
  // Per tab: a fetch failure (bad status or thrown) is tracked separately from
  // an empty-but-successful response, so a dead API never renders as "No
  // posts yet." — that used to be indistinguishable (the old catch marked the
  // tab "loaded" with nothing in it, same as a genuinely empty profile).
  const [tabError, setTabError] = useState<Partial<Record<Tab, string>>>({});
  const [pinned, setPinned] = useState<FeedEvent | null>(null);
  const [posts, setPosts] = useState<FeedEvent[]>([]);
  const [replies, setReplies] = useState<UserReply[]>([]);
  const [media, setMedia] = useState<UserMediaItem[]>([]);

  const fetchTab = useCallback(async (t: Tab) => {
    setLoading(true);
    setTabError((e) => ({ ...e, [t]: undefined }));
    try {
      const res = await fetch(`/api/fantasy/social/profile-tab?userId=${userId}&tab=${t}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      if (t === "posts") { setPinned(d.pinned ?? null); setPosts(d.posts ?? []); }
      if (t === "replies") setReplies(d.replies ?? []);
      if (t === "media") setMedia(d.media ?? []);
      setLoaded((l) => ({ ...l, [t]: true }));
    } catch {
      setTabError((e) => ({ ...e, [t]: "That didn't load." }));
    }
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

      {loading && !loaded[tab] && !tabError[tab] && (
        <Loading label="Loading">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skel h={64} r={14} />
            <Skel h={64} r={14} />
            <Skel h={64} r={14} />
          </div>
        </Loading>
      )}

      {!loaded[tab] && tabError[tab] && (
        <ErrorState message={tabError[tab]!} onRetry={() => void fetchTab(tab)} />
      )}

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
          <Empty>No photos, GIFs, or videos yet.</Empty>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {media.map((m) => (
              <Link key={m.postId} href={`/fantasy/social/post/${m.postId}`} style={{
                display: "block", position: "relative", aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 6, background: PANEL_2,
              }}>
                {m.thumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.thumbUrl} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
                )}
                {/* A video tile (Phase 2c) never autoplays in the grid — just a
                    play glyph + duration chip over the poster (or a dark
                    placeholder when the poster capture failed). */}
                {m.kind === "video" && (
                  <>
                    <span aria-hidden style={{
                      position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                      width: 26, height: 26, borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                    </span>
                    {!!m.durationMs && (
                      <span style={{ position: "absolute", right: 4, bottom: 4, padding: "1px 5px", borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 9.5, fontWeight: 700 }}>
                        {fmtMediaDuration(m.durationMs)}
                      </span>
                    )}
                  </>
                )}
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}
