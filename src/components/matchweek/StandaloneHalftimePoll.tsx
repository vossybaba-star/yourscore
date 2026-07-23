"use client";

/**
 * The standalone halftime prediction poll (§0.6): "every player must see the
 * halftime poll whether or not they played the quiz." Surfaced on the
 * matchweek page for any fixture whose second_half_started_at is set —
 * reading /api/pl/fixtures rather than /api/gameday/today on purpose, because
 * the poll must be decoupled from quiz-pack state entirely (a cancelled or
 * never-generated pack must not hide it).
 *
 * Self-hides via the existing contract: this container renders nothing when
 * there is no candidate fixture, and each HalftimePredictionPoll instance
 * self-hides when its own phase isn't open yet and nothing is decided.
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

export function StandaloneHalftimePoll() {
  const [fixtures, setFixtures] = useState<PlFixtureRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pl/fixtures")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setFixtures(Array.isArray(json.fixtures) ? json.fixtures : []);
      })
      .catch(() => {
        /* transient — render nothing */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
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
