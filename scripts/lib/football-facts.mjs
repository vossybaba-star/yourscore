/**
 * football-facts.mjs — FREE structured football facts for the Reddit drafter.
 *
 * Why: the drafter was using the paid Anthropic web_search tool for facts that
 * we can get for nothing. Sportmonks is already on subscription (zero marginal
 * cost, Premier League only) and the ESPN-backed `sports-skills` CLI is free and
 * covers the World Cup + other leagues. Between them they answer the fact classes
 * that were actually breaking the drafts:
 *
 *   "Arne Slot is Liverpool's manager"   → plManager()   (Slot out 30 Jun, Iraola in)
 *   "Cherki, if Lyon go up"              → playerClub()  (current club)
 *   "Vinicius is a good captain pick"    → wcState()     (Brazil already out)
 *
 * Paid web search stays available in the drafter, but only for what this can't
 * answer: news, quotes, injury reports, "what did X say".
 *
 * Everything fails SOFT: a lookup that errors returns null and is simply omitted
 * from the brief. A missing fact must never crash a sweep.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const CACHE_FILE = join(DATA, "facts-cache.json");
const TTL_MS = 6 * 3600 * 1000; // 6h — well inside a sweep cadence, keeps calls tiny
const SM = "https://api.sportmonks.com/v3/football";
const PL_LEAGUE = 8; // the Sportmonks plan covers the Premier League only

const key = () => process.env.SPORTMONKS_API_KEY;

// ── cache ────────────────────────────────────────────────────────────────────
let _cache = null;
const loadCache = () => (_cache ??= existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {});
function cached(k, fn) {
  const c = loadCache();
  const hit = c[k];
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.v);
  return fn().then((v) => {
    c[k] = { at: Date.now(), v };
    try { writeFileSync(CACHE_FILE, JSON.stringify(c)); } catch { /* cache is best-effort */ }
    return v;
  });
}

