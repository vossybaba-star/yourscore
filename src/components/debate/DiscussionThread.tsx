"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

// One flat discussion thread per subject (quiz pack or debate). Newest first,
// 280 characters, delete your own. Reads are public; posting needs an account.

interface CommentRow {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
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
}: {
  subjectType: "pack" | "debate";
  subjectId: string;
  title?: string;
  accent?: string;
  signInNext?: string;
  /** false = read-only composer. Everyone still READS the thread; posting is
   * what's gated (on the debate card, by having voted first). */
  canPost?: boolean;
  /** Placeholder shown in place of the composer prompt when `canPost` is false. */
  lockedHint?: string;
  /** Render as a section INSIDE a parent card (no own frame, just a divider)
   * rather than as its own standalone card. */
  embedded?: boolean;
}) {
  const { user } = useUser();
  const router = useRouter();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/comments?type=${subjectType}&id=${subjectId}`).catch(() => null);
    if (!res?.ok) return;
    const body = await res.json();
    setComments(body.comments ?? []);
    setTotal(body.total ?? 0);
  }, [subjectType, subjectId]);

  useEffect(() => { load(); }, [load]);

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
        body: JSON.stringify({ subjectType, subjectId, body }),
      });
      const out = await res.json();
      if (!res.ok) { setError(out.error ?? "Could not post"); return; }
      setDraft("");
      setComments((prev) => [
        { id: out.id, userId: user.id, name: user.user_metadata?.display_name ?? "You", avatarUrl: user.user_metadata?.avatar_url ?? null, body, createdAt: out.createdAt },
        ...prev,
      ]);
      setTotal((t) => t + 1);
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    await fetch("/api/comments", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  return (
    <div
      className={embedded ? "" : "rounded-2xl overflow-hidden"}
      style={embedded
        ? { borderTop: "1px solid rgba(255,255,255,0.08)" }
        : { background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: accent }}>{title}</p>
        <p className="font-body text-[10px]" style={{ color: "#586058" }}>{total > 0 ? `${total} comment${total === 1 ? "" : "s"}` : "Start it off"}</p>
      </div>

      {/* Composer */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 280))}
            onKeyDown={(e) => { if (e.key === "Enter") post(); }}
            disabled={!canPost}
            placeholder={!canPost ? lockedHint : user ? "Say your piece…" : "Sign in to join in…"}
            className="flex-1 min-w-0 rounded-xl px-4 py-3 font-body text-sm text-white placeholder:text-[#586058] outline-none disabled:opacity-60"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <button
            onClick={post}
            disabled={posting || !canPost || !draft.trim()}
            className="rounded-xl px-4 font-display text-[12px] tracking-wide active:scale-[0.97] transition-transform disabled:opacity-40"
            style={{ background: accent, color: "#04231f" }}
          >
            POST
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5 min-h-[16px]">
          {error ? <p className="font-body text-[11px]" style={{ color: "#f87171" }}>{error}</p> : <span />}
          {draft.length > 200 && <p className="font-body text-[10px]" style={{ color: "#586058" }}>{280 - draft.length}</p>}
        </div>
      </div>

      {/* Thread */}
      <div className="px-5 pb-4 space-y-3">
        {comments.length === 0 && (
          <p className="font-body text-xs text-text-muted py-2">No comments yet. Someone has to have an opinion.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2.5">
            <Link href={`/profile/${c.userId}`} className="flex-shrink-0 mt-0.5">
              <PlayerAvatar seed={c.userId} name={c.name} avatarUrl={c.avatarUrl} size={28} ring="rgba(255,255,255,0.12)" />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <Link href={`/profile/${c.userId}`} className="font-body text-xs font-bold text-white truncate">{c.name}</Link>
                <span className="font-body text-[10px] flex-shrink-0" style={{ color: "#586058" }}>{timeAgo(c.createdAt)}</span>
                {user?.id === c.userId && (
                  <button onClick={() => remove(c.id)} className="font-body text-[10px] ml-auto flex-shrink-0" style={{ color: "#586058" }}>
                    delete
                  </button>
                )}
              </div>
              <p className="font-body text-sm text-text-muted leading-snug break-words">{c.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
