"use client";

/**
 * /38-0/live — live multiplayer entry. Play a friend (shareable 6-char code) or
 * find a live opponent via the random queue (with a disguised-bot fallback when
 * nobody pairs in time). Needs a signed-in player with a saved team — the API
 * returns "Save a team first" otherwise, which we surface with a build-team link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type QueueResp = { status?: "matched" | "waiting"; match?: { id: string }; error?: string };

// Fall back to a bot quickly when no human is waiting — but jittered (5–8s) so it
// never feels like a fixed timer, and long enough that the "searching" screen reads
// as real matchmaking rather than a dead spinner.
const botFallbackDelay = () => 5_000 + Math.floor(Math.random() * 3_000);
const HARD_TIMEOUT_MS = 30_000; // give up (instead of spinning forever) if nothing resolves

export default function LiveEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "friend" | "finding">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queueStartRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const findGenRef = useRef(0); // generation token: a cancel/restart invalidates in-flight ticks
  const botAfterRef = useRef(0); // jittered moment to drop in a bot if no human pairs

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  async function api(body: Record<string, unknown>): Promise<QueueResp> {
    const res = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.json().catch(() => ({ error: "Request failed" }));
  }

  async function playFriend() {
    setError(null);
    const r = await api({ action: "create" });
    if (r.error || !r.match) { setError(r.error ?? "Couldn't create lobby"); return; }
    setMode("friend");
    setMatchId(r.match.id);
    setCode((r.match as { join_code?: string }).join_code ?? null);
  }

  async function joinByCode() {
    setError(null);
    const r = await api({ action: "join", code: joinCode.trim().toUpperCase() });
    if (r.error || !r.match) { setError(r.error ?? "Couldn't join"); return; }
    router.push(`/38-0/live/match/${r.match.id}`);
  }

  const findMatch = useCallback(async () => {
    setError(null);
    setMode("finding");
    const gen = ++findGenRef.current; // a later cancel/restart bumps this and invalidates us
    queueStartRef.current = Date.now();
    botAfterRef.current = botFallbackDelay();
    const tick = async () => {
      if (findGenRef.current !== gen) { stopPolling(); return; }
      const elapsed = Date.now() - queueStartRef.current;
      const r = await api(elapsed > botAfterRef.current ? { action: "bot" } : { action: "queue" });
      if (findGenRef.current !== gen) return; // cancelled during the request — don't navigate
      if (r.error) { stopPolling(); setError(r.error); setMode("idle"); return; }
      if (r.match) { stopPolling(); router.push(`/38-0/live/match/${r.match.id}`); return; }
      // Backstop: never spin forever if pairing/bot never resolves.
      if (elapsed > HARD_TIMEOUT_MS) { stopPolling(); setError("Couldn't find a match — try again."); setMode("idle"); }
    };
    await tick();
    if (findGenRef.current === gen && !pollRef.current) pollRef.current = setInterval(tick, 1500);
  }, [router]);

  function cancelFind() {
    findGenRef.current++; // invalidate any in-flight tick so it can't navigate
    stopPolling();
    api({ action: "cancelQueue" }).catch(() => {});
    setMode("idle");
  }

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-5 pt-10">
        <Link href="/38-0" className="text-sm" style={{ color: "#8888aa" }}>← 38-0</Link>
        <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 34, color: "#00ff87" }}>Live H2H</h1>
        <p className="mt-1 text-sm" style={{ color: "#9a9ab0" }}>
          Two halves. Swap before kick-off and at halftime. Beat your opponent over 90.
        </p>

        {error && (
          <div className="mt-5 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(255,71,87,0.12)", color: "#ff7a88" }}>
            {error}
            {/team/i.test(error) && <> — <Link href="/38-0/play" className="underline">build your XI</Link> first.</>}
          </div>
        )}

        {mode === "idle" && (
          <div className="mt-7 space-y-3">
            <button onClick={findMatch} className="w-full rounded-2xl py-4 font-semibold" style={{ background: "#00ff87", color: "#04130a" }}>
              Find a live match
            </button>
            <button onClick={playFriend} className="w-full rounded-2xl py-4 font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "#e8e8f0", border: "1px solid rgba(255,255,255,0.12)" }}>
              Play a friend
            </button>
            <div className="pt-4">
              <label className="text-xs uppercase tracking-wide" style={{ color: "#7a7a92" }}>Join with a code</label>
              <div className="mt-2 flex gap-2">
                <input
                  value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6} placeholder="ABC123"
                  className="flex-1 rounded-xl px-4 py-3 tracking-[0.3em] font-mono"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                />
                <button onClick={joinByCode} disabled={joinCode.trim().length < 4} className="rounded-xl px-5 font-semibold" style={{ background: "#ffb800", color: "#1a1300", opacity: joinCode.trim().length < 4 ? 0.5 : 1 }}>
                  Join
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "friend" && (
          <div className="mt-7 text-center">
            <p className="text-sm" style={{ color: "#9a9ab0" }}>Share this code with your mate</p>
            <div className="mt-3 font-mono tracking-[0.4em] font-bold" style={{ fontSize: 44, color: "#00ff87" }}>{code}</div>
            <button
              onClick={() => navigator.share?.({ title: "38-0 H2H", text: `Play me on 38-0 — code ${code}`, url: `${location.origin}/38-0/live/${code}` }).catch(() => {})}
              className="mt-4 w-full rounded-2xl py-3 font-semibold" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8f0" }}
            >
              Share link
            </button>
            <button onClick={() => matchId && router.push(`/38-0/live/match/${matchId}`)} className="mt-3 w-full rounded-2xl py-4 font-semibold" style={{ background: "#00ff87", color: "#04130a" }}>
              Enter lobby →
            </button>
            <p className="mt-3 text-xs" style={{ color: "#7a7a92" }}>You&apos;ll wait in the lobby until they join.</p>
          </div>
        )}

        {mode === "finding" && <FindingPanel onCancel={cancelFind} />}
      </div>
    </div>
  );
}

const FINDING_MESSAGES = [
  "Searching for a live opponent…",
  "Scanning the lobby…",
  "Checking who's online…",
  "Matching you by squad strength…",
  "Lining up a game…",
];

/** Makes matchmaking feel alive (not a dead spinner) for the few seconds before a
 *  human pairs or the bot drops in: a rotating status + a jittering "online" count. */
function FindingPanel({ onCancel }: { onCancel: () => void }) {
  const [msg, setMsg] = useState(0);
  const [online, setOnline] = useState(() => 70 + Math.floor(Math.random() * 90));
  useEffect(() => {
    const a = setInterval(() => setMsg((x) => (x + 1) % FINDING_MESSAGES.length), 1300);
    const b = setInterval(() => setOnline((n) => Math.min(220, Math.max(45, n + Math.floor(Math.random() * 9) - 4))), 850);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  return (
    <div className="mt-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-full animate-spin" style={{ border: "3px solid rgba(0,255,135,0.2)", borderTopColor: "#00ff87" }} />
      <p className="mt-5 font-semibold transition-opacity" style={{ color: "#e8e8f0", minHeight: 22 }}>{FINDING_MESSAGES[msg]}</p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.22)" }}>
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#00ff87" }} />
        <span className="text-xs" style={{ color: "#9a9ab0" }}><b style={{ color: "#00ff87" }}>{online}</b> managers online</span>
      </div>
      <button onClick={onCancel} className="mt-8 block mx-auto text-sm underline" style={{ color: "#8888aa" }}>Cancel</button>
    </div>
  );
}
