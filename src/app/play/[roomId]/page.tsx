"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { useUser } from "@/hooks/useUser";

// Lazy-loaded so the QR library stays out of the initial bundle (matches the
// league pages). react-qr-code is the single QR dependency used app-wide.
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
import { QuestionCard, type ActiveQuestion } from "@/components/game/QuestionCard";
import { Leaderboard, type LeaderboardEntry } from "@/components/game/Leaderboard";
import { Spinner } from "@/components/ui/Spinner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Room {
  id: string; name: string; code: string;
  status: "lobby" | "live" | "completed";
  created_by: string; room_mode: "h2h" | "group" | "open";
  question_count: number; pack_id: string | null;
  category_filter: string | null; difficulty_filter: string;
  current_question_idx: number; question_started_at: string | null;
  max_players: number;
}

interface Player {
  user_id: string; display_name: string; joined_at: string;
}

// Realtime question_events payload shape. The realtime channel delivers an
// untyped record; this captures the fields read off it (set when status="live").
interface QuestionEvent {
  id: string;
  status: string | null;
  sequence_number: number | null;
  question_id: string | null;
  closes_at: string;
  fired_at: string;
}

type DB = SupabaseClient<Database>;

const MODE_LABEL: Record<string, string> = { h2h: "1v1", group: "Private", open: "Public" };
const MODE_COLOR: Record<string, string> = { h2h: "#f87171", group: "#a78bfa", open: "#00ff87" };
const QUESTION_DURATION_MS = 20_000;

// ── Avatar helper ─────────────────────────────────────────────────────────────

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "1.5px solid rgba(255,255,255,0.1)" }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

// ── Countdown ring ────────────────────────────────────────────────────────────

