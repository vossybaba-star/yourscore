"use client";

import { useEffect, useSyncExternalStore } from "react";

// The games nav (GamesNav in the root layout) is ONE persistent bar — it must
// never remount between game sections. But it also must never sit over live
// gameplay, and "playing" is page-internal state the layout can't see. Game
// pages raise this flag while a run is on screen; the nav subscribes.

let hiddenCount = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function useGamesNavHidden(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => hiddenCount > 0,
    () => false
  );
}

/** Hide the games nav while mounted-and-true (counts, so overlapping users are safe). */
export function useHideGamesNav(hidden: boolean) {
  useEffect(() => {
    if (!hidden) return;
    hiddenCount++;
    emit();
    return () => {
      hiddenCount--;
      emit();
    };
  }, [hidden]);
}