async function sm(path) {
  if (!key()) return null;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${SM}${path}${sep}api_token=${key()}`);
  if (!res.ok) throw new Error(`sportmonks ${res.status}`);
  return (await res.json()).data;
}

/** ESPN-backed sports-skills CLI — free, no API key. */
async function espn(args) {
  const home = process.env.HOME || "";
  // VPS installs it in a venv; macOS via `pip install --user`. Fall back to PATH.
  const candidates = [
    process.env.SPORTS_SKILLS_BIN,
    join(home, ".venv-sports/bin/sports-skills"),   // VPS
    join(home, "Library/Python/3.9/bin/sports-skills"), // laptop
    "/usr/local/bin/sports-skills",
  ].filter(Boolean);
  const bin = candidates.find((p) => existsSync(p)) || "sports-skills";
  const { stdout } = await execFileAsync(bin, ["football", ...args], { timeout: 45_000, maxBuffer: 20e6 });
  return JSON.parse(stdout).data;
}

// ── Premier League (Sportmonks — already paid) ───────────────────────────────

/** Who actually manages this PL club right now. The Slot-class fact. */
// Sportmonks coach objects carry `common_name` / `firstname`+`lastname` — NOT the
// `display_name`/`name` a player object has. Reading the player fields off a coach
// yielded undefined, so plManager() returned null for EVERY club, silently (the
// bare catch hid it): the manager never once reached a fact brief, in the sweep or
// the dash. Managers are the exact fact class that broke drafts ("Arne Slot is
// still at Liverpool"). Read the fields a coach actually has.
const coachName = (c) =>
  c?.display_name || c?.name || c?.common_name ||
  [c?.firstname, c?.lastname].filter(Boolean).join(" ") || null;

export async function plManager(club) {
  return cached(`mgr:${club.toLowerCase()}`, async () => {
    try {
      const teams = await sm(`/teams/search/${encodeURIComponent(club)}`);
      const t = (teams || []).find((x) => x.name?.toLowerCase().includes(club.toLowerCase())) || (teams || [])[0];
      if (!t) return null;
      const full = await sm(`/teams/${t.id}?include=coaches`);
      const active = (full?.coaches || []).find((c) => c.active);
      if (!active) return null;
      const coach = await sm(`/coaches/${active.coach_id}`);
      const name = coachName(coach);
      if (!name) return null;
      const prev = (full.coaches || []).filter((c) => !c.active && c.end).sort((a, b) => b.end.localeCompare(a.end))[0];
      let note = `${full.name} manager: ${name} (since ${active.start || "?"})`;
      if (prev) {
        const p = await sm(`/coaches/${prev.coach_id}`);
        const pn = coachName(p);
        if (pn) note += `. Predecessor ${pn} left ${prev.end}`;
      }
      return note;
    } catch { return null; }
  });
}

/** What club does this player actually play for now. The Cherki-class fact. */
export async function playerClub(name) {
  return cached(`plr:${name.toLowerCase()}`, async () => {
    try {
      const ps = await sm(`/players/search/${encodeURIComponent(name)}?include=teams.team`);
      const p = (ps || [])[0];
      if (!p) return null;
      const clubs = (p.teams || [])
        .map((t) => ({ name: t.team?.name, start: t.start, national: !!t.team?.national_team }))
        .filter((t) => t.name && !t.national)
        .sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
      if (!clubs.length) return null;
      return `${p.display_name}: currently at ${clubs[0].name} (since ${clubs[0].start || "?"})`;
    } catch { return null; }
  });
}

/** Current PL table (top + bottom, enough to ground a take). */
export async function plTable() {
  return cached("pltable", async () => {
    try {
      const league = await sm(`/leagues/${PL_LEAGUE}?include=currentSeason`);
      const seasonId = (league?.currentseason || league?.currentSeason)?.id;
      if (!seasonId) return null;
      // Without the include, `participant` is absent and every row rendered as
      // "1. ? 0pts" — we were feeding that placeholder junk into the drafter's
      // fact brief on every single draft.
      const rows = await sm(`/standings/seasons/${seasonId}?include=participant`);
      if (!rows?.length) return null;
      // Pre-season the standings exist but nothing has been played: 20 clubs on
      // 0 points is not a fact, it's noise. Say nothing rather than something empty.
      if (!rows.some((r) => (r.points || 0) > 0)) return null;
      const named = (r) => r.participant?.name || r.team?.name;
      if (!rows.every(named)) return null; // names missing = don't guess, stay silent
      const line = (r) => `${r.position}. ${named(r)} ${r.points}pts`;
      return `PL table — ${rows.slice(0, 4).map(line).join(", ")} ... ${rows.slice(-3).map(line).join(", ")}`;
    } catch { return null; }
  });
}

// ── World Cup / other leagues (ESPN — free) ──────────────────────────────────

/** Live World Cup state: recent results and which sides are already out. */
export async function wcState() {
  return cached("wc", async () => {
    try {
      const d = await espn(["get_season_schedule", "--season_id=world-cup-2026"]);
      const sch = d?.schedules || [];
      const played = sch.filter((e) => e.status === "closed");
      if (!played.length) return null;
      const fmt = (e) => {
        const [a, b] = e.competitors;
        return `${a.team.name} ${a.score ?? "?"}-${b.score ?? "?"} ${b.team.name}`;
      };
      const recent = [...played].sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(-8)
        .map((e) => `${e.start_time.slice(0, 10)} ${fmt(e)}`);
      // Only genuinely FUTURE fixtures. The feed carries non-"closed" entries dated
      // in the past (postponed/placeholder); listing those as "still to play" would
      // have the drafter write about a match that already happened.
      const nowIso = new Date().toISOString();
      const upcoming = sch
        .filter((e) => e.status !== "closed" && e.start_time > nowIso)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .slice(0, 4)
        .map((e) => `${e.start_time.slice(0, 10)} ${e.competitors.map((c) => c.team.name).join(" v ")}`);
      return [
        `WORLD CUP 2026 — ${played.length}/${sch.length} matches played.`,
        `Latest results: ${recent.join(" | ")}`,
        upcoming.length ? `Still to play: ${upcoming.join(" | ")}` : `No fixtures left.`,
        `(A nation whose last match is a knockout defeat is OUT — do not write about them as if still involved.)`,
      ].join("\n");
    } catch { return null; }
  });
}

// ── brief assembly ───────────────────────────────────────────────────────────

/**
 * Build a factual brief from FREE sources for the entities a thread is about.
 * @param {{clubs?:string[], players?:string[], competition?:string}} e
 * @returns {Promise<string>} "" when nothing could be established
 */
export async function factBrief({ clubs = [], players = [], competition = "" } = {}) {
  const jobs = [];
  for (const c of clubs.slice(0, 3)) jobs.push(plManager(c));
  for (const p of players.slice(0, 4)) jobs.push(playerClub(p));
  if (/world cup|wc/i.test(competition)) jobs.push(wcState());
  if (/premier league|pl\b/i.test(competition)) jobs.push(plTable());
  const out = (await Promise.all(jobs.map((j) => j.catch(() => null)))).filter(Boolean);
  return out.length ? out.join("\n") : "";
}
