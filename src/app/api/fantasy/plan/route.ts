import { NextRequest } from "next/server";
import { planTransfersTx } from "@/lib/fantasy/server";
import { SQUAD_SIZE } from "@/lib/fantasy/engine";
import { withFantasyUser } from "../_lib";

// The transfer planner: the manager sends the ids they're considering moving
// on, and gets back the best legal way to do it. Everything else the search
// needs — squad, prices, credits, the weekly free transfer, the wildcard — is
// read server-side, so the request cannot lie about what it can afford.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  // Deduped, integer-only, and capped at a full squad. The cap is what stops a
  // crafted request turning the depth-2 pair search into a CPU bill: the
  // planner's own market-width budget is sized against how many players were
  // marked, and it can only do that job if that number is bounded.
  const considering = Array.from(new Set(
    (Array.isArray(body.considering) ? body.considering : [])
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isInteger(n) && n > 0),
  )).slice(0, SQUAD_SIZE) as number[];

  return withFantasyUser("plan", (db, userId) => planTransfersTx(db, userId, considering));
}
