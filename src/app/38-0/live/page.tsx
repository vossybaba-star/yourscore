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
import { Button } from "@/components/ui/Button";
import { BackPill } from "@/components/ui/BackPill";
import { useUser } from "@/hooks/useUser";
import { asLeague, type League } from "@/lib/draft/types";
import { trackShare } from "@/lib/analytics/trackGame";

type QueueResp = { status?: "matched" | "waiting"; match?: { id: string }; error?: string };
type LeaderRow = {
  user_id: string; display_name: string;
  wins: number; draws: number; losses: number; points: number; rank: number;
};

// Fall back to a bot when no human is waiting — jittered 2–3s so it never feels
// like a fixed timer. Short enough that players don't bail before the bot fires.
const botFallbackDelay = () => 2_000 + Math.floor(Math.random() * 1_000);
const HARD_TIMEOUT_MS = 30_000; // give up (instead of spinning forever) if nothing resolves
// Show the friend-lobby "match with randoms instead?" prompt after this many ms.
const FRIEND_WAIT_PROMPT_MS = 45_000;

export default function LiveEntry() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [mode, setMode] = useState<"idle" | "friend" | "finding" | "matched">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [oppJoined, setOppJoined] = useState<string | null>(null);
  const [friendWaitTooLong, setFriendWaitTooLong] = useState(false);
  const queueStartRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const findGenRef = useRef(0);
  const botAfterRef = useRef(0);
  // Which competition this live session is for (PL / La Liga), from the entry link.
  const [competition, setCompetition] = useState<League>("PL");
  useEffect(() => { setCompetition(asLeague(new URLSearchParams(window.location.search).get("competition"))); }, []);

  // Leaderboard
  const [lbMetric, setLbMetric] = useState<"today" | "all">("today");
  const [lbRows, setLbRows] = useState<LeaderRow[]>([]);
  const [lbLoading, setLbLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLbLoading(true);
    fetch(`/api/draft/leaderboard?metric=${lbMetric}&competition=${competition}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setLbRows(d.rows ?? []); })
      .catch(() => { if (alive) setLbRows([]); })
      .finally(() => { if (alive) setLbLoading(false); });
    return () => { alive = false; };
  }, [lbMetric, competition]);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => () => stopPolling(), []);

  // Host's friend lobby: poll for the opponent joining + prompt to find randoms after 45s.
  useEffect(() => {
    if (mode !== "friend" || !matchId || oppJoined) return;
    let alive = true;
    setFriendWaitTooLong(false);

    // Show the "match with other gamers" prompt after 45s
    const promptTimer = setTimeout(() => { if (alive) setFriendWaitTooLong(true); }, FRIEND_WAIT_PROMPT_MS);

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
    return () => { alive = false; clearInterval(iv); clearTimeout(promptTimer); };
  }, [mode, matchId, oppJoined, router]);

  async function api(body: Record<string, unknown>): Promise<QueueResp> {
    const res = await fetch("/api/draft/live", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, competition }) });
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
    const gen = ++findGenRef.current;
    queueStartRef.current = Date.now();
    botAfterRef.current = botFallbackDelay();
    const tick = async () => {
      if (findGenRef.current !== gen) { stopPolling(); return; }
      const elapsed = Date.now() - queueStartRef.current;
      const r = await api(elapsed > botAfterRef.current ? { action: "bot" } : { action: "queue" });
      if (findGenRef.current !== gen) return;
      if (r.error) { stopPolling(); setError(r.error); setMode("idle"); return; }
      if (r.match) {
        stopPolling();
        const mid = r.match.id;
        setMatchId(mid);
        setMode("matched");
        // Brief "opponent found" moment before entering the match
        setTimeout(() => router.push(`/38-0/live/match/${mid}`), 1600);
        return;
      }
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

  // Signed out — only show once auth state has resolved
  const signedOut = !user && !authLoading;

  function handleFindMatch() {
    if (signedOut) { setShowAuthPrompt(true); return; }
    void findMatch();
  }

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-5 pt-10">
        <BackPill href="/38-0" label="38-0" tone="draft" />
        <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 34, color: "#aeea00" }}>Live H2H</h1>
        <p className="mt-1 text-sm" style={{ color: "#9aa39d" }}>
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
            {/* Auth prompt — appears above "Find a live match" when a signed-out user taps it */}
            {showAuthPrompt && (
              <>
                <Button variant="primary" tone="lime" size="md" fullWidth href="/auth/sign-in?signup=1">
                  Sign Up — Free
                </Button>
                <Button variant="ghost" size="md" fullWidth href="/auth/sign-in">
                  Sign In
                </Button>
                <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }} />
              </>
            )}

            <Button variant="primary" tone="lime" size="md" fullWidth onClick={handleFindMatch}>
              Find a live match
            </Button>
            <Button variant="ghost" size="md" fullWidth onClick={playFriend}>
              Play a friend
            </Button>

            {/* Join with a code — always visible */}
            <div className="pt-4">
              <label className="text-xs uppercase tracking-wide" style={{ color: "#8a948f" }}>Join with a code</label>
              <div className="mt-2 flex gap-2">
                <input
                  value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6} placeholder="ABC123"
                  className="flex-1 rounded-xl px-4 py-3 tracking-[0.3em] font-mono"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" }}
                />
                <Button variant="primary" tone="lime" size="sm" onClick={joinByCode} disabled={joinCode.trim().length < 4}>
                  Join
                </Button>
              </div>
            </div>
          </div>
        )}

        {mode === "friend" && (
          <div className="mt-7 text-center">
            {oppJoined ? (
              <div className="rounded-2xl p-5" style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.45)" }}>
                <div className="text-3xl">🟢</div>
                <p className="mt-2 font-display tracking-wide" style={{ fontSize: 22, color: "#aeea00" }}>{oppJoined} JOINED!</p>
                <p className="mt-1 text-sm" style={{ color: "#9aa39d" }}>Taking you into the lobby…</p>
                <Button variant="primary" tone="lime" size="md" fullWidth className="mt-4" onClick={() => matchId && router.push(`/38-0/live/match/${matchId}`)}>
                  Enter now →
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm" style={{ color: "#9aa39d" }}>Share this code with your mate</p>
                <div className="mt-3 font-mono tracking-[0.4em] font-bold" style={{ fontSize: 44, color: "#aeea00" }}>{code}</div>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.25)" }}>
                  <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#ffb800" }} />
                  <span className="text-xs" style={{ color: "#c4ccc6" }}>Waiting for your mate to join…</span>
                </div>
                <Button
                  variant="ghost" size="md" fullWidth className="mt-4"
                  onClick={() => { trackShare("live"); navigator.share?.({ title: "38-0 H2H", text: `Play me on 38-0 — code ${code}`, url: `${location.origin}/38-0/live/${code}?competition=${competition}` }).catch(() => {}); }}
                >
                  Share link
                </Button>
                <Button variant="primary" tone="lime" size="md" fullWidth className="mt-3" onClick={() => matchId && router.push(`/38-0/live/match/${matchId}`)}>
                  Enter lobby →
                </Button>
                <p className="mt-3 text-xs" style={{ color: "#8a948f" }}>We&apos;ll pull you in automatically the moment they join.</p>

                {/* After 45s: offer to match with random online gamers instead */}
                {friendWaitTooLong && (
                  <div className="mt-5 rounded-2xl px-4 py-4 text-left"
                    style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.3)" }}>
                    <p className="text-sm font-semibold" style={{ color: "#ffb800" }}>
                      Your mate hasn&apos;t joined yet
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "#9aa39d" }}>
                      There are other gamers online right now — want us to match you with one of them instead?
                    </p>
                    <Button
                      variant="primary" tone="lime" size="sm" fullWidth className="mt-3"
                      onClick={() => {
                        setMode("idle");
                        setFriendWaitTooLong(false);
                        void findMatch();
                      }}
                    >
                      Match me with someone online →
                    </Button>
                    <button
                      onClick={() => setFriendWaitTooLong(false)}
                      className="mt-2 w-full rounded-xl py-2 text-xs"
                      style={{ color: "#8a948f" }}
                    >
                      Keep waiting for my mate
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode === "finding" && <FindingPanel onCancel={cancelFind} />}

        {mode === "matched" && (
          <div className="mt-12 text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full"
              style={{ background: "rgba(174,234,0,0.15)", border: "2px solid #aeea00" }}>
              <span style={{ fontSize: 28 }}>⚽</span>
            </div>
            <p className="mt-5 font-display tracking-wide" style={{ fontSize: 24, color: "#aeea00" }}>
              Opponent Found!
            </p>
            <p className="mt-2 text-sm" style={{ color: "#9aa39d" }}>Taking you into the match…</p>
          </div>
        )}

        {/* ── H2H Leaderboard — shown in idle mode ── */}
        {mode === "idle" && (
          <div className="mt-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                LEADER<span style={{ color: "#aeea00" }}>BOARD</span>
              </h2>
              <Link href="/38-0/leaderboard" className="font-body text-xs" style={{ color: "#8a948f" }}>
                Full board →
              </Link>
            </div>

            {/* Today / All-time toggle */}
            <div className="flex gap-1 p-1 rounded-2xl mb-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {([["today", "Today"], ["all", "All-time"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setLbMetric(key)}
                  className="flex-1 py-1.5 rounded-xl font-body text-sm font-semibold transition-all"
                  style={lbMetric === key ? { background: "#aeea00", color: "#062013" } : { background: "transparent", color: "#8a948f" }}>
                  {label}
                </button>
              ))}
            </div>

            {lbLoading ? (
              <div className="py-6 text-center font-body text-sm" style={{ color: "#8a948f" }}>Loading…</div>
            ) : lbRows.length === 0 ? (
              <div className="rounded-2xl px-4 py-5 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="font-body text-sm" style={{ color: "#8a948f" }}>No wins yet — be first on the board.</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center px-3 py-2 font-body" style={{ fontSize: 10, color: "#8a948f", letterSpacing: 0.5, background: "rgba(255,255,255,0.03)" }}>
                  <span style={{ width: 28, textAlign: "center" }}>#</span>
                  <span className="flex-1 pl-2">PLAYER</span>
                  <span style={{ width: 24, textAlign: "center" }}>W</span>
                  <span style={{ width: 24, textAlign: "center" }}>D</span>
                  <span style={{ width: 24, textAlign: "center" }}>L</span>
                  <span style={{ width: 36, textAlign: "center", color: "#c4ccc6" }}>PTS</span>
                </div>
                {lbRows.map((r) => {
                  const isMe = user && r.user_id === user.id;
                  const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
                  return (
                    <div key={r.user_id} className="flex items-center px-3 py-2.5"
                      style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: isMe ? "rgba(174,234,0,0.08)" : "transparent" }}>
                      <span className="font-display tabular-nums" style={{ width: 28, textAlign: "center", fontSize: medal ? 15 : 14, color: r.rank === 1 ? "#ffb800" : r.rank <= 3 ? "#c4ccc6" : "#8a948f" }}>
                        {medal ?? r.rank}
                      </span>
                      <div className="flex-1 min-w-0 pl-2">
                        <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>
                          {r.display_name}{isMe ? " (you)" : ""}
                        </div>
                      </div>
                      <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#aeea00" }}>{r.wins}</span>
                      <span className="font-body tabular-nums" style={{ width: 24, textAlign: "center", fontSize: 13, color: "#ffb800" }}>{r.draws}</span>
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
  "Searching for a live opponent…",
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
      <div className="mx-auto h-12 w-12 rounded-full animate-spin" style={{ border: "3px solid rgba(174,234,0,0.2)", borderTopColor: "#aeea00" }} />
      <p className="mt-5 font-semibold transition-opacity" style={{ color: "#e8e8f0", minHeight: 22 }}>{FINDING_MESSAGES[msg]}</p>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.22)" }}>
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: "#aeea00" }} />
        <span className="text-xs" style={{ color: "#9aa39d" }}><b style={{ color: "#aeea00" }}>{online}</b> managers online</span>
      </div>
      <button onClick={onCancel} className="mt-8 block mx-auto text-sm underline" style={{ color: "#8a948f" }}>Cancel</button>
    </div>
  );
}
