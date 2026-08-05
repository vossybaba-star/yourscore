"use client";
/**
 * @username autocomplete (Social Phase 3b, AC3) — shared by the post composer
 * (CreatePostSheet) and the comment/reply inputs (DiscussionThread). Typing
 * "@" plus 2+ characters queries /api/fantasy/users/search?q=&limit=8;
 * picking a result inserts "@username " and hands the caller back the new
 * text + caret position.
 *
 * Deliberately renders BELOW the field rather than a caret-tracking floating
 * popup — a textarea/input's caret position is fiddly to measure precisely
 * across browsers, and a fixed dropdown under the field is a common, much
 * simpler pattern that still reads clearly for a single-composer-at-a-time UI.
 */
import { useEffect, useState } from "react";
import { INK, LINE, MUTED, PANEL } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

export interface MentionUser { userId: string; username: string; displayName: string; avatarUrl: string | null }

/** The @token immediately before the caret, if any — text back from the
 *  caret to the nearest "@" with no whitespace in between. Null when the
 *  caret isn't inside a mention-shaped token, or the token is under 2
 *  characters (AC3: "after '@' + 2+ chars"). */
export function mentionQueryAt(text: string, caret: number): string | null {
  const upTo = text.slice(0, Math.max(0, caret));
  const at = upTo.lastIndexOf("@");
  if (at === -1) return null;
  const token = upTo.slice(at + 1);
  if (!token || /\s/.test(token) || token.length < 2) return null;
  return token;
}

/** Replace the @token ending at `caret` with "@username " — returns the new
 *  text and where the caret should land afterwards (right after the
 *  trailing space, ready to keep typing). */
export function applyMention(text: string, caret: number, username: string): { text: string; caret: number } {
  const upTo = text.slice(0, caret);
  const at = upTo.lastIndexOf("@");
  if (at === -1) return { text, caret };
  const before = text.slice(0, at);
  const after = text.slice(caret);
  const insert = `@${username} `;
  return { text: before + insert + after, caret: (before + insert).length };
}

/** The dropdown itself — null-renders when there's no active query or no
 *  results, so a caller can mount it unconditionally right under the field. */
export function MentionDropdown({ query, onSelect }: { query: string | null; onSelect: (username: string) => void }) {
  const [users, setUsers] = useState<MentionUser[] | null>(null);

  useEffect(() => {
    if (!query) { setUsers(null); return; }
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/fantasy/users/search?q=${encodeURIComponent(query)}&limit=8`)
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => { if (live) setUsers(d.users ?? []); })
        .catch(() => { if (live) setUsers([]); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  if (!query || !users || users.length === 0) return null;

  return (
    <div style={{ marginTop: 6, borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, overflow: "hidden" }}>
      {users.filter((u) => !!u.username).map((u) => (
        // onMouseDown (not onClick) + preventDefault: a click fires AFTER the
        // field's blur, which would close this dropdown before the selection
        // registers. mousedown fires first, so preventing its default keeps
        // the field focused and the dropdown open through the selection.
        <button key={u.userId} onMouseDown={(e) => { e.preventDefault(); onSelect(u.username); }} style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer",
          background: "none", border: "none", borderBottom: `1px solid ${LINE}`, padding: "8px 10px",
        }}>
          <PlayerAvatar name={u.displayName} avatarUrl={u.avatarUrl} size={24} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {u.displayName}
            </span>
            <span style={{ display: "block", fontSize: 11.5, color: MUTED }}>@{u.username}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
