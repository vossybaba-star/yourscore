/**
 * Draft XI — player pool access + spin logic.
 *
 * Wraps the shipped dataset (src/data/draft/player-seasons.json, ~2.6MB / 10k
 * player-seasons) with the runtime indexes the game needs: spin a random
 * (club, season) bucket, list the players in it that can still fill an open slot,
 * and look players up by id. The dataset is loaded on demand (see ensurePool)
 * rather than statically imported, so it does not bloat every draft page's
 * initial JS bundle.
 */

import type { League, NationEntry, PlayerSeason, Position } from "./types";
import { canPlay, playerIdentity } from "./score";
import { allWCNations, type WCNation } from "@/data/draft/wc2026";

/** Names of every nation at WC 2026 — the eligible set for the open "World Cup" draft. */
const WC_NATION_NAMES = new Set<string>(allWCNations().map((n) => n.nation));

type Bucket = { league: League; club: string; clubSlug: string; season: string; playerIds: string[] };

type Club = { name: string; clubSlug: string; season: string; league: League; strength: number };

type PoolData = {
  generatedAt: string;
  source: string;
  counts: { players: number; buckets: number; csvAdded: number };
  players: PlayerSeason[];
  buckets: Bucket[];
  clubs: Club[];
  nations?: NationEntry[]; // present after the WC-Run dataset rebuild
  leagues?: Record<League, { players: number; buckets: number }>;
};

// The ~2.6MB player dataset is loaded on demand via a dynamic import rather than
// a static `import`, so webpack ships it as its own async chunk instead of
// inlining it into every draft/quiz page's initial JS bundle (which blocked first
// render). Consumers must `await ensurePool()` — and, in React, gate rendering on
// `isPoolReady()` — before calling any pool function below.
let DATA: PoolData | null = null;
let byId = new Map<string, PlayerSeason>();
let byNation = new Map<string, NationEntry>();
/** Every player whose nationality is a WC 2026 nation — the open "World Cup" draft pool. */
let WC_PLAYERS: PlayerSeason[] = [];
/** Nation → crest, for labelling a World Cup spin. */
let WC_CREST = new Map<string, string>();
let poolReady = false;
let loadPromise: Promise<void> | null = null;

function buildIndexes(data: PoolData): void {
  DATA = data;
  byId = new Map<string, PlayerSeason>(data.players.map((p) => [p.id, p]));
  byNation = new Map<string, NationEntry>((data.nations ?? []).map((n) => [n.nation, n]));
  WC_PLAYERS = data.players.filter((p) => !!p.nationality && WC_NATION_NAMES.has(p.nationality));
  WC_CREST = new Map<string, string>(allWCNations().map((n) => [n.nation, n.crest]));
  poolReady = true;
}

/** True once the dataset has loaded and the indexes are built. */
export function isPoolReady(): boolean {
  return poolReady;
}

/** Load the player dataset (once) and build the runtime indexes. Idempotent;
 *  concurrent callers share a single in-flight load. */
async function loadPoolData(): Promise<PoolData> {
  // Server (e.g. the records API awaiting ensurePool): bundle the JSON — no
  // stale-chunk risk server-side.
  if (typeof window === "undefined") {
    const m = await import("@/data/draft/player-seasons.json");
    return ((m as { default?: unknown }).default ?? m) as PoolData;
  }
  // Client: fetch a STABLE, deploy-invariant public URL. A webpack dynamic-import
  // chunk gets a fresh content hash on every deploy, so a cached app shell (the
  // native WKWebView caches JS aggressively) would request an OLD chunk hash that
  // newer deploys have deleted → 404 → pool never loads → the user can't pick a
  // player. A /public URL is served identically by every deploy, so even a stale
  // cached shell loads it fine.
  const res = await fetch("/data/draft/player-seasons.json", { cache: "force-cache" });
  if (!res.ok) throw new Error(`pool fetch failed: ${res.status}`);
  return (await res.json()) as PoolData;
}

export async function ensurePool(): Promise<void> {
  if (poolReady) return;
  // On failure, clear the cached promise so a later call retries — otherwise a
  // single transient load failure would cache the rejection forever and
  // permanently break spinning/picking players.
  loadPromise ??= loadPoolData()
    .then((data) => { buildIndexes(data); })
    .catch((err) => { loadPromise = null; throw err; });
  await loadPromise;
}

