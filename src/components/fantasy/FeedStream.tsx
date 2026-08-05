"use client";
/**
 * The fantasy activity feed — interesting moves by other managers. Two scopes
 * (Following / Global), each move carries an emoji reaction bar and its own
 * comment thread (the shipped discussion stack, subject type "fantasy_feed").
 *
 * Extracted from the /fantasy/feed page so the SAME rich feed renders both at
 * that route AND under the home "Feed" tab (founder, 3 Aug — "wire up the
 * version with comments"). `embedded` drops the standalone chrome padding so it
 * sits inside the home shell; `signInNext` is where a signed-out commenter is
 * sent back to.
 *
 * Reactions mirror the league-chat set (😂 👀 🔥 👏 ❤️ 😭). One per user per
 * event: tap an emoji to react, tap your own to remove it, tap another to switch.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { PullToRefresh } from "@/components/fantasy/PullToRefresh";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import type { BoardPlayer } from "@/lib/fantasy/board";
import { DiscussionThread } from "@/components/debate/DiscussionThread";
import { InviteToLeagueSheet } from "@/components/fantasy/InviteToLeagueSheet";
import { SharePost } from "@/components/fantasy/SharePost";
import { FollowButton } from "@/components/social/FollowButton";
import { AvatarLightbox } from "@/components/ui/AvatarLightbox";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { ImageGrid } from "@/components/fantasy/ImageGrid";
import { MediaGallery } from "@/components/fantasy/MediaGallery";
import { InlineVideoPlayer, VideoPosterPreview, type PostVideo } from "@/components/fantasy/VideoPlayer";
import { CreatePostSheet } from "@/components/fantasy/CreatePostSheet";
import { useUser } from "@/hooks/useUser";
import { ReportSheet } from "@/components/social/ReportSheet";
import {
  trackBlockUser, trackBookmarkAdded, trackMuteUser, trackPollVoted, trackPostOpened,
  trackQuoteCreated, trackReactionAdded, trackRepostCreated, trackShareOpened,
  trackVideoEmbedPlayed, trackVideoSourceOpened,
} from "@/lib/analytics/trackSocial";
import { youTubeEmbedUrl, youTubeThumbUrl } from "@/lib/videoEmbeds";

// Kept in sync with FEED_REACTIONS in lib/fantasy/feed.ts (that module is
// server-only, so the set is duplicated here for the client).
const REACTION_SET = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;

type FeedScope = "following" | "global";
type FeedSort = "recent" | "top";
interface FeedFixtureCell { gw: number; oppShort: string; home: boolean; difficulty: "kind" | "medium" | "tough" }
interface FeedFace {
  name: string; avatarUrl: string | null; captain?: boolean;
  pos?: string; price?: number;
  ownership?: number | null; lastSeasonPts?: number | null;
  fixtures?: FeedFixtureCell[];
}
interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }
interface FeedReaction { emoji: string; count: number }
interface FeedPoll { question: string; options: { text: string; votes: number }[]; myChoice: number | null; total: number; endsAt: string | null }
interface FeedQuiz { correct: number; total: number; title: string | null; game: "quiz" | "round" }
interface FeedGif { mp4: string | null; webp: string | null; gifUrl: string | null; width: number; height: number }
/** videoKind/youtubeId (video build 2D) drive the three-level fallback card
 *  below — youtube: inline lazy embed; rich: large tap-to-source preview;
 *  null: the plain card, unchanged from before this build. */
interface FeedLink {
  url: string; title: string | null; description: string | null; siteName: string | null; image: string | null; domain: string;
  videoKind: "youtube" | "rich" | null; youtubeId: string | null;
}
interface FeedFixture { homeClub: string; awayClub: string; kickoffIso: string; gw: number }
/** A repost/quote target's compact summary (kept in sync with EmbeddedPost in
 *  lib/fantasy/feed.ts — that module is server-only, so duplicated here). */
export interface EmbeddedPost {
  id: string; available: boolean;
  actorId?: string; actorName?: string; actorAvatar?: string | null; createdAt?: string;
  text?: string | null; image?: string | null; isQuoteOfQuote?: boolean;
  /** True when the embedded target carries a video — the compact embed shows
   *  its poster (as `image`) with a play glyph, never inline-plays it. */
  hasVideo?: boolean;
}
export interface FeedEvent {
  id: string;
  /** React-list identity for this feed ROW — see lib/fantasy/feed.ts. Equal to
   *  `id` for every event except a repost pointer row. */
  rowKey: string;
  actorId: string; actorName: string; actorUsername: string | null; actorAvatar: string | null; actorClub: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  reactions: FeedReaction[]; myEmoji: string | null; commentCount: number;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
  text?: string | null; poll?: FeedPoll | null; image?: string | null; images?: string[] | null; gif?: FeedGif | null;
  /** An optional video attached to a post (native video upload, 5 Aug).
   *  Mutually exclusive with image/images/gif. */
  video?: PostVideo | null;
  link?: FeedLink | null; fixture?: FeedFixture | null; quiz?: FeedQuiz | null;
  /** Set when this row is a repost: who reposted it. */
  repostedBy?: { id: string; name: string } | null;
  /** True when this row is a repost/quote whose target no longer resolves. */
  unavailable?: boolean;
  repostCount: number;
  myReposted: boolean;
  /** A quote post's embedded quoted post. Null when this post isn't a quote. */
  quoteOf?: EmbeddedPost | null;
  /** Whether the viewer has bookmarked this post (Phase 3b). */
  myBookmarked: boolean;
  /** Real, resolved @username mentions in this post's text (Phase 3b). */
  mentionedUsers?: { username: string; userId: string }[] | null;
}

/** A post's GIF: mp4 renders as a looping muted autoplay video; otherwise the
 *  webp/gif image fallback. An IntersectionObserver pauses the video once it
 *  scrolls out of view and resumes it on the way back in, so a feed full of GIFs
 *  doesn't play every one of them at once. */
function GifTile({ gif }: { gif: FeedGif }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) void el.play().catch(() => {}); else el.pause(); });
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const imgSrc = gif.webp ?? gif.gifUrl;
  return (
    <div style={{ marginTop: 10, borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL_2 }}>
      {gif.mp4 ? (
        <video ref={videoRef} src={gif.mp4} loop muted playsInline autoPlay
          style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "cover" }} />
      ) : imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt="" loading="lazy" style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "cover" }} />
      ) : null}
    </div>
  );
}

/** A post's unfurled link — image (16:9, only if present), title (2-line
 *  clamp), domain. The whole card opens the link in a new tab; nofollow
 *  because it's user-submitted, not an endorsement. */
