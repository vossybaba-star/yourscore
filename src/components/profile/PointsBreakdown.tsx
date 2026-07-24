import Link from "next/link";

type CountedRow = { label: string; points: number; accent: string; href: string };
type UncountedRow = { label: string; detail: string; href: string };

/**
 * Where your YourScore points actually come from — and, just as importantly,
 * where they don't. Rank reads three tables; every other game earns nothing
 * today. Saying so plainly beats a player working it out and concluding the
 * leaderboard is broken.
 */
export function PointsBreakdown({
  counted,
  uncounted,
}: {
  counted: CountedRow[];
  uncounted: UncountedRow[];
}) {
  const max = Math.max(1, ...counted.map((r) => r.points));

  return (
    <div>
      <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">
        Where your points come from
      </p>
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {counted.map((r, i) => (
          <Link
            key={r.label}
            href={r.href}
            className="block px-4 py-3 transition-opacity hover:opacity-80"
            style={{ borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}
          >
            <div className="flex items-baseline justify-between mb-2">
              <span className="font-body text-sm text-white">{r.label}</span>
              <span className="font-display text-base" style={{ color: r.accent }}>
                {r.points.toLocaleString()}
              </span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "#15211a" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round((r.points / max) * 100)}%`, background: r.accent }}
              />
            </div>
          </Link>
        ))}

        {uncounted.map((r) => (
          <Link
            key={r.label}
            href={r.href}
            className="flex items-center justify-between px-4 py-3 transition-opacity hover:opacity-80"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="min-w-0 pr-3">
              <p className="font-body text-sm text-text-muted">{r.label}</p>
              <p className="font-body text-[11px] text-text-muted mt-0.5 truncate">{r.detail}</p>
            </div>
            <span className="font-body text-[11px] flex-shrink-0" style={{ color: "#ff4757" }}>
              not counted yet
            </span>
          </Link>
        ))}
      </div>
      <p className="font-body text-[11px] text-text-muted mt-2 leading-snug">
        Only 38-0 matches and quiz lobbies feed YourScore Rank right now. The rest still count as
        personal bests.
      </p>
    </div>
  );
}