function requireData(): PoolData {
  if (!DATA) throw new Error("Draft pool not loaded — await ensurePool() before using pool functions.");
  return DATA;
}

/** Player-pool totals (call after ensurePool). */
export function poolMeta() {
  return requireData().counts;
}
/** Per-league counts (players + spinnable squads) for UI copy (call after ensurePool). */
export function leagueCounts(): Record<League, { players: number; buckets: number }> {
  const d = requireData();
  return (
    d.leagues ?? {
      PL: { players: d.counts.players, buckets: d.counts.buckets },
      LaLiga: { players: 0, buckets: 0 },
    }
  ) as Record<League, { players: number; buckets: number }>;
}

/** Buckets for one competition. */
function bucketsFor(league: League): Bucket[] {
  return requireData().buckets.filter((b) => b.league === league);
}

export function getPlayer(id: string): PlayerSeason | undefined {
  return byId.get(id);
}

export function getBucketPlayers(bucket: Bucket): PlayerSeason[] {
  return bucket.playerIds
    .map((id) => byId.get(id))
    .filter((p): p is PlayerSeason => !!p)
    .sort((a, b) => b.overall - a.overall);
}

/** A spin result: the dealt club-season plus its drafted-into-able players. */
export type Spin = {
  club: string;
  clubSlug: string;
  season: string;
  players: PlayerSeason[];
};

/**
 * Spin a random (club, season). If the dealt bucket has no player able to fill any
 * of `openSlotPositions` (or all its players are already drafted), re-spin — up to
 * a sane cap — so the user never dead-ends. Pass the positions of the slots still
 * open and the set of already-used player_season_ids.
 */
export function spin(
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  /** Canonical player identities already in the XI (see playerIdentity) — excludes
   *  the same player even under a different edition's name string. */
  usedIdentities: Set<string> = new Set(),
  rng: () => number = Math.random,
  /** Club-seasons already offered this draft, as "club|season". An already-offered
   *  squad is only re-dealt rarely (see REOFFER_SUPPRESS), so the same options don't
   *  keep coming up position after position — while the occasional same-squad double
   *  stays a fun surprise. Same club via a different season is unrestricted. */
  seen: Set<string> = new Set(),
  /** Which competition's squads to deal from. */
  league: League = "PL",
  /** The quiz-gated quality band for PL Gated mode (see draft-quiz.ts) — a soft rating
   *  window the dealt squad is filtered to, so a wrong answer deals a squad WITHOUT its
   *  stars and a correct streak opens the elite tier. Relaxed (ceiling up first, then
   *  floor down) if no squad can field anyone inside it, so a pick never dead-ends.
   *  Omitted (Just Draft, La Liga, every pre-existing caller) = unbounded, and the
   *  behaviour below is then identical to before the band existed. */
  band: { minOverall?: number; maxOverall?: number } = {}
): Spin {
  const buckets = bucketsFor(league);
  // MEMOISED per call. getBucketPlayers sorts the squad every time, and the band search
  // below can sample the same bucket many times over its relax rounds — without this the
  // gated draft re-sorted squads thousands of times per spin and took seconds on mobile.
  // A bucket's draftable set doesn't change within one spin, so compute it at most once.
  const draftableCache = new Map<string, PlayerSeason[]>();
  const draftable = (b: Bucket) => {
    const key = `${b.club}|${b.season}`;
    const hit = draftableCache.get(key);
    if (hit) return hit;
    const players = getBucketPlayers(b).filter(
      (p) =>
        !usedPlayerIds.has(p.id) &&
        !usedIdentities.has(playerIdentity(p.name)) && // no player twice, even across editions
        openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
    );
    draftableCache.set(key, players);
    return players;
  };

  // Already-offered squads slip through only ~15% of the time, so unseen squads are
  // strongly preferred but a repeat is still possible (a rare double), not banned.
  const REOFFER_SUPPRESS = 0.85;
  let floor = band.minOverall ?? 0;
  let cap = band.maxOverall ?? 99;
  // Outer loop widens the band; inner loop is the original squad hunt. With no band
  // (floor 0 / cap 99) the widen step breaks immediately, so this collapses to exactly
  // the pre-band single pass — same rng draws, same result.
  for (let relax = 0; relax < 40; relax++) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const b = buckets[Math.floor(rng() * buckets.length)];
      if (seen.has(`${b.club}|${b.season}`) && rng() < REOFFER_SUPPRESS) continue;
      const players = draftable(b).filter((p) => p.overall >= floor && p.overall <= cap);
      if (players.length > 0) {
        return { club: b.club, clubSlug: b.clubSlug, season: b.season, players };
      }
    }
    if (cap < 99) cap = Math.min(99, cap + 5);
    else if (floor > 0) floor = Math.max(0, floor - 5);
    else break;
  }

  // Extremely unlikely fallback: any bucket, still excluding already-used players.
  const b = buckets[Math.floor(rng() * buckets.length)];
  const players = getBucketPlayers(b).filter((p) => !usedPlayerIds.has(p.id) && !usedIdentities.has(playerIdentity(p.name)));
  return { club: b.club, clubSlug: b.clubSlug, season: b.season, players };
}

