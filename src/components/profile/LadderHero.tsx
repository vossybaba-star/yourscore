import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { ShareStatsButton } from "@/components/ui/ShareStatsButton";
import { Button } from "@/components/ui/Button";
import { WIN_POINTS, DRAW_POINTS, positionBadge, positionColor } from "@/lib/rank";

export type LadderRow = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  overall_score: number;
  overall_rank: number;
  is_me: boolean;
};

/**
 * The cheapest concrete thing that closes the gap. Points are only ever earned
 * in these denominations, so name the actual action rather than the number —
 * "one 38-0 win" is a decision, "1,240 pts" is a puzzle.
 */
function overtakeCopy(gap: number): string {
  if (gap <= DRAW_POINTS) return "one 38-0 draw does it";
  if (gap <= WIN_POINTS) return "one 38-0 win does it";
  const wins = Math.ceil(gap / WIN_POINTS);
  // Past ~3 wins the 38-0 grind stops reading as a nudge and starts reading as
  // a wall — point at the track that scales instead.
  if (wins > 3) return "a strong quiz run closes it";
  return `${wins} 38-0 wins does it`;
}

/**
 * Position-led hero: the players either side of you, and the one action that
 * moves you up. Position is the status; the badge is cosmetic.
 */
export function LadderHero({
  rows,
  overallRank,
  overallScore,
  accuracy,
  compact = false,
}: {
  rows: LadderRow[];
  overallRank: number;
  overallScore: number;
  accuracy: number | null;
  /** The hero already shows position, points and share — don't repeat them. */
  compact?: boolean;
}) {
  const badge = positionBadge(overallRank);
  const accent = positionColor(overallRank);
  const above = rows.find((r) => r.overall_rank === overallRank - 1) ?? null;
  const gap = above ? Math.max(0, above.overall_score - overallScore) : 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "#0e1611", border: `1px solid ${accent}33` }}
    >
      {rows.map((r) => {
        if (r.is_me) {
          return (
            <div
              key={r.user_id}
              className="px-4 py-4"
              style={{
                background: "rgba(174,234,0,0.07)",
                borderTop: "1px solid rgba(174,234,0,0.25)",
                borderBottom: "1px solid rgba(174,234,0,0.25)",
              }}
            >
              {compact ? (
                <div className="flex items-baseline gap-2.5">
                  <span
                    className="font-display text-2xl leading-none"
                    style={{ color: accent === "#8a948f" ? "#eef2f0" : accent }}
                  >
                    #{r.overall_rank.toLocaleString()}
                  </span>
                  <span className="font-body text-sm font-semibold text-white">You</span>
                  <span className="font-body text-xs text-text-muted ml-auto">
                    {r.overall_score.toLocaleString()}
                  </span>
                </div>
              ) : (
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-body text-[10px] text-text-muted uppercase tracking-widest mb-1">
                      YourScore rank
                    </p>
                    <p
                      className="font-display text-5xl leading-none"
                      style={{ color: accent === "#8a948f" ? "#eef2f0" : accent }}
                    >
                      #{r.overall_rank.toLocaleString()}
                    </p>
                    <p className="font-body text-xs text-text-muted mt-1.5">
                      {r.overall_score.toLocaleString()} pts
                      {/* At #1 the crown line below already says it — don't say it twice. */}
                      {badge && r.overall_rank !== 1 ? ` · ${badge.emoji} ${badge.label}` : ""}
                    </p>
                  </div>
                  <ShareStatsButton rank={r.overall_rank} score={r.overall_score} accuracy={accuracy} />
                </div>
              )}

              {above && gap > 0 && (
                <>
                  <div
                    className="mt-3.5 h-1 rounded-full overflow-hidden"
                    style={{ background: "#15211a" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.round((overallScore / above.overall_score) * 100))}%`,
                        background: "#aeea00",
                      }}
                    />
                  </div>
                  <p className="font-body text-[11px] mt-2 text-white">
                    {gap.toLocaleString()} pts overtakes{" "}
                    <span className="font-semibold">{above.display_name}</span>
                  </p>
                  <p className="font-body text-[11px] mt-0.5" style={{ color: "#aeea00" }}>
                    {overtakeCopy(gap)}
                  </p>
                </>
              )}

              {r.overall_rank === 1 && (
                <p className="font-body text-[11px] mt-3" style={{ color: "#ffc233" }}>
                  👑 Top of the table — every game keeps you there
                </p>
              )}
            </div>
          );
        }

        return (
          <div key={r.user_id} className="flex items-center gap-2.5 px-4 py-2.5">
            <span
              className="font-display text-xs w-9 flex-shrink-0"
              style={{ color: "#586058" }}
            >
              #{r.overall_rank.toLocaleString()}
            </span>
            <PlayerAvatar seed={r.user_id} name={r.display_name} avatarUrl={r.avatar_url} size={20} />
            <span className="font-body text-xs text-text-muted flex-1 min-w-0 truncate">
              {r.display_name}
            </span>
            <span className="font-body text-xs text-text-muted flex-shrink-0">
              {r.overall_score.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Half the player base sits on zero points, where everyone's "rival" is also on
 * zero and the gap rounds to a meaningless 1 pt. Show them the first rung
 * instead of a ladder that can't move.
 */
export function LadderEmpty() {
  return (
    <div
      className="rounded-2xl px-5 py-6 text-center"
      style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.2)" }}>
      <p className="font-body text-[10px] text-text-muted uppercase tracking-widest mb-2">
        YourScore rank
      </p>
      <p className="font-display text-4xl leading-none text-white mb-2">Unranked</p>
      <p className="font-body text-sm text-text-muted mb-4">
        Win a 38-0 match or play a quiz and you&apos;re on the table.
      </p>
      <Button href="/38-0" variant="primary" size="md">
        Play your first game →
      </Button>
    </div>
  );
}
