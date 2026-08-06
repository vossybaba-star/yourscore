/** POST /api/fantasy/challenges/[id]/accept — one-tap accept (Phase 3A): the
 *  opponent's "Play" tap IS acceptance, no separate Accept step. The caller
 *  navigates into /h2h/[id] using the returned h2hId once this resolves ok. */
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { acceptChallenge } from "@/lib/fantasy/challenges";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withFantasyUser("challenges-accept", (db, userId) => acceptChallenge(db, userId, id));
}
