"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Post-result entry for a GROUP challenge: the player just finished a quiz, so
// their score seeds the board (creator-plays-first). They pick friends to invite
// (or none, for an open/link board) and we create it server-side, then drop them
// on the board to share. Mirrors ChallengeAFriendButton's 1v1 path.

interface Friend { user_id: string; display_name: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

interface Props {
  packId: string;
  packName: string;
  totalQuestions: number;
  maxScore: number;
  score: number;
  correctCount: number;
}

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }

export function GroupChallengeButton({ packId, packName, totalQuestions, maxScore, score, correctCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  async function openSheet() {
    setOpen(true);
    if (friends) return;
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setFriends([]); return; }
    const db = sb as Row;
    const { data: rows } = await db.from("friendships").select("user_id, friend_id, status")
      .or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    const ids = ((rows ?? []) as Row[]).filter((r: Row) => r.status === "accepted")
      .map((r: Row) => (r.user_id === uid ? r.friend_id : r.user_id)).filter(Boolean);
    if (ids.length === 0) { setFriends([]); return; }
    const { data: profs } = await db.from("profiles").select("id, display_name").in("id", ids);
    setFriends(((profs ?? []) as Row[]).map((p: Row) => ({ user_id: p.id, display_name: p.display_name ?? "Player" })));
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/challenge/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizPackId: packId, quizPackName: packName, totalQuestions, maxScore,
          myScore: score, myCorrect: correctCount, invitedUserIds: Array.from(picked),
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) { router.push(`/g/${data.id}`); return; }
    } catch { /* fall through */ }
    setCreating(false);
  }

  return (
    <>
      <button
        onClick={openSheet}
        className="w-full rounded-2xl py-3.5 font-display tracking-widest text-sm active:scale-[0.98] transition-transform"
        style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.35)", color: "#00d8c0" }}
      >
        CHALLENGE A GROUP →
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => !creating && setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl px-5 pt-3" style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />
            <p className="font-display text-lg text-white">Start a group board</p>
            <p className="font-body text-xs text-text-muted mt-1 mb-4">Your {score.toLocaleString()} starts it off. Invite friends, or just create it and share the link.</p>

            {friends === null ? (
              <p className="font-body text-sm text-text-muted py-6 text-center">Loading friends…</p>
            ) : friends.length === 0 ? (
              <p className="font-body text-sm text-text-muted py-4 text-center">No friends yet — create the board and share the link.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5 mb-2">
                {friends.map((f) => {
                  const on = picked.has(f.user_id);
                  return (
                    <button key={f.user_id} onClick={() => toggle(f.user_id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
                      style={{ background: on ? "rgba(0,216,192,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${on ? "rgba(0,216,192,0.4)" : "rgba(255,255,255,0.08)"}` }}>
                      <span className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe6" }}>{initial(f.display_name)}</span>
                      <span className="flex-1 text-left font-body text-sm text-white truncate">{f.display_name}</span>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ border: `1.5px solid ${on ? "#00d8c0" : "rgba(255,255,255,0.25)"}`, background: on ? "#00d8c0" : "transparent" }}>
                        {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke="#04231f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button onClick={create} disabled={creating}
              className="w-full mt-3 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform disabled:opacity-60"
              style={{ background: "#00d8c0", color: "#04231f", fontSize: 17 }}>
              {creating ? "Creating…" : picked.size > 0 ? `Create board · invite ${picked.size}` : "Create board"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
