/**
 * /play/game/perfect-10 — server shell.
 *
 * The game itself is a client component (Game.tsx). This shell exists purely so
 * the route can export generateMetadata: a shared Perfect 10 link used to unfurl
 * as the generic YourScore card, which told a scroller nothing about the game.
 * Now it unfurls the tower card from /api/og/perfect-10.
 *
 * searchParams are read here — and only a page (not a layout) receives them —
 * so a challenge link (?c=<token>) unfurls that player's actual scorecard.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import Perfect10Game from "./Game";

const SITE = "https://yourscore.app";

// The card reads live attempt/list rows, so never let the metadata response sit
// in Next's Data Cache (which survives deploys on Vercel).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { c?: string; list?: string; s?: string; f?: string };
}): Promise<Metadata> {
  // A signed-in share carries ?c=<token> (verified). A guest share carries the
  // list plus their own result inline (&s=&f=) — forward those or the card
  // falls back to the generic promo and the guest's tower is lost.
  const guestResult = Boolean(searchParams.list && searchParams.s && searchParams.f);
  const qs = searchParams.c
    ? `?c=${encodeURIComponent(searchParams.c)}`
    : searchParams.list
      ? `?list=${encodeURIComponent(searchParams.list)}` +
        (guestResult ? `&s=${encodeURIComponent(searchParams.s!)}&f=${encodeURIComponent(searchParams.f!)}` : "")
      : "";
  const image = `${SITE}/api/og/perfect-10${qs}`;

  const isResult = Boolean(searchParams.c) || guestResult;
  const title = isResult ? "I built my Perfect 10 tower, beat it" : "Perfect 10: name the top 10";
  const description = isResult
    ? "Ten rungs, three lives, three hints. See the tower and take on the same list."
    : "Name everyone in the ranked top 10. Three lives, three hints. Can you light up all ten rungs?";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE}/play/game/perfect-10${qs}`,
      images: [{ url: image, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function Perfect10Page() {
  return (
    <Suspense fallback={null}>
      <Perfect10Game />
    </Suspense>
  );
}
