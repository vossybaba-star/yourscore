"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fantasyEnabledByEnv, fantasyVisible } from "@/lib/fantasy/flag";
import { trackDiag } from "@/lib/analytics/trackGame";

const GOLD = "#ffc400";
const FANTASY_HREF = "/fantasy?ref=postgame";

export interface FantasyPromoCardProps {
  /** Where the card is mounted, e.g. "quiz", "p10", "38-0-match" — passed
   *  straight through to the click diagnostic. */
  surface: string;
}

/**
 * Postgame fantasy promo — mounted at the end of every game's results screen,
 * directly under the primary next-action CTA cluster. Same card idiom as the
 * rest of the results screens (rounded-2xl, dark surface, hairline border),
 * with a gold accent so it reads as its own game rather than a Quiz/38-0
 * upsell.
 *
 * Copy flips on the fantasy visibility gate (lib/fantasy/flag.ts): the live
 * pitch once fantasy is visible to this viewer, a "save your spot" variant
 * while it's still gated. The visible/not-visible answer is computed in an
 * effect so SSR (which has no sessionStorage) can't mismatch the client's
 * preview state — first paint uses the env-only answer, which is identical
 * on both sides.
 */
export function FantasyPromoCard({ surface }: FantasyPromoCardProps) {
  const [visible, setVisible] = useState(fantasyEnabledByEnv());

  useEffect(() => {
    setVisible(fantasyVisible());
  }, []);

  const body = visible
    ? "Fantasy Premier League is live. More transfers, more chips and play games directly with your league members."
    : "Fantasy lands with the season. Save your spot.";
  const cta = visible ? "PLAY FANTASY →" : "SAVE YOUR SPOT →";

  return (
    <div className="rounded-2xl p-5 bg-surface" style={{ border: `1px solid ${GOLD}33` }}>
      <p className="font-display text-xs tracking-widest mb-2" style={{ color: GOLD }}>
        YOURSCORE FANTASY
      </p>
      <p className="font-body text-sm text-text-muted mb-4">{body}</p>
      <Button
        variant="ghost"
        size="md"
        fullWidth
        href={FANTASY_HREF}
        className="!border-[rgba(255,196,0,0.4)] !text-[#ffc400]"
        onClick={() => trackDiag("fantasy_promo_click", { surface })}
      >
        {cta}
      </Button>
    </div>
  );
}
