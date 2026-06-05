"use client";

import { useEffect, useRef, useState } from "react";

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_score: number;
  correct_answers: number;
  total_answers: number;
  current_streak: number;
  rank: number;
  avg_answer_speed_ms: number | null;
  fastest_answer_ms: number | null;
}

function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" },
    { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" },
    { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div
      className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.text,
        fontSize: size * 0.38,
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="font-display text-xl" style={{ color: "#ffd700" }}>1</span>;
  if (rank === 2) return <span className="font-display text-xl" style={{ color: "#c0c0c0" }}>2</span>;
  if (rank === 3) return <span className="font-display text-xl" style={{ color: "#cd7f32" }}>3</span>;
  return <span className="font-display text-xl text-text-muted">{rank}</span>;
}

function fmtSpeed(ms: number | null): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function accuracy(correct: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((correct / total) * 100)}%`;
}

// ── Player stats modal ────────────────────────────────────────────────────────

function PlayerStatsModal({
  entry,
  currentUserId,
  onClose,
}: {
  entry: LeaderboardEntry;
  currentUserId?: string;
  onClose: () => void;
}) {
  const isSelf = entry.user_id === currentUserId;
  const wrong = entry.total_answers - entry.correct_answers;
  const acc = accuracy(entry.correct_answers, entry.total_answers);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{ background: "rgba(10,10,15,0.8)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-t-3xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{
          background: "#12121e",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          animation: "slideUp 0.3s cubic-bezier(0.16,1,0.3,1) forwards",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <AvatarCircle name={entry.display_name} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-body text-lg font-bold text-white truncate">{entry.display_name}</p>
              {isSelf && <span className="font-body text-xs" style={{ color: "#00ff87" }}>you</span>}
            </div>
            <p className="font-body text-sm" style={{ color: "#8888aa" }}>
              #{entry.rank} · {entry.total_score.toLocaleString()} pts
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.06)", color: "#8888aa" }}
          >
            ✕
          </button>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 p-5">
          {[
            { label: "Correct", value: entry.correct_answers.toString(), color: "#00ff87", icon: "✓" },
            { label: "Wrong", value: wrong.toString(), color: "#ff4757", icon: "✗" },
            { label: "Accuracy", value: acc, color: "#a78bfa", icon: "%" },
            { label: "Avg Speed", value: fmtSpeed(entry.avg_answer_speed_ms), color: "#60a5fa", icon: "⌀" },
            { label: "Fastest", value: fmtSpeed(entry.fastest_answer_ms), color: "#ffb800", icon: "⚡" },
            {
              label: "Streak",
              value: entry.current_streak >= 1 ? `🔥×${entry.current_streak}` : "—",
              color: entry.current_streak >= 3 ? "#fb923c" : "#ffffff",
              icon: "🔥",
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-2xl px-4 py-3"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <p className="font-body text-xs uppercase tracking-widest mb-1" style={{ color: "#555577" }}>{label}</p>
              <p className="font-display text-2xl" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="pb-8" />
      </div>
    </div>
  );
}

// ── Leaderboard card ──────────────────────────────────────────────────────────

interface LeaderboardCardProps {
  entry: LeaderboardEntry;
  currentUserId?: string;
  prevRank?: number;
  isNew?: boolean;
  onClick?: () => void;
}

function LeaderboardCard({ entry, currentUserId, prevRank, isNew, onClick }: LeaderboardCardProps) {
  const isSelf = entry.user_id === currentUserId;
  const rankDelta = prevRank != null ? prevRank - entry.rank : 0;
  const wrong = entry.total_answers - entry.correct_answers;
  const acc = accuracy(entry.correct_answers, entry.total_answers);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer active:scale-[0.98]"
      style={{
        background: isSelf ? "rgba(0,255,135,0.06)" : "rgba(255,255,255,0.02)",
        border: `1px solid ${isSelf ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.05)"}`,
        animation: isNew ? "slideUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards" : undefined,
      }}
      onClick={onClick}
    >
      {/* Rank */}
      <div className="w-7 text-center flex-shrink-0">
        <RankBadge rank={entry.rank} />
      </div>

      <AvatarCircle name={entry.display_name} size={32} />

      {/* Name + stats */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-body text-sm font-medium text-white truncate">{entry.display_name}</span>
          {entry.current_streak >= 3 && (
            <span className="text-xs font-body text-amber flex items-center gap-0.5">🔥×{entry.current_streak}</span>
          )}
          {isSelf && <span className="text-xs font-body" style={{ color: "#00ff87" }}>you</span>}
        </div>
        <p className="font-body text-xs" style={{ color: "#555577" }}>
          <span style={{ color: "#00ff87" }}>✓{entry.correct_answers}</span>
          {entry.total_answers > 0 && (
            <>
              <span style={{ color: "#333355" }}> · </span>
              <span style={{ color: "#ff4757" }}>✗{wrong}</span>
              <span style={{ color: "#333355" }}> · </span>
              <span style={{ color: "#a78bfa" }}>{acc}</span>
              {entry.avg_answer_speed_ms != null && (
                <>
                  <span style={{ color: "#333355" }}> · </span>
                  <span style={{ color: "#60a5fa" }}>⚡{fmtSpeed(entry.avg_answer_speed_ms)}</span>
                </>
              )}
            </>
          )}
        </p>
      </div>

      {/* Score + delta */}
      <div className="text-right flex-shrink-0">
        <p className="font-display text-xl leading-none" style={{ color: isSelf ? "#00ff87" : "#ffffff" }}>
          {entry.total_score.toLocaleString()}
        </p>
        {rankDelta !== 0 && (
          <p className="font-body text-xs mt-0.5 flex items-center justify-end gap-0.5"
            style={{ color: rankDelta > 0 ? "#00ff87" : "#ff4757" }}>
            {rankDelta > 0 ? "▲" : "▼"} {Math.abs(rankDelta)}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId?: string;
  maxVisible?: number;
  showFull?: boolean;
}

export function Leaderboard({ entries, currentUserId, maxVisible = 5, showFull = false }: LeaderboardProps) {
  const prevEntriesRef = useRef<LeaderboardEntry[]>([]);
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});
  const [selectedEntry, setSelectedEntry] = useState<LeaderboardEntry | null>(null);

  useEffect(() => {
    const prev: Record<string, number> = {};
    prevEntriesRef.current.forEach(e => { prev[e.user_id] = e.rank; });
    setPrevRanks(prev);
    prevEntriesRef.current = entries;
  }, [entries]);

  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const selfEntry = sorted.find(e => e.user_id === currentUserId);
  const visible = showFull ? sorted : sorted.slice(0, maxVisible);
  const selfVisible = selfEntry && visible.find(e => e.user_id === currentUserId);

  return (
    <>
      <div className="space-y-2">
        {visible.map(entry => (
          <LeaderboardCard
            key={entry.user_id}
            entry={entry}
            currentUserId={currentUserId}
            prevRank={prevRanks[entry.user_id]}
            onClick={() => setSelectedEntry(entry)}
          />
        ))}

        {/* Always show self if not in visible range */}
        {!selfVisible && selfEntry && (
          <>
            <div className="text-center py-1">
              <span className="font-body text-xs text-text-muted">···</span>
            </div>
            <LeaderboardCard
              entry={selfEntry}
              currentUserId={currentUserId}
              prevRank={prevRanks[selfEntry.user_id]}
              onClick={() => setSelectedEntry(selfEntry)}
            />
          </>
        )}
      </div>

      {selectedEntry && (
        <PlayerStatsModal
          entry={selectedEntry}
          currentUserId={currentUserId}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </>
  );
}
