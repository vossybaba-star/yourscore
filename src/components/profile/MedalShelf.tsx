import { medalColor, shelfOrder, type Medal } from "@/lib/medals";

/**
 * The trophy cabinet as a shelf of medals rather than three large stat boxes.
 *
 * Denser (six in less room than the old three), and it earns the space two ways
 * the boxes didn't: every medal carries how rare it is, and the ones you haven't
 * got stay on the shelf as visible gaps with the target written on them.
 */
export function MedalShelf({
  medals,
  footnote,
  limit = 6,
}: {
  medals: Medal[];
  footnote?: string | null;
  /** The full set is 26 — showing them all would re-create the space problem
   *  this replaced. Six is the shelf; the count carries the rest. */
  limit?: number;
}) {
  const earned = medals.filter((m) => m.earned).length;
  const shown = shelfOrder(medals).slice(0, limit);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest">Your cabinet</p>
        <p className="font-body text-[11px] text-text-muted">
          {earned}/{medals.length}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {shown.map((m) => {
          const c = medalColor(m.pct);
          return (
            <div
              key={m.id}
              className="rounded-xl px-2 py-3 text-center"
              style={{
                background: m.earned ? `${c}0f` : "transparent",
                border: m.earned ? `1px solid ${c}3d` : "1px dashed rgba(255,255,255,0.12)",
              }}
            >
              <span
                className="block text-xl leading-none"
                // Locked medals stay visible but drained — a silhouette reads as
                // "not yet", where hiding them reads as "doesn't exist".
                style={{ filter: m.earned ? "none" : "grayscale(1)", opacity: m.earned ? 1 : 0.3 }}
              >
                {m.glyph}
              </span>
              <p
                className="font-body text-[11px] mt-1.5 truncate"
                style={{ color: m.earned ? "#eef2f0" : "#8a948f" }}
              >
                {m.label}
              </p>
              <p
                className="font-body text-[10px] mt-0.5 truncate"
                style={{ color: m.earned ? c : "#586058" }}
              >
                {m.earned ? `${m.pct}% have this` : m.goal}
              </p>
            </div>
          );
        })}
      </div>

      {footnote && <p className="font-body text-[11px] text-text-muted mt-2.5">{footnote}</p>}
    </div>
  );
}
