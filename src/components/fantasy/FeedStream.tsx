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
import { useCallback, useEffect, useState, type ReactNode } from "react";
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

// Kept in sync with FEED_REACTIONS in lib/fantasy/feed.ts (that module is
// server-only, so the set is duplicated here for the client).
const REACTION_SET = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;

type FeedScope = "following" | "global";
type FeedSort = "recent" | "top";
interface FeedFace { name: string; avatarUrl: string | null; captain?: boolean }
interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }
interface FeedReaction { emoji: string; count: number }
interface FeedPoll { question: string; options: { text: string; votes: number }[]; myChoice: number | null; total: number }
interface FeedQuiz { correct: number; total: number; title: string | null; game: "quiz" | "round" }
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorUsername: string | null; actorAvatar: string | null; actorClub: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  reactions: FeedReaction[]; myEmoji: string | null; commentCount: number;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
  text?: string | null; poll?: FeedPoll | null; image?: string | null; quiz?: FeedQuiz | null;
}

/** Render post text with any http(s) URLs turned into safe, tappable links. */
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}
            style={{ color: TEAL, textDecoration: "none", wordBreak: "break-all" }}>{part}</a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
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

/** The reaction bar under a feed card: the existing tallies plus a picker. */
function ReactionBar({ ev }: { ev: FeedEvent }) {
  const [reactions, setReactions] = useState<FeedReaction[]>(ev.reactions);
  const [mine, setMine] = useState<string | null>(ev.myEmoji);
  const [pickerOpen, setPickerOpen] = useState(false);

  const react = useCallback(async (emoji: string) => {
    const remove = mine === emoji;
    const prevReactions = reactions, prevMine = mine;
    const next = remove ? null : emoji;
    // Optimistic.
    setReactions(applyReaction(reactions, mine, next));
    setMine(next);
    setPickerOpen(false);
    try {
      const res = remove
        ? await fetch("/api/fantasy/feed/react", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id }) })
        : await fetch("/api/fantasy/feed/react", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id, emoji }) });
      if (res.status === 401) { window.location.href = "/auth/sign-in?next=/fantasy/social"; return; }
      if (!res.ok) { setReactions(prevReactions); setMine(prevMine); }
    } catch { setReactions(prevReactions); setMine(prevMine); }
  }, [mine, reactions, ev.id]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {reactions.map((r) => {
        const on = r.emoji === mine;
        return (
          <button key={r.emoji} onClick={() => react(r.emoji)} style={{
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
            padding: "3px 8px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
            background: on ? tint(TEAL, "22") : PANEL_2, color: on ? TEAL : MUTED,
            border: `1px solid ${on ? tint(TEAL, "66") : LINE}`,
          }}><span style={{ fontSize: 14 }}>{r.emoji}</span>{r.count}</button>
        );
      })}
      <button onClick={() => setPickerOpen((o) => !o)} aria-label="React" style={{
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: 28, height: 28, borderRadius: 999, fontSize: 14,
        background: pickerOpen ? tint(TEAL, "22") : "none", color: pickerOpen ? TEAL : MUTED,
        border: `1px solid ${pickerOpen ? tint(TEAL, "66") : LINE}`,
      }}>{reactions.length ? "＋" : "☺"}</button>

      {pickerOpen && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 5,
          display: "flex", gap: 2, padding: 5, borderRadius: 999,
          background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
        }}>
          {REACTION_SET.map((emoji) => (
            <button key={emoji} onClick={() => react(emoji)} style={{
              cursor: "pointer", background: emoji === mine ? tint(TEAL, "22") : "none",
              border: "none", borderRadius: 999, padding: "4px 6px", fontSize: 18, lineHeight: 1,
            }}>{emoji}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A post's poll — tap an option to vote; bars fill once you've voted. */
function PollBlock({ ev }: { ev: FeedEvent }) {
  const [poll, setPoll] = useState<FeedPoll>(ev.poll!);
  const voted = poll.myChoice != null;

  const vote = useCallback(async (idx: number) => {
    if (poll.myChoice === idx) return;
    const prev = poll;
    const options = poll.options.map((o, i) => {
      let v = o.votes;
      if (poll.myChoice === i) v -= 1;
      if (i === idx) v += 1;
      return { ...o, votes: v };
    });
    const total = poll.total + (poll.myChoice == null ? 1 : 0);
    setPoll({ ...poll, options, myChoice: idx, total });
    try {
      const r = await fetch("/api/fantasy/feed/poll/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: ev.id, optionIndex: idx }) });
      if (r.status === 401) { window.location.href = "/auth/sign-in?next=/fantasy/social"; return; }
      if (!r.ok) setPoll(prev);
    } catch { setPoll(prev); }
  }, [poll, ev.id]);

  return (
    <div style={{ marginTop: 12 }}>
      {poll.question && <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 8 }}>{poll.question}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {poll.options.map((o, i) => {
          const pct = poll.total > 0 ? Math.round((o.votes / poll.total) * 100) : 0;
          const mine = poll.myChoice === i;
          return (
            <button key={i} onClick={() => vote(i)} style={{
              position: "relative", overflow: "hidden", textAlign: "left", cursor: voted ? "default" : "pointer", width: "100%",
              padding: "9px 12px", borderRadius: 10, background: PANEL_2, border: `1px solid ${mine ? tint(TEAL, "66") : LINE}`,
            }}>
              {voted && <div aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: mine ? tint(TEAL, "2a") : "rgba(255,255,255,0.05)" }} />}
              <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: mine ? TEAL : INK }}>{o.text}</span>
                {voted && <span style={{ fontSize: 13, fontWeight: 700, color: mine ? TEAL : MUTED }}>{pct}%</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>{poll.total} vote{poll.total === 1 ? "" : "s"}{voted ? "" : " · tap to vote"}</div>
    </div>
  );
}

/** The ⋯ overflow on every card — Twitter grammar: share lives here (and stays
 *  inline too), plus copy link, the profile, and the league invite. */
function CardMenu({ ev, onShare, onInvite, shareUrl }: {
  ev: FeedEvent; onShare: () => void; onInvite: () => void; shareUrl: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  const item = (label: string, emoji: string, fn: () => void) => (
    <button key={label} onClick={() => { setMenuOpen(false); fn(); }} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
      background: "none", border: "none", padding: "10px 14px", fontSize: 13.5, fontWeight: 600, color: INK, whiteSpace: "nowrap",
    }}><span aria-hidden style={{ fontSize: 15 }}>{emoji}</span>{label}</button>
  );
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setMenuOpen((o) => !o)} aria-label="More" style={{
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: 30, height: 30, borderRadius: 999, background: menuOpen ? PANEL_2 : "none",
        border: "none", color: MUTED, fontSize: 17, letterSpacing: "0.08em", lineHeight: 1,
      }}>···</button>
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 8 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 9, minWidth: 190,
            borderRadius: 12, background: PANEL, border: `1px solid ${LINE}`, boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            padding: "4px 0", overflow: "hidden",
          }}>
            {item("Share post", "↗", onShare)}
            {item(copied ? "Link copied" : "Copy link", "🔗", () => {
              navigator.clipboard?.writeText(shareUrl).catch(() => {});
              setCopied(true); setTimeout(() => setCopied(false), 1600);
            })}
            {item(`View ${ev.actorName}`, "👤", () => router.push(`/profile/${ev.actorId}`))}
            {item("Invite to a league", "＋", onInvite)}
          </div>
        </>
      )}
    </div>
  );
}

