/** POST /api/fantasy/challenges/[id]/cancel — the challenger only, pending
 *  only (Phase 3A). Called from the league chat's Challenge card's quiet
 *  "Cancel" action. */
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { cancelChallenge } from "@/lib/fantasy/challenges";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withFantasyUser("challenges-cancel", (db, userId) => cancelChallenge(db, userId, id));
}
