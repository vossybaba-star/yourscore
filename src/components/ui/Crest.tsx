"use client";

import { getTeamBadgeUrlSync } from "@/lib/teamImages";

// Moved verbatim from src/components/fantasy/shared.tsx (comment-replies stage 1)
// so the debate/comment layer can use it without importing 602 lines of
// "use client" fantasy code. fantasy/shared.tsx re-exports this so every
// existing fantasy call site keeps working untouched.

/** Club crest (local /badges/*.png). Silent if a club has no badge mapped. */
export function Crest({ club, size = 18 }: { club: string; size?: number }) {
  const src = getTeamBadgeUrlSync(club);
  if (!src) return <span style={{ width: size, height: size, display: "inline-block" }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size}
    style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />;
}
