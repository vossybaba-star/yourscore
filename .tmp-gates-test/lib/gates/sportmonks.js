"use strict";
/**
 * SportMonks source adapter — enriches the FPL-normalized Player[] with the
 * fields the Who-am-I format needs: nationality, age and jersey number.
 *
 * Design notes:
 * - The MATCHING logic is pure (testable); the fetchers are separate helpers.
 * - Matching is deliberately conservative — name+club only, and only when the
 *   candidate is unambiguous on BOTH sides. An unmatched player simply stays
 *   unenriched (still fine for Higher/Lower + form; excluded as a Who-am-I
 *   answer). Precision over coverage: a wrong enrichment makes a WRONG question,
 *   a missing one just makes fewer. (Same lesson as the WC nationality build:
 *   never add a name-only fallback.)
 * - Career history is NOT sourced here: the Starter plan omits out-of-plan
 *   leagues, so histories are partial (verified live: Haaland → Man City only).
 *   Career-path builds from the owned FIFA dataset instead.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeName = normalizeName;
exports.lastToken = lastToken;
exports.ageFrom = ageFrom;
exports.matchClubs = matchClubs;
exports.buildEnrichment = buildEnrichment;
exports.enrichPlayers = enrichPlayers;
exports.fetchSmSeasonTeams = fetchSmSeasonTeams;
exports.fetchSmSquad = fetchSmSquad;
exports.fetchSmSeasonSquads = fetchSmSeasonSquads;
/** Lowercase, strip diacritics, collapse whitespace. */
function normalizeName(s) {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Last name token (the strongest cross-source signal for footballer names). */
function lastToken(s) {
    const t = normalizeName(s).split(" ");
    return t[t.length - 1] ?? "";
}
/** Age in whole years at `now` from an ISO date-of-birth. */
function ageFrom(dob, now) {
    const d = new Date(dob + "T00:00:00Z");
    if (Number.isNaN(d.getTime()))
        return undefined;
    let age = now.getUTCFullYear() - d.getUTCFullYear();
    const m = now.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate()))
        age--;
    return age >= 14 && age <= 50 ? age : undefined;
}
/** FPL club-name abbreviations expanded before matching (data normalization —
 *  a fixed, checkable list, NOT fuzzy guessing). */
const CLUB_ALIASES = {
    spurs: "tottenham hotspur",
    utd: "united",
    "nott'm": "nottingham",
    wolves: "wolverhampton wanderers",
};
function expandAliases(name) {
    return name
        .toLowerCase()
        .split(/\s+/)
        .map((t) => CLUB_ALIASES[t] ?? t)
        .join(" ");
}
/** Token prefix-overlap score between two normalized names ("man" ⊂ "manchester"). */
function prefixScore(a, b) {
    const at = a.split(" ").filter((t) => t.length >= 3);
    const bt = b.split(" ").filter((t) => t.length >= 3);
    let n = 0;
    for (const x of at)
        if (bt.some((y) => y.startsWith(x) || x.startsWith(y)))
            n++;
    return n;
}
/**
 * Map FPL club ids to SportMonks club ids. FPL names are abbreviated ("Man
 * City", "Spurs"); we expand known aliases, then require a UNIQUE best match
 * with a prefix-overlap score ≥ 2 — otherwise the club stays unmapped (its
 * players simply aren't enriched; never a wrong club).
 */
function matchClubs(fplClubs, smClubs) {
    const out = new Map();
    for (const f of fplClubs) {
        const fn = normalizeName(expandAliases(f.name));
        const fnTokens = fn.split(" ").filter((t) => t.length >= 3).length;
        let best = null;
        let tie = false;
        for (const s of smClubs) {
            const score = prefixScore(fn, normalizeName(expandAliases(s.name)));
            if (best === null || score > best.score) {
                best = { id: s.id, score };
                tie = false;
            }
            else if (score === best.score)
                tie = true;
        }
        // Accept a unique best when it matches ≥2 tokens, OR when it covers EVERY
        // token of the FPL name (handles one-word clubs: Arsenal, Liverpool, …).
        if (best && !tie && (best.score >= 2 || (best.score >= 1 && best.score >= fnTokens)))
            out.set(f.id, best.id);
    }
    return out;
}
/**
 * Conservatively match FPL players to SportMonks squad members and return the
 * enrichment per FPL player id. Rule: same (mapped) club AND same last-name
 * token AND exactly one candidate on each side — otherwise no match.
 */
