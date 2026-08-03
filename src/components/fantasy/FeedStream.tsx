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
import { ShareToLeague } from "@/components/fantasy/league/ShareToLeague";
import { FollowButton } from "@/components/social/FollowButton";
import { AvatarLightbox } from "@/components/ui/AvatarLightbox";

// Kept in sync with FEED_REACTIONS in lib/fantasy/feed.ts (that module is
// server-only, so the set is duplicated here for the client).
const REACTION_SET = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;

type FeedScope = "following" | "global";
type FeedSort = "recent" | "top";
interface FeedFace { name: string; avatarUrl: string | null; captain?: boolean }
interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }
interface FeedReaction { emoji: string; count: number }
interface FeedPoll { question: string; options: { text: string; votes: number }[]; myChoice: number | null; total: number }
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null;
  type: string; gw: number | null; sentence: string; createdAt: string;
  reactions: FeedReaction[]; myEmoji: string | null; commentCount: number;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
  text?: string | null; poll?: FeedPoll | null; image?: string | null;
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

function FeedCard({ ev, signInNext }: { ev: FeedEvent; signInNext: string }) {
  const [open, setOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const hasBoard = !!(ev.board && ev.board.xi.length > 0);
  const canShare = hasBoard || (!!ev.player && ev.playerId != null);

  return (
    <div style={{ borderRadius: 14, background: PANEL, border: `1px solid ${LINE}`, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AvatarLightbox name={ev.actorName} avatarUrl={ev.actorAvatar}>
          <PlayerAvatar name={ev.actorName} avatarUrl={ev.actorAvatar} size={34} />
        </AvatarLightbox>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, color: INK, lineHeight: 1.35 }}>
            <Link href={`/profile/${ev.actorId}`} style={{ color: INK, fontWeight: 700, textDecoration: "none" }}>{ev.actorName}</Link>
            {ev.type !== "post" && <span style={{ color: "#c7d0cb" }}> {ev.sentence}</span>}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{timeAgo(ev.createdAt)}</div>
        </div>
        {/* Follow lives in the header (spec); FollowButton renders nothing on your own posts. */}
        <FollowButton userId={ev.actorId} size="sm" initialFollowing={false} />
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

      {/* Primary sequence (spec): React · Comment · Share to league. Invite the
          manager to a league trails as a lighter action. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, paddingLeft: 2, flexWrap: "wrap" }}>
        <ReactionBar ev={ev} />
        <button onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: open ? TEAL : MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>💬</span>{ev.commentCount > 0 ? ev.commentCount : "Comment"}
        </button>
        {canShare && (
          <ShareToLeague
            buildBody={() => hasBoard ? { kind: "squad", ofUserId: ev.actorId } : { kind: "player", playerId: ev.playerId }}
            trigger={(openShare) => (
              <button onClick={openShare} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: MUTED, fontSize: 13, fontWeight: 600 }}>
                <span style={{ fontSize: 14 }}>↗</span>Share to league
              </button>
            )}
          />
        )}
        <button onClick={() => setInviteOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, color: MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ fontSize: 14 }}>＋</span>Invite
        </button>
      </div>

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
