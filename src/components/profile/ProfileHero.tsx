import { PlayerCard, type Attributes } from "@/components/profile/PlayerCard";
import { ShareStatsButton } from "@/components/ui/ShareStatsButton";
import { positionBadge, positionColor } from "@/lib/rank";
import { Button } from "@/components/ui/Button";

/**
 * Profile hero: the headline numbers on the left, the player card on the right.
 *
 * The card is the identity ("who am I on YourScore") and the left column is the
 * standing ("where am I"). Stacking them cost most of a phone screen; side by
 * side they read as one unit and the ladder still clears the fold.
 */
export function ProfileHero({
  userId,
  name,
  avatarUrl,
  ovr,
  archetype,
  club,
  attributes,
  overallRank,
  overallScore,
  accuracy,
  dayStreak,
  cardWidth = 148,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  ovr: number;
  archetype: string;
  club: string | null;
  attributes: Attributes;
  overallRank: number | null;
  overallScore: number;
  accuracy: number | null;
  dayStreak: number;
  cardWidth?: number;
}) {
  const badge = positionBadge(overallRank);
  const accent = positionColor(overallRank);
  const ranked = overallRank !== null && overallScore > 0;

  return (
    <div className="flex items-stretch gap-3">
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="font-body text-[10px] text-text-muted uppercase tracking-widest">YourScore rank</p>
        {ranked ? (
          <>
            <p
              className="font-display leading-none mt-1"
              style={{ fontSize: 52, color: accent === "#8a948f" ? "#eef2f0" : accent }}
            >
              #{overallRank!.toLocaleString()}
            </p>
            <p className="font-body text-xs text-text-muted mt-1.5">
              {overallScore.toLocaleString()} pts
              {badge ? ` · ${badge.emoji} ${badge.label}` : ""}
            </p>
          </>
        ) : (
          <>
            <p className="font-display leading-none mt-1 text-white" style={{ fontSize: 34 }}>
              Unranked
            </p>
            <p className="font-body text-xs text-text-muted mt-1.5 mb-3">
              Win a 38-0 match or play a quiz and you&apos;re on the table.
            </p>
            <Button href="/38-0" variant="primary" size="sm">
              Play your first game →
            </Button>
          </>
        )}

        <div className="mt-3 pt-3 grid grid-cols-2 gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <p
              className="font-display text-2xl leading-none"
              style={{ color: accuracy === null ? "#eef2f0" : accuracy >= 70 ? "#00d8c0" : "#ffb800" }}
            >
              {accuracy !== null ? `${accuracy}%` : "—"}
            </p>
            <p className="font-body text-[11px] text-text-muted mt-1">Accuracy</p>
          </div>
          <div>
            <p className="font-display text-2xl leading-none" style={{ color: "#ffb800" }}>
              {dayStreak > 0 ? `${dayStreak}🔥` : "—"}
            </p>
            <p className="font-body text-[11px] text-text-muted mt-1">Day streak</p>
          </div>
        </div>

        {ranked && (
          <div className="mt-auto pt-3">
            <ShareStatsButton rank={overallRank!} score={overallScore} accuracy={accuracy} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0" style={{ width: cardWidth }}>
        <PlayerCard
          width={cardWidth}
          userId={userId}
          name={name}
          avatarUrl={avatarUrl}
          ovr={ovr}
          archetype={archetype}
          club={club}
          attributes={attributes}
        />
      </div>
    </div>
  );
}
