"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { trackGamePlay, trackGameComplete } from "@/lib/analytics/trackGame";
import { GridBackground } from "@/components/ui/GridBackground";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import dynamic from "next/dynamic";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { useUser } from "@/hooks/useUser";
import { REALTIME_ENABLED } from "@/lib/realtime";
import { QUIZ_BOT_ID } from "@/lib/versus/quizBot";
import { smartBackTarget } from "@/lib/nav";

// Lazy-loaded so the QR library stays out of the initial bundle (matches the
// league pages). react-qr-code is the single QR dependency used app-wide.
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false });
import { QuestionCard, type ActiveQuestion } from "@/components/game/QuestionCard";
import { RankRewardCard } from "@/components/rank/RankRewardCard";
import { Leaderboard, type LeaderboardEntry } from "@/components/game/Leaderboard";
import { Spinner } from "@/components/ui/Spinner";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { AddFriendCard, AddFriendInline } from "@/components/social/AddFriendCard";
import { DebateCard } from "@/components/debate/DebateCard";
import { DiscussionThread } from "@/components/debate/DiscussionThread";

// ── Types ─────────────────────────────────────────────────────────────────────

// Shadow matches: a real player's previous run replayed in the CPU seat. The
// room row carries the persona + per-question times (rooms.shadow, mig 66);
// identity is revealed honestly on the result screen.
interface ShadowInfo {
  userId: string; name: string; avatarUrl: string | null;
  playedAt: string | null; times: (number | null)[]; originalScore: number;
}

interface Room {
  id: string; name: string; code: string;
  status: "lobby" | "live" | "completed";
  created_by: string; room_mode: "h2h" | "group" | "open";
  question_count: number; pack_id: string | null;
  category_filter: string | null; difficulty_filter: string;
  current_question_idx: number; question_started_at: string | null;
  max_players: number;
  shadow?: ShadowInfo | null;
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
const MODE_COLOR: Record<string, string> = { h2h: "#f87171", group: "#aeea00", open: "#aeea00" };
const QUESTION_DURATION_MS = 20_000;
// Marks a room as auto-matchmade (vs a hand-created private lobby). Must match
// INSTANT_MATCH_NAME in src/lib/versus/quiz-matchmaking.ts — instant matches skip
// the invite/QR lobby and auto-start.
const INSTANT_MATCH_NAME = "Instant Match";

// ── Avatar helper ─────────────────────────────────────────────────────────────

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#3a423d", text: "#aeea00" },
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
  // Timer caution gradient is a gameplay signal, not Quiz branding: keep amber→red.
  const color = pct > 0.5 ? "#aeea00" : pct > 0.25 ? "#ffb800" : "#f87171";
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
  const router = useRouter();
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
  // Play-again voting
  const [playAgainVotes, setPlayAgainVotes] = useState<Set<string>>(new Set());
  const [myVote, setMyVote] = useState<"yes" | "no" | null>(null);
  const [newRoomId, setNewRoomId] = useState<string | null>(null);
  // Lobby persistence: timestamp when game completed (for 5-min countdown)
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [lobbyTimeLeft, setLobbyTimeLeft] = useState<number>(300); // seconds
  const [showLeaveModal, setShowLeaveModal] = useState(false);

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
  // Foreground-restore listener (registered inside the async setup, removed on cleanup)
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  // Per-game audience signals (Multiplayer quiz): "play" once the lobby goes live,
  // "complete" once it finishes. Gated on having played so a cold viewer opening a
  // finished room's link doesn't get counted. Fires for every player.
  const gamePlayedRef     = useRef(false);
  const gameCompletedRef  = useRef(false);
  useEffect(() => {
    const status = room?.status;
    if (status === "live" && !gamePlayedRef.current) {
      gamePlayedRef.current = true;
      trackGamePlay("quiz", { mode: "multiplayer" });
    }
    if (status === "completed" && gamePlayedRef.current && !gameCompletedRef.current) {
      gameCompletedRef.current = true;
      trackGameComplete("quiz", { mode: "multiplayer" });
    }
  }, [room?.status]);
  // Realtime channel — kept so handleAnswer can broadcast an "answered" signal
  // (answers RLS is owner-only, so postgres_changes can't power the counter).
  const channelRef        = useRef<ReturnType<DB["channel"]> | null>(null);
  // Trailing debounce for leaderboard refetches: a burst of room_scores events
  // (one per player per answer) should trigger a single refetch, not many.
  const leaderboardRefetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isHost = user && room ? user.id === room.created_by : false;

  // Keep refs in sync
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  useEffect(() => { playersCountRef.current = players.length; }, [players]);

