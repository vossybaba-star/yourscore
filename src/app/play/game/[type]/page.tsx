/**
 * /play/game/[type] — server shell.
 *
 * The game itself is a client component (Game.tsx). This shell exists purely so
 * the route can export generateMetadata, exactly as /play/game/perfect-10 does:
 * a shared Higher or Lower link used to unfurl as the generic YourScore card,
 * which told a scroller nothing about the game. Now it unfurls today's actual
 * first question from /api/og/higher-lower.
 *
 * Only Higher or Lower gets a card of its own for now — Guess the Player keeps
 * the site-wide default until it has one built for it.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import GameTypeGame from "./Game";

const SITE = "https://yourscore.app";

// The card is today's pinned round, so the metadata must never be baked at
// build time and served on a later day.
export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { type: string } }): Metadata {
  if (params.type !== "higher-lower") return {};

  const image = `${SITE}/api/og/higher-lower`;
  const title = "Higher or Lower: pick the bigger number";
  const description =
    "Two Premier League players in the same position, one stat. Ten questions, the clock is scoring you. Can you call today's round?";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      // The card shows the PINNED daily round, so the link has to ask for it
      // (?daily=1). Without it the player draws a fresh random round and the
      // two players they were just shown are gone.
      url: `${SITE}/play/game/higher-lower?daily=1`,
      images: [{ url: image, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function GameTypePage() {
  return (
    <Suspense fallback={null}>
      <GameTypeGame />
    </Suspense>
  );
}
