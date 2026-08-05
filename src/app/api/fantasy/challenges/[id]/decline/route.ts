/** POST /api/fantasy/challenges/[id]/decline — the challenged player only,
 *  pending only. Called from the league chat's Challenge card. */
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { declineChallenge } from "@/lib/fantasy/challenges";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withFantasyUser("challenges-decline", (db, userId) => declineChallenge(db, userId, id));
}
