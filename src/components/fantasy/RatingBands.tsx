"use client";
/**
 * The presentational pieces of a squad rating — the 0-10 score colour and the
 * strong/decent/weak band groups. Moved out of SquadRating.tsx (the member
 * card) so /fantasy/rate's guest result screen can render the SAME rating
 * bit-for-bit identically without importing SquadRating.tsx's own data
 * fetching (peek/rate against a signed-in user, which a guest has none of).
 *
 * Purely presentational — no fetching, no state beyond what's passed in.
 */
import { CORAL, INK, LIME, MUTED, tint } from "./shared";

export interface BandCard { name: string; pos: string; note: string }
export interface RatingBandsShape { strong: BandCard[]; decent: BandCard[]; weak: BandCard[] }

export const scoreColor = (score: number): string => {
  if (score >= 7) return LIME;
  if (score >= 4.5) return "#e0c53c"; // between LIME and CORAL, no new named token needed elsewhere
  return CORAL;
};

export type BandTone = "strong" | "decent" | "weak";
export const BAND_LABEL: Record<BandTone, string> = { strong: "STRONG", decent: "DECENT", weak: "WEAK" };
// LIME for strong, a neutral/muted tone for decent, CORAL for weak — the same
// role colours the rest of the fantasy surface already uses.
export const BAND_COLOR: Record<BandTone, string> = { strong: LIME, decent: MUTED, weak: CORAL };

/** One band group: a label, then a compact row per player (name, position,
 *  note). Renders nothing when the group is empty — an XI won't always fill
 *  all three bands. */
export function BandGroup({ tone, players }: { tone: BandTone; players: BandCard[] }) {
  if (!players.length) return null;
  const accent = BAND_COLOR[tone];
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.08em", color: accent, fontWeight: 700, marginBottom: 6 }}>
        {BAND_LABEL[tone]}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {players.map((p, i) => (
          <div key={`${tone}${i}`} className="font-body rounded-xl" style={{
            padding: "8px 12px", fontSize: 12.5, lineHeight: 1.45,
            background: tint(accent, "12"), border: `1px solid ${tint(accent, "3a")}`,
            display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
          }}>
            <span style={{ color: INK, fontWeight: 700 }}>{p.name}</span>
            <span style={{ color: MUTED, fontSize: 11 }}>{p.pos}</span>
            <span style={{ color: MUTED }}>{p.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** All three band groups, strong then decent then weak — the same order both
 *  the member card and the guest result render them in. Renders nothing when
 *  every group is empty. */
export function BandGroups({ bands }: { bands: RatingBandsShape }) {
  if (!bands.strong.length && !bands.decent.length && !bands.weak.length) return null;
  return (
    <div style={{ marginBottom: 2 }}>
      <BandGroup tone="strong" players={bands.strong} />
      <BandGroup tone="decent" players={bands.decent} />
      <BandGroup tone="weak" players={bands.weak} />
    </div>
  );
}
