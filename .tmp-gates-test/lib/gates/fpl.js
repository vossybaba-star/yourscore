"use strict";
/**
 * FPL source adapter — maps the public `bootstrap-static` feed into Player[].
 *
 * This is the free/public data source that lets the first two formats (Higher/Lower
 * + This-season form) build now, before any SportMonks key is set up. The mapper is
 * PURE (testable with a fixture); the network fetch is a separate, optional helper.
 *
 * Unofficial API — the facts are used as input only; nothing here brands as FPL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fplToPlayers = fplToPlayers;
exports.fetchFplBootstrap = fetchFplBootstrap;
const POSITION_BY_TYPE = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
function toNumber(s) {
    const n = typeof s === "number" ? s : parseFloat(s ?? "");
    return Number.isFinite(n) ? n : 0;
}
/** Map a live/fixture bootstrap payload to the normalized Player[]. */
function fplToPlayers(b) {
    const clubById = new Map(b.teams.map((t) => [t.id, t.short_name]));
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
async function fetchFplBootstrap() {
    const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
    if (!res.ok)
        throw new Error(`FPL bootstrap-static ${res.status}`);
    return (await res.json());
}
