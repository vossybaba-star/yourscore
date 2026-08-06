/** POST /api/fantasy/leagues/[code]/competitions/[id]/cancel — league-owner-only,
 *  admin-sourced competitions only, while still scheduled/open (cancelCompetition's
 *  own gate). Official competitions can't be cancelled via the API this wave. */
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { cancelCompetition } from "@/lib/fantasy/competitions";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const { id } = await ctx.params;
  return withFantasyUser("competition-cancel", (db, userId) => cancelCompetition(db, userId, id));
}
