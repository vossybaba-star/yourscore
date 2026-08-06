/** GET /api/fantasy/leagues/[code]/competitions/[id] — one competition's full
 *  standings (competitionDetail). The [code] segment is for the URL's own
 *  readability only — competitionDetail gates off the competition row's own
 *  league_id, same as challengeByH2h resolving off the h2h id rather than any
 *  wrapping league context. */
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { competitionDetail } from "@/lib/fantasy/competitions";
import { HttpError } from "@/lib/fantasy/server";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string; id: string }> }) {
  const { id } = await ctx.params;
  return withFantasyUser("competition-detail", async (db, userId) => {
    const detail = await competitionDetail(db, id, userId);
    if (!detail) throw new HttpError(404, "competition not found");
    return detail;
  });
}
