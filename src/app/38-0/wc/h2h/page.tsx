"use client";

/**
 * /38-0/wc/h2h — World Cup head-to-head entry (the "WC" matchmaking lane).
 *
 * Plays a saved World Cup squad (nation-locked or World XI) against another WC
 * squad or a WC-pool bot, on its OWN queue / lobbies / leaderboard — separate from
 * the PL/La Liga ladders. It reuses the live match engine (/38-0/live/match/[id])
 * by passing competition="WC" to the matchmaking API.
 *
 * The friend flow stays entirely inside this page (share link → /38-0/wc/h2h?join=CODE)
 * so the shared PL live entry/join pages are untouched. A user with no saved WC team
 * gets "Save a team first" → a build-your-World-Cup-squad CTA. The squad itself is
 * saved as the active WC team from the draft / run screen before landing here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";
import { useUser } from "@/hooks/useUser";

const COMPETITION = "WC" as const;
const ACCENT = "#ffb800"; // World Cup gold

type QueueResp = { status?: "matched" | "waiting"; match?: { id: string; join_code?: string }; error?: string };
type LeaderRow = {
  user_id: string; display_name: string;
  wins: number; draws: number; losses: number; points: number; rank: number;
};

// Jittered bot fallback (5–8s) so it reads as real matchmaking, not a fixed timer.
const botFallbackDelay = () => 5_000 + Math.floor(Math.random() * 3_000);
const HARD_TIMEOUT_MS = 30_000;

export default function WorldCupH2H() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [mode, setMode] = useState<"idle" | "friend" | "finding">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [oppJoined, setOppJoined] = useState<string | null>(null);
  const queueStartRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const findGenRef = useRef(0);
  const botAfterRef = useRef(0);

  // Friend invite links land here as ?join=CODE — prefill the code box.
  useEffect(() => {
    const j = new URLSearchParams(window.location.search).get("join");
    if (j) setJoinCode(j.toUpperCase().slice(0, 6));
  }, []);

  // Leaderboard (the WC board)
  const [lbMetric, setLbMetric] = useState<"today" | "all">("today");
  const [lbRows, setLbRows] = useState<LeaderRow[]>([]);
  const [lbLoading, setLbLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLbLoading(true);
    fetch(`/api/draft/leaderboard?metric=${lbMetric}&competition=${COMPETITION}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setLbRows(d.rows ?? []); })
      .catch(() => { if (alive) setLbRows([]); })
      .finally(() => { if (alive) setLbLoading(false); });
    return () => { alive = false; };
  }, [lbMetric]);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  // Host's friend lobby: poll for the opponent joining.
  useEffect(() => {
    if (mode !== "friend" || !matchId || oppJoined) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/draft/live/${matchId}`);
        if (!res.ok) return;
        const { match } = await res.json();
        if (alive && match?.p2_id) {
          clearInterval(iv);
          setOppJoined(match.p2_name ?? "Your opponent");
          setTimeout(() => { if (alive) router.push(`/38-0/live/match/${matchId}`); }, 1800);
        }
      } catch { /* transient — keep polling */ }
    }, 2000);
    return () => { alive = false; clearInterval(iv); };
  }, [mode, matchId, oppJoined, router]);

  async function api(body: Record<string, unknown>): Promise<QueueResp> {
    const res = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, competition: COMPETITION }) });
    return res.json().catch(() => ({ error: "Request failed" }));
  }

  async function playFriend() {
    setError(null);
    const r = await api({ action: "create" });
    if (r.error || !r.match) { setError(r.error ?? "Couldn't create lobby"); return; }
    setMode("friend");
    setMatchId(r.match.id);
    setCode(r.match.join_code ?? null);
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
    const gen = ++findGenRef.current;
    queueStartRef.current = Date.now();
    botAfterRef.current = botFallbackDelay();
    const tick = async () => {
      if (findGenRef.current !== gen) { stopPolling(); return; }
      const elapsed = Date.now() - queueStartRef.current;
      const r = await api(elapsed > botAfterRef.current ? { action: "bot" } : { action: "queue" });
      if (findGenRef.current !== gen) return;
      if (r.error) { stopPolling(); setError(r.error); setMode("idle"); return; }
      if (r.match) { stopPolling(); router.push(`/38-0/live/match/${r.match.id}`); return; }
      if (elapsed > HARD_TIMEOUT_MS) { stopPolling(); setError("Couldn't find a match — try again."); setMode("idle"); }
    };
    await tick();
    if (findGenRef.current === gen && !pollRef.current) pollRef.current = setInterval(tick, 1500);
  }, [router]);

  function cancelFind() {
    findGenRef.current++;
    stopPolling();
    api({ action: "cancelQueue" }).catch(() => {});
    setMode("idle");
  }

  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const signedOut = !user && !authLoading;

  function handleFindMatch() {
    if (signedOut) { setShowAuthPrompt(true); return; }
    void findMatch();
  }

  // "Save a team first" → send them to build a World Cup squad, not a PL XI.
  const needsTeam = !!error && /team/i.test(error);

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-5 pt-10">
        <BackPill href="/38-0/wc" label="World Cup" tone="wc" />
        <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 34, color: ACCENT }}>World Cup H2H 🌍</h1>
        <p className="mt-1 text-sm" style={{ color: "#9a9ab0" }}>
          Take your World Cup squad head-to-head. Two halves, swap before kick-off and at the break. WC squads only — own board.
        </p>

        {error && (
          <div className="mt-5 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(255,71,87,0.12)", color: "#ff7a88" }}>
            {error}
            {needsTeam && <> — <Link href="/38-0/wc" className="underline">build your World Cup squad</Link> first.</>}
          </div>
        )}

        {mode === "idle" && (
          <div className="mt-7 space-y-3">
            {showAuthPrompt && (
              <>
                <Link href="/auth/sign-in?signup=1"
                  className="flex items-center justify-center w-full rounded-2xl py-4 font-body font-semibold text-center"
                  style={{ background: ACCENT, color: "#1a1300", fontSize: 16 }}>
                  Sign Up — Free
                </Link>
                <Link href="/auth/sign-in"
                  className="flex items-center justify-center w-full rounded-2xl py-4 font-body font-semibold text-center"
                  style={{ background: "rgba(255,255,255,0.06)", color: "#e8e8f0", border: "1px solid rgba(255,255,255,0.12)", fontSize: 16 }}>
                  Sign In
                </Link>
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }} />
              </>
            )}

            <button onClick={handleFindMatch} className="w-full rounded-2xl py-4 font-semibold" style={{ background: ACCENT, color: "#1a1300" }}>
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
                <button onClick={joinByCode} disabled={joinCode.trim().length < 4} className="rounded-xl px-5 font-semibold" style={{ background: ACCENT, color: "#1a1300", opacity: joinCode.trim().length < 4 ? 0.5 : 1 }}>
                  Join
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === "friend" && (
          <div className="mt-7 text-center">
            {oppJoined ? (
              <div className="rounded-2xl p-5" style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.45)" }}>
                <div className="text-3xl">🟢</div>
                <p className="mt-2 font-display tracking-wide" style={{ fontSize: 22, color: ACCENT }}>{oppJoined} JOINED!</p>
                <p className="mt-1 text-sm" style={{ color: "#9a9ab0" }}>Taking you into the lobby…</p>
                <button onClick={() => matchId && router.push(`/38-0/live/match/${matchId}`)} className="mt-4 w-full rounded-2xl py-4 font-semibold" style={{ background: ACCENT, color: "#1a1300" }}>
                  Enter now →
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm" style={{ color: "#9a9ab0" }}>Share this code with your mate</p>
                <div className="mt-3 font-mono tracking-[0.4em] font-bold" style={{ fontSize: 44, color: ACCENT }}>{code}</div>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.25)" }}>
                  <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
                  <span className="text-xs" style={{ color: "#cfcfe6" }}>Waiting for your mate to join…</span>
                </div>
                <button
                  onClick={() => navigator.share?.({ title: "World Cup H2H", text: `Play me on 38-0 World Cup — code ${code}`, url: `${location.origin}/38-0/wc/h2h?join=${code}` }).catch(() => {})}
                  className="mt-4 w-full rounded-2xl py-3 font-semibold" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#e8e8f0" }}
                >
                  Share link
                </button>
                <button onClick={() => matchId && router.push(`/38-0/live/match/${matchId}`)} className="mt-3 w-full rounded-2xl py-4 font-semibold" style={{ background: ACCENT, color: "#1a1300" }}>
                  Enter lobby →
                </button>
                <p className="mt-3 text-xs" style={{ color: "#7a7a92" }}>We&apos;ll pull you in automatically the moment they join.</p>
              </>
            )}
          </div>
        )}

        {mode === "finding" && <FindingPanel onCancel={cancelFind} />}

        {mode === "idle" && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                WORLD CUP <span style={{ color: ACCENT }}>BOARD</span>
              </h2>
            </div>

            <div className="flex gap-1 p-1 rounded-2xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {([["today", "Today"], ["all", "All-time"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setLbMetric(key)}
                  className="flex-1 py-1.5 rounded-xl font-body text-sm font-semibold transition-all"
                  style={lbMetric === key ? { background: ACCENT, color: "#1a1300" } : { background: "transparent", color: "#8888aa" }}>
                  {label}
                </button>
              ))}
            </div>

            {lbLoading ? (
              <div className="py-6 text-center font-body text-sm" style={{ color: "#8888aa" }}>Loading…</div>
            ) : lbRows.length === 0 ? (
              <div className="rounded-2xl px-4 py-5 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="font-body text-sm" style={{ color: "#8888aa" }}>No wins yet — be first on the World Cup board.</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 10, color: "#8888aa", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
                  <span style={{ width: 28, textAlign: "center" }}>#</span>
                  <span className="flex-1 pl-2">PLAYER</span>
                  <span style={{ width: 24, textAlign: "center" }}>W</span>
                  <span style={{ width: 24, textAlign: "center" }}>D</span>
                  <span style={{ width: 24, textAlign: "center" }}>L</span>
                  <span style={{ width: 36, textAlign: "center", color: "#cfcfe6" }}>PTS</span>
                </div>
                {lbRows.map((r) => {
                  const isMe = user && r.user_id === user.id;
                  const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
                  return (
                    <div key={r.user_id} className="flex items-center px-3 py-2.5"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: isMe ? "rgba(255,184,0,0.08)" : "transparent" }}>
                      <span className="font-display tabular-nums" style={{ width: 28, textAlign: "center", fontSize: medal ? 15 : 14, color: r.rank === 1 ? ACCENT : r.rank <= 3 ? "#cfcfe6" : "#8888aa" }}>
                        {medal ?? r.rank}
                      </span>
                      <div className="flex-1 min-w-0 pl-2">
                        <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                          {r.display_name}{isMe ? " (you)" : ""}
                        </div>
                      </div>
                      <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#00ff87" }}>{r.wins}</span>
                      <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: ACCENT }}>{r.draws}</span>
                      <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#ff4757" }}>{r.losses}</span>
                      <span className="font-display tabular-nums" style={{ width: 36, textAlign: "center", fontSize: 15, color: "#fff" }}>{r.points}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const FINDING_MESSAGES = [
  "Searching for a World Cup opponent…",
  "Scanning the lobby…",
  "Checking who's online…",
  "Matching you by squad strength…",
  "Lining up a game…",
];

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
      <div className="mx-auto h-12 w-12 rounded-full animate-spin" style={{ border: "3px solid rgba(255,184,0,0.2)", borderTopColor: ACCENT }} />
      <p className="mt-5 font-semibold transition-opacity" style={{ color: "#e8e8f0", minHeight: 22 }}>{FINDING_MESSAGES[msg]}</p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.22)" }}>
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
        <span className="text-xs" style={{ color: "#9a9ab0" }}><b style={{ color: ACCENT }}>{online}</b> managers online</span>
      </div>
      <button onClick={onCancel} className="mt-8 block mx-auto text-sm underline" style={{ color: "#8888aa" }}>Cancel</button>
    </div>
  );
}
