import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { sharePlayerToLeague, shareSquad, shareCaptain, shareNews, shareComparison } from "@/lib/fantasy/chat";

// POST — share something into the league chat.
//   { kind:'player', playerId, note? }        (from a player's profile / the scout)
//   { kind:'squad' } / { kind:'captain' }     (from the chat composer — your own)
//   { kind:'news', title, source, url, image } (from the news reader)
//   { kind:'compare', a, b }                  (from the compare screen)
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-share", (db, userId) => {
    if (body.kind === "squad") return shareSquad(db, userId, params.code);
    if (body.kind === "captain") return shareCaptain(db, userId, params.code);
    if (body.kind === "news") return shareNews(db, userId, params.code, body);
    if (body.kind === "compare") return shareComparison(db, userId, params.code, body.a, body.b);
    return sharePlayerToLeague(db, userId, params.code, body.playerId, body.note);
  });
}
