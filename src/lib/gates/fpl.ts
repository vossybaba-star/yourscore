/**
 * FPL source adapter — maps the public `bootstrap-static` feed into Player[].
 *
 * This is the free/public data source that lets the first two formats (Higher/Lower
 * + This-season form) build now, before any SportMonks key is set up. The mapper is
 * PURE (testable with a fixture); the network fetch is a separate, optional helper.
 *
 * Unofficial API — the facts are used as input only; nothing here brands as FPL.
 */

import { type Player, type Position } from "./types";

/** The subset of the FPL bootstrap-static shape we read. */
export interface FplBootstrap {
  elements: FplElement[];
  teams: FplTeam[];
  /** Gameweeks — the first event's deadline year tells us which season the feed serves. */
  events?: { id: number; name: string; deadline_time: string }[];
}

export interface FplElement {
  id: number;
  web_name: string;
  element_type: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  team: number;
  now_cost: number; // tenths of £m
  selected_by_percent: string;
  goals_scored: number;
  assists: number;
  minutes: number;
  starts?: number;
  total_points: number;
  form: string;
  status: string; // "a" available, "i" injured, "d" doubtful, "s" susp, "u" unavailable
  code?: number;
}

export interface FplTeam {
  id: number;
  short_name: string;
}

const POSITION_BY_TYPE: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

function toNumber(s: string | number | undefined): number {
  const n = typeof s === "number" ? s : parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** Map a live/fixture bootstrap payload to the normalized Player[]. */
export function fplToPlayers(b: FplBootstrap): Player[] {
  const clubById = new Map<number, string>(b.teams.map((t) => [t.id, t.short_name]));
  return b.elements.map((e) => ({
    id: e.id,
    name: e.web_name,
    position: POSITION_BY_TYPE[e.element_type] ?? "MID",
    club: clubById.get(e.team) ?? "",
    clubId: e.team,
    price: e.now_cost / 10,
    ownership: toNumber(e.selected_by_percent),
    goals: e.goals_scored,
    assists: e.assists,
    appearances: e.starts ?? 0,
    minutes: e.minutes,
    points: e.total_points,
    form: toNumber(e.form),
    available: e.status === "a",
    photoCode: e.code,
  }));
}

/** Fetch the live public bootstrap feed (used by the validation script, not tests). */
export async function fetchFplBootstrap(): Promise<FplBootstrap> {
  const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!res.ok) throw new Error(`FPL bootstrap-static ${res.status}`);
  return (await res.json()) as FplBootstrap;
}
