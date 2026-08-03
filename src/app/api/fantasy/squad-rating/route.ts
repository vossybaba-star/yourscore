import { NextRequest } from "next/server";
import { peekSquadRating, rateSquad, SquadRatingRateLimitError } from "@/lib/fantasy/squadRating";
import { HttpError } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

// Authed + service-role: force-no-store so Next's data cache can't pin this
// per-user read to a stale snapshot (the CLAUDE.md Vercel-cache gotcha).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

/** Peek: the cached rating for the manager's CURRENT squad hash, or
 *  { rating: null }. Never computes, never calls the model — the "Rate my
 *  squad" button is what triggers the first real POST. */
export async function GET() {
  return withFantasyUser("squad-rating", (db, userId) => peekSquadRating(db, userId));
}

/** Rate: a cache hit for the current hash returns the stored row with zero
 *  model calls; a miss computes once. `{fresh:true}` forces a recompute of
 *  the same hash (a manual "fresh take"), throttled to a few a day by
 *  rateSquad() itself — SquadRatingRateLimitError is bridged to a real 429
 *  here rather than squadRating.ts importing @/lib/fantasy/server's much
 *  larger dependency graph just for one error class. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const fresh = body?.fresh === true;
  return withFantasyUser("squad-rating", async (db, userId) => {
    try {
      return await rateSquad(db, userId, { fresh });
    } catch (e) {
      if (e instanceof SquadRatingRateLimitError) throw new HttpError(429, e.message, "rate_limited");
      throw e;
    }
  });
}
