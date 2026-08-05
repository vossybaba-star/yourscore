import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { leagueMembers } from "@/lib/fantasy/chat";

/**
 * GET /api/fantasy/leagues/[code]/members — id/username/display_name/
 * avatar_url for this league's roster, blocked accounts excluded. Member-
 * only, same gate chat/route.ts uses.
 *
 * Deliberately lighter than GET /api/fantasy/leagues/[code] (leagueDetail —
 * which also computes season/month tables, readiness, recaps): this exists
 * ONLY to feed the league chat's @mention autocomplete a roster it can match
 * against instantly, client-side, on every keystroke (Phase 1A) — fetching
 * leagueDetail just to populate a dropdown would pay for a lot of work the
 * dropdown never uses.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  return withFantasyUser("league-members", (db, userId) => leagueMembers(db, userId, params.code));
}
