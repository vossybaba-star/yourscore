import { playerProfile, HttpError } from "@/lib/fantasy/server";
import { withFantasyUser } from "../../_lib";

// One player's decision profile. A read, no writes.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const playerId = Number(id);
  return withFantasyUser("player", (db, userId) => {
    // A bad id is the caller's mistake, not a server fault. HttpError is what
    // the wrapper understands — a plain Error with a `status` property looks
    // like a crash and comes back as a 500, which sends the client debugging
    // the wrong end.
    if (!Number.isInteger(playerId) || playerId <= 0) {
      throw new HttpError(400, "invalid player id", "invalid-player-id");
    }
    return playerProfile(db, userId, playerId);
  });
}
