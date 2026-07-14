"use strict";
/**
 * SportMonks historical adapter (the €29 historical add-on) — PL seasons back
 * to 2000/01. Sources for the era formats: classic trivia (champions, top
 * scorers) and career-path (per-season squads → PL club history per player).
 *
 * Fetchers are thin; everything the generators consume is normalized + pure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.seasonStartYear = seasonStartYear;
exports.shortSeasonName = shortSeasonName;
exports.ageAtSeason = ageAtSeason;
exports.buildCareers = buildCareers;
exports.fetchPlSeasons = fetchPlSeasons;
exports.fetchSeasonStandings = fetchSeasonStandings;
exports.fetchSeasonTopScorers = fetchSeasonTopScorers;
/** Parse "2013/2014" → 2013 (used for era difficulty + ordering). */
function seasonStartYear(name) {
    const m = name.match(/^(\d{4})/);
    return m ? parseInt(m[1], 10) : 0;
}
/** Short display form: "2013/2014" → "2013/14". */
function shortSeasonName(name) {
    const m = name.match(/^(\d{4})\/(\d{2})(\d{2})$/);
    return m ? `${m[1]}/${m[3]}` : name;
}
/** Age (whole years) at the start of a season (≈ Aug 1) from an ISO DOB. */
function ageAtSeason(dob, startYear) {
    const m = dob.match(/^(\d{4})-(\d{2})/);
    if (!m)
        return null;
    const birthYear = parseInt(m[1], 10);
    const birthMonth = parseInt(m[2], 10);
    const age = startYear - birthYear - (birthMonth > 8 ? 1 : 0);
    return age >= 10 && age <= 55 ? age : null;
}
/**
 * Build per-player PL careers from a list of season squads (pure).
 * Consecutive seasons at the same club collapse into one entry; a return to a
 * previous club after leaving is a NEW entry (Arsenal → Chelsea → Arsenal).
 *
 * Youth containment (founder, Jul 9): squad registrations from before a player
 * turned `minStintAge` (default 18) are SKIPPED — an academy kid on the bench
 * list isn't a career stop anyone remembers. Careers with an unknown DOB can't
 * be filtered, so they're flagged `dobKnown: false` and excluded as answers.
 */
function buildCareers(seasonSquads, opts = {}) {
    const minStintAge = opts.minStintAge ?? 18;
    const ordered = seasonSquads.slice().sort((a, b) => a.season.startYear - b.season.startYear);
    const byPlayer = new Map();
    for (const { season, players } of ordered) {
        // A player can appear in two squads in one season (mid-season move); keep
        // first-seen order within the season as-is.
        for (const p of players) {
            const age = p.dateOfBirth ? ageAtSeason(p.dateOfBirth, season.startYear) : null;
            if (age !== null && age < minStintAge)
                continue; // youth stint — not a career stop
            let c = byPlayer.get(p.smId);
            if (!c) {
                c = {
                    playerId: p.smId,
                    name: p.name,
                    clubs: [],
                    firstYear: season.startYear,
                    lastYear: season.startYear,
                    seasons: 0,
                    dobKnown: age !== null,
                    photoUrl: p.imagePath,
                };
                byPlayer.set(p.smId, c);
            }
            if (age === null)
                c.dobKnown = false;
            // Seasons run oldest → newest, so the latest non-empty image wins.
            if (p.imagePath)
                c.photoUrl = p.imagePath;
            if (c.lastYear !== season.startYear || c.seasons === 0)
                c.seasons++;
            c.lastYear = season.startYear;
            if (c.lastClub !== p.club) {
                c.clubs.push({ club: p.club, fromYear: season.startYear });
                c.lastClub = p.club;
            }
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure-to-drop
    return Array.from(byPlayer.values()).map(({ lastClub: _drop, ...c }) => c);
}
// ---------------------------------------------------------------------------
// Fetchers (network — scripts/cron, not tests)
// ---------------------------------------------------------------------------
const SM_BASE = "https://api.sportmonks.com/v3/football";
/** SportMonks type id for "Goals" in the topscorers feed. */
const TOPSCORER_GOALS_TYPE = 208;
async function smGet(path, key) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${SM_BASE}${path}${sep}api_token=${key}`);
    if (!res.ok)
        throw new Error(`SportMonks ${path} ${res.status}`);
    const body = (await res.json());
    if (body.data === undefined)
        throw new Error(`SportMonks ${path}: ${body.message ?? "no data"}`);
    return body.data;
}
/** All PL seasons on the plan (historical add-on → back to 2000/01), oldest first. */
async function fetchPlSeasons(key) {
    const data = (await smGet(`/seasons?filters=seasonLeagues:8&per_page=50`, key));
    return data
        .map((s) => ({ id: s.id, name: s.name, startYear: seasonStartYear(s.name) }))
        .filter((s) => s.startYear > 0)
        .sort((a, b) => a.startYear - b.startYear);
}
/** Final standings for a season (position-sorted). */
async function fetchSeasonStandings(seasonId, key) {
    const data = (await smGet(`/standings/seasons/${seasonId}?include=participant`, key));
    return data
        .filter((r) => r.participant)
        .map((r) => ({
        position: r.position,
        teamId: r.participant.id,
        team: r.participant.name,
        points: r.points,
    }))
        .sort((a, b) => a.position - b.position);
}
/** Top goalscorers for a season (rank-sorted, goals type only). */
async function fetchSeasonTopScorers(seasonId, key) {
    const data = (await smGet(`/topscorers/seasons/${seasonId}?include=player&filters=seasontopscorerTypes:${TOPSCORER_GOALS_TYPE}&per_page=25`, key));
    return data
        .filter((r) => r.player)
        .map((r) => ({
        rank: r.position,
        playerId: r.player.id,
        name: r.player.display_name ?? r.player.name ?? "",
        goals: r.total,
    }))
        .filter((r) => r.name.length > 0)
        .sort((a, b) => a.rank - b.rank);
}
