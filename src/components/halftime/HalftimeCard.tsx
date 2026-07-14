"use client";

/**
 * Home dashboard spotlight for a live (or next) halftime pack. Mirrors the
 * Dashboard.tsx "RESUME YOUR RUN" wcRun banner (same shape/classes) so it
 * reads as part of the same takeover-priority-CTA family, not a bolt-on.
 *
 * Self-fetching (useHalftimeToday) so mounting this needed zero changes to
 * the server-built DashboardData contract — see Dashboard.tsx.
 */

import Link from "next/link";
import { useHalftimeToday, kickoffLabel, hasKickedOff, isLive, packHref, type HalftimeFixture } from "./useHalftimeToday";

const TEAL = "#00d8c0";

/** Prefer a live pack (earliest-released first); otherwise the soonest kickoff today. */
function pickFixture(fixtures: HalftimeFixture[]): HalftimeFixture | null {
  if (fixtures.length === 0) return null;
  const live = fixtures.filter((f) => isLive(f)).sort((a, b) => (a.released_at ?? "").localeCompare(b.released_at ?? ""));
  if (live.length) return live[0];
  return [...fixtures].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))[0];
}

export function HalftimeCard() {
  const { fixtures, loaded } = useHalftimeToday();
  if (!loaded) return null;

  const f = pickFixture(fixtures);
  if (!f) return null;

  const live = isLive(f);
  const href = (live ? packHref(f) : null) ?? "/play";

  return (
    <Link
      href={href}
      className="d-2 flex items-center justify-between rounded-2xl px-4 py-3.5 transition-transform active:scale-[0.99]"
      style={
        live
          ? { background: "linear-gradient(120deg, rgba(0,216,192,0.16), rgba(0,216,192,0.04))", border: "1px solid rgba(0,216,192,0.4)" }
          : { background: "linear-gradient(120deg, rgba(0,216,192,0.07), rgba(0,216,192,0.02))", border: "1px solid rgba(0,216,192,0.2)" }
      }
    >
      <div className="min-w-0">
        <p className="font-display text-lg text-white leading-none truncate">
          {live ? "HALFTIME — PLAY NOW" : `${f.home} v ${f.away}`}
        </p>
        <p className="font-body text-xs mt-1 truncate" style={{ color: live ? TEAL : "#8a948f" }}>
          {live
            ? `${f.home} v ${f.away} · quiz pack is live`
            : hasKickedOff(f)
            ? "Quiz pack drops at half time"
            : `Kicks off ${kickoffLabel(f.kickoff_at)} · quiz pack at half time`}
        </p>
      </div>
      <span className="font-display text-xl flex-shrink-0" style={{ color: TEAL }}>→</span>
    </Link>
  );
}
