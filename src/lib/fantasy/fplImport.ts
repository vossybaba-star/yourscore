/**
 * FPL team import — pure mapping helpers. No IO here on purpose: parsing a
 * pasted ID/URL and mapping a picks payload onto our pool are both testable
 * without a network call, and the route (src/app/api/fantasy/fpl-import/route.ts)
 * is the only place that touches fetch.
 *
 * Pool ids ARE FPL element ids (by design — see src/lib/fantasy/pool.ts), so
 * mapping is a direct id lookup, not a name match.
 */

const MAX_TEAM_ID = 99_999_999;

/** Accepts a bare numeric team ID, or any pasted FPL URL containing
 *  `/entry/<digits>` (the shape of both the "my team" and "points" pages).
 *  Whitespace is trimmed. Anything else — empty, non-numeric, zero/negative,
 *  or absurdly large — returns null rather than a bad id to fetch. */
export function parseTeamId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let digits: string | null = null;
  if (/^\d+$/.test(trimmed)) {
    digits = trimmed;
  } else {
    const m = trimmed.match(/\/entry\/(\d+)/);
    if (m) digits = m[1];
  }
  if (!digits) return null;

  const id = Number(digits);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_TEAM_ID) return null;
  return id;
}

/** The subset of an FPL `/picks/` entry we read. `position` is FPL's own
 *  ordering: 1-11 is the XI in shirt-slot order, 12-15 is the bench in sub
 *  order (bench[0] is always the reserve keeper). */
export interface FplPick {
  element: number;
  position: number;
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface FplImportMap {
  /** Elements present in our pool, in FPL's own position order. */
  pickIds: number[];
  /** Elements FPL carries that our 522-player pool does not. */
  missingIds: number[];
  /** Only set when all 15 elements map AND both armband flags landed on a
   *  mapped player — a partial import still hands back pickIds, but there is
   *  no complete XI/bench/captain shape to trust smartDefaults over. */
  selection: { xi: number[]; bench: number[]; captain: number; vice: number } | null;
}

export function mapFplPicks(picks: FplPick[], poolIds: Set<number>): FplImportMap {
  const sorted = [...picks].sort((a, b) => a.position - b.position);

  const pickIds: number[] = [];
  const missingIds: number[] = [];
  for (const p of sorted) (poolIds.has(p.element) ? pickIds : missingIds).push(p.element);

  let selection: FplImportMap["selection"] = null;
  if (sorted.length === 15 && missingIds.length === 0) {
    const xi = sorted.filter((p) => p.position >= 1 && p.position <= 11).map((p) => p.element);
    const bench = sorted.filter((p) => p.position >= 12 && p.position <= 15).map((p) => p.element);
    const captain = sorted.find((p) => p.is_captain)?.element;
    const vice = sorted.find((p) => p.is_vice_captain)?.element;
    if (xi.length === 11 && bench.length === 4 && captain !== undefined && vice !== undefined)
      selection = { xi, bench, captain, vice };
  }

  return { pickIds, missingIds, selection };
}