function buildEnrichment(players, smPlayers, clubMap, // fpl clubId -> sm clubId
now) {
    // Index SM players by (smClubId, lastToken)
    const smIndex = new Map();
    for (const s of smPlayers) {
        const key = `${s.clubId}:${lastToken(s.name)}`;
        const arr = smIndex.get(key);
        if (arr)
            arr.push(s);
        else
            smIndex.set(key, [s]);
    }
    // Count FPL players per (fplClubId, lastToken) to enforce uniqueness on our side too
    const fplCount = new Map();
    for (const p of players) {
        const key = `${p.clubId}:${lastToken(p.name)}`;
        fplCount.set(key, (fplCount.get(key) ?? 0) + 1);
    }
    const out = new Map();
    for (const p of players) {
        const smClub = clubMap.get(p.clubId);
        if (smClub === undefined)
            continue;
        const token = lastToken(p.name);
        if (!token)
            continue;
        if ((fplCount.get(`${p.clubId}:${token}`) ?? 0) !== 1)
            continue; // ambiguous on FPL side
        const candidates = smIndex.get(`${smClub}:${token}`) ?? [];
        if (candidates.length !== 1)
            continue; // ambiguous or missing on SM side
        const s = candidates[0];
        out.set(p.id, {
            nationality: s.nationality,
            age: s.dateOfBirth ? ageFrom(s.dateOfBirth, now) : undefined,
            jersey: s.jersey,
            photoUrl: s.imagePath,
            flagUrl: s.flagPath,
            smId: s.smId,
        });
    }
    return out;
}
/** Apply an enrichment map to players (returns new objects; input untouched). */
function enrichPlayers(players, enrichment) {
    return players.map((p) => {
        const e = enrichment.get(p.id);
        return e
            ? { ...p, nationality: e.nationality, age: e.age, jersey: e.jersey, photoUrl: e.photoUrl, flagUrl: e.flagUrl }
            : p;
    });
}
// ---------------------------------------------------------------------------
// Fetchers (network — used by scripts/serving, not by tests)
// ---------------------------------------------------------------------------
const SM_BASE = "https://api.sportmonks.com/v3/football";
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
/** Teams in a season: [{id, name}]. */
async function fetchSmSeasonTeams(seasonId, key) {
    const data = (await smGet(`/teams/seasons/${seasonId}`, key));
    return data.map((t) => ({ id: t.id, name: t.name }));
}
/** A team's squad for a season, with player nationality included. */
async function fetchSmSquad(seasonId, teamId, teamName, key) {
    const data = (await smGet(`/squads/seasons/${seasonId}/teams/${teamId}?include=player.nationality`, key));
    const out = [];
    for (const row of data) {
        const pl = row.player;
        if (!pl)
            continue;
        const name = pl.display_name ?? pl.name;
        if (!name)
            continue;
        out.push({
            smId: pl.id,
            name,
            clubId: teamId,
            club: teamName,
            // API sends null for unassigned shirt numbers — coerce to undefined so
            // downstream "known attribute" checks stay honest.
            jersey: typeof row.jersey_number === "number" ? row.jersey_number : undefined,
            dateOfBirth: pl.date_of_birth ?? undefined,
            nationality: pl.nationality?.name ?? undefined,
            imagePath: pl.image_path ?? undefined,
            flagPath: pl.nationality?.image_path ?? undefined,
        });
    }
    return out;
}
/** All squads for a season (sequential — ~20 requests, well under rate limits). */
async function fetchSmSeasonSquads(seasonId, key) {
    const teams = await fetchSmSeasonTeams(seasonId, key);
    const players = [];
    for (const t of teams) {
        players.push(...(await fetchSmSquad(seasonId, t.id, t.name, key)));
    }
    return { teams, players };
}