function LinkCard({ link }: { link: FeedLink }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}
      style={{ display: "block", marginTop: 10, borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL_2, textDecoration: "none" }}>
      {link.image && (
        <div style={{ width: "100%", aspectRatio: "16/9", background: PANEL, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={link.image} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ padding: "10px 12px" }}>
        {link.title && (
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.35,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{link.title}</div>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: link.title ? 4 : 0 }}>{link.domain}</div>
      </div>
    </a>
  );
}

/** Bare SVG play glyph (X-grade stroke idiom, no emoji) — same shape as
 *  VideoPlayer.tsx's PlayGlyph, kept local since that one isn't exported and
 *  this card is never allowed to reuse InlineVideoPlayer for an embed (an
 *  iframe is not a <video>). */
function PlayGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Level 1 of the fallback hierarchy (video build 2D): a YouTube link gets a
 *  poster-first, lazily-initialised inline embed. No iframe is mounted until
 *  the viewer taps — only the thumbnail + play glyph exist before that, so
 *  there's never a "dead player" to break: the tap either mounts a working
 *  iframe or the viewer still has the thumbnail and the source link never
 *  goes away (it's still a normal-looking card either way). Once tapped, the
 *  iframe stays mounted (no toggle back to the poster). */
function YouTubeEmbedCard({ link }: { link: FeedLink }) {
  const [playing, setPlaying] = useState(false);
  if (!link.youtubeId) return null;
  const thumb = link.image ?? youTubeThumbUrl(link.youtubeId);

  if (playing) {
    return (
      <div style={{
        position: "relative", width: "100%", aspectRatio: "16/9", marginTop: 10,
        borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: "#000",
      }} onClick={(e) => e.stopPropagation()}>
        <iframe
          src={`${youTubeEmbedUrl(link.youtubeId)}&autoplay=1`}
          title={link.title ?? "YouTube video"}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); trackVideoEmbedPlayed(); setPlaying(true); }}
      style={{
        display: "block", width: "100%", marginTop: 10, padding: 0, textAlign: "left",
        borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL_2, cursor: "pointer",
      }}
    >
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: PANEL }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)" }}>
          <span style={{ width: 52, height: 52, borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PlayGlyph size={24} />
          </span>
        </div>
      </div>
      <div style={{ padding: "10px 12px" }}>
        {link.title && (
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.35,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{link.title}</div>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: link.title ? 4 : 0 }}>YouTube</div>
      </div>
    </button>
  );
}

/** Level 2 of the fallback hierarchy (video build 2D): any unfurled page
 *  whose og tags declared video, but isn't YouTube — never embedded (no
 *  guarantee it's reliable/ToS-compliant to iframe), so this is a large
 *  tap-to-source preview only. The whole card opens the source in a new tab,
 *  same anchor behaviour as the plain LinkCard below. */
function RichVideoCard({ link }: { link: FeedLink }) {
  const publisher = link.siteName || link.domain;
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow"
      onClick={(e) => { e.stopPropagation(); trackVideoSourceOpened(); }}
      style={{ display: "block", marginTop: 10, borderRadius: 12, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL_2, textDecoration: "none" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: PANEL }}>
        {link.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.image} alt="" loading="lazy" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
        )}
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.2)" }}>
          <span style={{ width: 52, height: 52, borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PlayGlyph size={24} />
          </span>
        </div>
      </div>
      <div style={{ padding: "10px 12px" }}>
        {link.title && (
          <div style={{
            fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.35,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>{link.title}</div>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: link.title ? 4 : 0 }}>Watch on {publisher}</div>
      </div>
    </a>
  );
}

/** A post's attached fixture — crests + names, kickoff in UK time, GW label. */
function FixtureCard({ fixture }: { fixture: FeedFixture }) {
  const homeCrest = getTeamBadgeUrlSync(fixture.homeClub);
  const awayCrest = getTeamBadgeUrlSync(fixture.awayClub);
  const kickoff = new Date(fixture.kickoffIso);
  const kickoffLabel = Number.isNaN(kickoff.getTime()) ? "" : kickoff.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
  const Side = ({ crest, name }: { crest: string | null; name: string }) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
      {crest ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={crest} alt="" width={32} height={32} style={{ width: 32, height: 32, objectFit: "contain" }} />
      ) : <div style={{ width: 32, height: 32, borderRadius: 999, background: PANEL }} />}
      <span style={{ fontSize: 12, fontWeight: 700, color: INK, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{name}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 10, padding: "12px 10px", borderRadius: 12, border: `1px solid ${LINE}`, background: PANEL_2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Side crest={homeCrest} name={fixture.homeClub} />
        <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 700, flexShrink: 0 }}>VS</span>
        <Side crest={awayCrest} name={fixture.awayClub} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10, fontSize: 11.5, color: MUTED }}>
        {kickoffLabel && <span>{kickoffLabel}</span>}
        <span>GW{fixture.gw}</span>
      </div>
    </div>
  );
}

/** Render post text with any http(s) URLs turned into safe, tappable links,
 *  plus (Phase 3b) any @username token that resolved to a real profile
 *  (`mentions`, computed server-side in hydrateEvents) linked to it. An
 *  unresolved handle — typo, or no such user — stays plain text. */
