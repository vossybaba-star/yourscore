"use client";

import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { GOLD, AMBER, CORAL, INK, MUTED, POS_COLOR, tint, type Pos } from "@/components/fantasy/shared";

/**
 * One player on the tactical pitch — a PORTRAIT marker (founder, 25 Jul: the
 * squad should read like a team sheet, not a database). Presentational only: the
 * tap target, menu and swap logic stay in FantasyHub's wrapper, so this is safe
 * to reuse anywhere a player needs a face (bench, transfer room, captaincy).
 *
 * The face is `PlayerAvatar`, which draws the headshot when we hold one and a
 * stable gradient-monogram when we don't — so the pitch never blanks and never
 * shifts as images load. Captaincy is a GOLD ring + armband (earned power);
 * vice is a quiet teal ring; a doubt is an amber dot. Nothing here celebrates —
 * the calm state is the default.
 */
export function PlayerMarker({
  name, label, avatarUrl, club, size = 34, isCaptain = false, isVice = false, doubt, datum, dim = false, pos, flagged = false,
}: {
  /** Full name — seeds the monogram fallback. */
  name: string;
  /** What shows under the face (a surname, usually). */
  label: string;
  avatarUrl?: string | null;
  /** Club name — draws a small crest on the marker so the pitch reads by team. */
  club?: string;
  size?: number;
  isCaptain?: boolean;
  isVice?: boolean;
  /** The doubt reason, if any — presence draws the amber dot. */
  doubt?: string;
  /** One datum under the name (price, opponent, points — the lens decides). */
  datum?: string;
  dim?: boolean;
  /** Position — colours the name plate so the pitch reads by role, not one hue. */
  pos?: Pos;
  /** A pick we could not confidently match — draws a bold CORAL ring around the
   *  face (a circle) so a viewer sees straight away which players need fixing. */
  flagged?: boolean;
}) {
  const ring = flagged ? CORAL : isCaptain ? GOLD : isVice ? "rgba(0,216,192,0.75)" : undefined;
  const badge = size >= 30 ? 15 : 13;
  const posC = pos ? POS_COLOR[pos] : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: dim ? 0.85 : 1, minWidth: 0, width: "100%" }}>
      <div style={{
        position: "relative", flexShrink: 0,
        // Flagged picks wear a bold coral halo on top of the ring, so a viewer
        // sees the exact faces that still need them without hunting for a dot.
        ...(flagged ? { borderRadius: "50%", boxShadow: `0 0 0 4px ${CORAL}, 0 0 18px 4px ${tint(CORAL, "aa")}` } : null),
      }}>
        <PlayerAvatar name={name} avatarUrl={avatarUrl} size={size} ring={ring} />
        {club && (
          <span aria-hidden style={{
            position: "absolute", bottom: -3, left: -3, width: size * 0.42, height: size * 0.42,
            minWidth: 14, minHeight: 14, borderRadius: "50%", background: "#0a1710",
            border: "1.5px solid #0a1710", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Crest club={club} size={size * 0.42} />
          </span>
        )}
        {(isCaptain || isVice) && (
          <span aria-hidden style={{
            position: "absolute", top: -4, right: -4, width: badge, height: badge, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isCaptain ? GOLD : "#0e1611", color: isCaptain ? "#3a2600" : "rgba(0,216,192,0.95)",
            border: `1px solid ${isCaptain ? "#ffdf9e" : "rgba(0,216,192,0.6)"}`,
            fontFamily: "var(--font-display, inherit)", fontWeight: 800, fontSize: badge * 0.62, lineHeight: 1,
          }}>{isCaptain ? "C" : "V"}</span>
        )}
        {doubt && (
          <span aria-hidden title={doubt} style={{
            position: "absolute", bottom: -2, right: -2, width: size * 0.3, height: size * 0.3, minWidth: 10, minHeight: 10,
            borderRadius: "50%", background: AMBER, border: "2px solid #0a1710",
          }} />
        )}
      </div>
      <span style={{
        fontSize: size >= 30 ? 10 : 9.5, fontWeight: 700, color: INK, lineHeight: 1.05, textAlign: "center",
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        textShadow: "0 1px 2px rgba(0,0,0,0.7)",
        // A faint position-coloured plate so the pitch reads by role at a glance:
        // GK amber, DEF teal, MID lime, FWD coral — not one flat hue.
        ...(posC ? {
          padding: "1px 6px", borderRadius: 6,
          background: tint(posC, "40"), boxShadow: `inset 0 0 0 1px ${tint(posC, "cc")}`,
        } : null),
      }}>{label}</span>
      {datum && (
        <span style={{ fontSize: 8.5, color: MUTED, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{datum}</span>
      )}
    </div>
  );
}
