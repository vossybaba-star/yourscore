import { NextRequest } from "next/server";
import { stepRound } from "@/lib/fantasy/server";
import { withFantasyUser } from "../../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const k = Number(body.k);
  const optionId = body.optionId === null || body.optionId === undefined ? null : Number(body.optionId);
  return withFantasyUser("step", (db, userId) => stepRound(db, userId, k, optionId));
}
