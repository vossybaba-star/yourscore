/**
 * Guest squad rating — the same score, bands and verdict squadRating.ts
 * produces for a signed-in manager's stored squad, but for a raw set of ids a
 * signed-out visitor just confirmed off a screenshot. No `fantasy_squads` row
 * exists yet, so there is nothing to load by user id and nothing to cache by
 * squad hash: every call here reads the live market fresh and computes once.
 *
 * Deliberately thin — every actual scoring/banding/copy rule for BOTH
 * horizons lives in squadRating.ts's computeHorizonResults() and is reused
 * verbatim, so a guest's two-horizon take and a member's are computed by the
 * exact same code, not a parallel implementation that could drift from it.
 * `server-only` because computeHorizonResults() calls callModelForHorizons()
 * with the raw ANTHROPIC_API_KEY, same as squadRating.ts.
 */
import "server-only";
import { BUDGET_TENTHS, XI_SIZE } from "./engine";
import {
  type Db, type RatingInputs, type RatingPlayer, type RatingResponse,
  buildRatingInputs, loadRatingMarket, computeHorizonResults,
} from "./squadRating";

export interface GuestSquadShape {
  ids: number[]; // all 15, any order
  xi: number[];
  bench: number[];
  captain: number;
}

/** Build the frozen RatingInputs for a guest's just-confirmed 15 — the raw-ids
 *  twin of squadRating.ts's loadRatingInputs(), reading the SAME market via
 *  loadRatingMarket() so a guest and a signed-in manager score off identical
 *  live data. Returns null when there's no snapshot batch to rate against, or
 *  when any of the given ids don't resolve in the current pool (a stale/bad
 *  id set — the route treats this the same as "can't rate right now"). */
export async function loadGuestRatingInputs(
  db: Db, squad: GuestSquadShape,
): Promise<{ inputs: RatingInputs; cutoff: string } | null> {
  const market = await loadRatingMarket(db);
  if (!market) return null;

  const squadPlayers = squad.ids.map((id) => market.toRatingPlayer(id)).filter((p): p is RatingPlayer => !!p);
  if (squadPlayers.length !== squad.ids.length) return null; // an id the current pool doesn't know

  // The bank a guest never told us: whatever's left of the standard budget
  // after these 15's current prices, floored at zero (a screenshot squad
  // priced above today's market never goes negative here — deriveMove()'s
  // affordability check is what actually protects the suggested move).
  const spent = squadPlayers.reduce((s, p) => s + p.priceTenths, 0);
  const bankTenths = Math.max(0, BUDGET_TENTHS - spent);

  const inputs = buildRatingInputs({
    gameweek: market.gw, squadPlayers, xiIds: squad.xi, benchIds: squad.bench,
    captainId: squad.captain, bankTenths, pool: market.poolCandidates, fixtures: market.fixtures,
  });
  if (inputs.xi.length !== XI_SIZE) return null;
  return { inputs, cutoff: market.cutoff };
}

/** Compute a full two-horizon rating for a guest's confirmed 15 — one model
 *  call, zero DB writes (no cache row, no squad row, no auth). Returns the
 *  same RatingResponse shape a member's /api/fantasy/squad-rating POST
 *  returns, so SquadRating.tsx's and /fantasy/rate's rendering (via
 *  RatingBands.tsx) works unmodified for either surface. */
export async function rateGuestSquad(db: Db, squad: GuestSquadShape): Promise<RatingResponse | null> {
  const loaded = await loadGuestRatingInputs(db, squad);
  if (!loaded) return null;
  const { inputs, cutoff } = loaded;

  const { month, next5, generatedAt } = await computeHorizonResults(inputs);
  return { month, next5, generatedAt, snapshotCutoff: cutoff };
}
