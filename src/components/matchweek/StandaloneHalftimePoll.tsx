"use client";

/**
 * The standalone halftime prediction poll (§0.6): "every player must see the
 * halftime poll whether or not they played the quiz." Surfaced on the
 * matchweek page for any fixture whose second_half_started_at is set —
 * reading /api/pl/fixtures rather than /api/gameday/today on purpose, because
 * the poll must be decoupled from quiz-pack state entirely (a cancelled or
 * never-generated pack must not hide it).
 *
 * FIX P4: this used to fetch once on mount, so a fan already sitting on the
 * matchweek page when the real whistle blew never saw the poll appear —
 * second_half_started_at flips server-side with no client event to react to.
 * Polls /api/pl/fixtures on a fixed interval instead, so any fixture that
 * reaches the whistle while this page is open surfaces within one poll tick
 * (POLL_MS, well under a minute). The endpoint is already force-no-store and
 * cheap (one indexed query on the halftime_releases gameweek window — the
 * same query /api/gameday/today's rail already runs on the same cadence
 * family), so a single fixed interval is enough; no backoff/stop condition is
 * needed here because there is always a next gameweek to watch for.
 *
 * Self-hides via the existing contract: this container renders nothing when
 * there is no candidate fixture, and each HalftimePredictionPoll instance
 * self-hides when its own phase isn't open yet and nothing is decided — and
 * that component polls its own endpoint independently to pick up a result
 * landing (see its header), stopping once settled.
 */

import { useEffect, useState } from "react";
import HalftimePredictionPoll from "@/components/halftime/HalftimePredictionPoll";

interface PlFixtureRow {
  fixture_id: number;
  home: string;
  away: string;
  second_half_started_at: string | null;
}

const TEAL = "#00d8c0";
const POLL_MS = 30_000;

export function StandaloneHalftimePoll() {
  const [fixtures, setFixtures] = useState<PlFixtureRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/pl/fixtures", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const json = await res.json();
          setFixtures(Array.isArray(json.fixtures) ? json.fixtures : []);
        }
      } catch {
        /* transient — keep the last good list, retry next tick */
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

  if (!loaded) return null;
  const live = fixtures.filter((f) => f.second_half_started_at !== null);
  if (!live.length) return null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4 flex flex-col gap-3">
      {live.map((f) => (
        <HalftimePredictionPoll key={f.fixture_id} fixtureId={f.fixture_id} phase="halftime" accent={TEAL} />
      ))}
    </div>
  );
}
