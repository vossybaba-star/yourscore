/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { RoomCodeShare } from "@/components/room/RoomCodeShare";
import { QuestionCard, type ActiveQuestion } from "@/components/game/QuestionCard";
import { Leaderboard, type LeaderboardEntry } from "@/components/game/Leaderboard";
import { useUser } from "@/hooks/useUser";
import { BottomNav } from "@/components/ui/BottomNav";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RoomData {
  id: string;
  code: string;
  name: string;
  status: "lobby" | "live" | "completed";
  created_by: string | null;
  match_id: string | null;
  match: { home_team: string; away_team: string; match_date: string; flag_home: string; flag_away: string; home_score: number; away_score: number } | null;
}

interface LobbyPlayer { id: string; display_name: string; joined_at: string; }

const FLAG_MAP: Record<string, string> = {
  England: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", France: "🇫🇷", Brazil: "🇧🇷", Argentina: "🇦🇷",
  Germany: "🇩🇪", Spain: "🇪🇸", Portugal: "🇵🇹", Netherlands: "🇳🇱",
  USA: "🇺🇸", Mexico: "🇲🇽", Italy: "🇮🇹", Morocco: "🇲🇦",
};

const FALLBACK_ROOM: RoomData = {
  id: "mock-room-id", code: "ENG123", name: "The Lads' Room", status: "lobby",
  created_by: null, match_id: null,
  match: { home_team: "England", away_team: "France", match_date: "2026-06-15T19:00:00Z", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", flag_away: "🇫🇷", home_score: 0, away_score: 0 },
};

const FALLBACK_PLAYERS: LeaderboardEntry[] = [
  { user_id: "1", display_name: "Zach",   avatar_url: null, total_score: 1250, correct_answers: 7, current_streak: 3, rank: 1 },
  { user_id: "2", display_name: "Marcus", avatar_url: null, total_score: 1100, correct_answers: 6, current_streak: 2, rank: 2 },
  { user_id: "3", display_name: "Priya",  avatar_url: null, total_score: 950,  correct_answers: 5, current_streak: 0, rank: 3 },
];

function makeMockQuestion(): ActiveQuestion {
  return {
    eventId: "evt-1", questionId: "q-1",
    questionText: "How many World Cup goals has Kylian Mbappé scored for France?",
    optionA: "9 goals", optionB: "12 goals", optionC: "7 goals", optionD: "15 goals",
    difficulty: "medium", category: "player_fact",
    explanation: "Mbappé has scored 12 World Cup goals for France across multiple tournaments.",
    startTime: new Date(), totalSeconds: 45,
  };
}

function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "1px solid rgba(255,255,255,0.08)" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

function MatchCountdown({ matchDate }: { matchDate: string }) {
  const [diff, setDiff] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setDiff(new Date(matchDate).getTime() - Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [matchDate]);
  if (diff === null) return null;
  if (diff <= 0) return <span style={{ color: "#00ff87" }} className="font-display text-2xl">LIVE NOW</span>;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return <span className="font-display text-2xl text-white">{h > 0 && <>{h}h </>}{m}m {s}s</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

type RoomState = "lobby" | "live" | "completed";

export default function RoomPage({ params }: { params: { id: string } }) {
  const { user } = useUser();
  const [room, setRoom] = useState<RoomData | null>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ? null : FALLBACK_ROOM
  );
  const [roomState, setRoomState] = useState<RoomState>("lobby");
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(FALLBACK_PLAYERS);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const supabaseRef = useRef<any>(null);

  // ── Fetch room + members + wire realtime ──────────────────────────────────
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return;
    }

    import("@/lib/supabase/client").then(({ createClient }) => {
      const sb = createClient();
      supabaseRef.current = sb;

      // Fetch room + match
      sb.from("rooms")
        .select("id, code, name, status, created_by, match_id, matches(home_team, away_team, match_date, home_score, away_score)")
        .eq("id", params.id)
        .single()
        .then(({ data }) => {
          if (data) {
            const d = data as any;
            setRoom({
              id: d.id, code: d.code, name: d.name, status: d.status,
              created_by: d.created_by, match_id: d.match_id ?? null,
              match: d.matches ? {
                home_team: d.matches.home_team, away_team: d.matches.away_team,
                match_date: d.matches.match_date,
                flag_home: FLAG_MAP[d.matches.home_team] ?? "🏳️",
                flag_away: FLAG_MAP[d.matches.away_team] ?? "🏳️",
                home_score: d.matches.home_score ?? 0,
                away_score: d.matches.away_score ?? 0,
              } : null,
            });
            setRoomState(d.status as RoomState);
          }
        });

      // Fetch lobby players
      const fetchLobbyPlayers = () =>
        sb.from("room_members")
          .select("user_id, joined_at, profiles(display_name)")
          .eq("room_id", params.id)
          .order("joined_at", { ascending: true })
          .then(({ data }) => {
            if (data) {
              setLobbyPlayers(data.map((row: any) => ({
                id: row.user_id,
                display_name: row.profiles?.display_name ?? "Player",
                joined_at: row.joined_at,
              })));
            }
          });
      fetchLobbyPlayers();

      // Fetch leaderboard
      sb.from("room_scores")
        .select("*, profiles(display_name, avatar_url)")
        .eq("room_id", params.id)
        .order("rank", { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setLeaderboard(data.map((row: any) => ({
              user_id: row.user_id,
              display_name: row.profiles?.display_name ?? "Player",
              avatar_url: row.profiles?.avatar_url ?? null,
              total_score: row.total_score,
              correct_answers: row.correct_answers,
              current_streak: row.current_streak,
              rank: row.rank ?? 0,
            })));
          }
        });

      // Realtime subscriptions
      const channel = sb.channel(`room:${params.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "question_events", filter: `room_id=eq.${params.id}` },
          async (payload) => {
            const event = payload.new as any;
            if (event.status !== "live") return;
            const { data: q } = await sb.from("questions").select("*").eq("id", event.question_id).single();
            if (!q) return;
            setRoomState("live");
            setActiveQuestion({
              eventId: event.id, questionId: q.id, questionText: q.question_text,
              optionA: q.option_a, optionB: q.option_b, optionC: q.option_c, optionD: q.option_d,
              difficulty: q.difficulty, category: q.category, explanation: q.explanation,
              startTime: new Date(event.fired_at), totalSeconds: 45,
            });
            setQuestionCount((n) => n + 1);
          }
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "room_scores", filter: `room_id=eq.${params.id}` },
          async () => {
            const { data } = await sb.from("room_scores")
              .select("*, profiles(display_name, avatar_url)")
              .eq("room_id", params.id).order("rank", { ascending: true });
            if (data) {
              setLeaderboard(data.map((row: any) => ({
                user_id: row.user_id, display_name: row.profiles?.display_name ?? "Player",
                avatar_url: row.profiles?.avatar_url ?? null, total_score: row.total_score,
                correct_answers: row.correct_answers, current_streak: row.current_streak, rank: row.rank ?? 0,
              })));
            }
          }
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${params.id}` },
          (payload) => {
            const u = payload.new as any;
            if (u.status) setRoomState(u.status);
          }
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_members", filter: `room_id=eq.${params.id}` },
          () => fetchLobbyPlayers()
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches" },
          (payload) => {
            const u = payload.new as any;
            setRoom((prev) => {
              if (!prev || !prev.match || prev.match_id !== u.id) return prev;
              const updated: RoomData = { ...prev, match: { ...prev.match, home_score: u.home_score ?? prev.match.home_score, away_score: u.away_score ?? prev.match.away_score } };
              return updated;
            });
          }
        )
        .subscribe();

      return () => { sb.removeChannel(channel); };
    });
  }, [params.id]);

  // ── Answer handler ────────────────────────────────────────────────────────
  const handleAnswer = useCallback(async (letter: "a" | "b" | "c" | "d") => {
    if (!activeQuestion) throw new Error("No active question");
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      await new Promise((r) => setTimeout(r, 300));
      return { isCorrect: letter === "b", points: letter === "b" ? 185 : 0, correctAnswer: "b" as const };
    }
    const res = await fetch("/api/answer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionEventId: activeQuestion.eventId, selectedAnswer: letter, roomId: params.id }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error); }
    return res.json();
  }, [activeQuestion, params.id]);

  const handleQuestionExpire = useCallback(() => {
    setTimeout(() => setActiveQuestion(null), 4000);
  }, []);

  if (!room) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-green animate-spin" style={{ borderTopColor: "#00ff87" }} />
      </main>
    );
  }

  const isCreator = user?.id === room.created_by || (!process.env.NEXT_PUBLIC_SUPABASE_URL && !user);

  // ── Header ────────────────────────────────────────────────────────────────
  const header = (
    <div className="sticky top-0 z-10" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
        <div>
          <p className="font-body text-xs text-text-muted">{room.name}</p>
          <p className="font-body text-sm font-semibold text-white">
            {room.match ? `${room.match.flag_home} ${room.match.home_team} vs ${room.match.away_team} ${room.match.flag_away}` : room.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {questionCount > 0 && <span className="font-body text-xs text-text-muted">Q{questionCount}</span>}
          <div className="px-3 py-1.5 rounded-full text-xs font-body font-semibold uppercase tracking-widest"
            style={{ background: roomState === "live" ? "rgba(0,255,135,0.12)" : "rgba(255,184,0,0.12)", color: roomState === "live" ? "#00ff87" : "#ffb800", border: `1px solid ${roomState === "live" ? "rgba(0,255,135,0.2)" : "rgba(255,184,0,0.2)"}` }}>
            {roomState === "lobby" ? "Lobby" : roomState === "live" ? "Live" : "Ended"}
          </div>
        </div>
      </div>
    </div>
  );

  // ── LOBBY ─────────────────────────────────────────────────────────────────
  if (roomState === "lobby") {
    const displayPlayers = lobbyPlayers.length > 0 ? lobbyPlayers : [];

    return (
      <main className="min-h-dvh bg-bg pb-28">
        <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
        {header}
        <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-4">
          {room.match && (
            <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-2">Match starts in</p>
              <MatchCountdown matchDate={room.match.match_date} />
              <p className="font-body text-xs text-text-muted mt-2">
                {new Date(room.match.match_date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
          )}

          <RoomCodeShare code={room.code} roomName={room.name} />

          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: "#12121e", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">Players joined</p>
              <span className="font-display text-xl" style={{ color: "#00ff87" }}>{displayPlayers.length}</span>
            </div>
            <div style={{ background: "#12121e" }}>
              {displayPlayers.length === 0 ? (
                <div className="px-5 py-4">
                  <p className="font-body text-xs text-text-muted">No players yet. Share the code!</p>
                </div>
              ) : displayPlayers.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 px-5 py-3"
                  style={{ borderBottom: i < displayPlayers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <AvatarCircle name={p.display_name} />
                  <div className="flex-1">
                    <p className="font-body text-sm font-medium text-white">{p.display_name}</p>
                    <p className="font-body text-xs text-text-muted">
                      Joined {new Date(p.joined_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {room.created_by && p.id === room.created_by && (
                    <span className="text-xs font-body text-text-muted px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>host</span>
                  )}
                  {p.id === user?.id && (
                    <span className="text-xs font-body px-2 py-1 rounded-full" style={{ color: "#00ff87", background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.15)" }}>you</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isCreator && (
            <div className="rounded-2xl p-4" style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.12)" }}>
              <p className="font-body text-xs font-semibold mb-1" style={{ color: "#00ff87" }}>You created this room</p>
              <p className="font-body text-xs text-text-muted leading-relaxed">Questions fire automatically during the match — no action needed from you. Keep this tab open.</p>
            </div>
          )}
          {true && (
            <div className="space-y-3">
              <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ffb800" }} />
                  <p className="font-body text-xs font-semibold text-white">Waiting for match to start</p>
                </div>
                <p className="font-body text-xs text-text-muted leading-relaxed">Keep this tab open. Questions fire automatically during the match.</p>
              </div>

              <div className="rounded-2xl p-4" style={{ background: "rgba(0,255,135,0.03)", border: "1px solid rgba(0,255,135,0.08)" }}>
                <p className="font-body text-xs font-semibold mb-1" style={{ color: "#00ff87" }}>The more players, the better the battle</p>
                <p className="font-body text-xs text-text-muted mb-3">Drop the code in your group chat — they can join any time before the match.</p>
                <button
                  onClick={() => {
                    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
                    const text = `Join my YourScore room 🏆\n${room.match ? `${room.match.home_team} vs ${room.match.away_team}` : room.name}\n\nCode: ${room.code}\n${appUrl}/join/${room.code}`;
                    if (navigator.share) navigator.share({ text }).catch(() => {});
                    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-body font-semibold hover:opacity-80 transition-opacity"
                  style={{ color: "#25d366" }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                  Invite on WhatsApp
                </button>
              </div>
            </div>
          )}

          {process.env.NODE_ENV === "development" && (
            <button onClick={() => { setRoomState("live"); setActiveQuestion(makeMockQuestion()); }}
              className="w-full py-3 rounded-xl font-body text-xs text-text-muted hover:text-white transition-colors"
              style={{ border: "1px dashed rgba(255,255,255,0.1)" }}>
              [dev] Preview live game →
            </button>
          )}
        </div>
        <BottomNav />
      </main>
    );
  }

  // ── COMPLETED ─────────────────────────────────────────────────────────────
  if (roomState === "completed") {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-5">
        <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="relative z-0 w-full max-w-sm text-center space-y-6">
          <div>
            <p className="font-display text-6xl mb-3">🏆</p>
            <h1 className="font-display text-4xl text-white tracking-wide">FULL TIME</h1>
            <p className="font-body text-sm text-text-muted mt-2">{room.name} · Final results are in</p>
          </div>
          <Link href={`/room/${params.id}/results`}
            className="block w-full py-4 rounded-2xl font-display text-xl tracking-widest transition-opacity hover:opacity-80"
            style={{ background: "rgba(0,255,135,0.12)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
            SEE RESULTS →
          </Link>
        </div>
      </main>
    );
  }

  // ── LIVE ──────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-dvh bg-bg pb-10">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      {header}
      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5 space-y-4">

        {/* ── Match scoreboard ──────────────────────────────────────────── */}
        {room.match && !activeQuestion && (
          <MatchScoreboard match={room.match} playerCount={leaderboard.length} />
        )}

        {/* ── "Next question coming" pulse ──────────────────────────────── */}
        {!activeQuestion && (
          <div className="rounded-2xl px-5 py-4 flex items-center gap-4" style={{ background: "rgba(255,184,0,0.04)", border: "1px solid rgba(255,184,0,0.15)" }}>
            <div className="flex gap-1 flex-shrink-0">
              {[0,1,2].map((i) => (
                <span key={i} className="w-2 h-2 rounded-full" style={{ background: "#ffb800", animation: `pulse 1.4s ease-in-out ${i*0.25}s infinite` }} />
              ))}
            </div>
            <div>
              <p className="font-body text-sm font-semibold text-white">Next question incoming</p>
              <p className="font-body text-xs text-text-muted">Stay on this tab — questions fire without warning</p>
            </div>
          </div>
        )}

        {/* ── Leaderboard ────────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ background: "#12121e", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest">Live Standings</p>
            <Link href={`/room/${params.id}/leaderboard`} className="font-body text-xs" style={{ color: "#00ff87" }}>Full table →</Link>
          </div>
          <div className="p-3" style={{ background: "#12121e" }}>
            <Leaderboard entries={leaderboard} currentUserId={user?.id} maxVisible={5} />
          </div>
        </div>

        {/* ── My rank spotlight ─────────────────────────────────────────── */}
        {user && !activeQuestion && (() => {
          const me = leaderboard.find(e => e.user_id === user.id);
          if (!me) return null;
          return (
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.12)" }}>
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Your position</p>
                <p className="font-body text-sm font-semibold text-white">
                  {me.current_streak >= 2 ? `🔥 ${me.current_streak}× streak · ` : ""}
                  {me.correct_answers} correct
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-3xl" style={{ color: "#00ff87" }}>#{me.rank || "—"}</p>
                <p className="font-body text-xs text-text-muted">{me.total_score.toLocaleString()} pts</p>
              </div>
            </div>
          );
        })()}

        {process.env.NODE_ENV === "development" && (
          <div className="flex gap-2">
            <button onClick={() => setActiveQuestion(activeQuestion ? null : makeMockQuestion())}
              className="flex-1 py-3 rounded-xl font-body text-xs text-text-muted hover:text-white transition-colors"
              style={{ border: "1px dashed rgba(255,255,255,0.1)" }}>
              [dev] {activeQuestion ? "Hide question" : "Fire mock question →"}
            </button>
            <button onClick={() => setRoomState("completed")}
              className="py-3 px-4 rounded-xl font-body text-xs text-text-muted hover:text-white transition-colors"
              style={{ border: "1px dashed rgba(255,255,255,0.1)" }}>
              [dev] End →
            </button>
          </div>
        )}
      </div>

      {activeQuestion && (
        <QuestionCard question={activeQuestion} onAnswer={handleAnswer} onExpire={handleQuestionExpire} />
      )}
    </main>
  );
}

// ── Match Scoreboard Component ────────────────────────────────────────────────

interface MatchScoreboardProps {
  match: { home_team: string; away_team: string; match_date: string; flag_home: string; flag_away: string; home_score: number; away_score: number };
  playerCount: number;
}

function MatchScoreboard({ match, playerCount }: MatchScoreboardProps) {
  const [elapsed, setElapsed] = useState<string>("LIVE");

  useEffect(() => {
    const tick = () => {
      const start = new Date(match.match_date).getTime();
      const diffMs = Date.now() - start;
      if (diffMs < 0) { setElapsed("PRE"); return; }
      const mins = Math.floor(diffMs / 60000);
      if (mins < 45) { setElapsed(`${mins}'`); return; }
      if (mins < 50) { setElapsed("HT"); return; }
      if (mins < 100) { setElapsed(`${mins - 5}'`); return; }
      setElapsed("FT");
    };
    tick();
    const iv = setInterval(tick, 30000);
    return () => clearInterval(iv);
  }, [match.match_date]);

  const statusLabel = elapsed === "HT" ? "Half Time" : elapsed === "FT" ? "Full Time" : elapsed === "PRE" ? "Pre Match" : `${elapsed} In Play`;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,255,135,0.15)" }}>
      {/* Live badge */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ background: "rgba(0,255,135,0.08)", borderBottom: "1px solid rgba(0,255,135,0.1)" }}>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
          <span className="font-body text-xs font-semibold uppercase tracking-widest" style={{ color: "#00ff87" }}>
            {statusLabel}
          </span>
        </div>
        <span className="font-body text-xs text-text-muted">{playerCount} playing</span>
      </div>

      {/* Score */}
      <div className="px-5 py-6" style={{ background: "#12121e" }}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center gap-2 flex-1">
            <span className="text-4xl">{match.flag_home}</span>
            <p className="font-display text-sm text-white text-center leading-tight">{match.home_team.toUpperCase()}</p>
          </div>

          <div className="flex items-center gap-4 px-4">
            <span className="font-display text-6xl text-white tabular-nums">{match.home_score}</span>
            <span className="font-display text-3xl text-text-muted">–</span>
            <span className="font-display text-6xl text-white tabular-nums">{match.away_score}</span>
          </div>

          <div className="flex flex-col items-center gap-2 flex-1">
            <span className="text-4xl">{match.flag_away}</span>
            <p className="font-display text-sm text-white text-center leading-tight">{match.away_team.toUpperCase()}</p>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 divide-x" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0f0f1a" }}>
        {[
          { label: "Tournament", value: "WC 2026" },
          { label: "Elapsed",    value: elapsed   },
          { label: "Playing",    value: `${playerCount}` },
        ].map(s => (
          <div key={s.label} className="text-center py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <p className="font-display text-base text-white">{s.value}</p>
            <p className="font-body text-xs text-text-muted">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
