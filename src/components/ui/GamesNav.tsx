"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { GameSwitcher, type GameKey } from "@/components/ui/GameSwitcher";
import { useGamesNavHidden } from "@/lib/gamesNav";

// THE games nav. Mounted once in the root layout so it is one persistent bar —
// switching game is a client navigation that swaps the page BELOW it; the bar
// itself never remounts, never flashes, never moves (founder 2026-07-18: "the
// top nav under play is a NAV, not a page selector"). Pages don't render their
// own switcher anymore.
//
// Visible only on the five game sections (exact routes — sub-pages like
// /38-0/play or /play/new are flows, not sections), and never over live
// gameplay (game pages raise the useHideGamesNav flag mid-run).

const GAME_ROUTES: Record<string, GameKey> = {
  "/play": "quiz",
  "/38-0": "draft",
  "/play/game/perfect-10": "perfect10",
  "/play/game/higher-lower": "higher-lower",
  "/play/game/guess-the-player": "guess-the-player",
};

export function GamesNav() {
  const pathname = usePathname();
  const hidden = useGamesNavHidden();
  const barRef = useRef<HTMLDivElement>(null);
  const active = GAME_ROUTES[pathname ?? ""];
  const show = Boolean(active) && !hidden;

  // Pages that stack their own sticky header under the bar (the Quiz hub's
  // title + filters) need its height as an offset — published as a CSS var so
  // safe-area padding is accounted for without any page measuring anything.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!show || !barRef.current) {
      root.style.setProperty("--games-nav-h", "0px");
      return;
    }
    const bar = barRef.current;
    const apply = () => root.style.setProperty("--games-nav-h", `${bar.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--games-nav-h", "0px");
    };
  }, [show]);

  if (!show) return null;

  return (
    <div
      ref={barRef}
      className="sticky top-0 z-30 pt-safe"
      style={{ background: "rgba(10,10,15,0.97)", backdropFilter: "blur(20px)" }}
    >
      <div className="max-w-lg mx-auto px-5 pt-3" data-tour="games">
        <GameSwitcher active={active} />
      </div>
    </div>
  );
}
