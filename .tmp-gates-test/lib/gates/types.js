"use strict";
/**
 * YourScore Fantasy Football — gate generator: shared types.
 *
 * The "gates" are the knowledge-round challenges that earn a player's transfer
 * budget. This module is the content-generation engine that turns football data
 * into validated, unambiguous question instances (a "clean base").
 *
 * ADDITIVE and self-contained: it does not touch existing YourScore schema or
 * routes. Authored to be type-strippable (no enums / namespaces / param-props)
 * so the generators + validators run under `node --test` with Node's native
 * type stripping — same convention as src/lib/draft/*.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAT_LABEL = exports.POSITIONS = void 0;
exports.statValue = statValue;
exports.POSITIONS = ["GK", "DEF", "MID", "FWD"];
/** Human labels for the stats (used in prompts). */
exports.STAT_LABEL = {
    price: "value",
    goals: "goals this season",
    assists: "assists this season",
    appearances: "starts this season",
    points: "fantasy points this season",
    form: "recent form",
    age: "age",
};
/** Read a numeric stat off a Player (single source of truth for both generators). */
function statValue(p, stat) {
    switch (stat) {
        case "price":
            return p.price;
        case "goals":
            return p.goals;
        case "assists":
            return p.assists;
        case "appearances":
            return p.appearances;
        case "points":
            return p.points;
        case "form":
            return p.form;
        case "age":
            return p.age ?? 0;
    }
}
