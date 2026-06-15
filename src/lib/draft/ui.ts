/**
 * Draft XI — presentation helpers (tier colours/labels). Keeps the broadcast
 * look consistent across the draft pages and the OG share image.
 */

import type { Tier } from "./types";

export const TIER_COLOR: Record<Tier, string> = {
  INVINCIBLE: "#ffd700",
  Centurions: "#aeea00",
  Champions: "#aeea00",
  "Title Challengers": "#aeea00",
  Europe: "#aeea00",
  "Mid-table": "#ffb800",
  "Relegation Battle": "#ff8a3d",
  Relegated: "#ff4757",
};

export const TIER_TAGLINE: Record<Tier, string> = {
  INVINCIBLE: "The impossible season",
  Centurions: "100+ points. Untouchable.",
  Champions: "Champions of England",
  "Title Challengers": "In the hunt to the end",
  Europe: "European nights",
  "Mid-table": "Comfortably mid",
  "Relegation Battle": "Scrapping for survival",
  Relegated: "Down with a whimper",
};

export function tierColor(tier: Tier): string {
  return TIER_COLOR[tier] ?? "#ffb800";
}

/** Strength → 0-100 bar fill, mapped over the meaningful 40-99 range. */
export function strengthPct(strength: number): number {
  return Math.max(0, Math.min(100, ((strength - 40) / 59) * 100));
}
