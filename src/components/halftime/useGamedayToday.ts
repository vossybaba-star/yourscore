"use client";

/**
 * Client hook + small pure helpers wrapping GET /api/gameday/today.
 *
 * This is the ONLY gameday data source W4 touches. The route is public and
 * uncached (no-store). Every row it returns is already state='published' —
 * the route itself is the invisibility gate now (an approved/base_ready row
 * never appears here at all), so unlike the old halftime version there is no
 * per-row "is it live yet" state to interpret client-side.
 *
 * Polling (not a subscription) because the publish event is a daily cron
 * flipping a row on the server — there's nothing to subscribe to from the
 * client.
 */

import { useEffect, useState } from "react";

export interface GamedayFixture {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  round_name: string | null;
  state: "published";
  published_at: string | null;
  pack_id: string | null;
  slug: string | null;
  /** Set once the real second-half whistle has blown — opens the standalone
   * halftime prediction poll (§0.6). */
  second_half_started_at: string | null;
}

/** @deprecated kept as an alias while W4 migrates its imports. */
export type HalftimeFixture = GamedayFixture;

interface TodayResponse {
  fixtures: GamedayFixture[];
}

const POLL_MS = 20_000;

export function useGamedayToday(): { fixtures: GamedayFixture[]; loaded: boolean } {
  const [fixtures, setFixtures] = useState<GamedayFixture[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/gameday/today", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const json = (await res.json()) as TodayResponse;
          setFixtures(Array.isArray(json.fixtures) ? json.fixtures : []);
        }
      } catch {
        // Transient network error — keep the last good list, retry next tick.
      } finally {
        if (!cancelled) {
          setLoaded(true);
          timer = setTimeout(tick, POLL_MS);
        }
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { fixtures, loaded };
}

// ── Presentation-only helpers (no business logic — that lives in shared.ts) ──

export function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function hasKickedOff(f: Pick<GamedayFixture, "kickoff_at">): boolean {
  return Date.now() >= new Date(f.kickoff_at).getTime();
}

/** Every row from /api/gameday/today is already published — this is now a
 * constant true, kept as a function so call sites don't need to change. */
export function isLive(): boolean {
  return true;
}

/** Deep link into the existing solo pack flow. */
export function packHref(f: GamedayFixture): string | null {
  if (!f.slug || !f.pack_id) return null;
  return `/challenges/${f.slug}?pid=${f.pack_id}`;
}

/**
 * "Play with friends" → the EXISTING /play/new flow, pre-selected on this
 * pack via its existing ?packId= param (src/app/play/new/page.tsx:44,70-88).
 * Default mode there is "group" (Private, up to 8) — no new Lobby code.
 */
export function lobbyHref(f: GamedayFixture): string | null {
  if (!f.pack_id) return null;
  return `/play/new?packId=${f.pack_id}`;
}
