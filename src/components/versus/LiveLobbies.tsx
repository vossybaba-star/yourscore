"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";

// Live quiz lobbies, self-contained for the Versus hub: create a game, join by
// code, or jump into an open public lobby. The lobby itself still plays at
// /play/[id]; this is the entry surface (moved out of the Quiz tab).

interface OpenRoom { id: string; name: string | null; code: string; question_count: number | null; _member_count: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function joinErrorMessage(err: string): string {
  const e = err.toLowerCase();
  if (e.includes("not found") || e.includes("invalid")) return "That code isn't valid — double-check it.";
  if (e.includes("full")) return "This lobby is full.";
  if (e.includes("started") || e.includes("progress")) return "This lobby has already started.";
  if (e.includes("expired") || e.includes("ended")) return "This lobby no longer exists.";
  return "Couldn't join — try again.";
}

export function LiveLobbies() {
  const { user } = useUser();
  const router = useRouter();
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) { setRooms([]); return; }
    const sb = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = sb as any;
    const fresh = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    db.from("rooms")
      .select("id, name, code, question_count, created_at")
      .eq("type", "player").eq("status", "lobby").eq("room_mode", "open")
      .gte("created_at", fresh).order("created_at", { ascending: false }).limit(20)
      .then(async ({ data }: { data: Row[] | null }) => {
        const list = data ?? [];
        const withCounts = await Promise.all(list.map(async (r) => {
          const { count } = await db.from("room_members").select("*", { count: "exact", head: true }).eq("room_id", r.id);
          return { id: r.id, name: r.name, code: r.code, question_count: r.question_count, _member_count: count ?? 0 };
        }));
        setRooms(withCounts);
      });
  }, []);

  useEffect(() => { if (joinOpen) setTimeout(() => inputRef.current?.focus(), 120); else { setCode(""); setError(""); } }, [joinOpen]);

  async function join(c: string) {
    const clean = c.trim().toUpperCase();
    if (clean.length < 4) return;
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(`/play?join=${clean}`)}`); return; }
    setJoining(true); setError("");
    try {
      const res = await fetch("/api/room/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: clean }) });
      const data = await res.json();
      if (!res.ok) { setError(joinErrorMessage(data.error ?? "")); setJoining(false); return; }
      setJoinOpen(false);
      router.push(`/play/${data.room.id}`);
    } catch { setError("Network error"); setJoining(false); }
  }

  return (
    <>
      <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2" style={{ color: "#586058" }}>Play live now</p>

      <div className="grid grid-cols-2 gap-2.5">
        <Link href="/play/new" className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 active:scale-[0.98] transition-transform"
          style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.3)" }}>
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none"><path d="M10 2v16M2 10h16" stroke="#00d8c0" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <p className="font-display text-sm tracking-wide" style={{ color: "#00d8c0" }}>Create a game</p>
        </Link>
        <button onClick={() => setJoinOpen(true)} className="flex flex-col items-center justify-center gap-2 rounded-2xl py-5 active:scale-[0.98] transition-transform"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none"><path d="M2 10h12M10 4l6 6-6 6" stroke="#9aa39d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p className="font-display text-sm tracking-wide text-white">Join with code</p>
        </button>
      </div>

      {rooms && rooms.length > 0 && (
        <>
          <p className="font-body text-xs font-bold uppercase tracking-widest mt-5 mb-2" style={{ color: "#586058" }}>Open lobbies</p>
          <div className="space-y-2">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => join(r.code)} disabled={joining} className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface active:scale-[0.99] transition-transform disabled:opacity-60" style={{ border: "1px solid rgba(174,234,0,0.25)" }}>
                <span className="font-body text-[10px] uppercase tracking-wide px-2 py-1 rounded-md flex-shrink-0" style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>Public</span>
                <div className="flex-1 min-w-0 text-left">
                  <p className="font-body text-sm font-semibold text-white truncate">{r.name || "Open lobby"}</p>
                  <p className="font-body text-xs text-text-muted">{r._member_count} in · {r.question_count ?? "?"} questions</p>
                </div>
                <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>Join</span>
              </button>
            ))}
          </div>
        </>
      )}

      {joinOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setJoinOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl px-5 pt-3" style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />
            <p className="font-display text-lg text-white mb-1">Join a game</p>
            <p className="font-body text-xs text-text-muted mb-4">Enter the invite code from a friend.</p>
            <form onSubmit={(e) => { e.preventDefault(); void join(code); }}>
              <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} placeholder="CODE"
                className="w-full rounded-2xl px-4 py-4 font-display text-2xl tracking-[0.3em] text-center text-white outline-none" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" }} />
              {error && <p className="font-body text-xs mt-2 text-center" style={{ color: "#ff8a3d" }}>{error}</p>}
              <button type="submit" disabled={joining || code.trim().length < 4} className="w-full mt-3 rounded-2xl py-4 font-display tracking-wide disabled:opacity-50" style={{ background: "#00d8c0", color: "#04231f", fontSize: 17 }}>
                {joining ? "Joining…" : "Join →"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