/** All spinnable buckets for a competition (for previews / the slot-machine reel). */
export function allBuckets(league: League = "PL"): Bucket[] {
  return bucketsFor(league);
}

// ── World Cup Run: nation-locked pool ───────────────────────────────────────

/** The nations that can field a full XI (+ upgrade headroom), most-stocked first. */
export function playableNations(): NationEntry[] {
  return (requireData().nations ?? []).filter((n) => n.playable);
}

export function getNation(nation: string): NationEntry | undefined {
  return byNation.get(nation);
}

export type PickableNation = WCNation & { count: number; lines: NationEntry["lines"] };

/** Nations a user can run a World Cup with = playable (enough PL depth) ∩ the real
 *  WC 2026 field, most-stocked first, with flag/abbr for the picker. */
export function pickableNations(): PickableNation[] {
  return allWCNations()
    .map((w) => ({ w, n: byNation.get(w.nation) }))
    .filter((x): x is { w: WCNation; n: NationEntry } => !!x.n && x.n.playable)
    .map(({ w, n }) => ({ ...w, count: n.count, lines: n.lines }))
    .sort((a, b) => b.count - a.count);
}

/** All players for a nation (sorted by overall desc), or [] if unknown. */
export function nationPlayers(nation: string): PlayerSeason[] {
  const n = byNation.get(nation);
  if (!n) return [];
  return n.playerIds
    .map((id) => byId.get(id))
    .filter((p): p is PlayerSeason => !!p)
    .sort((a, b) => b.overall - a.overall);
}

/**
 * Nation-locked spin: deal a candidate slate of `count` players FROM ONE NATION that
 * can fill an open slot, within an overall band [`minOverall`, `maxOverall`].
 *  - `minOverall` is the rising quality FLOOR for upgrade picks (better players each round).
 *  - `maxOverall` is the CEILING for the starting draft (lower-rated players to begin with).
 * If a nation lacks depth in the band, it's relaxed (cap raised first, then floor lowered)
 * so the player never dead-ends. Returns candidates sorted by overall desc.
 */
export function spinForNation(
  nation: string,
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  usedIdentities: Set<string> = new Set(),
  opts: { minOverall?: number; maxOverall?: number; count?: number } = {},
  rng: () => number = Math.random
): PlayerSeason[] {
  const count = opts.count ?? 5;
  const pool = nationPlayers(nation).filter(
    (p) =>
      !usedPlayerIds.has(p.id) &&
      !usedIdentities.has(playerIdentity(p.name)) &&
      openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
  );
  let floor = opts.minOverall ?? 0;
  let cap = opts.maxOverall ?? 99;
  const target = Math.min(count, pool.length);
  const within = () => pool.filter((p) => p.overall >= floor && p.overall <= cap);
  let eligible = within();
  // Relax to keep every nation fieldable: raise the ceiling first (so a thin nation can
  // still draft above the starting cap), then lower the floor.
  for (let guard = 0; eligible.length < target && guard < 40; guard++) {
    if (cap < 99) cap = Math.min(99, cap + 5);
    else if (floor > 0) floor = Math.max(0, floor - 5);
    else break;
    eligible = within();
  }
  const arr = eligible.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count).sort((a, b) => b.overall - a.overall);
}

/** Is this player eligible for the open World Cup draft (nationality at WC 2026)? */
export function isWCEligible(player: PlayerSeason): boolean {
  return !!player.nationality && WC_NATION_NAMES.has(player.nationality);
}

/** A World Cup spin: ONE nation FROM ONE ERA (a coherent team-and-year, e.g. Brazil 2016/17),
 *  dealt by luck, plus that squad's players for the open slot. */
export type WorldSpin = { nation: string; crest?: string; era?: string; players: PlayerSeason[] };

