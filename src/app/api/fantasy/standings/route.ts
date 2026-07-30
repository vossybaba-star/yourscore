/** GET /api/fantasy/standings?scope=month|season|gw — global standings for the
 *  league tab: where the signed-in player falls among everyone. Auth + founder
 *  gate + rate limit come from withFantasyUser; the service client calls the
 *  aggregation RPC. */
import type { NextRequest } from "next/server";
import { withFantasyUser } from "@/app/api/fantasy/_lib";
import { loadGlobalStandings, type StandingsScope } from "@/lib/fantasy/standings";

export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get("scope");
  const scope: StandingsScope = raw === "season" || raw === "gw" ? raw : "month";
  return withFantasyUser("standings", (db, userId) => loadGlobalStandings(db, userId, scope));
}
