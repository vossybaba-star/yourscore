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
  held, cap, roundEarns, chips = [],
}: {
  /** Transfer credits in hand (engine `squad.credits`). */
  held: number;
  /** The ceiling (engine `CREDIT_CAP`). */
  cap: number;
  /** True while this week's knowledge round can still earn more. */
  roundEarns?: boolean;
  /** The chip powers held for the squad — shown by name so it's clear what you've got. */
  chips?: string[];
}) {
  const filled = Math.max(0, Math.min(cap, held));
  return (
    <div style={{
      background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${tint(GOLD, "04")})`,
      border: `1px solid ${tint(GOLD, "33")}`, borderRadius: 16, padding: "14px 15px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="font-display" style={{ letterSpacing: "0.13em", fontSize: 12, color: GOLD, textTransform: "uppercase" }}>
          Transfer Bank
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
      {chips.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${tint(GOLD, "22")}`, paddingTop: 11 }}>
          <span className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED, textTransform: "uppercase" }}>
            Your chips
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
            {chips.map((c) => (
              <span key={c} className="font-body" style={{
                fontSize: 11.5, fontWeight: 600, color: GOLD, padding: "4px 10px", borderRadius: 999,
                background: tint(GOLD, "12"), border: `1px solid ${tint(GOLD, "44")}`,
              }}>{c}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
