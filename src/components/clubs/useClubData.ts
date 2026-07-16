"use client";

/**
 * Client hooks wrapping the Club-Fan Leaderboard API. Mirrors
 * src/components/halftime/useHalftimeToday.ts: self-fetching, tolerant of
 * transient network errors (keeps last good state), `loaded` gates first paint
 * so nothing flashes an empty state before the first response lands.
 */

import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/hooks/useUser";
import type { ClubStanding } from "@/lib/clubs/table";

export interface ClubMeResponse {
  club: string | null;
  suggestion: string | null;
  locked: boolean;
  clubs: string[];
}

/** GET /api/clubs/me — the signed-in user's own club state. null user → no fetch. */
export function useClubMe(): { user: ReturnType<typeof useUser>["user"]; data: ClubMeResponse | null; loaded: boolean; refresh: () => Promise<void> } {
  const { user, loading: userLoading } = useUser();
  const [data, setData] = useState<ClubMeResponse | null>(null);
  const [fetched, setFetched] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(null);
      setFetched(true);
      return;
    }
    try {
      const res = await fetch("/api/clubs/me", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as ClubMeResponse);
    } catch {
      // transient network error — keep the last good state
    } finally {
      setFetched(true);
    }
  }, [user]);

  useEffect(() => {
    if (userLoading) return;
    refresh();
  }, [userLoading, refresh]);

  return { user, data, loaded: fetched && !userLoading, refresh };
}

/**
 * The club the viewer represents, or null. Wraps useClubMe and adds a DEV-ONLY
 * `?club=Arsenal` preview override (compiled out of production via NODE_ENV),
 * because a signed-in club can't be seen without a real session — the demo has
 * no auth. Shared so every surface that keys off "your club" agrees.
 */
export function useViewerClub(): string | null {
  const { data: me } = useClubMe();
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const c = new URLSearchParams(window.location.search).get("club");
    if (c) setPreview(c);
  }, []);

  return me?.club ?? preview;
}

export interface ClubTableResponse {
  gw: string | null;
  standings: ClubStanding[];
}

/** GET /api/clubs/table?gw=... — public, no auth. */
export function useClubTable(gw?: string): { data: ClubTableResponse | null; loaded: boolean } {
  const [data, setData] = useState<ClubTableResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const qs = gw ? `?gw=${encodeURIComponent(gw)}` : "";
        const res = await fetch(`/api/clubs/table${qs}`, { cache: "no-store" });
        if (res.ok && !cancelled) setData((await res.json()) as ClubTableResponse);
      } catch {
        // transient network error — keep the last good state
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [gw]);

  return { data, loaded };
}