function FeedCard({ ev, signInNext }: { ev: FeedEvent; signInNext: string }) {
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const hasBoard = !!(ev.board && ev.board.xi.length > 0);
  const canShare = hasBoard || (!!ev.player && ev.playerId != null);
  const crestUrl = ev.actorClub ? getTeamBadgeUrlSync(ev.actorClub) : null;
  // Where a shared post points: a squad → the manager's XI, a player → that
  // player, anything else → the live feed. Plus a one-line lead for the share.
  const origin = typeof window !== "undefined" ? window.location.origin : "https://yourscore.app";
  const shareUrl = hasBoard ? `${origin}/profile/${ev.actorId}#fantasy-xi`
    : (ev.player && ev.playerId != null) ? `${origin}/fantasy/players/${ev.playerId}`
    : `${origin}/fantasy/social`;
  const shareText = ev.type === "post" && ev.text ? ev.text.slice(0, 140)
    : hasBoard ? `${ev.actorName}'s Fantasy XI on YourScore`
    : `${ev.actorName} on YourScore Fantasy`;
  const leagueBody = canShare
    ? () => (hasBoard ? { kind: "squad", ofUserId: ev.actorId } : { kind: "player", playerId: ev.playerId })
    : undefined;

  return (
    <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 12, marginBottom: 10 }}>
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
        <CardMenu ev={ev} shareUrl={shareUrl} onShare={() => setShareOpen(true)} onInvite={() => setInviteOpen(true)} />
      </div>

      {/* A user post: the text (links tappable), an image, then a poll if any. */}
      {ev.type === "post" && ev.text && (
        <div style={{ fontSize: 14.5, color: INK, lineHeight: 1.45, marginTop: 10, whiteSpace: "pre-wrap", wordBreak: "break-word" }}><LinkedText text={ev.text} /></div>
      )}
      {ev.type === "post" && ev.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ev.image} alt="" loading="lazy"
          style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "cover", borderRadius: 12, marginTop: 10, border: `1px solid ${LINE}` }} />
      )}
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

      {/* Squad tiles render the real tactical PITCH (founder, 3 Aug — a row of faces
          isn't useful; we need to see the team in formation). Tap opens the
          manager's full squad (back retraces feed → profile → player). */}
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

      {/* Shortlist / squad-update tiles show the one player. */}
      {ev.player && (
        ev.playerId != null ? (
          <Link href={`/fantasy/players/${ev.playerId}`}
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

      {/* Primary sequence (spec): React · Comment · Share. Invite moved into the
          ⋯ menu (4 Aug) so the row breathes like a tweet's. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, paddingLeft: 2, flexWrap: "wrap" }}>
        <ReactionBar ev={ev} />
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: open ? TEAL : MUTED, fontSize: 13, fontWeight: 600 }}>
          {/* Silhouette, not emoji (founder, 4 Aug) — the Twitter-style outline bubble. */}
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
          {ev.commentCount > 0 ? ev.commentCount : "Comment"}
        </button>
        <button onClick={() => setShareOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>↗</span>Share
        </button>
      </div>

      {/* One share sheet per card, opened from the inline Share OR the ⋯ menu. */}
      <SharePost url={shareUrl} text={shareText} leagueBody={leagueBody}
        open={shareOpen} onClose={() => setShareOpen(false)} />

      {open && (
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
  controlledScope, controlledSort, chrome = true, emptyFollowing,
}: {
  embedded?: boolean; signInNext?: string;
  /** When the parent owns the scope/sort (the Social tabs), FeedStream renders
   *  no scope/sort chrome of its own and does not auto-flip an empty Following
   *  feed to Global — the caller's empty state takes over instead. */
  controlledScope?: FeedScope; controlledSort?: FeedSort;
  chrome?: boolean; emptyFollowing?: ReactNode;
}) {
  const router = useRouter();
  const controlled = controlledScope != null;
  const [scopeState, setScope] = useState<FeedScope>(controlledScope ?? "following");
  const [sortState, setSort] = useState<FeedSort>(controlledSort ?? "recent");
  const scope = controlledScope ?? scopeState;
  const sort = controlledSort ?? sortState;
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

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
      const d = res.ok ? await res.json() : { events: [], followingCount: 0 };
      setFollowingCount(d.followingCount ?? 0);
      if (!controlled && (d.followingCount ?? 0) === 0 && scope === "following") { setScope("global"); return {}; }
      const next: FeedEvent[] = d.events ?? [];
      const updated = next[0]?.id !== events?.[0]?.id || next.length !== (events?.length ?? -1);
      setEvents(next);
      return { updated };
    } catch {
      if (!silent) setEvents([]);
      return {};
    }
  }, [scope, sort, events, controlled]);

  useEffect(() => {
    if (!embedded && !controlled && typeof window !== "undefined") {
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
        if (!controlled && (d.followingCount ?? 0) === 0 && scope === "following") { setScope("global"); return; }
        setEvents(d.events ?? []);
      })
      .catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, sort, embedded, controlled]);

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
                }}>{s === "recent" ? "Recent" : "Top"}</button>
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

        {events?.map((ev) => <FeedCard key={ev.id} ev={ev} signInNext={signInNext} />)}
      </PullToRefresh>
    </div>
  );
}
