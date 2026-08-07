/**
 * feed.ts — pure squad/player-snapshot logic (P2, 5 Aug: squad posts silently
 * rewrite themselves as the pool/bootstrap change). Split out for the same
 * reason challenges-pure.ts is (see that file's own doc): feed.ts pulls in
 * `import "server-only"`, which throws the moment the module is `require()`d
 * outside a React Server Component context — so it cannot be loaded by a
 * plain `node --test` run. The math worth unit testing (formation/value
 * derivation, defensive payload parsing) lives here; feed.ts stays the
 * db/render-facing wrapper on top.
 */
import type { FantasyPos } from "./engine";

// ── Snapshot shapes ──────────────────────────────────────────────────────────

/** One squad member frozen at post time — everything a board tile needs to
 *  render WITHOUT re-deriving from today's pool.json/FPL bootstrap. Captain/
 *  vice state isn't duplicated here: `payload.captain`/`payload.vice` are
 *  already player ids, and an id never drifts — only what a lookup TURNS an
 *  id into (name/club/price/pos) can go stale, which is exactly what this
 *  snapshots. */
export interface SquadPlayerSnapshot {
  id: number;
  name: string;
  club: string;
  price: number;
  pos: FantasyPos;
}

/** A full squad_complete event's frozen payload — the founder's exact field
 *  list (5 Aug): every player's identity, the formation, the gameweek the
 *  squad was posted for, and the total team value at that moment. */
export interface SquadSnapshot {
  players: SquadPlayerSnapshot[];
  formation: string;
  gw: number;
  teamValue: number;
}

/** A single attached player (shortlist_add / squad_update / a post's tagged
 *  player) frozen at attach time. */
export interface PlayerSnapshot {
  name: string;
  club: string;
  price: number;
  pos: FantasyPos;
}

const VALID_POS = new Set<FantasyPos>(["GK", "DEF", "MID", "FWD"]);
function isFantasyPos(v: unknown): v is FantasyPos {
  return typeof v === "string" && VALID_POS.has(v as FantasyPos);
}

// ── Formation / value ────────────────────────────────────────────────────────

/** "4-4-2"-style label off the XI's position counts. GK is never shown — the
 *  engine's own formation rule (validateSelection) fixes it at exactly one,
 *  so a DEF-MID-FWD triple is all a manager ever reads on a real team sheet. */
export function formationOf(xiPositions: FantasyPos[]): string {
  const count = (pos: FantasyPos) => xiPositions.filter((p) => p === pos).length;
  return `${count("DEF")}-${count("MID")}-${count("FWD")}`;
}

/** Total squad value at the moment of the snapshot: every pick's price plus
 *  whatever's left in the bank, in £m. Takes tenths throughout (same unit
 *  engine.ts prices in) and converts once at the end, so it never drifts a
 *  penny off floating-point summation the way repeated £m addition would. */
export function teamValueOf(pickPriceTenths: number[], bankTenths: number): number {
  const totalTenths = pickPriceTenths.reduce((sum, t) => sum + t, 0) + bankTenths;
  return Math.round(totalTenths) / 10;
}

// ── Defensive payload parsing ────────────────────────────────────────────────
// payload is untrusted JSON round-tripped through Postgres — every field is
// re-checked here rather than trusted, same posture the rest of feed.ts's
// payload parsing already takes (see e.g. parseVideoAttachment).

/** A squad_complete event's payload.snapshot, id-keyed for O(1) lookup while
 *  building the board. Null for anything malformed OR ABSENT — absent is the
 *  expected, common case for every post written before this feature (pre-
 *  snapshot posts): the caller falls back to the live derivation in that
 *  case, never half-renders a broken snapshot. A single bad row invalidates
 *  the whole snapshot (returns null) rather than rendering a board that mixes
 *  frozen and re-derived players, which would be more confusing than either
 *  extreme on its own. */
export function parseSquadSnapshot(raw: unknown): Map<number, SquadPlayerSnapshot> | null {
  const s = raw as { players?: unknown } | undefined;
  if (!s || !Array.isArray(s.players) || !s.players.length) return null;
  const out = new Map<number, SquadPlayerSnapshot>();
  for (const p of s.players as unknown[]) {
    const row = p as { id?: unknown; name?: unknown; club?: unknown; price?: unknown; pos?: unknown };
    if (
      !Number.isInteger(row.id) || typeof row.name !== "string" || !row.name ||
      typeof row.club !== "string" || typeof row.price !== "number" || !isFantasyPos(row.pos)
    ) return null;
    out.set(row.id as number, { id: row.id as number, name: row.name, club: row.club, price: row.price, pos: row.pos });
  }
  return out;
}

/** A player-attachment event's payload.playerSnapshot. Null for malformed or
 *  absent (pre-snapshot posts) — same fallback-to-live rule as above. */
export function parsePlayerSnapshot(raw: unknown): PlayerSnapshot | null {
  const s = raw as { name?: unknown; club?: unknown; price?: unknown; pos?: unknown } | undefined;
  if (
    !s || typeof s.name !== "string" || !s.name || typeof s.club !== "string" ||
    typeof s.price !== "number" || !isFantasyPos(s.pos)
  ) return null;
  return { name: s.name, club: s.club, price: s.price, pos: s.pos };
}
