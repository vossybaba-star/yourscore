/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";

interface PlayerResult {
  user_id: string;
  display_name: string;
  total_score: number;
  correct_answers: number;
  total_answers: number;
  current_streak: number;
  best_streak: number;
  rank: number;
}

const MOCK: PlayerResult[] = [
  { user_id: "1", display_name: "Zach",   total_score: 1850, correct_answers: 9, total_answers: 11, current_streak: 4, best_streak: 4, rank: 1 },
  { user_id: "2", display_name: "Marcus", total_score: 1540, correct_answers: 8, total_answers: 11, current_streak: 2, best_streak: 3, rank: 2 },
  { user_id: "3", display_name: "Priya",  total_score: 1120, correct_answers: 6, total_answers: 11, current_streak: 0, best_streak: 2, rank: 3 },
  { user_id: "4", display_name: "Tom W",  total_score: 890,  correct_answers: 5, total_answers: 11, current_streak: 1, best_streak: 2, rank: 4 },
  { user_id: "5", display_name: "Jay",    total_score: 640,  correct_answers: 3, total_answers: 11, current_streak: 0, best_streak: 1, rank: 5 },
];

const RANK_COLOR = ["#ffd700", "#c0c0c0", "#cd7f32"];

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

export default function FullLeaderboard({ params }: { params: { id: string } }) {
  const { user } = useUser();
  const [entries, setEntries] = useState<PlayerResult[]>(MOCK);
  const [roomName, setRoomName] = useState("");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase.from("rooms").select("name").eq("id", params.id).single()
        .then(({ data }) => { if (data) setRoomName(data.name); });
      supabase.from("room_scores")
        .select("user_id, total_score, correct_answers, total_answers, current_streak, best_streak, rank, profiles(display_name)")
        .eq("room_id", params.id)
        .order("rank", { ascending: true })
        .then(({ data }) => {
          if (data?.length) setEntries(data.map((s: any) => ({
            user_id: s.user_id,
            display_name: s.profiles?.display_name ?? "Player",
            total_score: s.total_score,
            correct_answers: s.correct_answers,
            total_answers: s.total_answers,
            current_streak: s.current_streak,
            best_streak: s.best_streak,
            rank: s.rank ?? 0,
          })));
        });
    });
  }, [params.id]);

  return (
    <main className="min-h-dvh bg-bg pb-16">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="sticky top-0 z-10" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <div>
            <Link href={`/room/${params.id}`} className="font-body text-xs text-text-muted hover:text-white transition-colors">← Back</Link>
            <p className="font-body text-sm font-semibold text-white mt-0.5">{roomName || "Leaderboard"}</p>
          </div>
          <span className="font-body text-xs text-text-muted">{entries.length} players</span>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-5">
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {/* Column headers */}
          <div className="grid px-5 py-2.5" style={{ gridTemplateColumns: "36px 36px 1fr auto auto", gap: "12px", background: "#0d0d18", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="font-body text-xs text-text-muted">#</span>
            <span />
            <span className="font-body text-xs text-text-muted">Player</span>
            <span className="font-body text-xs text-text-muted text-center">Correct</span>
            <span className="font-body text-xs text-text-muted text-right">Score</span>
          </div>

          {entries.map((e, i) => {
            const isSelf = e.user_id === user?.id;
            const accuracy = e.total_answers > 0 ? Math.round((e.correct_answers / e.total_answers) * 100) : 0;
            return (
              <div key={e.user_id}
                className="grid items-center px-5 py-3"
                style={{
                  gridTemplateColumns: "36px 36px 1fr auto auto",
                  gap: "12px",
                  background: isSelf ? "rgba(0,255,135,0.04)" : "#12121e",
                  borderBottom: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                }}
              >
                <span className="font-display text-base text-center"
                  style={{ color: e.rank <= 3 ? RANK_COLOR[e.rank - 1] : "#8888aa" }}>
                  {e.rank}
                </span>
                <AvatarCircle name={e.display_name} size={32} />
                <div className="min-w-0">
                  <p className="font-body text-sm font-medium text-white truncate">
                    {e.display_name}
                    {isSelf && <span className="ml-1.5 text-xs" style={{ color: "#00ff87" }}>you</span>}
                    {e.current_streak >= 3 && <span className="ml-1.5 text-xs">🔥×{e.current_streak}</span>}
                  </p>
                  <p className="font-body text-xs text-text-muted">{accuracy}% accuracy</p>
                </div>
                <p className="font-body text-xs text-text-muted text-center">{e.correct_answers}/{e.total_answers}</p>
                <p className="font-display text-lg text-right" style={{ color: isSelf ? "#00ff87" : "#ffffff" }}>
                  {e.total_score.toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
