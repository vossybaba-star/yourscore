"use client";

/**
 * Client hook + small pure helpers wrapping GET /api/halftime/today.
 *
 * This is the ONLY halftime data source W4 touches. The route is public,
 * uncached (no-store) and deliberately withholds pack_id/slug/questions
 * until a fixture is actually released — see route.ts for why. We just
 * render whatever it gives us; no guessing at pack availability here.
 *
 * Polling (not a subscription) because the release event is a poller/watchdog
 * flipping a row on the server — there's nothing to subscribe to from the
 * client, and 20s is well inside every AC timing budget (AC15: 2 min, AC16:
 * 3 min) without hammering the route.
 */

import { useEffect, useState } from "react";
import { isReleased, type HalftimeState } from "@/lib/halftime/shared";

export interface HalftimeFixture {
  fixture_id: number;
  home: string;
  away: string;
  kickoff_at: string;
  round_name: string | null;
  state: HalftimeState;
  released_at: string | null;
  /** Withheld by the API until released. */
  pack_id: string | null;
  /** Withheld by the API until released. */
  slug: string | null;
}

interface TodayResponse {
  matchday: string;
  fixtures: HalftimeFixture[];
}

const POLL_MS = 20_000;

export function useHalftimeToday(): { fixtures: HalftimeFixture[]; loaded: boolean } {
  const [fixtures, setFixtures] = useState<HalftimeFixture[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/halftime/today", { cache: "no-store" });
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

export function hasKickedOff(f: Pick<HalftimeFixture, "kickoff_at">): boolean {
  return Date.now() >= new Date(f.kickoff_at).getTime();
}

export function isLive(f: Pick<HalftimeFixture, "state">): boolean {
  return isReleased(f.state);
}

/** Deep link into the existing solo pack flow. Null until the fixture is live. */
export function packHref(f: HalftimeFixture): string | null {
  if (!isLive(f) || !f.slug || !f.pack_id) return null;
  return `/challenges/${f.slug}?pid=${f.pack_id}`;
}

/**
 * "Play with friends" → the EXISTING /play/new flow, pre-selected on this
 * pack via its existing ?packId= param (src/app/play/new/page.tsx:44,70-88).
 * Default mode there is "group" (Private, up to 8) — no new Lobby code.
 * Null until the fixture is live (no pack exists before then).
 */
export function lobbyHref(f: HalftimeFixture): string | null {
  if (!isLive(f) || !f.pack_id) return null;
  return `/play/new?packId=${f.pack_id}`;
}
