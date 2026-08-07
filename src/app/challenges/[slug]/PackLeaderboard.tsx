"use client";

// Pack leaderboard, shared between the intro phase (page.tsx) and the
// results phase (ResultsView.tsx) — pulled into its own file rather than
// living in either so neither has to import the other (ResultsView is a
// next/dynamic chunk off page.tsx; the reverse import would be circular).

import { useMemo, useState } from "react";

// Synthetic row id for the guest's own not-yet-saved score on the leaderboard.
export const GUEST_ROW_ID = "__guest__";

export interface LeaderEntry {
  user_id: string;
  score: number;
  correct_count: number;
  display_name: string | null;
}

export function PackLeaderboard({ entries, userId, accent, loading, maxVisible = 10, approxRank }: {
  entries: LeaderEntry[];
  userId: string | null;
  accent: string;
  loading?: boolean;
  maxVisible?: number;
  /** The user's row sits below a full fetched page, so its true rank is "N or lower". */
  approxRank?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<"speed" | "accuracy">("speed");
  const MEDALS = ["🥇", "🥈", "🥉"];
  const RANK_COLORS = ["#00d8c0", "#9aa39d", "#cd7f32"];

  // Speed ranks by points (the default board); Accuracy ranks by most correct,
  // points breaking ties. Both derived from the same rows so switching is instant.
  const ranked = useMemo(() => {
    const copy = [...entries];
    copy.sort(mode === "accuracy"
      ? (a, b) => (b.correct_count - a.correct_count) || (b.score - a.score)
      : (a, b) => (b.score - a.score) || (b.correct_count - a.correct_count));
    return copy;
  }, [entries, mode]);
  const userRank = userId ? ranked.findIndex(e => e.user_id === userId) + 1 : 0;

  const visible = showAll ? ranked : ranked.slice(0, maxVisible);
  const hasMore = !showAll && ranked.length > maxVisible;
  const userOutsideVisible = userId && userRank > 0 && userRank > visible.length;

  function EntryRow({ entry, rank }: { entry: LeaderEntry; rank: number }) {
    const isUser = entry.user_id === userId;
    const rankLabel = isUser && approxRank ? `${rank}+` : rank;
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 transition-colors"
        style={{
          background: isUser ? `${accent}0f` : undefined,
          borderLeft: isUser ? `3px solid ${accent}` : "3px solid transparent",
        }}>
        <span className="font-display text-sm w-7 text-center flex-shrink-0"
          style={{ color: rank <= 3 ? RANK_COLORS[rank - 1] : "#586058" }}>
          {rank <= 3 ? MEDALS[rank - 1] : rankLabel}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm truncate" style={{ color: isUser ? "#ffffff" : "#9aa39d" }}>
            {isUser
              ? `You${entry.display_name ? ` (${entry.display_name})` : ""}`
              : (entry.display_name ?? "Player")}
          </p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#586058" }}>
            {mode === "accuracy" ? `${entry.score.toLocaleString()} pts` : `${entry.correct_count} correct`}
          </p>
        </div>
        <span className="font-display text-sm flex-shrink-0"
          style={{ color: isUser ? accent : "#8a948f" }}>
          {mode === "accuracy" ? entry.correct_count : entry.score.toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <p className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>LEADERBOARD</p>
        {userRank > 0 && (
          <span className="font-display text-xs px-2 py-0.5 rounded-full"
            style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>
            YOU #{userRank}{approxRank ? "+" : ""}
          </span>
        )}
      </div>
      {/* Rank by Speed (points) or Accuracy (most correct). */}
      {entries.length > 0 && (
        <div className="px-5 pb-3 flex gap-1.5">
          {(["speed", "accuracy"] as const).map((m) => {
            const on = mode === m;
            return (
              <button key={m} onClick={() => { setMode(m); setShowAll(false); }}
                className="flex-1 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
                style={on
                  ? { background: accent, color: "#0a0a0f" }
                  : { background: "rgba(255,255,255,0.04)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.08)" }}>
                {m === "speed" ? "Speed" : "Accuracy"}
              </button>
            );
          })}
        </div>
      )}
      {loading ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-xs" style={{ color: "#586058" }}>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-sm text-white mb-1">No scores yet</p>
          <p className="font-body text-xs" style={{ color: "#586058" }}>Be the first to set a score!</p>
        </div>
      ) : (
        <div className="pb-2">
          {visible.map((entry, idx) => (
            <EntryRow key={entry.user_id + idx} entry={entry} rank={idx + 1} />
          ))}
          {userOutsideVisible && ranked[userRank - 1] && (
            <>
              <div className="px-5 py-1 text-center">
                <span className="font-body text-xs" style={{ color: "#586058" }}>···</span>
              </div>
              <EntryRow entry={ranked[userRank - 1]} rank={userRank} />
            </>
          )}
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-3 font-body text-xs text-center transition-colors"
              style={{ color: accent, borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              View full leaderboard ({ranked.length} scores) ↓
            </button>
          )}
          {showAll && ranked.length > maxVisible && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full py-3 font-body text-xs text-center"
              style={{ color: "#586058", borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              Show less ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
}