  // CPU room? (instant-match fallback seats the dedicated CPU user as p2). The
  // CPU's real answer is written server-side when the human answers; this ref
  // powers the local "answered" tick that keeps the counter + early advance
  // honest on the only real client in the room.
  const hasBotRef = useRef(false);
  const botTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { hasBotRef.current = players.some((p) => p.user_id === QUIZ_BOT_ID); }, [players]);
  useEffect(() => () => { if (botTickTimerRef.current) clearTimeout(botTickTimerRef.current); }, []);

  // Shadow persona: render the CPU seat as the real player whose run this is.
  const shadowRef = useRef<ShadowInfo | null>(null);
  useEffect(() => { shadowRef.current = room?.shadow ?? null; }, [room?.shadow]);
  const shadow = room?.shadow ?? null;
  const personaRows = useCallback(<T extends { user_id: string; display_name: string }>(rows: T[]): T[] => {
    if (!shadow) return rows;
    return rows.map((r) => r.user_id === QUIZ_BOT_ID
      ? { ...r, display_name: shadow.name, ...("avatar_url" in r ? { avatar_url: shadow.avatarUrl } : {}) }
      : r);
  }, [shadow]);

  // Instant Match (auto-matchmade h2h) — the players are already paired, so skip
  // the invite/QR "share a code" lobby entirely: the host auto-starts and both
  // sides see a brief "Starting…" screen instead. (Hand-created lobbies keep the
  // normal invite flow.)
  const isInstantMatch = room?.name === INSTANT_MATCH_NAME && room?.room_mode === "h2h";
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!isInstantMatch || !isHost || room?.status !== "lobby") return;
    if (players.length < 2 || starting || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void handleStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInstantMatch, isHost, room?.status, players.length, starting]);

  // Build QR join URL (client-only)
  useEffect(() => {
    if (room) setJoinUrl(`${window.location.origin}/play?join=${room.code}`);
  }, [room]);

  // Warn before tab close during active lobby/game
  useEffect(() => {
    if (!room || room.status === "completed") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [room?.status]);

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

  // retries: on a completed room the final room_scores write can lag the rooms
  // status→completed flip, so the first read races to empty. Retry a few times so
  // the scorecard (winner, your-result, FINAL STANDINGS) never renders blank.
  const fetchLeaderboard = useCallback(async (sb: DB, rid: string, retries = 0) => {
    const runQuery = () => sb
      .from("room_scores")
      .select("user_id, total_score, correct_answers, total_answers, current_streak, rank, avg_answer_speed_ms, fastest_answer_ms")
      .eq("room_id", rid)
      .order("total_score", { ascending: false })
      .limit(20);
    let res = await runQuery();
    for (let attempt = 0; attempt < retries && !res.data?.length; attempt++) {
      await new Promise((r) => setTimeout(r, 900));
      res = await runQuery();
    }
    const data = res.data;
    // Still nothing after retries → keep the last good board rather than blanking it.
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

    // Opponent-seat tick. Shadow rooms use the REAL recorded answer time for
    // this question (null = they never answered it — no tick, the window runs).
    // CPU rooms mirror the server's seeded delay (same seed → the tick lands
    // exactly when the CPU's recorded time_taken says it answered).
    if (botTickTimerRef.current) { clearTimeout(botTickTimerRef.current); botTickTimerRef.current = null; }
    if (hasBotRef.current) {
      let delay: number | null;
      const sh = shadowRef.current;
      if (sh) {
        const t = sh.times?.[(ev.sequence_number ?? 1) - 1] ?? null;
        delay = t != null ? Math.max(800, t) : null;
      } else {
        let h = 2166136261;
        const seed = `${ev.id}:spd`;
        for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
        delay = Math.round(2800 + (((h >>> 0) % 100000) / 100000) * 7700);
      }
      if (delay != null) {
        botTickTimerRef.current = setTimeout(() => {
          if (activeEventIdRef.current !== ev.id) return;
          answeredUidsRef.current.add(QUIZ_BOT_ID);
          const count = answeredUidsRef.current.size;
          setAnsweredCount(count);
          if (isHostRef.current && playersCountRef.current > 0 && count >= playersCountRef.current) {
            triggerEarlyAdvance();
          }
        }, delay);
      }
    }

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

  const scheduleAdvance = useCallback((closes: string, extraMs = 300) => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    const delay = Math.max(0, new Date(closes).getTime() - Date.now() + extraMs);
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

      // Remove any leftover channel for this room before (re)subscribing. The
      // Supabase client is now a module-level singleton, so its channel registry
      // survives remounts / React StrictMode's double-invoke. Re-creating a
      // channel whose topic already exists returns the old, already-subscribed
      // instance — and adding .on() handlers to it throws
      // "cannot add postgres_changes callbacks ... after subscribe()", which
      // silently kills ALL realtime for the lobby. Awaiting removal guarantees a
      // fresh channel below.
      await Promise.all(
        sb.getChannels()
          .filter((c) => c.topic === `realtime:room:${roomId}`)
          .map((c) => sb.removeChannel(c))
      );
      if (cancelled) { setLoading(false); return; }

      const { data: roomData } = await sb
        .from("rooms").select("*").eq("id", roomId).single();
      if (cancelled || !roomData) { setLoading(false); return; }
      setRoom(roomData as unknown as Room);
      if (roomData.status === "completed") setCompletedAt(Date.now());

      await fetchPlayers(sb, roomId);
      if (roomData.status === "live" || roomData.status === "completed") {
        // Completed rooms: retry so a just-finished board (final write may lag) fills in.
        await fetchLeaderboard(sb, roomId, roomData.status === "completed" ? 4 : 0);
      }

      // Join as a player only while the room is forming. Visitors landing on a
      // live/finished room (shared links, spectators) must NOT be enrolled —
      // that inflated players.length, so "N/M answered" never completed and the
      // everyone-answered early advance could never fire again.
      if (roomData.status === "lobby") {
        await sb.from("room_members").upsert({ room_id: roomId, user_id: user.id }, { onConflict: "room_id,user_id" });
      }

      // Refresh/rejoin recovery: restore the in-flight question. Realtime only
      // delivers events that arrive while subscribed, so without this a reload
      // sat on "Next question incoming…" until the next advance — and a HOST
      // reload never rescheduled the advance at all (closesAt stayed null),
      // stalling the whole room.
      if (roomData.status === "live") {
        await fetchAndShowQuestion(sb, (roomData.current_question_idx ?? 0) + 1);
      }

      setLoading(false);

      if (!REALTIME_ENABLED || cancelled) { return; }
      const channel = sb.channel(`room:${roomId}`, { config: { broadcast: { self: true } } })
        // Question events: show new questions to all clients
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "question_events", filter: `room_id=eq.${roomId}` },
          (payload) => handleNewQuestion(sb, { new: payload.new as unknown as QuestionEvent }))
        // Leaderboard updates — debounced (trailing) so a burst of per-answer
        // score events collapses into a single refetch instead of one per event.
        .on("postgres_changes", { event: "*", schema: "public", table: "room_scores", filter: `room_id=eq.${roomId}` },
          () => {
            if (leaderboardRefetchRef.current) clearTimeout(leaderboardRefetchRef.current);
            leaderboardRefetchRef.current = setTimeout(() => {
              leaderboardRefetchRef.current = null;
              if (!cancelled) fetchLeaderboard(sb, roomId);
            }, 450);
          })
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
            if (updated.status === "completed") {
              setCompletedAt(Date.now());
              // Pull the final board (with retries) so the scorecard fills in.
              void fetchLeaderboard(sb, roomId, 4);
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
        // Play-again voting broadcast
        .on("broadcast", { event: "play_again_vote" }, ({ payload }) => {
          if (cancelled) return;
          const p = payload as { userId?: string; vote?: "yes" | "no" };
          if (!p.userId) return;
          setPlayAgainVotes((prev) => {
            const next = new Set(prev);
            if (p.vote === "yes") next.add(p.userId!);
            else next.delete(p.userId!);
            return next;
          });
        })
        // Host broadcasts new room after play-again — redirect everyone
        .on("broadcast", { event: "play_again_redirect" }, ({ payload }) => {
          if (cancelled) return;
          const p = payload as { roomId?: string };
          if (p.roomId) setNewRoomId(p.roomId);
        })
        .subscribe();

      channelRef.current = channel;

      // Tab restore: mobile suspends JS timers AND the realtime socket in the
      // background, so events fired while away are simply gone. Refetch the
      // room + in-flight question whenever the app comes back to foreground.
      const onVisible = () => {
        if (document.visibilityState !== "visible" || cancelled) return;
        void (async () => {
          const { data: fresh } = await sb.from("rooms").select("*").eq("id", roomId).single();
          if (!fresh || cancelled) return;
          setRoom(fresh as unknown as Room);
          if (fresh.status === "live") {
            await fetchAndShowQuestion(sb, (fresh.current_question_idx ?? 0) + 1);
            await fetchLeaderboard(sb, roomId);
          }
          if (fresh.status === "completed") setCompletedAt((c) => c ?? Date.now());
        })();
      };
      document.addEventListener("visibilitychange", onVisible);
      visibilityHandlerRef.current = onVisible;
    });

    return () => {
      cancelled = true;
      if (visibilityHandlerRef.current) {
        document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
        visibilityHandlerRef.current = null;
      }
      if (leaderboardRefetchRef.current) { clearTimeout(leaderboardRefetchRef.current); leaderboardRefetchRef.current = null; }
      // Remove the live channel on unmount. The async block above can't hand
      // its cleanup back to React (a return inside .then() goes to the
      // promise), so the refs are the hand-off — without this every visit
      // in/out of a lobby leaked a live subscription.
      if (channelRef.current && supabaseRef.current) {
        supabaseRef.current.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, userLoading, roomId, fetchPlayers, fetchLeaderboard, handleNewQuestion, fetchAndShowQuestion, triggerEarlyAdvance]);

  // Schedule the advance when a new question's closesAt lands. The host fires
  // right on the buzzer; every other member arms a WATCHDOG a few seconds later
  // (staggered) — the server accepts any member's advance once the question is
  // overdue, so a host who backgrounds/refreshes/leaves no longer stalls the
  // game. In the healthy path the next question's closesAt re-arms this effect
  // before a watchdog ever fires, and the server's atomic claim makes stray
  // duplicate calls harmless no-ops.
  useEffect(() => {
    if (!closesAt) return;
    scheduleAdvance(closesAt, isHost ? 300 : 4_000 + Math.random() * 3_000);
    return () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); };
  }, [isHost, closesAt, scheduleAdvance]);

  // 5-minute lobby countdown after game completes
  useEffect(() => {
    if (!completedAt) return;
    const LOBBY_HOLD_MS = 5 * 60 * 1000;
    const iv = setInterval(() => {
      const elapsed = Date.now() - completedAt;
      const left = Math.max(0, Math.floor((LOBBY_HOLD_MS - elapsed) / 1000));
      setLobbyTimeLeft(left);
    }, 1000);
    return () => clearInterval(iv);
  }, [completedAt]);

  // Auto-redirect when host creates a new room
  useEffect(() => {
    if (newRoomId) {
      const t = setTimeout(() => {
        window.location.href = `/play/${newRoomId}`;
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [newRoomId]);

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

  // When a question resolves (the overlay clears), bring the updated Live
  // Standings into view so a player who'd scrolled sees their new position
  // without hunting for it.
  const standingsRef = useRef<HTMLDivElement>(null);
  const wasQuestionActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = wasQuestionActiveRef.current;
    wasQuestionActiveRef.current = !!activeQuestion;
    if (wasActive && !activeQuestion && leaderboard.length > 0) {
      const t = setTimeout(() => standingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      return () => clearTimeout(t);
    }
  }, [activeQuestion, leaderboard.length]);

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

  function castPlayAgainVote(vote: "yes" | "no") {
    if (!user) return;
    setMyVote(vote);
    setPlayAgainVotes((prev) => {
      const next = new Set(prev);
      if (vote === "yes") next.add(user.id);
      else next.delete(user.id);
      return next;
    });
    channelRef.current?.send({
      type: "broadcast",
      event: "play_again_vote",
      payload: { userId: user.id, vote },
    });
  }

  async function handlePlayAgain() {
    if (!isHost || !room) return;
    // Normalize values to what the API accepts
    const validCounts = [5, 10, 20];
    const validDiffs = ["easy", "medium", "hard", "mixed"];
    const qCount = validCounts.includes(room.question_count) ? room.question_count : 10;
    const diff = validDiffs.includes(room.difficulty_filter) ? room.difficulty_filter : "mixed";
    const res = await fetch("/api/room/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: room.name,
        room_mode: room.room_mode,
        pack_id: room.pack_id,
        category_filter: room.category_filter,
        difficulty_filter: diff,
        question_count: qCount,
      }),
    });
    if (!res.ok) return;
    const { room: newRoom } = await res.json();
    const newId: string = newRoom.id;
    // Broadcast to all players so everyone gets redirected
    channelRef.current?.send({
      type: "broadcast",
      event: "play_again_redirect",
      payload: { roomId: newId },
    });
    setNewRoomId(newId);
  }

  function formatLobbyTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ── Signed-out visitors ───────────────────────────────────────────────────
  // The load effect needs a session (question_events RLS is member-scoped), so
  // without this gate a guest opening a shared game link spun forever.
  if (!userLoading && !user) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-6 gap-4 text-center">
        <p className="font-display text-5xl">⚽</p>
        <p className="font-display text-2xl text-white">You&apos;ve been invited to a quiz lobby</p>
        <p className="font-body text-sm" style={{ color: "#8a948f" }}>Sign in to take your seat — free, takes 10 seconds.</p>
        <Button variant="primary" tone="teal" size="lg" href={`/auth/sign-in?next=${encodeURIComponent(`/play/${roomId}`)}`}>
          Sign in to join →
        </Button>
        <BackPill fallback="/play" label="Back" tone="play" />
      </main>
    );
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
        <BackPill fallback="/play" label="Back" tone="play" />
      </main>
    );
  }

  const modeColor = MODE_COLOR[room.room_mode] ?? "#aeea00";
  const modeLabel = MODE_LABEL[room.room_mode] ?? room.room_mode;

  // ── LOBBY ─────────────────────────────────────────────────────────────────

  if (room.status === "lobby") {
    // Instant Match: no invite/QR lobby — you're already paired. Host auto-starts
    // (effect above); everyone just sees "Starting…".
    if (isInstantMatch) {
      return (
        <main className="min-h-dvh grid place-items-center bg-bg px-6">
          <GridBackground opacity={0.02} />
          <div className="relative z-10 text-center">
            <div className="mb-5 flex gap-1.5 justify-center">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-2.5 h-2.5 rounded-full bg-teal" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
              ))}
            </div>
            <p className="font-display text-2xl text-white">Opponent found</p>
            <p className="font-body text-sm text-text-muted mt-1.5">Starting your match…</p>
            {isHost && (
              <button onClick={handleStart} disabled={starting} className="mt-6 font-body text-xs underline disabled:opacity-50" style={{ color: "#8a948f" }}>
                {starting ? "Starting…" : "Tap to start now"}
              </button>
            )}
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-dvh pb-10 bg-bg">
        <GridBackground opacity={0.02} />

        <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <button onClick={() => setShowLeaveModal(true)} className="flex items-center gap-2 font-body text-sm text-text-muted">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Play
          </button>
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
          <div className="rounded-2xl px-5 py-4" style={{ background: "rgba(0,216,192,0.05)", border: "1px solid rgba(0,216,192,0.2)" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Invite Code</p>
              <button onClick={copyInvite}
                className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={{ background: copyDone ? "rgba(174,234,0,0.1)" : "rgba(0,216,192,0.1)", color: copyDone ? "#aeea00" : "#00d8c0", border: `1px solid ${copyDone ? "rgba(174,234,0,0.3)" : "rgba(0,216,192,0.25)"}` }}>
                {copyDone ? "✓ Copied!" : "Copy link"}
              </button>
            </div>
            <p className="font-display text-4xl tracking-[0.3em] mb-4 text-teal">{room.code}</p>

            {/* QR Code */}
            {joinUrl && (
              <div className="flex flex-col items-center gap-2 pt-3" style={{ borderTop: "1px solid rgba(0,216,192,0.15)" }}>
                <p className="font-body text-xs text-text-muted">Scan to join instantly</p>
                <div className="rounded-2xl p-3 bg-surface">
                  <QRCode
                    value={joinUrl}
                    size={160}
                    bgColor="#0e1611"
                    fgColor="#00d8c0"
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
              <span className="font-body text-xs" style={{ color: "#586058" }}>{players.length} / {room.max_players}</span>
            </div>
            <div className="p-3 space-y-1.5">
              {personaRows(players).map(p => (
                <div key={p.user_id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                  style={{ background: p.user_id === user?.id ? "rgba(174,234,0,0.04)" : "rgba(255,255,255,0.02)", border: `1px solid ${p.user_id === user?.id ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.05)"}` }}>
                  <Avatar name={p.display_name} size={32} />
                  <span className="font-body text-sm font-medium text-white flex-1">{p.display_name}</span>
                  {p.user_id === room.created_by && (
                    <span className="font-body text-xs px-2 py-0.5 rounded-full text-teal" style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.2)" }}>Host</span>
                  )}
                  {p.user_id === user?.id && p.user_id !== room.created_by && (
                    <span className="font-body text-xs text-green">You</span>
                  )}
                  {/* Add friend button — shown for other players, not self / the CPU */}
                  {p.user_id !== user?.id && p.user_id !== QUIZ_BOT_ID && (
                    <AddFriendInline userId={p.user_id} displayName={p.display_name} />
                  )}
                </div>
              ))}
              {players.length < room.max_players && (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.07)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.1)" }}>
                    <span style={{ color: "#3a423d", fontSize: 16 }}>+</span>
                  </div>
                  <span className="font-body text-xs" style={{ color: "#3a423d" }}>Waiting for players…</span>
                </div>
              )}
            </div>
          </div>

          {/* Start / waiting */}
          {isHost ? (
            <Button variant="primary" tone="teal" size="lg" fullWidth onClick={handleStart} disabled={starting || players.length < 1}>
              {starting ? "Starting…" : players.length < 2 ? `Waiting for players (${players.length}/2 min)` : `Start Game →`}
            </Button>
          ) : (
            <div className="rounded-2xl px-5 py-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex gap-1 flex-shrink-0">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full bg-teal" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
                ))}
              </div>
              <p className="font-body text-sm text-white">Waiting for host to start the game…</p>
            </div>
          )}
        </div>

        {/* Leave lobby confirmation modal */}
        {showLeaveModal && (
          <div className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(0,0,0,0.75)" }}
            onClick={() => setShowLeaveModal(false)}>
            <div className="w-full max-w-lg px-5 pb-6" onClick={e => e.stopPropagation()}>
              <div className="rounded-2xl overflow-hidden" style={{ background: "#15211a", border: "1px solid rgba(255,255,255,0.1)" }}>
                <div className="px-5 py-5">
                  <p className="font-display text-lg text-white mb-1">Leave lobby?</p>
                  <p className="font-body text-sm text-text-muted">You&apos;re about to leave this lobby. You may lose your place or progress.</p>
                </div>
                <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <button onClick={() => setShowLeaveModal(false)}
                    className="flex-1 py-4 font-body text-sm font-bold text-white"
                    style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                    Stay
                  </button>
                  <Link href="/play" className="flex-1 py-4 font-body text-sm text-center"
                    style={{ color: "#f87171" }}>
                    Leave
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ── COMPLETED ─────────────────────────────────────────────────────────────

  if (room.status === "completed") {
    const displayBoard = personaRows(leaderboard);
    const winner = displayBoard[0];
    const me = displayBoard.find(e => e.user_id === user?.id);
    const opponents = displayBoard.filter(e => e.user_id !== user?.id);
    const yesVotes = playAgainVotes.size;
    const totalPlayers = players.length || leaderboard.length;
    const lobbyExpired = lobbyTimeLeft === 0;

    // Redirecting everyone to new room
    if (newRoomId) {
      return (
        <main className="min-h-dvh bg-bg flex flex-col items-center justify-center gap-4 px-5">
          <p className="text-5xl">🎮</p>
          <p className="font-display text-2xl text-white">New game starting…</p>
          <p className="font-body text-sm text-text-muted">Taking you to the new lobby</p>
        </main>
      );
    }

    return (
      <main className="min-h-dvh pb-20 bg-bg">
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          {/* h2h battles came from Versus — send them back there, not the quiz tab */}
          <BackPill fallback={room.room_mode === "h2h" ? "/versus" : "/play"} label="Back" tone="play" />
          <div className="flex items-center gap-2">
            <span className="font-body text-xs" style={{ color: "#586058" }}>Game Over</span>
            {completedAt && !lobbyExpired && (
              <span className="font-body text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: lobbyTimeLeft < 60 ? "#f87171" : "#586058" }}>
                Rematch {formatLobbyTime(lobbyTimeLeft)}
              </span>
            )}
          </div>
        </nav>

        <div className="max-w-lg mx-auto px-5 space-y-4">

          {/* Result verdict — the payoff: did you win, and by what score. Leads the
              scorecard for 1v1 (where the winner tile below is then redundant). */}
          {me && (() => {
            const opp = opponents[0];
            const isH2H = room.room_mode === "h2h" && !!opp;
            let label: string, color: string, bg: string;
            if (isH2H && me.total_score > opp.total_score) { label = "YOU WON"; color = "#aeea00"; bg = "rgba(174,234,0,0.1)"; }
            else if (isH2H && me.total_score < opp.total_score) { label = "YOU LOST"; color = "#f87171"; bg = "rgba(248,113,113,0.08)"; }
            else if (isH2H) { label = "DRAW"; color = "#e8b23a"; bg = "rgba(232,178,58,0.1)"; }
            else {
              const place = me.rank ?? (displayBoard.findIndex(e => e.user_id === me.user_id) + 1);
              const won = place === 1;
              label = won ? "YOU WON" : `YOU FINISHED #${place}`;
              color = won ? "#aeea00" : "#cfd8cf"; bg = won ? "rgba(174,234,0,0.1)" : "rgba(255,255,255,0.04)";
            }
            return (
              <div className="rounded-2xl px-5 py-5 text-center" style={{ background: bg, border: `1px solid ${color}44` }}>
                <p className="font-display text-3xl tracking-wide" style={{ color }}>{label}</p>
                {isH2H && (
                  <>
                    <p className="font-display text-3xl text-white mt-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {me.total_score.toLocaleString()} <span style={{ color: "#586058" }}>–</span> {opp.total_score.toLocaleString()}
                    </p>
                    <p className="font-body text-xs text-text-muted mt-1">You vs {opp.display_name}</p>
                  </>
                )}
              </div>
            );
          })()}

          {/* Winner tile — for multiplayer (3+). For 1v1 the verdict above says it all. */}
          {winner && !(room.room_mode === "h2h" && me) && (
            <div className="rounded-2xl px-5 py-6 text-center" style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(0,216,192,0.05) 100%)", border: "1px solid rgba(255,215,0,0.25)" }}>
              <p className="text-4xl mb-2">🏆</p>
              <p className="font-body text-xs uppercase tracking-widest mb-1 text-text-muted">Winner</p>
              <p className="font-display text-3xl text-white mb-1">{winner.display_name}</p>
              <p className="font-display text-5xl" style={{ color: "#ffd700" }}>{winner.total_score.toLocaleString()}</p>
              <p className="font-body text-sm mt-1 text-text-muted">points</p>
            </div>
          )}

          {/* Your result */}
          {me && me.user_id !== winner?.user_id && (
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between" style={{ background: "rgba(174,234,0,0.04)", border: "1px solid rgba(174,234,0,0.15)" }}>
              <div>
                <p className="font-body text-xs uppercase tracking-widest mb-0.5 text-text-muted">Your result</p>
                <p className="font-body text-sm font-bold text-white">#{me.rank} · {me.correct_answers} correct</p>
              </div>
              <p className="font-display text-3xl text-green">{me.total_score.toLocaleString()}</p>
            </div>
          )}

          {/* Post-game reward moment — points earned + position on the leaderboard */}
          <RankRewardCard />

          {/* Friend prompts — show for all non-self, non-CPU opponents after game */}
          {user && opponents.filter(o => o.user_id !== user.id && o.user_id !== QUIZ_BOT_ID).map(opp => (
            <AddFriendCard
              key={opp.user_id}
              userId={opp.user_id}
              displayName={opp.display_name}
              context={room.room_mode === "h2h" ? `Great game with ${opp.display_name}! 👏` : undefined}
            />
          ))}

          {/* Shadow/CPU rooms: forward motion first — the scorecard's job is to
              get you into the next game, not to be an exit. */}
          {(room.shadow || players.some((p) => p.user_id === QUIZ_BOT_ID)) && (
            <div className="rounded-2xl px-5 py-4 space-y-2" style={{ background: "rgba(0,216,192,0.06)", border: "1px solid rgba(0,216,192,0.2)" }}>
              <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em] mb-1" style={{ color: "#00d8c0" }}>Keep playing</p>
              <Link href={`/versus/find?game=quiz${room.pack_id ? `&pack=${room.pack_id}` : ""}`} className="block w-full text-center rounded-xl py-3.5 font-display text-base tracking-wide active:scale-[0.99] transition-transform" style={{ background: "#00d8c0", color: "#04231f" }}>
                PLAY AGAIN — NEW OPPONENT →
              </Link>
              <Link href="/versus/quiz" className="block w-full text-center rounded-xl py-3 font-display text-sm tracking-wide" style={{ background: "rgba(255,255,255,0.05)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.14)" }}>
                PICK A DIFFERENT QUIZ →
              </Link>
            </div>
          )}

          {/* Shadow room: the honest reveal — you played a real player's past run */}
          {room.shadow && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(160deg, rgba(0,216,192,0.1), #0c1613)", border: "1px solid rgba(0,216,192,0.3)" }}>
              <div className="px-5 pt-5 pb-4">
                <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em] mb-3" style={{ color: "#00d8c0" }}>The reveal</p>
                <div className="flex items-center gap-3">
                  <PlayerAvatar seed={room.shadow.userId} name={room.shadow.name} avatarUrl={room.shadow.avatarUrl} size={44} ring="#00d8c0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm text-white leading-snug">
                      You just played <span className="font-bold">{room.shadow.name}</span>&rsquo;s real run{room.shadow.playedAt ? ` from ${new Date(room.shadow.playedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""} — every answer, at their real speed.
                    </p>
                    <p className="font-body text-xs text-text-muted mt-1">Their run scored {room.shadow.originalScore.toLocaleString()} back then.</p>
                  </div>
                </div>
              </div>
              <div className="px-5 pb-5 flex gap-2">
                <Link href={`/versus/shadow/${room.shadow.userId}`} className="flex-1 text-center rounded-xl py-3 font-display text-[12px] tracking-wide" style={{ background: "rgba(0,216,192,0.12)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}>
                  PLAY THEIR RUNS
                </Link>
                <Link href={`/versus/quiz?to=${room.shadow.userId}`} className="flex-1 text-center rounded-xl py-3 font-display text-[12px] tracking-wide" style={{ background: "rgba(255,255,255,0.05)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.14)" }}>
                  CHALLENGE LIVE
                </Link>
              </div>
            </div>
          )}

          {/* While the result's fresh: the quiz's own discussion + today's debate */}
          {room.pack_id && (
            <DiscussionThread subjectType="pack" subjectId={room.pack_id} title="Talk about this quiz" signInNext={`/play/${room.id}`} />
          )}
          <DebateCard signInNext={`/play/${room.id}`} />

          {/* ── Play Again voting panel (human rooms) ─────────────────────── */}
          {!lobbyExpired && !players.some((p) => p.user_id === QUIZ_BOT_ID) && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,216,192,0.06)", border: "1px solid rgba(0,216,192,0.2)" }}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(0,216,192,0.12)" }}>
                <p className="font-body text-xs font-bold uppercase tracking-widest text-teal">Play Again?</p>
                <p className="font-body text-xs" style={{ color: "#586058" }}>
                  {yesVotes > 0 ? `${yesVotes}/${totalPlayers} want to play` : "Vote below"}
                </p>
              </div>
              <div className="px-5 py-4">
                {/* Vote bar */}
                {totalPlayers > 0 && (
                  <div className="h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(yesVotes / totalPlayers) * 100}%`, background: "#00d8c0" }} />
                  </div>
                )}

                {!isHost ? (
                  /* Non-host: just vote */
                  <div className="flex gap-3">
                    <button onClick={() => castPlayAgainVote("yes")}
                      className="flex-1 py-3 rounded-xl font-body font-bold text-sm transition-all"
                      style={{
                        background: myVote === "yes" ? "#00d8c0" : "rgba(0,216,192,0.1)",
                        color: myVote === "yes" ? "#0a0a0f" : "#00d8c0",
                        border: `1px solid ${myVote === "yes" ? "#00d8c0" : "rgba(0,216,192,0.3)"}`,
                      }}>
                      {myVote === "yes" ? "✓ I'm in!" : room.room_mode === "h2h" && opponents[0] ? `Run it back against ${opponents[0].display_name}? 🎮` : "Play Again 🎮"}
                    </button>
                    <button onClick={() => castPlayAgainVote("no")}
                      className="flex-1 py-3 rounded-xl font-body font-bold text-sm transition-all"
                      style={{
                        background: myVote === "no" ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                        color: myVote === "no" ? "#ffffff" : "#586058",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}>
                      Leave
                    </button>
                  </div>
                ) : (
                  /* Host: vote + launch */
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <button onClick={() => castPlayAgainVote("yes")}
                        className="flex-1 py-3 rounded-xl font-body font-bold text-sm transition-all"
                        style={{
                          background: myVote === "yes" ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)",
                          color: myVote === "yes" ? "#00d8c0" : "#8a948f",
                          border: `1px solid ${myVote === "yes" ? "rgba(0,216,192,0.4)" : "rgba(255,255,255,0.08)"}`,
                        }}>
                        {myVote === "yes" ? "✓ You're in" : "I'm in"}
                      </button>
                      <button onClick={() => castPlayAgainVote("no")}
                        className="flex-1 py-3 rounded-xl font-body font-bold text-sm transition-all"
                        style={{
                          background: "rgba(255,255,255,0.04)", color: "#586058",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}>
                        Skip
                      </button>
                    </div>
                    <Button variant="primary" tone="teal" size="md" fullWidth onClick={handlePlayAgain}>
                      🎮 Start New Game ({yesVotes} ready)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Final Standings */}
          <div className="rounded-2xl overflow-hidden bg-surface border border-border">
            <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Final Standings</p>
              <p className="font-body text-xs mt-0.5" style={{ color: "#586058" }}>Tap a player to see their stats</p>
            </div>
            <div className="p-3">
              {leaderboard.length > 0 ? (
                <Leaderboard entries={personaRows(leaderboard)} currentUserId={user?.id} showFull maxVisible={leaderboard.length} />
              ) : (
                <p className="font-body text-sm text-center py-4 text-text-muted">Tallying the final scores…</p>
              )}
            </div>
          </div>

          {/* Bottom actions */}
          <div className="flex gap-3">
            {isHost && lobbyExpired && (
              <Button variant="primary" tone="teal" size="md" href="/play/new" className="flex-1">
                New Lobby 🎮
              </Button>
            )}
            <Button variant="ghost" size="md" onClick={() => router.push(smartBackTarget(room.room_mode === "h2h" ? "/versus" : "/play"))} className="flex-1">
              Back
            </Button>
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
              <p className="font-body text-sm" style={{ color: "#586058" }}>
                Q{room.current_question_idx + 1}<span style={{ color: "#3a423d" }}>/{room.question_count}</span>
              </p>
              {/* Live answer progress counter (Fix #7) */}
              {activeQuestion && players.length > 0 && (
                <p className="font-body text-xs" style={{ color: answeredCount >= players.length ? "#aeea00" : "#8a948f" }}>
                  {answeredCount}/{players.length} answered
                </p>
              )}
              {!activeQuestion && (
                <p className="font-body text-xs" style={{ color: "#3a423d" }}>{players.length} players</p>
              )}
            </div>
            {closesAt && <CountdownRing closesAt={closesAt} />}
          </div>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4 pt-4">

        {/* Waiting for first question */}
        {!activeQuestion && room.status === "live" && (
          <div className="rounded-2xl px-5 py-8 text-center" style={{ background: "rgba(0,216,192,0.04)", border: "1px solid rgba(0,216,192,0.15)" }}>
            <div className="flex justify-center gap-1.5 mb-3">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-3 h-3 rounded-full bg-teal" style={{ animation: `pulse 1.4s ease-in-out ${i * 0.25}s infinite` }} />
              ))}
            </div>
            <p className="font-body text-sm font-bold text-white">Next question incoming…</p>
            <p className="font-body text-xs mt-1 text-text-muted">Get ready</p>
          </div>
        )}

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div ref={standingsRef} className="rounded-2xl overflow-hidden bg-surface border border-border scroll-mt-4">
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs uppercase tracking-widest text-text-muted">Live Standings</p>
              <span className="font-body text-xs" style={{ color: "#586058" }}>tap for stats</span>
            </div>
            <div className="p-3">
              <Leaderboard entries={personaRows(leaderboard)} currentUserId={user?.id} maxVisible={8} />
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
          <Button variant="primary" tone="teal" size="md" fullWidth href="/auth/sign-in">Sign in to play →</Button>
        </div>
      )}
    </main>
  );
}
