"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackPill } from "@/components/ui/BackPill";

// Quiz Battle — quiz-first. Step 1: pick a quiz (unplayed first). Step 2: pick a
// friend + how to play them:
//   • Play live  → creates an h2h room bound to the pack + invites them → both
//     get the same questions at the same time (game-show style).
//   • Send scorecard (only if you've already played it) → async challenge.

const TEAL = "#00d8c0";

interface Pack { id: string; name: string; questionCount: number; cover: string | null; played: boolean }
interface Friend { user_id: string; display_name: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }
function bucket(qc: number) { return qc <= 5 ? 5 : qc <= 10 ? 10 : 20; } // valid room counts

export default function QuizBattlePage() {
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [picked, setPicked] = useState<Pack | null>(null);
  const [preTo, setPreTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<friendId>:live" | "<friendId>:card"
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPreTo(new URLSearchParams(window.location.search).get("to")); }, []);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setPacks([]); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = sb as any;

    const [pkRes, attRes, frRes] = await Promise.all([
      db.from("quiz_packs").select("id, name, question_count, metadata").eq("status", "published").eq("rotation_active", true).order("name"),
      db.from("quiz_attempts").select("pack_id").eq("user_id", uid),
      db.from("friendships").select("user_id, friend_id, status").or(`user_id.eq.${uid},friend_id.eq.${uid}`),
    ]);
    const playedIds = new Set(((attRes.data ?? []) as Row[]).map((r) => r.pack_id));
    const list: Pack[] = ((pkRes.data ?? []) as Row[]).map((p) => ({
      id: p.id, name: p.name, questionCount: p.question_count ?? 0,
      cover: p.metadata?.cover_image ?? null, played: playedIds.has(p.id),
    }));
    list.sort((a, b) => Number(a.played) - Number(b.played)); // unplayed first
    setPacks(list);

    const ids = ((frRes.data ?? []) as Row[]).filter((r) => r.status === "accepted").map((r) => (r.user_id === uid ? r.friend_id : r.user_id)).filter(Boolean);
    if (ids.length) {
      const { data: profs } = await db.from("profiles").select("id, display_name").in("id", ids);
      const fl: Friend[] = ((profs ?? []) as Row[]).map((p) => ({ user_id: p.id, display_name: p.display_name ?? "Player" }));
      fl.sort((a, b) => (a.user_id === preTo ? -1 : 0) - (b.user_id === preTo ? -1 : 0));
      setFriends(fl);
    }
  }, [preTo]);
  useEffect(() => { void load(); }, [load]);

  async function playLive(friend: Friend) {
    if (!picked || busy) return;
    setBusy(`${friend.user_id}:live`); setErr(null);
    try {
      const res = await fetch("/api/room/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_mode: "h2h", pack_id: picked.id, question_count: bucket(picked.questionCount), name: "Quiz Battle" }),
      });
      const data = await res.json();
      if (!res.ok || !data.room?.id) { setErr(data.error ?? "Couldn't start the battle"); setBusy(null); return; }
      void fetch("/api/room/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: data.room.id, invitedUserId: friend.user_id }) });
      router.push(`/play/${data.room.id}`);
    } catch { setErr("Network error"); setBusy(null); }
  }

  async function sendScorecard(friend: Friend) {
    if (!picked || busy) return;
    setBusy(`${friend.user_id}:card`); setErr(null);
    try {
      const res = await fetch("/api/h2h/from-attempt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: picked.id, invitedUserId: friend.user_id }),
      });
      const data = await res.json();
      if (res.ok && data.id) { setSentTo(friend.display_name); return; }
      setErr(data.needsPlay ? "Play this quiz first to send a scorecard — or play live instead." : (data.error ?? "Couldn't send"));
      setBusy(null);
    } catch { setErr("Network error"); setBusy(null); }
  }

  // ── Sent confirmation ──
  if (sentTo) {
    return (
      <div className="min-h-dvh grid place-items-center bg-bg px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.35)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <p className="font-display text-xl text-white">Sent to {sentTo}!</p>
          <p className="font-body text-sm text-text-muted mt-1.5">They&apos;ll get it in their Versus inbox and have to beat your score on {picked?.name}.</p>
          <Link href="/versus" className="inline-block mt-6 rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>Back to Versus →</Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4"><BackPill href="/versus" label="Versus" tone="play" /></div>

        {picked ? (
          /* ── Step 2 — pick a friend + how to play ── */
          <>
            <div className="mt-3">
              <button onClick={() => { setPicked(null); setErr(null); }} className="font-body text-xs text-text-muted mb-2">← pick a different quiz</button>
              <p className="font-display text-2xl text-white leading-tight">Who are you playing?</p>
              <p className="font-body text-sm text-text-muted mt-1">{picked.name} · {picked.questionCount} questions</p>
            </div>

            {err && <p className="font-body text-sm mt-4" style={{ color: "#ff6b78" }}>{err}</p>}

            <div className="mt-4 space-y-2.5">
              {friends.length === 0 ? (
                <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="font-body text-sm text-white">No friends yet</p>
                  <Link href="/versus?view=friends" className="font-body text-xs mt-1 inline-block" style={{ color: TEAL }}>Add some first →</Link>
                </div>
              ) : friends.map((f) => (
                <div key={f.user_id} className="rounded-2xl p-3.5 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe6" }}>{initial(f.display_name)}</span>
                    <span className="flex-1 font-body text-sm font-semibold text-white truncate">{f.display_name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => playLive(f)} disabled={!!busy} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide disabled:opacity-60" style={{ background: TEAL, color: "#04231f" }}>
                      {busy === `${f.user_id}:live` ? "Starting…" : "Play live ▶"}
                    </button>
                    {picked.played && (
                      <button onClick={() => sendScorecard(f)} disabled={!!busy} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide disabled:opacity-60" style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>
                        {busy === `${f.user_id}:card` ? "Sending…" : "Send scorecard"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-body text-xs text-text-muted mt-4 leading-relaxed">
              <span style={{ color: "#cdeee7" }}>Play live</span> — you both get the same questions at the same time.{picked.played ? " " : ""}
              {picked.played && <><span style={{ color: "#cdeee7" }}>Send scorecard</span> — they play whenever and try to beat your score.</>}
            </p>
          </>
        ) : (
          /* ── Step 1 — pick a quiz ── */
          <>
            <div className="mt-3">
              <p className="font-display text-2xl text-white leading-tight">Choose a quiz</p>
              <p className="font-body text-sm text-text-muted mt-1">Pick one, then challenge a friend to it.</p>
            </div>

            {packs === null ? (
              <p className="font-body text-sm text-text-muted mt-6">Loading quizzes…</p>
            ) : packs.length === 0 ? (
              <p className="font-body text-sm text-text-muted mt-6">No quizzes available right now.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {packs.map((p) => (
                  <button key={p.id} onClick={() => setPicked(p)} className="w-full flex items-center gap-3 rounded-2xl p-3 bg-surface active:scale-[0.99] transition-transform" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="w-12 h-12 rounded-xl flex-shrink-0" style={{ background: p.cover ? `center/cover url(${p.cover})` : "rgba(0,216,192,0.12)" }} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-body text-sm font-semibold text-white truncate">{p.name}</p>
                      <p className="font-body text-xs text-text-muted">{p.questionCount} questions</p>
                    </div>
                    <span className="font-body text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md flex-shrink-0" style={{ background: p.played ? "rgba(255,255,255,0.06)" : "rgba(0,216,192,0.15)", color: p.played ? "#8a948f" : TEAL }}>{p.played ? "Played" : "New"}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
