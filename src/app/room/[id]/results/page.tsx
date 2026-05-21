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
  best_streak: number;
  rank: number;
}

interface RoomInfo {
  name: string;
  match: { home_team: string; away_team: string; flag_home: string; flag_away: string };
}

const MOCK_RESULTS: PlayerResult[] = [
  { user_id: "1", display_name: "Zach",   total_score: 1850, correct_answers: 9, total_answers: 11, best_streak: 4, rank: 1 },
  { user_id: "2", display_name: "Marcus", total_score: 1540, correct_answers: 8, total_answers: 11, best_streak: 3, rank: 2 },
  { user_id: "3", display_name: "Priya",  total_score: 1120, correct_answers: 6, total_answers: 11, best_streak: 2, rank: 3 },
  { user_id: "4", display_name: "Tom W",  total_score: 890,  correct_answers: 5, total_answers: 11, best_streak: 2, rank: 4 },
  { user_id: "5", display_name: "Jay",    total_score: 640,  correct_answers: 3, total_answers: 11, best_streak: 1, rank: 5 },
];

const MOCK_ROOM: RoomInfo = {
  name: "The Lads' Room",
  match: { home_team: "England", away_team: "France", flag_home: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", flag_away: "🇫🇷" },
};

const PODIUM_COLOR = ["#ffd700", "#c0c0c0", "#cd7f32"];
const PODIUM_HEIGHT = [96, 72, 56];
const PODIUM_LABEL = ["1ST", "2ND", "3RD"];
// Podium display order: 2nd, 1st, 3rd
const PODIUM_ORDER = [1, 0, 2];

function AvatarCircle({ name, size = 40 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {name[0].toUpperCase()}
    </div>
  );
}

export default function ResultsPage({ params }: { params: { id: string } }) {
  const { user } = useUser();
  const [results, setResults] = useState<PlayerResult[]>(MOCK_RESULTS);
  const [room, setRoom] = useState<RoomInfo>(MOCK_ROOM);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      Promise.all([
        supabase.from("rooms").select("name, matches(home_team, away_team)").eq("id", params.id).single(),
        supabase.from("room_scores")
          .select("user_id, total_score, correct_answers, total_answers, best_streak, rank, profiles(display_name)")
          .eq("room_id", params.id)
          .order("rank", { ascending: true }),
      ]).then(([{ data: r }, { data: scores }]) => {
        if (r) setRoom({ name: (r as any).name, match: (r as any).matches ?? MOCK_ROOM.match });
        if (scores?.length) {
          setResults(scores.map((s: any) => ({
            user_id: s.user_id,
            display_name: s.profiles?.display_name ?? "Player",
            total_score: s.total_score,
            correct_answers: s.correct_answers,
            total_answers: s.total_answers,
            best_streak: s.best_streak,
            rank: s.rank ?? 0,
          })));
        }
      });
    });
  }, [params.id]);

  const me = results.find((r) => r.user_id === user?.id) ?? results[0];
  const top3 = results.slice(0, 3);
  const rest = results.slice(3);
  const accuracy = me.total_answers > 0 ? Math.round((me.correct_answers / me.total_answers) * 100) : 0;

  function handleShare() {
    const accuracy = me.total_answers > 0 ? Math.round((me.correct_answers / me.total_answers) * 100) : 0;
    const rankEmoji = me.rank === 1 ? "🥇" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : `#${me.rank}`;
    const text = `${rankEmoji} ${me.correct_answers}/${me.total_answers} correct · ${accuracy}% accuracy\n${me.total_score.toLocaleString()} pts in ${room.name}\n${room.match.flag_home} ${room.match.home_team} vs ${room.match.away_team} ${room.match.flag_away}\n\nCan you beat me? 👀\n${window.location.origin}/join`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(wa, "_blank");
    }
    setShared(true);
    setTimeout(() => setShared(false), 3000);
  }

  return (
    <main className="min-h-dvh bg-bg pb-16">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      {/* Header */}
      <div className="sticky top-0 z-10" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <div>
            <p className="font-body text-xs text-text-muted">{room.name}</p>
            <p className="font-body text-sm font-semibold text-white">
              {room.match.flag_home} {room.match.home_team} vs {room.match.away_team} {room.match.flag_away}
            </p>
          </div>
          <span className="px-3 py-1.5 rounded-full font-body text-xs font-semibold uppercase tracking-widest"
            style={{ background: "rgba(255,255,255,0.06)", color: "#8888aa", border: "1px solid rgba(255,255,255,0.1)" }}>
            Final
          </span>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-6 space-y-5">

        {/* Podium */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest text-center mb-6">Final standings</p>
          <div className="flex items-end justify-center gap-3">
            {PODIUM_ORDER.map((idx) => {
              const p = top3[idx];
              if (!p) return null;
              const color = PODIUM_COLOR[idx];
              const h = PODIUM_HEIGHT[idx];
              const isFirst = idx === 0;
              return (
                <div key={p.user_id} className="flex flex-col items-center gap-2" style={{ width: 96 }}>
                  <AvatarCircle name={p.display_name} size={isFirst ? 52 : 40} />
                  <p className="font-body text-xs font-semibold text-white text-center truncate w-full text-center">{p.display_name}</p>
                  <p className="font-display text-sm leading-none" style={{ color }}>{p.total_score.toLocaleString()}</p>
                  <div
                    className="w-full rounded-t-xl flex items-center justify-center"
                    style={{ height: h, background: `${color}18`, border: `1px solid ${color}30`, borderBottom: "none" }}
                  >
                    <span className="font-display text-xl" style={{ color }}>{PODIUM_LABEL[idx]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Your performance */}
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,255,135,0.15)" }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: "rgba(0,255,135,0.06)", borderBottom: "1px solid rgba(0,255,135,0.1)" }}>
            <p className="font-body text-xs font-semibold uppercase tracking-widest" style={{ color: "#00ff87" }}>Your performance</p>
            <span className="font-display text-sm" style={{ color: "#00ff87" }}>#{me.rank}</span>
          </div>
          <div className="grid grid-cols-4 divide-x" style={{ background: "#12121e", borderColor: "rgba(255,255,255,0.06)" }}>
            {[
              { label: "Score",    value: me.total_score.toLocaleString(), color: "#00ff87" },
              { label: "Correct",  value: `${me.correct_answers}/${me.total_answers}`, color: "#ffffff" },
              { label: "Accuracy", value: `${accuracy}%`, color: accuracy >= 70 ? "#00ff87" : accuracy >= 50 ? "#ffb800" : "#ff4757" },
              { label: "Streak",   value: `×${me.best_streak}`, color: "#ffb800" },
            ].map((s) => (
              <div key={s.label} className="px-4 py-4 text-center" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <p className="font-display text-xl leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="font-body text-xs text-text-muted mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Share card */}
        <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-body text-xs text-text-muted mb-3">Challenge your mates</p>
          <div className="rounded-xl p-4 mb-4" style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.1)" }}>
            <p className="font-body text-sm text-white leading-relaxed">
              {me.rank === 1 ? "🥇" : me.rank === 2 ? "🥈" : me.rank === 3 ? "🥉" : `#${me.rank}`}{" "}
              <span className="font-display text-lg" style={{ color: "#00ff87" }}>{me.correct_answers}/{me.total_answers}</span> correct ·{" "}
              <span style={{ color: accuracy >= 70 ? "#00ff87" : accuracy >= 50 ? "#ffb800" : "#ff4757" }}>{accuracy}%</span> accuracy
            </p>
            <p className="font-body text-xs text-text-muted mt-1">
              {me.total_score.toLocaleString()} pts in <strong className="text-white">{room.name}</strong> · Can you beat me? 👀
            </p>
          </div>
          <button
            onClick={handleShare}
            className="w-full py-3.5 rounded-xl font-body text-sm font-semibold transition-all flex items-center justify-center gap-2"
            style={{
              background: shared ? "rgba(0,255,135,0.12)" : "rgba(37,211,102,0.12)",
              color: shared ? "#00ff87" : "#25d366",
              border: `1px solid ${shared ? "rgba(0,255,135,0.2)" : "rgba(37,211,102,0.2)"}`,
            }}
          >
            {shared ? "✓ Challenge sent!" : "Challenge your mates on WhatsApp"}
          </button>
        </div>

        {/* Rest of leaderboard */}
        {rest.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="px-5 py-3" style={{ background: "#12121e", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-body text-xs text-text-muted uppercase tracking-widest">Full standings</p>
            </div>
            <div style={{ background: "#12121e" }}>
              {[...top3, ...rest].map((p, i) => {
                const isSelf = p.user_id === user?.id || p.user_id === me.user_id;
                return (
                  <div key={p.user_id} className="flex items-center gap-3 px-5 py-3"
                    style={{ borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      background: isSelf ? "rgba(0,255,135,0.04)" : "transparent" }}>
                    <span className="font-display text-base w-6 text-center flex-shrink-0"
                      style={{ color: p.rank <= 3 ? PODIUM_COLOR[p.rank - 1] : "#8888aa" }}>
                      {p.rank}
                    </span>
                    <AvatarCircle name={p.display_name} size={30} />
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">
                        {p.display_name}
                        {isSelf && <span className="ml-2 text-xs" style={{ color: "#00ff87" }}>you</span>}
                      </p>
                      <p className="font-body text-xs text-text-muted">{p.correct_answers}/{p.total_answers} correct</p>
                    </div>
                    <p className="font-display text-lg flex-shrink-0"
                      style={{ color: isSelf ? "#00ff87" : "#ffffff" }}>
                      {p.total_score.toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Back to lobby */}
        <div className="flex gap-3">
          <Link href="/" className="flex-1 py-3 rounded-xl font-body text-sm text-center text-text-muted hover:text-white transition-colors"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            Home
          </Link>
          <Link href="/room/new" className="flex-1 py-3 rounded-xl font-body text-sm font-semibold text-center transition-opacity hover:opacity-80"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.2)" }}>
            New room →
          </Link>
        </div>
      </div>
    </main>
  );
}
