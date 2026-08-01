import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { sharePlayerToLeague, shareSquad, shareCaptain } from "@/lib/fantasy/chat";

// POST — share something into the league chat.
//   { kind:'player', playerId, note? }  (from a player's profile)
//   { kind:'squad' }                    (from the chat composer — your own squad)
//   { kind:'captain' }                  (from the chat composer — your captain)
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-share", (db, userId) => {
    if (body.kind === "squad") return shareSquad(db, userId, params.code);
    if (body.kind === "captain") return shareCaptain(db, userId, params.code);
    return sharePlayerToLeague(db, userId, params.code, body.playerId, body.note);
  });
}
