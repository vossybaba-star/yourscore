"use client";

// In-app navigation trail + smart back.
//
// Problem (founder, Jul 5): back pills hardcode a destination, so "back" often
// teleports players to an area they never came from (league table → Versus,
// featured quiz → /play, …). Users expect back to RETRACE their steps.
//
// NavTracker (mounted once in the root layout) records every client-side
// route change into a sessionStorage trail. smartBack() walks that trail
// backwards, skipping transient screens a player should never be returned to
// (matchmaking radar, live game rooms, auth), and pushes the first real one.
// No trail (deep link, fresh session) → the caller's fallback.

const KEY = "ys:nav:trail";
const MAX = 25;

/** Screens that must never be a back destination — re-entering them re-queues,
 * re-joins a dead lobby, or bounces straight back out. */
const TRANSIENT: RegExp[] = [
  /^\/versus\/find/, // matchmaking radar — re-entering re-queues
  /^\/play\/[^/?]+/, // a game room (live or finished)
  /^\/g\//, // solo game session
  /^\/auth\//,
  /^\/league\/join/, // join redirector
  /^\/38-0\/match\/(?!result)/, // 38-0 match sim screens
];

function readTrail(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeTrail(trail: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail.slice(-MAX)));
  } catch {
    /* storage unavailable — smart back degrades to fallback */
  }
}

/** Called by NavTracker on every route change. */
export function recordVisit(url: string) {
  const trail = readTrail();
  if (trail[trail.length - 1] === url) return; // same-page query churn
  trail.push(url);
  writeTrail(trail);
}

/**
 * Retrace to the last real screen the player was on before this one.
 * Returns the URL to navigate to (and truncates the trail so repeated backs
 * keep walking up), or the fallback when there's nothing to retrace.
 */
export function smartBackTarget(fallback: string): string {
  const trail = readTrail();
  const current = trail.length ? trail[trail.length - 1] : null;
  for (let i = trail.length - 2; i >= 0; i--) {
    const candidate = trail[i];
    if (candidate === current) continue;
    if (TRANSIENT.some((re) => re.test(candidate))) continue;
    writeTrail(trail.slice(0, i + 1));
    return candidate;
  }
  writeTrail([]);
  return fallback;
}