/**
 * Open "World Cup" spin: land on ONE WC 2026 nation (luck of the spin) and offer THAT
 * nation's players for the open slot — like the base-game slot machine, but the bucket
 * is a country. Only nations that can actually fill the slot are in the draw. Selection
 * weight per nation is CAPPED, so the pool's English bias doesn't make England come up
 * every time — real footballing nations all appear, minnows occasionally. Pure luck on
 * rating — every overall is in play. Players sorted by overall desc.
 */
const SPIN_NATION_WEIGHT_CAP = 8;
export function spinWorld(
  openSlotPositions: Position[],
  usedPlayerIds: Set<string>,
  usedIdentities: Set<string> = new Set(),
  /** `minOverall`/`maxOverall` are the quiz-gated quality band (see draft-quiz.ts):
   *  a soft rating window. It's relaxed (ceiling up first, then floor down) when too
   *  few WC players fit, so a spin never comes up empty. */
  opts: { count?: number; minOverall?: number; maxOverall?: number } = {},
  rng: () => number = Math.random
): WorldSpin {
  const count = opts.count ?? 6;
  const fits = WC_PLAYERS.filter(
    (p) =>
      !usedPlayerIds.has(p.id) &&
      !usedIdentities.has(playerIdentity(p.name)) &&
      openSlotPositions.some((slotPos) => canPlay(p.position, slotPos))
  );
  if (fits.length === 0) return { nation: "", players: [] };
  // Narrow to the quality band, relaxing until at least a few players qualify.
  let floor = opts.minOverall ?? 0;
  let cap = opts.maxOverall ?? 99;
  const within = () => fits.filter((p) => p.overall >= floor && p.overall <= cap);
  let banded = within();
  for (let g = 0; banded.length < Math.min(count, 3) && g < 40; g++) {
    if (cap < 99) cap = Math.min(99, cap + 5);
    else if (floor > 0) floor = Math.max(0, floor - 5);
    else break;
    banded = within();
  }
  const eligible = banded.length ? banded : fits;
  // Group by nation AND era (FIFA edition), then weighted-pick ONE team-and-year — so a
  // slate is e.g. "Brazil 2016/17", never one nation's players mixed across years. Weight
  // is capped so a deep squad doesn't crowd out the rest.
  const SEP = "|||";
  const byTeam = new Map<string, PlayerSeason[]>();
  for (const p of eligible) {
    const key = `${p.nationality}${SEP}${p.season}`;
    const arr = byTeam.get(key) ?? [];
    arr.push(p);
    byTeam.set(key, arr);
  }
  const keys = Array.from(byTeam.keys());
  // When only a slot or two remain open, the team-and-era is being chosen to FILL that exact
  // position — so weight by the squad's BEST fitting player (squared) rather than by depth.
  // A correct answer (high band floor) then reliably surfaces a top-rated player at the slot,
  // and only teams that actually have a strong one for it come up. Broad openings keep the
  // depth-capped weighting so the early draft stays varied.
  const narrow = openSlotPositions.length <= 2;
  const bestOverall = (k: string) => byTeam.get(k)!.reduce((m, p) => Math.max(m, p.overall), 0);
  const weights = keys.map((k) => narrow ? bestOverall(k) ** 2 : Math.min(byTeam.get(k)!.length, SPIN_NATION_WEIGHT_CAP));
  let r = rng() * weights.reduce((s, w) => s + w, 0);
  let key = keys[0];
  for (let i = 0; i < keys.length; i++) { r -= weights[i]; if (r <= 0) { key = keys[i]; break; } }
  const [nation, era] = key.split(SEP);
  const arr = byTeam.get(key)!.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { nation, crest: WC_CREST.get(nation), era, players: arr.slice(0, count).sort((a, b) => b.overall - a.overall) };
}

/** The 19 real clubs the season simulator plays against — the most recent FIFA
 *  season's clubs for that competition (a coherent modern league, whatever era you
 *  drafted from). Strengths are FIFA-derived. The player joins as the 20th team. */
export function leagueOpponents(league: League = "PL"): { name: string; strength: number }[] {
  const clubs = (requireData().clubs ?? []).filter((c) => c.league === league);
  const latest = clubs.reduce((m, c) => (c.season > m ? c.season : m), "");
  return clubs
    .filter((c) => c.season === latest)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 19)
    .map((c) => ({ name: c.name, strength: c.strength }));
}
