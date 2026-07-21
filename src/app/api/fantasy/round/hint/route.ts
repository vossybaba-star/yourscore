import { NextRequest } from "next/server";
import { withFantasyUser } from "../../_lib";
import { roundHint } from "@/lib/fantasy/server";

// Insight: a seeded 50/50 on the question in front of you. Spend-once is
// enforced server-side via round_hint_k (CAS-claimed).
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("round-hint", (db, userId) => roundHint(db, userId, Number(body.k)));
}
