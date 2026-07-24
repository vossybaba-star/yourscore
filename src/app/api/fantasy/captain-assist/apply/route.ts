import { NextRequest } from "next/server";
import { applyCaptainRecommendation } from "@/lib/fantasy/captainAssist";
import { withFantasyUser } from "../../_lib";

export const fetchCache = "force-no-store";

/** Applies a FROZEN recommendation by id. The id is the contract: the server
 *  revalidates the squad, eligibility and snapshot freshness against the exact
 *  recommendation the user was shown, so a stale card is refused rather than
 *  applied, and the proposed player can never change between view and write.
 *  Captain and vice are independent — applying one without the other is valid. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("captain-assist-apply", (db, userId) =>
    applyCaptainRecommendation(db, userId, {
      recommendationId: String(body.recommendationId ?? ""),
      applyCaptain: body.applyCaptain !== false,
      applyVice: body.applyVice !== false,
    }),
  );
}