function LinkedText({ text, mentions }: { text: string; mentions?: { username: string; userId: string }[] | null }) {
  const byHandle = new Map((mentions ?? []).map((m) => [m.username.toLowerCase(), m.userId]));
  const parts = text.split(/(https?:\/\/[^\s]+|@[a-zA-Z0-9_]{2,30})/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}
              style={{ color: TEAL, textDecoration: "none", wordBreak: "break-all" }}>{part}</a>
          );
        }
        if (part.startsWith("@")) {
          const uid = byHandle.get(part.slice(1).toLowerCase());
          if (uid) {
            return (
              <Link key={i} href={`/profile/${uid}`} onClick={(e) => e.stopPropagation()}
                style={{ color: TEAL, fontWeight: 700, textDecoration: "none" }}>{part}</Link>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Recompute the reaction tallies after a user switches from `from` to `to`
 *  (either may be null). Keeps the canonical order and drops zeroed emojis. */
function applyReaction(current: FeedReaction[], from: string | null, to: string | null): FeedReaction[] {
  const counts = new Map(current.map((r) => [r.emoji, r.count]));
  if (from) counts.set(from, (counts.get(from) ?? 1) - 1);
  if (to) counts.set(to, (counts.get(to) ?? 0) + 1);
  return REACTION_SET.filter((e) => (counts.get(e) ?? 0) > 0).map((emoji) => ({ emoji, count: counts.get(emoji)! }));
}

/** The reaction control under a feed card: a single React button plus — only
 *  once reactions exist — a compact summary (top 3 emoji + one total count).
 *  No more one pill per emoji; tapping either opens the 6-emoji tray, and
 *  tapping the tray's outside overlay closes it (the same pattern CardMenu
 *  uses below). */
function ReactionBar({ ev }: { ev: FeedEvent }) {
  const [reactions, setReactions] = useState<FeedReaction[]>(ev.reactions);
  const [mine, setMine] = useState<string | null>(ev.myEmoji);
  const [trayOpen, setTrayOpen] = useState(false);

  const react = useCallback(async (emoji: string) => {
    const remove = mine === emoji;
    const prevReactions = reactions, prevMine = mine;
    const next = remove ? null : emoji;
    // Optimistic.
    setReactions(applyReaction(reactions, mine, next));
    setMine(next);
    setTrayOpen(false);
    if (!remove) trackReactionAdded(emoji);
    try {
      const res = remove
        ? await fetch("/api/fantasy/feed/react", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }) })
        : await fetch("/api/fantasy/feed/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id, emoji }) });
      if (res.status === 401) { window.location.href = "/auth/sign-in?next=/fantasy/social"; return; }
      if (!res.ok) { setReactions(prevReactions); setMine(prevMine); }
    } catch { setReactions(prevReactions); setMine(prevMine); }
  }, [mine, reactions, ev.id]);

  const total = reactions.reduce((s, r) => s + r.count, 0);
  const top = [...reactions].sort((a, b) => b.count - a.count).slice(0, 3);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
      {total > 0 && (
        <button onClick={() => setTrayOpen((o) => !o)}
          aria-label={`${total} reaction${total === 1 ? "" : "s"}${mine ? `, you reacted ${mine}` : ""}. Tap to react`}
          style={{
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer", minHeight: 44,
            padding: "9px 9px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            background: mine ? tint(TEAL, "1a") : PANEL_2, color: mine ? TEAL : MUTED,
            border: `1px solid ${mine ? tint(TEAL, "55") : LINE}`,
          }}>
          <span aria-hidden style={{ display: "flex", alignItems: "center" }}>
            {top.map((r) => <span key={r.emoji} style={{ fontSize: 13 }}>{r.emoji}</span>)}
          </span>
          {total}
        </button>
      )}
      <button onClick={() => setTrayOpen((o) => !o)} aria-label="React" aria-expanded={trayOpen} style={{
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: 44, height: 44, borderRadius: 999, fontSize: 15,
        background: trayOpen ? tint(TEAL, "22") : "none", color: trayOpen ? TEAL : MUTED,
        border: `1px solid ${trayOpen ? tint(TEAL, "66") : LINE}`,
      }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="11" cy="12" r="8" /><path d="M8 14s1.2 1.6 3 1.6 3-1.6 3-1.6" /><path d="M9 10h.01" /><path d="M13.5 10h.01" /><path d="M19 3v4" /><path d="M17 5h4" />
        </svg>
      </button>

      {trayOpen && (
        <>
          {/* stopPropagation: this overlay is a plain div, not one of the
              a/button/video tags the card's own body-tap-to-detail ignores —
              without it, tapping outside the tray to close it would ALSO open
              the post detail page underneath. */}
          <div onClick={(e) => { e.stopPropagation(); setTrayOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 4 }} />
          <div role="group" aria-label="Reactions" style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 5,
            display: "flex", gap: 2, padding: 5, borderRadius: 999,
            background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}>
            {REACTION_SET.map((emoji) => (
              <button key={emoji} onClick={() => react(emoji)} aria-label={`React with ${emoji}`} aria-pressed={emoji === mine} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", background: emoji === mine ? tint(TEAL, "22") : "none",
                border: "none", borderRadius: 999, fontSize: 18, lineHeight: 1,
                minWidth: 44, minHeight: 44,
              }}>{emoji}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Coarse "Ends in Xh" label for an open poll. Null once it's past endsAt
 *  (the caller treats that as closed). */
function timeRemaining(endsAt: string): string | null {
  const ms = Date.parse(endsAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const hours = ms / 3_600_000;
  if (hours < 1) return `Ends in ${Math.max(1, Math.ceil(ms / 60_000))}m`;
  if (hours < 24) return `Ends in ${Math.ceil(hours)}h`;
  return `Ends in ${Math.ceil(hours / 24)}d`;
}

/** A post's poll — tap an option to vote; bars fill once you've voted. Once
 *  endsAt has passed the poll is CLOSED: bars are always visible (no need to
 *  vote to see the result), options stop being tappable, and the footer reads
 *  "Final result" instead of the vote count. Legacy polls (no endsAt) never
 *  close. */
function PollBlock({ ev }: { ev: FeedEvent }) {
  const [poll, setPoll] = useState<FeedPoll>(ev.poll!);
  const closed = !!poll.endsAt && Date.now() > Date.parse(poll.endsAt);
  const voted = poll.myChoice != null;
  const showBars = voted || closed;

  const vote = useCallback(async (idx: number) => {
    if (closed || poll.myChoice === idx) return;
    const prev = poll;
    const options = poll.options.map((o, i) => {
      let v = o.votes;
      if (poll.myChoice === i) v -= 1;
      if (i === idx) v += 1;
      return { ...o, votes: v };
    });
    const total = poll.total + (poll.myChoice == null ? 1 : 0);
    setPoll({ ...poll, options, myChoice: idx, total });
    trackPollVoted();
    try {
      const r = await fetch("/api/fantasy/feed/poll/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id, optionIndex: idx }) });
      if (r.status === 401) { window.location.href = "/auth/sign-in?next=/fantasy/social"; return; }
      if (!r.ok) setPoll(prev);
    } catch { setPoll(prev); }
  }, [poll, ev.id, closed]);

  const remaining = !closed && poll.endsAt ? timeRemaining(poll.endsAt) : null;

  return (
    <div style={{ marginTop: 12 }}>
      {poll.question && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>{poll.question}</span>
          {remaining && <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap", flexShrink: 0 }}>{remaining}</span>}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {poll.options.map((o, i) => {
          const pct = poll.total > 0 ? Math.round((o.votes / poll.total) * 100) : 0;
          const mine = poll.myChoice === i;
          return (
            <button key={i} onClick={() => vote(i)} disabled={closed} style={{
              position: "relative", overflow: "hidden", textAlign: "left", cursor: closed ? "default" : voted ? "default" : "pointer", width: "100%",
              minHeight: 44, display: "flex", alignItems: "center",
              padding: "9px 12px", borderRadius: 10, background: PANEL_2, border: `1px solid ${mine ? tint(TEAL, "66") : LINE}`,
              opacity: closed && !mine ? 0.8 : 1,
            }}>
              {showBars && <div aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: mine ? tint(TEAL, "2a") : "rgba(255,255,255,0.05)" }} />}
              <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: mine ? TEAL : INK }}>{o.text}</span>
                {showBars && <span style={{ fontSize: 13, fontWeight: 700, color: mine ? TEAL : MUTED }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      {/* aria-live (AC5): announces the result line once a vote lands, so a
          screen-reader user hears the outcome without hunting for it. */}
      <div aria-live="polite" style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>
        {closed
          ? `Final result · ${poll.total} vote${poll.total === 1 ? "" : "s"}`
          : `${poll.total} vote${poll.total === 1 ? "" : "s"}${voted ? "" : " · tap to vote"}`}
      </div>
    </div>
  );
}

/** The ⋯ overflow on every card — Twitter grammar: share lives here (and stays
 *  inline too), plus copy link, bookmark, the profile, the league invite, and
 *  (Phase 3b, profile-owner only) pin/unpin. */
function CardMenu({ ev, onShare, onInvite, shareUrl, pinControl, viewerId, onHide }: {
  ev: FeedEvent; onShare: () => void; onInvite: () => void; shareUrl: string;
  /** Present only when the viewer is looking at their OWN post from a context
   *  that tracks pin state (the profile's Posts tab) — see FeedCard. */
  pinControl?: { pinned: boolean; onTogglePin: () => void };
  /** The signed-in viewer's id, or null for a guest (Phase 5a) — gates
   *  Delete/Report/Block/Mute, all hidden entirely for a guest rather than
   *  redirected to sign-in (AC8 — signed-in-only, no half-shown controls). */
  viewerId?: string | null;
  /** Tell the card to stop rendering itself (Phase 5a) — after a successful
   *  delete/block/mute, since the acted-on content shouldn't linger. */
  onHide?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(ev.myBookmarked);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const router = useRouter();
  const isOwner = !!viewerId && viewerId === ev.actorId;

  const toggleBookmark = useCallback(async () => {
    if (bookmarkBusy) return;
    setBookmarkBusy(true);
    const next = !bookmarked;
    setBookmarked(next); // optimistic
    try {
      const res = await fetch("/api/fantasy/feed/bookmark", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: ev.id }),
      });
      if (res.status === 401) { window.location.href = "/auth/sign-in?next=/fantasy/social"; return; }
      if (!res.ok) setBookmarked(!next);
      else if (next) trackBookmarkAdded();
    } catch { setBookmarked(!next); }
    setBookmarkBusy(false);
  }, [bookmarked, bookmarkBusy, ev.id]);

  const deletePost = useCallback(async () => {
    if (safetyBusy) return;
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    setSafetyBusy(true);
    try {
      const res = await fetch("/api/fantasy/feed/post", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }),
      });
      if (res.ok) onHide?.();
    } finally { setSafetyBusy(false); }
  }, [safetyBusy, ev.id, onHide]);

  const blockActor = useCallback(async () => {
    if (safetyBusy) return;
    if (!window.confirm(`Block ${ev.actorName}? You won't see each other's posts, and you'll stop following each other.`)) return;
    setSafetyBusy(true);
    try {
      const res = await fetch("/api/social/block", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: ev.actorId }),
      });
      if (res.ok) { trackBlockUser(); onHide?.(); }
    } finally { setSafetyBusy(false); }
  }, [safetyBusy, ev.actorId, ev.actorName, onHide]);

  const muteActor = useCallback(async () => {
    if (safetyBusy) return;
    if (!window.confirm(`Mute ${ev.actorName}? Their posts won't show in your feed.`)) return;
    setSafetyBusy(true);
    try {
      const res = await fetch("/api/social/mute", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: ev.actorId }),
      });
      if (res.ok) { trackMuteUser(); onHide?.(); }
    } finally { setSafetyBusy(false); }
  }, [safetyBusy, ev.actorId, ev.actorName, onHide]);

  const item = (label: string, emoji: string, fn: () => void) => (
    <button key={label} onClick={() => { setMenuOpen(false); fn(); }} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", minHeight: 44,
      background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: "nowrap",
    }}><span aria-hidden style={{ fontSize: 15 }}>{emoji}</span>{label}</button>
  );
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label="More" aria-expanded={menuOpen} style={{
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: 44, height: 44, borderRadius: 999, background: menuOpen ? PANEL_2 : "none",
        border: "none", color: MUTED, fontSize: 17, letterSpacing: "0.08em", lineHeight: 1,
      }}>···</button>
      {menuOpen && (
        <>
          {/* stopPropagation — same reason as ReactionBar's tray overlay above. */}
          <div onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 8 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9, minWidth: 190,
            borderRadius: 12, background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            padding: "4px 0", overflow: "hidden",
          }}>
            {item("Share post", "↗", () => { trackShareOpened(); onShare(); })}
            {item(copied ? "Link copied" : "Copy link", "🔗", () => {
              navigator.clipboard?.writeText(shareUrl).catch(() => {});
              setCopied(true); setTimeout(() => setCopied(false), 1600);
            })}
            {item(bookmarked ? "Remove bookmark" : "Bookmark", "🔖", toggleBookmark)}
            {pinControl && item(pinControl.pinned ? "Unpin" : "Pin to profile", "📌", pinControl.onTogglePin)}
            {item("View profile", "👤", () => router.push(`/profile/${ev.actorId}`))}
            {item("View squad", "👕", () => router.push(`/profile/${ev.actorId}#fantasy-xi`))}
            {item("Invite to a league", "＋", onInvite)}
            {/* Report/Block/Mute/Delete (Phase 5a) — signed-in only, hidden
                outright for a guest rather than a sign-in redirect. */}
            {viewerId && isOwner && item("Delete post", "🗑", deletePost)}
            {viewerId && !isOwner && item("Report post", "🚩", () => setReportOpen(true))}
            {viewerId && !isOwner && item(`Block ${ev.actorName}`, "🚫", blockActor)}
            {viewerId && !isOwner && item(`Mute ${ev.actorName}`, "🔇", muteActor)}
          </div>
        </>
      )}
      {reportOpen && <ReportSheet subjectType="post" subjectId={ev.id} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

/** The reposted-by attribution line — a compact "↻ Reposted by {name}" strip
 *  above the ORIGINAL post's full card. Plain (non-interactive) row, since the
 *  card underneath already links everywhere that matters. */
function RepostedByLine({ repostedBy }: { repostedBy: { id: string; name: string } }) {
  return (
    <Link href={`/profile/${repostedBy.id}`} onClick={(e) => e.stopPropagation()}
      style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: "none" }}>
      <span aria-hidden style={{ fontSize: 13 }}>↻</span>Reposted by {repostedBy.name}
    </Link>
  );
}

