"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { mentionQueryAt, applyMention, MentionDropdown, type MentionUser, type MentionEntity } from "@/components/fantasy/MentionAutocomplete";
import { trackReplyCreated, trackMentionAutocompleteOpened, trackMentionSelected, trackMentionPublished } from "@/lib/analytics/trackSocial";

// Two-level (IG-style) discussion thread per subject (quiz pack or debate).
// Top-level: newest first. Replies: oldest first within a parent, collapsed
// beyond 2 ("View N more replies"). Reads are public; posting needs an
// account. Replying is auth-gated only — NOT gated on canPost (founder call:
// you can join a reply thread without having voted on the debate itself).

const MAX_COLLAPSED_REPLIES = 2;

interface CommentRow {
  id: string;
  parentId: string | null;
  userId: string;
  name: string;
  avatarUrl: string | null;
  club: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  deleted?: boolean;
}

function timeAgo(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function DiscussionThread({
  subjectType,
  subjectId,
  title = "The discussion",
  accent = "#00d8c0",
  signInNext = "/versus",
  canPost = true,
  lockedHint = "Have your say once you've voted",
  embedded = false,
  focusCommentId = null,
}: {
  subjectType: "pack" | "debate" | "fantasy_feed";
  subjectId: string;
  title?: string;
  accent?: string;
  signInNext?: string;
  /** false = read-only TOP-LEVEL composer. Everyone still READS the thread;
   * posting a top-level comment is what's gated (on the debate card, by
   * having voted first). Replying is a separate, auth-only gate — see
   * startReply — a signed-in user who hasn't voted can still reply. */
  canPost?: boolean;
  /** Placeholder shown in place of the top-level composer prompt when
   * `canPost` is false. */
  lockedHint?: string;
  /** Render as a section INSIDE a parent card (no own frame, just a divider)
   * rather than as its own standalone card. */
  embedded?: boolean;
  /** Deep-link target (from a push tap or the inbox): once the first `load()`
   * lands, find this comment, auto-expand its parent if it's a collapsed
   * reply, scroll it into view, and briefly highlight it. Not found in the
   * fetched page (pruned/deleted/beyond the 50) → silent no-op. */
  focusCommentId?: string | null;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  // Real @username -> userId, resolved server-side for THIS page's comment
  // bodies (Phase 3b, AC3) — an unresolved handle just isn't in here and
  // renders as plain text. Same batch-resolve shape as the feed's own
  // hydrateEvents, just returned alongside /api/comments' normal payload
  // rather than duplicated per comment.
  const [mentionedUsers, setMentionedUsers] = useState<Map<string, string>>(new Map());
  // @mention autocomplete caret tracking — one for the top-level composer,
  // one for whichever reply box is open (only one is ever open at a time).
  const draftRef = useRef<HTMLInputElement>(null);
  const [draftCaret, setDraftCaret] = useState(0);
  const replyRef = useRef<HTMLInputElement>(null);
  const [replyCaret, setReplyCaret] = useState(0);
  // Structured mention entities picked from either composer (Phase 1A) —
  // sent alongside the plain text; the server validates against the final
  // body before trusting any of it. Two separate lists, same reason there
  // are two carets — the top-level and reply composers are independent.
  const [draftMentions, setDraftMentions] = useState<MentionEntity[]>([]);
  const [replyMentions, setReplyMentions] = useState<MentionEntity[]>([]);
  // mention_autocomplete_opened (Phase 1A) fires once per open, not once per
  // keystroke while a query stays active — one open-guard ref per composer.
  const draftMentionOpenRef = useRef(false);
  const replyMentionOpenRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusedRef = useRef(false);
  /** Latest comments, readable from the deep-link effect without making that
   *  effect depend on (and re-run for) every comments change. */
  const commentsRef = useRef<CommentRow[]>([]);

  // Per-parent collapse state and the single open inline reply composer.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyPosting, setReplyPosting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // mention_autocomplete_opened (Phase 1A) — fires once per open (transition
  // from no active query to one), not once per keystroke while it stays
  // open. One query/effect pair per composer, mirrored below.
  const draftMentionQuery = mentionQueryAt(draft, draftCaret);
  useEffect(() => {
    if (draftMentionQuery && !draftMentionOpenRef.current) { draftMentionOpenRef.current = true; trackMentionAutocompleteOpened("comment"); }
    if (!draftMentionQuery) draftMentionOpenRef.current = false;
  }, [draftMentionQuery]);
  const replyMentionQuery = mentionQueryAt(replyDraft, replyCaret);
  useEffect(() => {
    if (replyMentionQuery && !replyMentionOpenRef.current) { replyMentionOpenRef.current = true; trackMentionAutocompleteOpened("reply"); }
    if (!replyMentionQuery) replyMentionOpenRef.current = false;
  }, [replyMentionQuery]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?type=${subjectType}&id=${subjectId}`).catch(() => null);
    if (!res?.ok) return;
    const body = await res.json();
    setComments(body.comments ?? []);
    setTotal(body.total ?? 0);
    setMentionedUsers(new Map(
      ((body.mentionedUsers ?? []) as { username: string; userId: string }[]).map((m) => [m.username.toLowerCase(), m.userId]),
    ));
    setThreadLoaded(true);
  }, [subjectType, subjectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  // Deep-link focus (push tap or inbox row): runs once, after the first
  // successful load. Not found in the fetched page (beyond the 50, or
  // deleted+pruned) → silent no-op, no scroll, no error.
  //
  // `comments` is deliberately NOT a dep and is read through a ref. It used to
  // be one, and that silently killed the whole feature: any second load or
  // optimistic update landing inside the 400ms window re-ran this effect, the
  // cleanup cleared the pending timer, and the already-set guard then blocked
  // any reschedule — so no scroll and no highlight, ever. React StrictMode's
  // double-invoked effects made that the normal case in dev.
  useEffect(() => {
    if (!threadLoaded || !focusCommentId || focusedRef.current) return;
    const target = commentsRef.current.find((c) => c.id === focusCommentId);
    if (!target) {
      focusedRef.current = true; // genuinely absent: don't keep re-looking
      return;
    }
    focusedRef.current = true;
    if (target.parentId) {
      setExpanded((prev) => new Set(prev).add(target.parentId as string));
    }
    let clearHighlight: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      document.getElementById(`comment-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(target.id);
      clearHighlight = setTimeout(() => setHighlightId(null), 2000);
    }, 400);
    return () => { clearTimeout(t); if (clearHighlight) clearTimeout(clearHighlight); };
  }, [threadLoaded, focusCommentId]);

  const topLevel = useMemo(() => comments.filter((c) => c.parentId === null), [comments]);
  /** The viewer's own club, learned from any comment of theirs already in the
   *  thread — so an optimistic row carries the right crest with no extra
   *  request. Null until one exists (crest then appears on the next load). */
  const myClub = useMemo(
    () => (user ? comments.find((c) => c.userId === user.id && c.club)?.club ?? null : null),
    [comments, user],
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, CommentRow[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [comments]);

  async function post() {
    const body = draft.trim();
    if (!body || posting || !canPost) return;
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(signInNext)}`); return; }
    setPosting(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, body, mentions: draftMentions.length ? draftMentions : undefined }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not post"); return; }
      // reply_created (Phase 5b, AC4) — a Social feed comment specifically;
      // this component also backs pack/debate discussions, which aren't
      // in scope for the Social event set.
      if (subjectType === "fantasy_feed") trackReplyCreated();
      if (draftMentions.length) trackMentionPublished("comment", draftMentions.length);
      setDraft(""); setDraftMentions([]);
      setComments((prev) => [
        { id: out.id, parentId: null, userId: user.id, name: user.user_metadata?.display_name ?? "You", avatarUrl: user.user_metadata?.avatar_url ?? null, club: myClub, body, createdAt: out.createdAt, likeCount: 0, likedByMe: false },
        ...prev,
      ]);
      setTotal((t) => t + 1);
    } finally {
      setPosting(false);
    }
  }

  /** Reply is auth-gated only — never gated on `canPost`. A signed-in user
   * who hasn't voted (canPost === false) can still open this and reply,
   * even though the top-level composer above stays locked. */
  function startReply(parentId: string) {
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(signInNext)}`); return; }
    setReplyingTo((cur) => (cur === parentId ? null : parentId));
    setReplyDraft(""); setReplyMentions([]);
    setReplyError(null);
  }

  async function postReply(parentId: string) {
    const body = replyDraft.trim();
    if (!body || replyPosting || !user) return;
    setReplyPosting(true);
    setReplyError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType, subjectId, body, parentId, mentions: replyMentions.length ? replyMentions : undefined }),
      });
      const out = await res.json();
      if (!res.ok) { setReplyError(out.error ?? "Could not post"); return; }
      if (subjectType === "fantasy_feed") trackReplyCreated();
      if (replyMentions.length) trackMentionPublished("reply", replyMentions.length);
      setComments((prev) => [
        ...prev,
        { id: out.id, parentId, userId: user.id, name: user.user_metadata?.display_name ?? "You", avatarUrl: user.user_metadata?.avatar_url ?? null, club: myClub, body, createdAt: out.createdAt, likeCount: 0, likedByMe: false },
      ]);
      setTotal((t) => t + 1);
      // Your own reply is always visible, even if the parent already had 2+
      // collapsed replies.
      setExpanded((prev) => new Set(prev).add(parentId));
      setReplyDraft(""); setReplyMentions([]);
      setReplyingTo(null);
    } finally {
      setReplyPosting(false);
    }
  }

  async function remove(id: string) {
    // Confirm before delete (Social Phase 5a, AC5) — this can't be undone.
    if (!window.confirm("Delete this comment? This can't be undone.")) return;
    // Mirror the server's prune-vs-tombstone rule optimistically. Dropping the
    // row outright would orphan its replies — they'd stay in state but never
    // render (rendering walks top-level), so the whole sub-thread would appear
    // to vanish until a reload brought it back as a tombstone.
    setComments((prev) => {
      const hasLiveReplies = prev.some((c) => c.parentId === id);
      if (!hasLiveReplies) return prev.filter((c) => c.id !== id);
      return prev.map((c) =>
        c.id === id
          ? { ...c, deleted: true, userId: "", name: "", avatarUrl: null, club: null, body: "", likeCount: 0, likedByMe: false }
          : c,
      );
    });
    setTotal((t) => Math.max(0, t - 1));
    await fetch("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function toggleLike(c: CommentRow) {
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(signInNext)}`); return; }
    setComments((prev) => prev.map((x) => x.id === c.id ? { ...x, likedByMe: !x.likedByMe, likeCount: x.likeCount + (x.likedByMe ? -1 : 1) } : x));
    const res = await fetch("/api/comments/like", {
      method: c.likedByMe ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentId: c.id }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setComments((prev) => prev.map((x) => x.id === c.id ? { ...x, likedByMe: !x.likedByMe, likeCount: x.likeCount + (x.likedByMe ? -1 : 1) } : x));
    }
  }

  function toggleExpanded(parentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId); else next.add(parentId);
      return next;
    });
  }

  /** A comment body with any @username token that resolved to a real profile
   *  (mentionedUsers, set server-side by load()) turned into a link to that
   *  profile. An unresolved handle (typo, or no such user) stays plain text. */
  function renderMentionBody(body: string) {
    const parts = body.split(/(@[a-zA-Z0-9_]{2,30})/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const uid = mentionedUsers.get(part.slice(1).toLowerCase());
        if (uid) {
          return (
            <Link key={i} href={`/profile/${uid}`} onClick={(e) => e.stopPropagation()}
              className="font-body text-sm font-bold" style={{ color: accent, textDecoration: "none" }}>
              {part}
            </Link>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  }

  function renderCommentBody(c: CommentRow, opts: { onReply?: () => void; indent?: boolean } = {}) {
    return (
      <div
        key={c.id}
        id={`comment-${c.id}`}
        className="flex items-start gap-2.5 rounded-lg -mx-1.5 px-1.5 py-1"
        style={{
          background: highlightId === c.id ? "rgba(174,234,0,0.10)" : "transparent",
          transition: "background-color 1s ease",
        }}
      >
        <Link href={`/profile/${c.userId}`} className="flex-shrink-0 mt-0.5">
          <PlayerAvatar seed={c.userId} name={c.name} avatarUrl={c.avatarUrl} size={opts.indent ? 24 : 28} ring="rgba(255,255,255,0.12)" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <Link href={`/profile/${c.userId}`} className="font-body text-xs font-bold text-white truncate">{c.name}</Link>
            {c.club && <Crest club={c.club} size={13} />}
            <span className="font-body text-[10px] flex-shrink-0" style={{ color: "#586058" }}>{timeAgo(c.createdAt)}</span>
            {user?.id === c.userId && (
              <button onClick={() => remove(c.id)} className="font-body text-[10px] ml-auto flex-shrink-0" style={{ color: "#586058" }}>
                delete
              </button>
            )}
          </div>
          <p className="font-body text-sm text-text-muted leading-snug break-words">{renderMentionBody(c.body)}</p>
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={() => toggleLike(c)}
              aria-label={c.likedByMe ? "Unlike" : "Like"}
              className="flex items-center gap-1 active:scale-[0.97] transition-transform"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={c.likedByMe ? accent : "none"} stroke={c.likedByMe ? accent : "#586058"} strokeWidth="2">
                <path d="M12 21s-6.716-4.35-9.428-8.06C.9 10.42 1.2 6.9 4.05 5.25c2.4-1.39 4.9-.62 6.35 1.2.5.62.9 1.3 1.6 1.3s1.1-.68 1.6-1.3c1.45-1.82 3.95-2.59 6.35-1.2 2.85 1.65 3.15 5.17 1.48 7.69C18.716 16.65 12 21 12 21z" />
              </svg>
              {c.likeCount > 0 && (
                <span className="font-body text-[10px]" style={{ color: c.likedByMe ? accent : "#586058" }}>{c.likeCount}</span>
              )}
            </button>
            {opts.onReply && (
              <button onClick={opts.onReply} className="font-body text-[10px] font-bold" style={{ color: "#586058" }}>
                Reply
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderTombstone(c: CommentRow) {
    return (
      <div
        key={c.id}
        id={`comment-${c.id}`}
        className="flex items-start gap-2.5 rounded-lg -mx-1.5 px-1.5 py-1"
        style={{
          background: highlightId === c.id ? "rgba(174,234,0,0.10)" : "transparent",
          transition: "background-color 1s ease",
        }}
      >
        <span className="flex-shrink-0 mt-0.5" style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-body text-xs italic" style={{ color: "#586058" }}>Comment deleted</p>
        </div>
      </div>
    );
  }

  function renderReplyComposer(parentId: string) {
    const trackReplyCaret = (e: React.SyntheticEvent<HTMLInputElement>) => setReplyCaret(e.currentTarget.selectionStart ?? 0);
    const pickReplyMention = (user: MentionUser) => {
      const next = applyMention(replyDraft, replyCaret, user.username);
      setReplyDraft(next.text.slice(0, 280));
      setReplyCaret(next.caret);
      setReplyMentions((prev) => [...prev, { userId: user.userId, usernameSnapshot: user.username }]);
      trackMentionSelected("reply");
      requestAnimationFrame(() => { replyRef.current?.focus(); replyRef.current?.setSelectionRange(next.caret, next.caret); });
    };
    return (
      <div className="pl-[38px] pt-1">
        <div className="flex gap-2">
          <input
            ref={replyRef}
            value={replyDraft}
            onChange={(e) => { setReplyDraft(e.target.value.slice(0, 280)); trackReplyCaret(e); }}
            onKeyUp={trackReplyCaret} onClick={trackReplyCaret}
            onKeyDown={(e) => { if (e.key === "Enter") postReply(parentId); }}
            placeholder="Reply…"
            autoFocus
            className="flex-1 min-w-0 rounded-xl px-3 py-2 font-body text-sm text-white placeholder:text-[#586058] outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <button
            onClick={() => postReply(parentId)}
            disabled={replyPosting || !replyDraft.trim()}
            className="rounded-xl px-3 font-display text-[11px] tracking-wide active:scale-[0.97] transition-transform disabled:opacity-40"
            style={{ background: accent, color: "#04231f" }}
          >
            REPLY
          </button>
          <button
            onClick={() => setReplyingTo(null)}
            className="font-body text-[11px] flex-shrink-0"
            style={{ color: "#586058" }}
          >
            Cancel
          </button>
        </div>
        <MentionDropdown query={replyMentionQuery} onSelect={pickReplyMention} />
        {replyError && <p className="font-body text-[11px] mt-1" style={{ color: "#f87171" }}>{replyError}</p>}
      </div>
    );
  }

  return (
    <div
      className={embedded ? "" : "rounded-2xl overflow-hidden"}
      style={embedded
        ? { borderTop: "1px solid rgba(255,255,255,0.08)" }
        : { background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: accent }}>{title}</p>
        <p className="font-body text-[10px]" style={{ color: "#586058" }}>{total > 0 ? `${total} comment${total === 1 ? "" : "s"}` : "Start it off"}</p>
      </div>

      {/* Thread — comments first (Instagram order), composer pinned below, so a
          new comment never pushes the whole conversation off the screen. */}
      <div className="px-4 pt-2.5 pb-2 space-y-2">
        {topLevel.length === 0 && (
          <p className="font-body text-xs text-text-muted py-2">No comments yet. Someone has to have an opinion.</p>
        )}
        {topLevel.map((c) => {
          const replies = repliesByParent.get(c.id) ?? [];
          const isExpanded = expanded.has(c.id);
          const visibleReplies = isExpanded ? replies : replies.slice(0, MAX_COLLAPSED_REPLIES);
          const hiddenCount = replies.length - visibleReplies.length;

          return (
            <div key={c.id} className="space-y-2">
              {c.deleted ? renderTombstone(c) : renderCommentBody(c, { onReply: () => startReply(c.id) })}

              {(visibleReplies.length > 0 || replyingTo === c.id) && (
                <div className="pl-[38px] space-y-2">
                  {/* No Reply affordance under a tombstone: the parent is
                      soft-deleted, so the server rejects any reply to it
                      (400) — offering the button would be a dead end. */}
                  {visibleReplies.map((r) => renderCommentBody(r, {
                    onReply: c.deleted ? undefined : () => startReply(c.id),
                    indent: true,
                  }))}
                  {!isExpanded && hiddenCount > 0 && (
                    <button
                      onClick={() => toggleExpanded(c.id)}
                      className="font-body text-[11px] font-bold"
                      style={{ color: "#586058" }}
                    >
                      View {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
                    </button>
                  )}
                </div>
              )}

              {replyingTo === c.id && renderReplyComposer(c.id)}
            </div>
          );
        })}
      </div>

      {/* Composer at the bottom (Instagram-style): a single compact line, so it
          stays out of the way and posting keeps the thread in view. */}
      <div className="px-4 pt-2 pb-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex gap-2">
          <input
            ref={draftRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value.slice(0, 280)); setDraftCaret(e.currentTarget.selectionStart ?? 0); }}
            onKeyUp={(e) => setDraftCaret(e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => setDraftCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => { if (e.key === "Enter") post(); }}
            disabled={!canPost}
            placeholder={!canPost ? lockedHint : user ? "Add a comment…" : "Sign in to join in…"}
            className="flex-1 min-w-0 rounded-full px-4 py-2 font-body text-sm text-white placeholder:text-[#586058] outline-none disabled:opacity-60"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <button
            onClick={post}
            disabled={posting || !canPost || !draft.trim()}
            className="rounded-full px-4 font-display text-[12px] tracking-wide active:scale-[0.97] transition-transform disabled:opacity-40"
            style={{ background: accent, color: "#04231f" }}
          >
            POST
          </button>
        </div>
        {canPost && (
          <MentionDropdown query={draftMentionQuery} onSelect={(u) => {
            const next = applyMention(draft, draftCaret, u.username);
            setDraft(next.text.slice(0, 280));
            setDraftCaret(next.caret);
            setDraftMentions((prev) => [...prev, { userId: u.userId, usernameSnapshot: u.username }]);
            trackMentionSelected("comment");
            requestAnimationFrame(() => { draftRef.current?.focus(); draftRef.current?.setSelectionRange(next.caret, next.caret); });
          }} />
        )}
        {(error || draft.length > 200) && (
          <div className="flex items-center justify-between mt-1">
            {error ? <p className="font-body text-[11px]" style={{ color: "#f87171" }}>{error}</p> : <span />}
            {draft.length > 200 && <p className="font-body text-[10px]" style={{ color: "#586058" }}>{280 - draft.length}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
