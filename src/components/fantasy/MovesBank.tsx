"use client";

import { GOLD, INK, MUTED, tint } from "@/components/fantasy/shared";

/**
 * The Moves Bank — the product's core story made visible (founder, 25 Jul):
 * football knowledge earns extra transfers, so those earned moves get a home of
 * their own, not a bare number in a stat tile. Gold segments = earned power (the
 * house rule); empty segments = room to earn more. Filled from the real credit
 * count the engine already tracks — this is presentation, not a new mechanic.
 */
export function MovesBank({
  held, cap, roundEarns, chipsHeld = 0,
}: {
  /** Transfer credits in hand (engine `squad.credits`). */
  held: number;
  /** The ceiling (engine `CREDIT_CAP`). */
  cap: number;
  /** True while this week's knowledge round can still earn more. */
  roundEarns?: boolean;
  /** Chip tokens held — shown as a small aside, they spend on a separate track. */
  chipsHeld?: number;
}) {
  const filled = Math.max(0, Math.min(cap, held));
  return (
    <div style={{
      background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${tint(GOLD, "04")})`,
      border: `1px solid ${tint(GOLD, "33")}`, borderRadius: 16, padding: "14px 15px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="font-display" style={{ letterSpacing: "0.13em", fontSize: 12, color: GOLD, textTransform: "uppercase" }}>
          Moves Bank
        </span>
        <span className="font-display" style={{ fontSize: 14, color: GOLD, fontVariantNumeric: "tabular-nums" }}>
          {filled} / {cap}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 11 }} role="img" aria-label={`${filled} of ${cap} moves banked`}>
        {Array.from({ length: cap }).map((_, i) => (
          <span key={i} style={{
            flex: 1, height: 9, borderRadius: 5,
            background: i < filled ? `linear-gradient(180deg, #ffd977, ${GOLD})` : "rgba(255,255,255,0.06)",
            border: `1px solid ${i < filled ? tint(GOLD, "66") : "rgba(255,255,255,0.05)"}`,
            boxShadow: i < filled ? `0 0 9px -1px ${tint(GOLD, "77")}` : "none",
          }} />
        ))}
      </div>
      <p className="font-body" style={{ fontSize: 11.5, color: MUTED, marginTop: 10, lineHeight: 1.45 }}>
        {filled === 0
          ? <>No moves banked yet. <b style={{ color: INK, fontWeight: 600 }}>Right answers in the round earn transfers.</b></>
          : <><b style={{ color: INK, fontWeight: 600 }}>{filled} free move{filled === 1 ? "" : "s"}</b> in hand, earned from knowledge rounds.{roundEarns ? " Play this week's round to earn more." : ""}</>}
      </p>
      {chipsHeld > 0 && (
        <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 7,
          border: `1px solid ${tint(GOLD, "33")}`, borderRadius: 999, padding: "4px 10px" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: GOLD }} />
          <span className="font-body" style={{ fontSize: 11, color: MUTED }}>
            {chipsHeld} chip{chipsHeld === 1 ? "" : "s"} held
          </span>
        </div>
      )}
    </div>
  );
}
