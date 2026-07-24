export type RecentGame = {
  rank: number | null;
  correct_answers: number | null;
  total_answers: number | null;
  total_score: number | null;
  updated_at: string | null;
};

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function RecentGames({ games }: { games: RecentGame[] }) {
  if (games.length === 0) return null;

  return (
    <div>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent games</p>
      <div className="space-y-2">
        {games.map((g, i) => {
          const acc = g.total_answers
            ? Math.round(((g.correct_answers ?? 0) / g.total_answers) * 100)
            : null;
          const dateStr = g.updated_at
            ? new Date(g.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : "";
          return (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0 font-display"
                  style={{
                    background: g.rank === 1 ? "rgba(255,194,51,0.15)" : "rgba(255,255,255,0.05)",
                    color: "#8a948f",
                  }}
                >
                  {g.rank ? (MEDALS[g.rank] ?? `#${g.rank}`) : "–"}
                </div>
                <div>
                  <p className="font-body text-sm font-semibold text-white">
                    {g.correct_answers ?? 0}/{g.total_answers ?? 0} correct
                    {acc !== null && (
                      <span className="ml-1.5 text-xs" style={{ color: acc >= 70 ? "#00d8c0" : "#8a948f" }}>
                        {acc}%
                      </span>
                    )}
                  </p>
                  <p className="font-body text-xs text-text-muted">{dateStr}</p>
                </div>
              </div>
              <p className="font-display text-lg" style={{ color: "#aeea00" }}>
                {(g.total_score ?? 0).toLocaleString()}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
