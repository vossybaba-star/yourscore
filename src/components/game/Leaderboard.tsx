"use client";

import { useEffect, useRef, useState } from "react";

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  total_score: number;
  correct_answers: number;
  current_streak: number;
  rank: number;
}

function AvatarCircle({ name, size = 36 }: { name: string; size?: number }) {
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" },
    { bg: "#2a1a4a", text: "#a78bfa" },
    { bg: "#1a4a2a", text: "#4ade80" },
    { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[name.charCodeAt(0) % palettes.length];
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
      {name[0].toUpperCase()}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="font-display text-xl" style={{ color: "#ffd700" }}>
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className="font-display text-xl" style={{ color: "#c0c0c0" }}>
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className="font-display text-xl" style={{ color: "#cd7f32" }}>
        3
      </span>
    );
  return (
    <span className="font-display text-xl text-text-muted">{rank}</span>
  );
}

interface LeaderboardCardProps {
  entry: LeaderboardEntry;
  currentUserId?: string;
  prevRank?: number;
  isNew?: boolean;
}

function LeaderboardCard({ entry, currentUserId, prevRank, isNew }: LeaderboardCardProps) {
  const isSelf = entry.user_id === currentUserId;
  const rankDelta = prevRank != null ? prevRank - entry.rank : 0;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
      style={{
        background: isSelf
          ? "rgba(0,255,135,0.06)"
          : "rgba(255,255,255,0.02)",
        border: `1px solid ${isSelf ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.05)"}`,
        animation: isNew ? "slideUp 0.35s cubic-bezier(0.16,1,0.3,1) forwards" : undefined,
      }}
    >
      {/* Rank */}
      <div className="w-7 text-center flex-shrink-0">
        <RankBadge rank={entry.rank} />
      </div>

      <AvatarCircle name={entry.display_name} size={32} />

      {/* Name + streak */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-body text-sm font-medium text-white truncate">
            {entry.display_name}
          </span>
          {entry.current_streak >= 3 && (
            <span className="text-xs font-body text-amber flex items-center gap-0.5">
              🔥 ×{entry.current_streak}
            </span>
          )}
          {isSelf && (
            <span className="text-xs font-body" style={{ color: "#00ff87" }}>
              you
            </span>
          )}
        </div>
        <p className="font-body text-xs text-text-muted">
          {entry.correct_answers} correct
        </p>
      </div>

      {/* Score + delta */}
      <div className="text-right flex-shrink-0">
        <p
          className="font-display text-xl leading-none"
          style={{ color: isSelf ? "#00ff87" : "#ffffff" }}
        >
          {entry.total_score.toLocaleString()}
        </p>
        {rankDelta !== 0 && (
          <p
            className="font-body text-xs mt-0.5 flex items-center justify-end gap-0.5"
            style={{ color: rankDelta > 0 ? "#00ff87" : "#ff4757" }}
          >
            {rankDelta > 0 ? "▲" : "▼"} {Math.abs(rankDelta)}
          </p>
        )}
      </div>
    </div>
  );
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId?: string;
  maxVisible?: number;
  showFull?: boolean;
}

export function Leaderboard({
  entries,
  currentUserId,
  maxVisible = 5,
  showFull = false,
}: LeaderboardProps) {
  const prevEntriesRef = useRef<LeaderboardEntry[]>([]);
  const [prevRanks, setPrevRanks] = useState<Record<string, number>>({});

  useEffect(() => {
    const prev: Record<string, number> = {};
    prevEntriesRef.current.forEach((e) => { prev[e.user_id] = e.rank; });
    setPrevRanks(prev);
    prevEntriesRef.current = entries;
  }, [entries]);

  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const selfEntry = sorted.find((e) => e.user_id === currentUserId);
  const visible = showFull ? sorted : sorted.slice(0, maxVisible);
  const selfVisible = selfEntry && visible.find((e) => e.user_id === currentUserId);

  return (
    <div className="space-y-2">
      {visible.map((entry) => (
        <LeaderboardCard
          key={entry.user_id}
          entry={entry}
          currentUserId={currentUserId}
          prevRank={prevRanks[entry.user_id]}
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
          />
        </>
      )}
    </div>
  );
}
