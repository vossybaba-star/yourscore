/**
 * The Fantasy PL detail block on the profile: where you sit in the world, your
 * weekly streak, and season totals.
 *
 * Everything here is real, but the season doesn't start until GW1 — until a
 * gameweek is scored nobody has points or a rank, and nobody has a streak. So
 * pre-season this shows honest placeholders ("Unranked · season starts …",
 * "Starts GW1") rather than a fake #1-of-everyone. It all populates the moment
 * scores land.
 */
export function FantasyStats({
  worldRank,
  totalManagers,
  totalPoints,
  streak,
  gameweeksPlayed,
  deadlineLabel,
}: {
  worldRank: number | null;
  totalManagers: number;
  totalPoints: number;
  streak: number;
  gameweeksPlayed: number;
  deadlineLabel: string;
}) {
  const ranked = worldRank !== null;

  return (
    <div className="space-y-3">
      {/* World rank — the headline. */}
      <div
        className="rounded-2xl px-5 py-4"
        style={{ background: "linear-gradient(135deg, rgba(0,216,192,0.12), rgba(0,216,192,0.04))", border: "1px solid rgba(0,216,192,0.25)" }}
      >
        <p className="font-body text-[10px] uppercase tracking-widest" style={{ color: "#00d8c0" }}>
          In the world
        </p>
        {ranked ? (
          <>
            <p className="font-display text-5xl leading-none mt-1.5" style={{ color: "#00d8c0" }}>
              #{worldRank.toLocaleString()}
            </p>
            <p className="font-body text-xs text-text-muted mt-1.5">
              of {totalManagers.toLocaleString()} managers · {totalPoints.toLocaleString()} pts
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-4xl leading-none mt-1.5 text-white">Unranked</p>
            <p className="font-body text-xs text-text-muted mt-1.5">
              Season starts {deadlineLabel} — you&apos;ll get a world rank after gameweek one.
            </p>
          </>
        )}
      </div>

      {/* Streak + season detail. */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat
          value={streak > 0 ? `${streak}🔥` : "—"}
          label="Week streak"
          sub={streak > 0 ? "gameweeks in a row" : "starts GW1"}
          accent="#ffb800"
        />
        <Stat
          value={gameweeksPlayed > 0 ? String(gameweeksPlayed) : "—"}
          label="Gameweeks"
          sub="squads locked"
          accent="#00d8c0"
        />
        <Stat
          value={totalPoints > 0 ? totalPoints.toLocaleString() : "—"}
          label="Points"
          sub="this season"
          accent="#aeea00"
        />
      </div>
    </div>
  );
}

function Stat({ value, label, sub, accent }: { value: string; label: string; sub: string; accent: string }) {
  return (
    <div className="rounded-2xl px-3 py-3.5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="font-display text-2xl leading-none" style={{ color: accent }}>
        {value}
      </p>
      <p className="font-body text-xs text-white mt-1.5">{label}</p>
      <p className="font-body text-[11px] text-text-muted mt-0.5 leading-tight">{sub}</p>
    </div>
  );
}
