/**
 * Placeholder rows shown inside the draft tray's reserved slate area while a
 * spin/scout is resolving. Exists for CLS: the tray reserves its full height at
 * the tap (input-excluded), and these rows hold that space until the real
 * player list lands ~1s later — so the reveal swaps content in place instead of
 * shoving the page. Row geometry mirrors the real slate rows (38px badge,
 * py-2.5) so the swap itself moves nothing.
 */
export function SlateSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="h-full rounded-2xl overflow-hidden animate-pulse" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-3 py-2 font-body" style={{ fontSize: 11, color: "#586058" }}>Scouting players…</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="rounded-lg flex-shrink-0" style={{ width: 38, height: 38, background: "rgba(255,255,255,0.06)" }} />
          <div className="flex-1 min-w-0">
            <div className="rounded" style={{ height: 12, width: `${55 + ((i * 13) % 30)}%`, background: "rgba(255,255,255,0.06)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