/** A repost/quote whose target no longer resolves (AC6) — muted stub, no crash. */
function UnavailableStub({ repostedBy }: { repostedBy?: { id: string; name: string } | null }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${LINE}` }}>
      {repostedBy && <RepostedByLine repostedBy={repostedBy} />}
      <div style={{ padding: "14px 12px", borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`, fontSize: 13, color: MUTED, textAlign: "center" }}>
        This post is unavailable
      </div>
    </div>
  );
}

/** A quote post's embedded quoted post — compact, taps through to its detail
 *  page. A target that's ITSELF a quote renders as a plain link (never a
 *  nested card — Phase 3a rule: embeds are always one level deep). A missing
 *  target renders the same muted stub as an unavailable repost. */
function QuoteEmbedCard({ embed }: { embed: EmbeddedPost }) {
  const router = useRouter();
  const open = (e: React.MouseEvent) => { e.stopPropagation(); router.push(`/fantasy/social/post/${embed.id}`); };

  if (!embed.available) {
    return (
      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`, fontSize: 12.5, color: MUTED, textAlign: "center" }}>
        This post is unavailable
      </div>
    );
  }
  if (embed.isQuoteOfQuote) {
    return (
      <button onClick={open} style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", cursor: "pointer", marginTop: 10,
        padding: "9px 12px", borderRadius: 10, background: "none", border: `1px solid ${LINE}`, color: TEAL, fontSize: 12.5, fontWeight: 700,
      }}>Quoted a post <span aria-hidden>›</span></button>
    );
  }
  return (
    <div onClick={open} style={{ marginTop: 10, padding: 10, borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PlayerAvatar name={embed.actorName ?? "A manager"} avatarUrl={embed.actorAvatar ?? null} size={20} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{embed.actorName}</span>
        {embed.createdAt && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>· {timeAgo(embed.createdAt)}</span>}
      </div>
      {embed.text && (
        <div style={{ fontSize: 12.5, color: "#c7d0cb", lineHeight: 1.4, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {embed.text}
        </div>
      )}
      {embed.image && !embed.hasVideo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={embed.image} alt="" loading="lazy" style={{ display: "block", width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 8, marginTop: 6 }} />
      )}
      {/* A quoted post's video never inline-plays in the compact embed — just
          its poster + a play glyph, same as X. Tapping the embed (the whole
          card's onClick, above) is what actually opens it. */}
      {embed.hasVideo && (
        <VideoPosterPreview video={{ url: "", posterUrl: embed.image ?? null, width: 16, height: 9, durationMs: 0 }} />
      )}
    </div>
  );
}

/** Repost icon — two arrows forming a loop (the Twitter/X "retweet" glyph). */
function RepostIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

/** Action-row repost control: highlighted + a combined count when the viewer
 *  has reposted; a single tap on an ALREADY-reposted post undoes it directly
 *  (nothing to choose); otherwise it opens a small Repost/Quote chooser.
 *  Optimistic, 401 redirects to sign-in — same pattern as ReactionBar. */
function RepostControl({ ev, signInNext }: { ev: FeedEvent; signInNext: string }) {
  const [reposted, setReposted] = useState(ev.myReposted);
  const [count, setCount] = useState(ev.repostCount);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  const toggle = useCallback(async (undo: boolean) => {
    const prevReposted = reposted, prevCount = count;
    setReposted(!undo);
    setCount((c) => c + (undo ? -1 : 1));
    setChooserOpen(false);
    try {
      const res = undo
        ? await fetch("/api/fantasy/feed/repost", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }) })
        : await fetch("/api/fantasy/feed/repost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }) });
      if (res.status === 401) { window.location.href = `/auth/sign-in?next=${encodeURIComponent(signInNext)}`; return; }
      if (!res.ok) { setReposted(prevReposted); setCount(prevCount); }
      else if (!undo) trackRepostCreated();
    } catch { setReposted(prevReposted); setCount(prevCount); }
  }, [reposted, count, ev.id, signInNext]);

  const tap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (reposted) { toggle(true); return; }
    setChooserOpen((o) => !o);
  };

  const quoted = { id: ev.id, actorName: ev.actorName, actorAvatar: ev.actorAvatar, text: ev.text ?? null, image: (ev.images?.[0] ?? ev.image ?? ev.video?.posterUrl ?? null), createdAt: ev.createdAt };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={tap} aria-label={reposted ? "Undo repost" : "Repost or quote"} style={{
        display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", minHeight: 44,
        padding: "10px 9px", color: reposted ? TEAL : MUTED, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
      }}>
        <RepostIcon />
        {count > 0 ? count : "Repost"}
      </button>
      {chooserOpen && (
        <>
          <div onClick={(e) => { e.stopPropagation(); setChooserOpen(false); }} style={{ position: "fixed", inset: 0, zIndex: 8 }} />
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 9, minWidth: 150,
            borderRadius: 12, background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            padding: "4px 0", overflow: "hidden",
          }}>
            <button onClick={(e) => { e.stopPropagation(); toggle(false); }} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", minHeight: 44,
              background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK,
            }}><RepostIcon />Repost</button>
            <button onClick={(e) => { e.stopPropagation(); setChooserOpen(false); setQuoteOpen(true); }} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer", minHeight: 44,
              background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK,
            }}><span aria-hidden style={{ fontSize: 15 }}>✎</span>Quote</button>
          </div>
        </>
      )}
      <CreatePostSheet open={quoteOpen} onClose={() => setQuoteOpen(false)}
        onPosted={() => { trackQuoteCreated(); setQuoteOpen(false); }} quoting={quoted} />
    </div>
  );
}

/** Exported for the post-detail route (AC1) — reuses the exact same card
 *  rather than duplicating its render logic. `detail` suppresses the body-tap
 *  navigation (already on the detail page) and the inline collapsed comment
 *  thread (the page renders its own, always expanded, below). */
export function FeedCard({ ev, signInNext, detail = false, pinControl }: {
  ev: FeedEvent; signInNext: string; detail?: boolean;
  /** Pin/unpin control for this post (Phase 3b) — passed only by the profile
   *  Posts tab, which is the one place that tracks the viewer's pinned post.
   *  See CardMenu. */
  pinControl?: { pinned: boolean; onTogglePin: () => void };
}) {
  const router = useRouter();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  // Phase 5a — a successful delete/block/mute from this card's CardMenu hides
  // it immediately, client-side. Other cards by the same actor elsewhere in
  // the list catch up on the next feed load, once the server-side filter
  // (hiddenActorIds) excludes them.
  const [hiddenSelf, setHiddenSelf] = useState(false);

  if (hiddenSelf) return null;
  if (ev.unavailable) return <UnavailableStub repostedBy={ev.repostedBy} />;

  // Legacy single-image posts render through the same grid — just a one-item array.
  const images = ev.images && ev.images.length ? ev.images : ev.image ? [ev.image] : [];
  const hasBoard = !!(ev.board && ev.board.xi.length > 0);
  // Phase 4a, AC5: a genuine user post (not a repost pointer/unavailable stub —
  // both are filtered above) can go into a league's chat as a "feed" card too,
  // same as a squad/player already can.
  const canShare = hasBoard || (!!ev.player && ev.playerId != null) || ev.type === "post";
  const crestUrl = ev.actorClub ? getTeamBadgeUrlSync(ev.actorClub) : null;
  // Where a shared post points: a squad → the manager's XI, a player → that
  // player, a user post (or a repost/quote of one — `ev.id` is already the
  // CONTENT id, see lib/fantasy/feed.ts) → its detail page, anything else →
  // the live feed. Plus a one-line lead for the share.
  const origin = typeof window !== "undefined" ? window.location.origin : "https://yourscore.app";
  const shareUrl = hasBoard ? `${origin}/profile/${ev.actorId}#fantasy-xi`
    : (ev.player && ev.playerId != null) ? `${origin}/fantasy/players/${ev.playerId}`
    : ev.type === "post" ? `${origin}/fantasy/social/post/${ev.id}`
    : `${origin}/fantasy/social`;
  const shareText = ev.type === "post" && ev.text ? ev.text.slice(0, 140)
    : hasBoard ? `${ev.actorName}'s Fantasy XI on YourScore`
    : `${ev.actorName} on YourScore Fantasy`;
  const leagueBody = canShare
    ? () => (hasBoard ? { kind: "squad", ofUserId: ev.actorId }
      : (ev.player && ev.playerId != null) ? { kind: "player", playerId: ev.playerId }
      : { kind: "feed", eventId: ev.id })
    : undefined;

  // AC3: tapping the post's body opens its detail page — but not a tap that
  // landed on (or inside) a link, button or video, and not on the detail page
  // itself (nowhere useful to navigate to). Only "post" events HAVE a detail
  // page — a transfer/haul/squad tile keeps its own existing destinations.
  const openDetail = ev.type === "post" && !detail;
  const onBodyClick = openDetail
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest("a,button,video")) return;
        trackPostOpened(ev.type);
        router.push(`/fantasy/social/post/${ev.id}`);
      }
    : undefined;

  return (
    // Flat timeline row (founder: "content, not container, is the focus") — no
    // card shell, just a divider between posts. Horizontal edge-to-edge inside
    // the page's own side padding so an image can span the full content width.
    <div onClick={onBodyClick} style={{ padding: "12px 0", borderBottom: `1px solid ${LINE}`, cursor: openDetail ? "pointer" : undefined }}>
      {ev.repostedBy && <RepostedByLine repostedBy={ev.repostedBy} />}
      {/* Twitter grammar (founder, 4 Aug): BOLD screen name, muted non-bold
          @handle, the time inline after a dot — then the content underneath. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Manager portrait with the crest of the club they support tucked in the
            corner — the same identity the quiz shows. */}
        <div style={{ position: "relative", flexShrink: 0, width: 38, height: 38 }}>
          <AvatarLightbox name={ev.actorName} avatarUrl={ev.actorAvatar}>
            <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={38} />
          </AvatarLightbox>
          {crestUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={crestUrl} alt="" width={17} height={17}
              style={{ position: "absolute", right: -3, bottom: -2, width: 17, height: 17, objectFit: "contain", borderRadius: "50%", background: PANEL, padding: 1, boxShadow: "0 0 0 1.5px " + PANEL }} />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, minWidth: 0, fontSize: 13.5, lineHeight: 1.35 }}>
            <Link href={`/profile/${ev.actorId}`} style={{ color: INK, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "55%" }}>{ev.actorName}</Link>
            {ev.actorUsername && (
              <span style={{ color: MUTED, fontWeight: 400, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>@{ev.actorUsername}</span>
            )}
            <span style={{ color: MUTED, fontWeight: 400, fontSize: 12.5, whiteSpace: "nowrap", flexShrink: 0 }}>· {timeAgo(ev.createdAt)}</span>
          </div>
          {ev.type !== "post" && (
            <div style={{ fontSize: 13, color: "#c7d0cb", marginTop: 1, lineHeight: 1.4 }}>{ev.sentence}</div>
          )}
        </div>
        {/* Follow lives in the header (spec); FollowButton renders nothing on your own posts. */}
        <FollowButton userId={ev.actorId} size="sm" initialFollowing={false} />
        <CardMenu ev={ev} shareUrl={shareUrl} onShare={() => setShareOpen(true)} onInvite={() => setInviteOpen(true)} pinControl={pinControl}
          viewerId={user?.id ?? null} onHide={() => setHiddenSelf(true)} />
      </div>

      {/* A user post: the text (links + @mentions tappable), an image, then a poll if any. */}
      {ev.type === "post" && ev.text && (
        <div style={{ fontSize: 14.5, color: INK, lineHeight: 1.45, marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <LinkedText text={ev.text} mentions={ev.mentionedUsers} />
        </div>
      )}
      {ev.type === "post" && images.length > 0 && (
        <ImageGrid images={images} onOpen={(i) => setGalleryIndex(i)} />
      )}
      {ev.type === "post" && ev.gif && <GifTile gif={ev.gif} />}
      {ev.type === "post" && ev.video && <InlineVideoPlayer video={ev.video} context={{ postId: ev.id }} />}
      {galleryIndex !== null && (
        <MediaGallery images={images} index={galleryIndex} onClose={() => setGalleryIndex(null)} />
      )}
      {ev.type === "post" && ev.link && (
        ev.link.videoKind === "youtube" && ev.link.youtubeId
          ? <YouTubeEmbedCard link={ev.link} />
          : ev.link.videoKind === "rich"
            ? <RichVideoCard link={ev.link} />
            : <LinkCard link={ev.link} />
      )}
      {ev.type === "post" && ev.fixture && <FixtureCard fixture={ev.fixture} />}
      {ev.type === "post" && ev.quoteOf && <QuoteEmbedCard embed={ev.quoteOf} />}
      {ev.poll && <PollBlock ev={ev} />}

      {/* A quiz result: the score line as a card, with a door to the same game. */}
      {ev.type === "quiz_result" && ev.quiz && (
        <Link href={ev.quiz.game === "round" ? "/fantasy/round" : "/play"}
          style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", marginTop: 12, padding: "12px 14px", borderRadius: 12, background: tint(TEAL, "12"), border: `1px solid ${tint(TEAL, "44")}` }}>
          <span aria-hidden style={{ fontSize: 22 }}>🧠</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="font-display" style={{ display: "block", fontSize: 20, fontWeight: 800, color: TEAL, lineHeight: 1.1 }}>
              {ev.quiz.correct}/{ev.quiz.total}
            </span>
            <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ev.quiz.game === "round" ? `GW${ev.gw ?? ""} knowledge round` : (ev.quiz.title ?? "Football Quiz")}
            </span>
          </span>
          <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: TEAL }}>Beat it ›</span>
        </Link>
      )}

      {/* Squad tiles render the real tactical PITCH (founder, 5 Aug — kept over
          a compact card: people like seeing pitches as they scroll, PR #60).
          Tap opens the manager's full squad (back retraces feed → profile → player). */}
      {hasBoard && (
        <Link href={`/profile/${ev.actorId}#fantasy-xi`} style={{ display: "block", marginTop: 12, textDecoration: "none" }}>
          <div style={{ paddingBottom: 12 }}>
            <SquadBoard mode="complete" players={ev.board!.players} xi={ev.board!.xi} bench={ev.board!.bench} captain={ev.board!.captain} vice={ev.board!.vice} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: TEAL }}>
            See {ev.actorName}&apos;s squad <span aria-hidden>›</span>
          </div>
        </Link>
      )}

      {/* Shortlist / squad-update tiles show the one player — fixture-forward:
          pos · price · next fixture inline, with next 3 fixtures + ownership +
          last season behind a "More stats" expand. */}
      {ev.player && (() => {
        const pl = ev.player!;
        const DIFF: Record<string, string> = { kind: "#6FCF97", medium: "#E0C36B", tough: "#E08A6B" };
        const nextFx = pl.fixtures?.[0];
        const line = [pl.pos, pl.price != null ? `£${pl.price.toFixed(1)}m` : null].filter(Boolean).join(" · ");
        const canExpand = (pl.fixtures?.length ?? 0) > 0 || pl.ownership != null || pl.lastSeasonPts != null;
        const headStyle = { display: "flex", alignItems: "center", gap: 10, width: "100%", textDecoration: "none", padding: "8px 10px" } as const;
        const head = (
          <>
            <PlayerAvatar name={pl.name} avatarUrl={pl.avatarUrl} size={40} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: INK }}>{pl.name}</span>
              {(line || nextFx) && (
                <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 12, color: MUTED, marginTop: 2 }}>
                  {line && <span>{line}</span>}
                  {nextFx && (
                    <>
                      <span aria-hidden>·</span>
                      <span style={{ color: INK }}>GW{nextFx.gw} {nextFx.home ? "v" : "@"} {nextFx.oppShort}</span>
                      <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: DIFF[nextFx.difficulty], display: "inline-block" }} />
                    </>
                  )}
                </span>
              )}
            </span>
            {ev.playerId != null && <span style={{ color: MUTED, fontSize: 18 }}>›</span>}
          </>
        );
        return (
          <div style={{ marginTop: 12, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}`, overflow: "hidden" }}>
            {ev.playerId != null
              ? <Link href={`/fantasy/players/${ev.playerId}`} style={headStyle}>{head}</Link>
              : <div style={headStyle}>{head}</div>}
            {canExpand && (
              <>
                <button onClick={(e) => { e.stopPropagation(); setStatsOpen((o) => !o); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, width: "100%", background: "none", border: "none", borderTop: `1px solid ${LINE}`, color: MUTED, fontSize: 11.5, fontWeight: 600, padding: "6px 0", cursor: "pointer" }}>
                  {statsOpen ? "Less" : "More stats"} <span style={{ fontSize: 9 }}>{statsOpen ? "▲" : "▼"}</span>
                </button>
                {statsOpen && (
                  <div style={{ padding: "2px 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {(pl.fixtures?.length ?? 0) > 0 && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {pl.fixtures!.map((f) => (
                          <div key={f.gw} style={{ flex: 1, textAlign: "center", padding: "6px 3px", borderRadius: 6, background: "rgba(159,178,165,0.08)", borderBottom: `2px solid ${DIFF[f.difficulty] ?? MUTED}` }}>
                            <div style={{ fontSize: 9.5, color: MUTED }}>GW{f.gw}</div>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginTop: 1 }}>{f.oppShort}</div>
                            <div style={{ fontSize: 9.5, color: MUTED }}>{f.home ? "Home" : "Away"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(pl.ownership != null || pl.lastSeasonPts != null) && (
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: MUTED }}>
                        {pl.ownership != null && <span>Owned by <b style={{ color: INK }}>{pl.ownership.toFixed(1)}%</b></span>}
                        {pl.lastSeasonPts != null && <span>Last season <b style={{ color: INK }}>{pl.lastSeasonPts} pts</b></span>}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Primary sequence (spec): React · Comment · Share, one line always —
          no flexWrap, tight gaps. Invite moved into the ⋯ menu (4 Aug) so the
          row breathes like a tweet's. Each control carries vertical padding so
          the tap target is ~44px tall even though it reads visually small. */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 4, marginLeft: -9 }}>
        <ReactionBar ev={ev} />
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: "10px 9px", color: open ? TEAL : MUTED, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          {/* Silhouette, not emoji (founder, 4 Aug) — the Twitter-style outline bubble. */}
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {ev.commentCount > 0 ? ev.commentCount : "Comment"}
        </button>
        {ev.type === "post" && <RepostControl ev={ev} signInNext={signInNext} />}
        <button onClick={(e) => { e.stopPropagation(); trackShareOpened(); setShareOpen(true); }} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: "10px 9px", color: MUTED, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>Share
        </button>
      </div>

      {/* One share sheet per card, opened from the inline Share OR the ⋯ menu. */}
      <SharePost url={shareUrl} text={shareText} leagueBody={leagueBody}
        open={shareOpen} onClose={() => setShareOpen(false)} />

      {/* On the detail page the DiscussionThread renders separately, always
          expanded, underneath this card — suppress the inline collapsed copy
          so a comment never appears (or gets posted) twice. */}
      {open && !detail && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
          <DiscussionThread subjectType="fantasy_feed" subjectId={ev.id} title="Comments" accent={TEAL} embedded signInNext={signInNext} />
        </div>
      )}

      {inviteOpen && (
        <InviteToLeagueSheet inviteeId={ev.actorId} inviteeName={ev.actorName} onClose={() => setInviteOpen(false)} />
      )}
    </div>
  );
}

export function FeedStream({
  embedded = false, signInNext = "/fantasy/feed",
  controlledScope, controlledSort, chrome = true, emptyFollowing, onExplore,
}: {
  embedded?: boolean; signInNext?: string;
  /** When the parent owns the scope/sort (the Social tabs), FeedStream renders
   *  no scope/sort chrome of its own and does not auto-flip an empty Following
   *  feed to Global — the caller's empty state takes over instead. */
  controlledScope?: FeedScope; controlledSort?: FeedSort;
  chrome?: boolean; emptyFollowing?: ReactNode;
  /** Where the caught-up terminal sends people next (UX walk A4): the Social
   *  shell passes a tab switch into Discover; standalone copies omit it. */
  onExplore?: () => void;
}) {
  const router = useRouter();
  const controlled = controlledScope != null;
  const [scopeState, setScope] = useState<FeedScope>(controlledScope ?? "following");
  const [sortState, setSort] = useState<FeedSort>(controlledSort ?? "recent");
  const scope = controlledScope ?? scopeState;
  const sort = controlledSort ?? sortState;
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  // Cursor pagination (Phase 5a, AC7) — `cursor` is the oldest event's
  // createdAt from the last page fetched; `hasMore` goes false once the
  // server returns a shorter-than-asked-for window (the true end).
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // loadMore reads this instead of `events` directly — `events` is left out
  // of loadMore's own deps (below) so its identity stays stable across every
  // page append, but that means a plain closure over `events` would go stale
  // (permanently null, from the render loadMore was first created in) the
  // moment the first page landed. The ref always has the live value.
  const eventsRef = useRef<FeedEvent[] | null>(null);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Restore scope+sort from the URL once on mount (only when standalone and
  // uncontrolled — the embedded/controlled copies must not touch the URL).
  useEffect(() => {
    if (embedded || controlled) return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("scope") === "global") setScope("global");
    if (p.get("sort") === "top") setSort("top");
  }, [embedded, controlled]);

  const loadFeed = useCallback(async (silent = false): Promise<{ updated?: boolean }> => {
    if (!silent) setEvents(null);
    try {
      const res = await fetch(`/api/fantasy/feed?scope=${scope}&sort=${sort}`);
      const d = res.ok ? await res.json() : { events: [], followingCount: 0, nextCursor: null };
      setFollowingCount(d.followingCount ?? 0);
      if (!controlled && (d.followingCount ?? 0) === 0 && scope === "following") { setScope("global"); return {}; }
      const next: FeedEvent[] = d.events ?? [];
      const updated = next[0]?.rowKey !== events?.[0]?.rowKey || next.length !== (events?.length ?? -1);
      setEvents(next);
      setCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
      return { updated };
    } catch {
      if (!silent) setEvents([]);
      return {};
    }
  }, [scope, sort, events, controlled]);

  // Load the next page (Phase 5a, AC7) — appended, deduped by rowKey (a
  // repost pointer row and its original share the same `id` but never the
  // same rowKey, so rowKey is the correct dedupe key here).
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor || eventsRef.current === null) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/fantasy/feed?scope=${scope}&sort=${sort}&before=${encodeURIComponent(cursor)}`);
      const d = res.ok ? await res.json() : { events: [], nextCursor: null };
      const seen = new Set(eventsRef.current.map((e) => e.rowKey));
      const fresh: FeedEvent[] = (d.events ?? []).filter((e: FeedEvent) => !seen.has(e.rowKey));
      setEvents((prev) => [...(prev ?? []), ...fresh]);
      setCursor(d.nextCursor ?? null);
      setHasMore(!!d.nextCursor);
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, cursor, scope, sort]);

  useEffect(() => {
    if (!embedded && !controlled && typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.set("scope", scope); u.searchParams.set("sort", sort);
      window.history.replaceState(null, "", u);
    }
    let live = true;
    setEvents(null);
    setCursor(null);
    setHasMore(true);
    fetch(`/api/fantasy/feed?scope=${scope}&sort=${sort}`)
      .then((r) => (r.ok ? r.json() : { events: [], followingCount: 0, nextCursor: null }))
      .then((d) => {
        if (!live) return;
        setFollowingCount(d.followingCount ?? 0);
        if (!controlled && (d.followingCount ?? 0) === 0 && scope === "following") { setScope("global"); return; }
        setEvents(d.events ?? []);
        setCursor(d.nextCursor ?? null);
        setHasMore(!!d.nextCursor);
      })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sort, embedded, controlled]);

  // Infinite scroll (Phase 5a, AC7) — a sentinel row at the list's end;
  // loadMore fires once it's within 400px of the viewport, well before the
  // user actually hits bottom.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const showScopeTabs = (followingCount ?? 0) > 0;

  return (
    <div>
      {chrome && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, margin: "2px 0 12px" }}>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: 0, flex: 1 }}>
              The moves your rivals are making. Follow managers to fill your feed.
            </p>
            <Link href="/fantasy/social?tab=discover" style={{
              flexShrink: 0, padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
              textDecoration: "none", background: tint(TEAL, "22"), color: TEAL, border: `1px solid ${tint(TEAL, "66")}`, whiteSpace: "nowrap",
            }}>Find managers</Link>
          </div>

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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 12 }}>
            {(["recent", "top"] as FeedSort[]).map((s) => {
              const active = sort === s;
              return (
                <button key={s} onClick={() => setSort(s)} style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                  background: active ? tint(TEAL, "18") : "transparent", color: active ? TEAL : MUTED,
                  border: `1px solid ${active ? tint(TEAL, "55") : LINE}`,
                }}>{s === "recent" ? "Latest" : "Top"}</button>
              );
            })}
          </div>
        </>
      )}

      <PullToRefresh onRefresh={() => loadFeed(true)}>
        {events === null && <p style={{ fontSize: 13, color: MUTED }}>Loading…</p>}

        {events !== null && events.length === 0 && (
          (controlled && scope === "following" && emptyFollowing != null) ? (
            <>{emptyFollowing}</>
          ) : (
          <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 20, textAlign: "center" }}>
            <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5, margin: 0 }}>
              {scope === "following"
                ? "Nothing here yet. Follow some managers and their moves show up here."
                : "No moves yet. Once managers start making transfers and playing chips, they land here."}
            </p>
            {scope === "following" && (
              <button onClick={() => router.push("/fantasy/social?tab=discover")} style={{
                marginTop: 14, padding: "10px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                background: TEAL, color: "#04231f", border: "none",
              }}>Find managers to follow</button>
            )}
          </div>
          )
        )}

        {events?.map((ev) => <FeedCard key={ev.rowKey} ev={ev} signInNext={signInNext} />)}

        {/* Infinite scroll sentinel (Phase 5a, AC7) — only once there's a
            first page to extend; stays mounted while hasMore so the observer
            keeps firing as the user keeps scrolling. */}
        {events !== null && events.length > 0 && (
          <div ref={sentinelRef} style={{ padding: "18px 0", textAlign: "center" }}>
            {loadingMore ? (
              <span style={{ fontSize: 12.5, color: MUTED }}>Loading more…</span>
            ) : !hasMore ? (
              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: MUTED }}>You&apos;re all caught up</span>
                {onExplore && (
                  <button onClick={onExplore} style={{
                    cursor: "pointer", padding: "9px 16px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
                    background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03))",
                    border: "1px solid rgba(255,255,255,0.12)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
                    color: TEAL,
                  }}>See what&apos;s trending in Discover ›</button>
                )}
              </span>
            ) : null}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}
