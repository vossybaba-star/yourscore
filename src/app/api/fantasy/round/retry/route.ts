import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";
import { roundRetry } from "@/lib/fantasy/server";

// Second Chance: retry one wrong answer after the round. POST {k} re-serves the
// question; POST {k, optionId} grades it and grants the credit delta exactly once.
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("round-retry", (db, userId) =>
    roundRetry(db, userId, Number(body.k), body.optionId == null ? null : Number(body.optionId)));
}