function CountdownRing({ closesAt }: { closesAt: string }) {
  const [remaining, setRemaining] = useState(QUESTION_DURATION_MS);
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, new Date(closesAt).getTime() - Date.now()));
    tick();
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [closesAt]);
  const secs = Math.ceil(remaining / 1000);
  const pct = remaining / QUESTION_DURATION_MS;
  const r = 22; const circ = 2 * Math.PI * r;
  const color = pct > 0.5 ? "#00ff87" : pct > 0.25 ? "#ffb800" : "#f87171";
  return (
    <div className="relative flex items-center justify-center" style={{ width: 56, height: 56 }}>
      <svg width="56" height="56" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.5s" }} />
      </svg>
      <span className="font-display text-lg leading-none relative z-10" style={{ color }}>{secs}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoomPage() {
  const params = useParams();
  const { user, loading: userLoading } = useUser();
  const roomId = params.roomId as string;

  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  // Live answer progress counter (Fix #7)
  const [answeredCount, setAnsweredCount] = useState(0);

  const advanceTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the sequence_number of the question currently showing (1-based).
  const currentSeqRef     = useRef(0);
  // Refs for use inside Realtime callbacks (avoid stale closure captures)
  const activeEventIdRef  = useRef<string | null>(null);
  const answeredUidsRef   = useRef<Set<string>>(new Set());
  const playersCountRef   = useRef(0);
  const isHostRef         = useRef(false);
  const supabaseRef       = useRef<DB | null>(null);
  // Realtime channel — kept so handleAnswer can broadcast an "answered" signal
  // (answers RLS is owner-only, so postgres_changes can't power the counter).
  const channelRef        = useRef<ReturnType<DB["channel"]> | null>(null);

  const isHost = user && room ? user.id === room.created_by : false;

  // Keep refs in sync
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { playersCountRef.current = players.length; }, [players]);

  // Build QR join URL (client-only)
  useEffect(() => {
    if (room) setJoinUrl(`${window.location.origin}/play?join=${room.code}`);
  }, [room]);

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchPlayers = useCallback(async (sb: DB, rid: string) => {
    const { data } = await sb
      .from("room_members")
      .select("user_id, joined_at")
      .eq("room_id", rid)
      .order("joined_at", { ascending: true });
    if (!data?.length) { setPlayers([]); return; }
    const uids = data.map((r) => r.user_id).filter((id): id is string => id !== null);
    const { data: profiles } = await sb.from("profiles").select("id, display_name").in("id", uids);
    const pm: Record<string, string> = {};
    (profiles ?? []).forEach((p) => { pm[p.id] = p.display_name ?? "Player"; });
    setPlayers(data.map((r) => ({ user_id: r.user_id ?? "", display_name: pm[r.user_id ?? ""] ?? "Player", joined_at: r.joined_at ?? "" })));
  }, []);

  const fetchLeaderboard = useCallback(async (sb: DB, rid: string) => {
    const { data } = await sb
      .from("room_scores")
      .select("user_id, total_score, correct_answers, total_answers, current_streak, rank, avg_answer_speed_ms, fastest_answer_ms")
      .eq("room_id", rid)
      .order("total_score", { ascending: false })
      .limit(20);
    if (!data?.length) return;
    const uids = data.map((r) => r.user_id).filter((id): id is string => id !== null);
    const { data: profiles } = await sb.from("profiles").select("id, display_name, avatar_url").in("id", uids);
    const pm: Record<string, { display_name: string | null; avatar_url: string | null }> = {};
    (profiles ?? []).forEach((p) => { pm[p.id] = p; });
    setLeaderboard(data.map((r, i) => ({
      user_id: r.user_id ?? "",
      display_name: pm[r.user_id ?? ""]?.display_name ?? "Player",
      avatar_url: pm[r.user_id ?? ""]?.avatar_url ?? null,
      total_score: r.total_score ?? 0,
      correct_answers: r.correct_answers ?? 0,
      total_answers: r.total_answers ?? 0,
      current_streak: r.current_streak ?? 0,
      rank: r.rank ?? i + 1,
      avg_answer_speed_ms: r.avg_answer_speed_ms ?? null,
      fastest_answer_ms: r.fastest_answer_ms ?? null,
    })));
  }, []);

  // ── Handle new question event ─────────────────────────────────────────────

  const handleNewQuestion = useCallback(async (sb: DB, payload: { new: QuestionEvent }) => {
    const ev = payload.new;
    if (ev.status !== "live") return;

    // Cancel any pending "expire clear" from the previous question.
    if (expireTimerRef.current) {
      clearTimeout(expireTimerRef.current);
      expireTimerRef.current = null;
    }

    // Track which question is showing (1-based sequence_number).
    currentSeqRef.current = ev.sequence_number ?? 1;

    // Reset answered tracking for this new question (Fixes #3 & #7)
    activeEventIdRef.current = ev.id;
    answeredUidsRef.current = new Set();
    setAnsweredCount(0);

    const idx = currentSeqRef.current - 1;
    let q: Record<string, unknown> | null = null;

    const { data: roomData } = await sb
      .from("rooms").select("questions_json").eq("id", roomId).single();
    const stored = Array.isArray(roomData?.questions_json) ? roomData.questions_json : [];
    q = (stored[idx] as Record<string, unknown>) ?? null;

    if (!q && ev.question_id) {
      const { data } = await sb.from("questions").select("*").eq("id", ev.question_id).single();
      q = data ?? null;
    }

    if (!q) return;

    const options = q.options as Record<string, string> | undefined;
    setClosesAt(ev.closes_at);
    setActiveQuestion({
      eventId: ev.id,
      questionId: (q.id as string) || ev.question_id || ev.id,
      questionText: (q.question as string) ?? "",
      optionA: options?.A ?? (q.option_a as string) ?? "",
      optionB: options?.B ?? (q.option_b as string) ?? "",
      optionC: options?.C ?? (q.option_c as string) ?? "",
      optionD: options?.D ?? (q.option_d as string) ?? "",
      difficulty: (q.difficulty as "easy" | "medium" | "hard") ?? "medium",
      category: (q.category as string) ?? null,
      explanation: null,
      startTime: new Date(ev.fired_at),
      totalSeconds: QUESTION_DURATION_MS / 1000,
    });
  }, [roomId]);

  // ── Recovery: fetch the current question_event if Realtime missed INSERT ──

  const fetchAndShowQuestion = useCallback(async (sb: DB, seqNumber: number) => {
    if (currentSeqRef.current === seqNumber) return;
    const { data: ev } = await sb
      .from("question_events")
      .select("*")
      .eq("room_id", roomId)
      .eq("sequence_number", seqNumber)
      .eq("status", "live")
      .maybeSingle();
    if (ev) await handleNewQuestion(sb, { new: ev as unknown as QuestionEvent });
  }, [roomId, handleNewQuestion]);

  // ── Auto-advance (host only) ──────────────────────────────────────────────

  const scheduleAdvance = useCallback((closes: string) => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    const delay = Math.max(0, new Date(closes).getTime() - Date.now() + 300);
    advanceTimerRef.current = setTimeout(async () => {
      const expectedIdx = currentSeqRef.current - 1;
      setActiveQuestion(null);
      setClosesAt(null);
      await fetch("/api/room/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, expectedIdx }),
      });
    }, delay);
  }, [roomId]);

  // ── Early advance when all players have answered (Fix #3) ─────────────────

  const triggerEarlyAdvance = useCallback(async () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
    const expectedIdx = currentSeqRef.current - 1;
    setActiveQuestion(null);
    setClosesAt(null);
    await fetch("/api/room/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, expectedIdx }),
    });
  }, [roomId]);

  // ── Initial load + Realtime ───────────────────────────────────────────────

  useEffect(() => {
    if (userLoading || !user) return;
    let cancelled = false;

    import("@/lib/supabase/client").then(async ({ createClient }) => {
      const sb = createClient();
      supabaseRef.current = sb;

      // Ensure the Realtime socket carries the user's JWT, so RLS-gated tables
      // (question_events is room-member-scoped) deliver events. Without this the
      // socket can stay on the anon token after a cookie-hydrated session and
      // questions never appear for players.
      const { data: { session } } = await sb.auth.getSession();
      if (session?.access_token) sb.realtime.setAuth(session.access_token);

      const { data: roomData } = await sb
        .from("rooms").select("*").eq("id", roomId).single();
      if (cancelled || !roomData) { setLoading(false); return; }
      setRoom(roomData as unknown as Room);

      await fetchPlayers(sb, roomId);
      if (roomData.status === "live" || roomData.status === "completed") {
        await fetchLeaderboard(sb, roomId);
      }

      await sb.from("room_members").upsert({ room_id: roomId, user_id: user.id }, { onConflict: "room_id,user_id" });

      setLoading(false);

      const channel = sb.channel(`room:${roomId}`, { config: { broadcast: { self: true } } })
        // Question events: show new questions to all clients
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "question_events", filter: `room_id=eq.${roomId}` },
          (payload) => handleNewQuestion(sb, { new: payload.new as unknown as QuestionEvent }))
        // Leaderboard updates
        .on("postgres_changes", { event: "*", schema: "public", table: "room_scores", filter: `room_id=eq.${roomId}` },
          () => fetchLeaderboard(sb, roomId))
        // Room status changes (also used as recovery path for missed question INSERT)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          async (payload) => {
            if (cancelled) return;
            const updated = payload.new as unknown as Room;
            setRoom(updated);
            if (updated.status === "live") {
              const expectedSeq = updated.current_question_idx + 1;
              await fetchAndShowQuestion(sb, expectedSeq);
            }
          })
        // New players joining
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
          () => fetchPlayers(sb, roomId))
        // Answer tracking: live progress counter + early advance (Fixes #3, #7).
        // Uses a broadcast (not postgres_changes) because answers RLS is
        // owner-only, so the host can't see other players' answer rows.
        .on("broadcast", { event: "answered" }, ({ payload }) => {
          if (cancelled) return;
          const p = payload as { userId?: string; eventId?: string };
          if (!p.userId || p.eventId !== activeEventIdRef.current) return;
          answeredUidsRef.current.add(p.userId);
          const count = answeredUidsRef.current.size;
          setAnsweredCount(count);
          // Host: trigger early advance when everyone has answered (Fix #3)
          if (isHostRef.current && playersCountRef.current > 0 && count >= playersCountRef.current) {
            triggerEarlyAdvance();
          }
        })
        .subscribe();

      channelRef.current = channel;
      return () => { cancelled = true; channelRef.current = null; sb.removeChannel(channel); };
    });

    return () => { cancelled = true; };
  }, [user, userLoading, roomId, fetchPlayers, fetchLeaderboard, handleNewQuestion, fetchAndShowQuestion, triggerEarlyAdvance]);

  // Schedule host advance when a new question's closesAt is set.
  useEffect(() => {
    if (!isHost || !closesAt) return;
    scheduleAdvance(closesAt);
    return () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); };
  }, [isHost, closesAt, scheduleAdvance]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleStart() {
    setStarting(true);
    const res = await fetch("/api/room/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    if (!res.ok) { setStarting(false); return; }
    // Optimistically leave the lobby on first tap — don't wait for our own
    // realtime echo. Other players transition via the rooms UPDATE event.
    setRoom((r) => (r ? { ...r, status: "live", current_question_idx: 0 } : r));
    const sb = supabaseRef.current;
    if (sb) await fetchAndShowQuestion(sb, 1);
  }

  async function handleAnswer(letter: "a" | "b" | "c" | "d") {
    if (!activeQuestion) throw new Error("No active question");
    const res = await fetch("/api/answer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionEventId: activeQuestion.eventId, selectedAnswer: letter }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
    // Tell the room this player answered (powers the live counter + early
    // advance) — broadcast avoids the owner-only RLS on the answers table.
    if (user) {
      channelRef.current?.send({
        type: "broadcast",
        event: "answered",
        payload: { userId: user.id, eventId: activeQuestion.eventId },
      });
    }
    return res.json();
  }

  // FIX #2 (question sync): capture which sequence number expired so the
  // 3500ms clear timer doesn't wipe a newer question loaded after expire fires.
  const handleQuestionExpire = useCallback(() => {
    const expiringSeq = currentSeqRef.current;
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current);
    expireTimerRef.current = setTimeout(() => {
      expireTimerRef.current = null;
      // Only clear if we're still on the same question (no newer one arrived)
      if (currentSeqRef.current === expiringSeq) {
        setActiveQuestion(null);
        setClosesAt(null);
      }
    }, 3500);
  }, []);

  function copyInvite() {
    if (!room) return;
    navigator.clipboard.writeText(joinUrl || `${window.location.origin}/play?join=${room.code}`)
      .then(() => { setCopyDone(true); setTimeout(() => setCopyDone(false), 2000); });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading || userLoading) {
    return <main className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></main>;
  }

  if (!room) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-6 gap-4">
        <p className="font-display text-5xl">🤔</p>
        <p className="font-display text-2xl text-white">Lobby not found</p>
        <Link href="/play" className="font-body text-sm text-amber">← Back to Play</Link>
      </main>
    );
  }

  const modeColor = MODE_COLOR[room.room_mode] ?? "#a78bfa";
  const modeLabel = MODE_LABEL[room.room_mode] ?? room.room_mode;

  // ── LOBBY ─────────────────────────────────────────────────────────────────

  if (room.status === "lobby") {
    return (
      <main className="min-h-dvh pb-10 bg-bg">
        <GridBackground opacity={0.02} />

        <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <Link href="/play" className="flex items-center gap-2 font-body text-sm text-text-muted">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Play
          </Link>
          <span className="font-body text-xs px-3 py-1 rounded-full"
            style={{ background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}30` }}>
            {modeLabel} · Lobby
          </span>
        </nav>

        <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4">
          {/* Room header */}
          <div className="rounded-2xl px-5 py-5 bg-surface border border-border">
            <p className="font-display text-2xl text-white tracking-wide mb-1">{room.name}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-body text-xs text-text-muted">{room.question_count} questions</span>
              {room.category_filter && (
                <span className="font-body text-xs text-text-muted">· {room.category_filter}</span>
              )}
              <span className="font-body text-xs text-text-muted">· {room.difficulty_filter}</span>
            </div>
          </div>

          {/* Invite code + QR (Fix #5) */}
          <div className="rounded-2xl px-5 py-4" style={{ background: "rgba(255,184,0,0.05)", border: "1px solid rgba(255,184,0,0.2)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Invite Code</p>
              <button onClick={copyInvite}
                className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: copyDone ? "rgba(0,255,135,0.1)" : "rgba(255,184,0,0.1)", color: copyDone ? "#00ff87" : "#ffb800", border: `1px solid ${copyDone ? "rgba(0,255,135,0.3)" : "rgba(255,184,0,0.25)"}` }}>
                {copyDone ? "✓ Copied!" : "Copy link"}
              </button>
            </div>
            <p className="font-display text-4xl tracking-[0.3em] mb-4 text-amber">{room.code}</p>

            {/* QR Code */}
            {joinUrl && (
              <div className="flex flex-col items-center gap-2 pt-3" style={{ borderTop: "1px solid rgba(255,184,0,0.15)" }}>
                <p className="font-body text-xs text-text-muted">Scan to join instantly</p>
                <div className="rounded-2xl p-3 bg-surface">
                  <QRCode
                    value={joinUrl}
                    size={160}
                    bgColor="#12121e"
                    fgColor="#ffb800"
                    level="M"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Players */}
          <div className="rounded-2xl overflow-hidden bg-surface border border-border">
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Players</p>
              <span className="font-body text-xs" style={{ color: "#555577" }}>{players.length} / {room.max_players}</span>
            </div>
            <div className="p-3 space-y-1.5">
              {players.map(p => (
                <div key={p.user_id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: p.user_id === user?.id ? "rgba(0,255,135,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${p.user_id === user?.id ? "rgba(0,255,135,0.15)" : "rgba(255,255,255,0.05)"}` }}>
                  <Avatar name={p.display_name} size={32} />
                  <span className="font-body text-sm font-medium text-white flex-1">{p.display_name}</span>
                  {p.user_id === room.created_by && (
                    <span className="font-body text-xs px-2 py-0.5 rounded-full text-amber" style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.2)" }}>Host</span>
                  )}
                  {p.user_id === user?.id && p.user_id !== room.created_by && (
                    <span className="font-body text-xs text-green">You</span>
                  )}
                </div>
              ))}
              {players.length < room.max_players && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.07)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.1)" }}>
                    <span style={{ color: "#444466", fontSize: 16 }}>+</span>
                  </div>
                  <span className="font-body text-xs" style={{ color: "#444466" }}>Waiting for players…</span>
                </div>
              )}
            </div>
          </div>

          {/* Start / waiting */}
          {isHost ? (
            <button onClick={handleStart} disabled={starting || players.length < 1}
              className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
              style={{ background: starting ? "rgba(255,184,0,0.15)" : "#ffb800", color: starting ? "#555577" : "#0a0a0f" }}>
              {starting ? "Starting…" : players.length < 2 ? `Waiting for players (${players.length}/2 min)` : `Start Game →`}
            </button>
          ) : (
            <div className="rounded-2xl px-5 py-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex gap-1 flex-shrink-0">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full bg-amber" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
                ))}
              </div>
              <p className="font-body text-sm text-white">Waiting for host to start the game…</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  // ── COMPLETED ─────────────────────────────────────────────────────────────

  if (room.status === "completed") {
    const winner = leaderboard[0];
    const me = leaderboard.find(e => e.user_id === user?.id);

    return (
      <main className="min-h-dvh pb-10 bg-bg">
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <Link href="/play" className="font-body text-sm text-text-muted">← Play</Link>
          <span className="font-body text-xs" style={{ color: "#555577" }}>Game Over</span>
        </nav>

        <div className="max-w-lg mx-auto px-5 space-y-4">
          {winner && (
            <div className="rounded-2xl px-5 py-6 text-center" style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(255,184,0,0.05) 100%)", border: "1px solid rgba(255,215,0,0.25)" }}>
              <p className="text-4xl mb-2">🏆</p>
              <p className="font-body text-xs uppercase tracking-widest mb-1 text-text-muted">Winner</p>
              <p className="font-display text-3xl text-white mb-1">{winner.display_name}</p>
              <p className="font-display text-5xl" style={{ color: "#ffd700" }}>{winner.total_score.toLocaleString()}</p>
              <p className="font-body text-sm mt-1 text-text-muted">points</p>
            </div>
          )}

          {me && me.user_id !== winner?.user_id && (
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between" style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.15)" }}>
              <div>
                <p className="font-body text-xs uppercase tracking-widest mb-0.5 text-text-muted">Your result</p>
                <p className="font-body text-sm font-bold text-white">#{me.rank} · {me.correct_answers} correct</p>
              </div>
              <p className="font-display text-3xl text-green">{me.total_score.toLocaleString()}</p>
            </div>
          )}

          <div className="rounded-2xl overflow-hidden bg-surface border border-border">
            <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Final Standings</p>
              <p className="font-body text-xs mt-0.5" style={{ color: "#555577" }}>Tap a player to see their stats</p>
            </div>
            <div className="p-3">
              <Leaderboard entries={leaderboard} currentUserId={user?.id} showFull maxVisible={leaderboard.length} />
            </div>
          </div>

          <div className="flex gap-3">
            {isHost && (
              <Link href="/play/new"
                className="flex-1 py-3.5 rounded-2xl font-body font-bold text-sm text-center transition-all hover:opacity-90 bg-amber"
                style={{ color: "#0a0a0f" }}>
                Play Again 🎮
              </Link>
            )}
            <Link href="/play"
              className="flex-1 py-3.5 rounded-2xl font-body font-bold text-sm text-center transition-all hover:opacity-80"
              style={{ background: "rgba(255,255,255,0.06)", color: "#aaaacc", border: "1px solid rgba(255,255,255,0.1)" }}>
              Back to Play
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── LIVE ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-dvh pb-10 bg-bg">
      <GridBackground opacity={0.02} />

      {/* Game header */}
      <div className="sticky top-0 z-30" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-body text-xs px-2.5 py-1 rounded-full font-semibold"
              style={{ background: `${modeColor}18`, color: modeColor, border: `1px solid ${modeColor}30` }}>
              {modeLabel}
            </span>
            <span className="font-body text-sm font-bold text-white truncate max-w-[140px]">{room.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="font-body text-sm" style={{ color: "#555577" }}>
                Q{room.current_question_idx + 1}<span style={{ color: "#333355" }}>/{room.question_count}</span>
              </p>
              {/* Live answer progress counter (Fix #7) */}
              {activeQuestion && players.length > 0 && (
                <p className="font-body text-xs" style={{ color: answeredCount >= players.length ? "#00ff87" : "#8888aa" }}>
                  {answeredCount}/{players.length} answered
                </p>
              )}
              {!activeQuestion && (
                <p className="font-body text-xs" style={{ color: "#333355" }}>{players.length} players</p>
              )}
            </div>
            {closesAt && <CountdownRing closesAt={closesAt} />}
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4 pt-4">

        {/* Waiting for first question */}
        {!activeQuestion && room.status === "live" && (
          <div className="rounded-2xl px-5 py-8 text-center" style={{ background: "rgba(255,184,0,0.04)", border: "1px solid rgba(255,184,0,0.15)" }}>
            <div className="flex justify-center gap-1.5 mb-3">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-3 h-3 rounded-full bg-amber" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
              ))}
            </div>
            <p className="font-body text-sm font-bold text-white">Next question incoming…</p>
            <p className="font-body text-xs mt-1 text-text-muted">Get ready</p>
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div className="rounded-2xl overflow-hidden bg-surface border border-border">
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Live Standings</p>
              <span className="font-body text-xs" style={{ color: "#555577" }}>tap for stats</span>
            </div>
            <div className="p-3">
              <Leaderboard entries={leaderboard} currentUserId={user?.id} maxVisible={8} />
            </div>
          </div>
        )}
      </div>

      {/* Active question overlay — key prop forces remount on new question (Fix #1: auto-answer bug) */}
      {activeQuestion && user && (
        <QuestionCard
          key={activeQuestion.eventId}
          question={activeQuestion}
          onAnswer={handleAnswer}
          onExpire={handleQuestionExpire}
        />
      )}

      {/* Sign in prompt if unauthenticated during live game */}
      {activeQuestion && !user && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4" style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(16px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <p className="font-body text-sm font-bold text-white mb-3">Question is live — sign in to answer</p>
          <Link href="/auth/sign-in" className="block w-full py-3.5 rounded-xl font-body font-bold text-sm text-center bg-amber"
            style={{ color: "#0a0a0f" }}>Sign in to play →</Link>
        </div>
      )}
    </main>
  );
}
