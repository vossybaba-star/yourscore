import { NextRequest } from "next/server";
import { applyTransferTx } from "@/lib/fantasy/server";
import { tryEmitFeedEvent } from "@/lib/fantasy/feed";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const outId = Number(body.out), inId = Number(body.in);
  return withFantasyUser("transfer", async (db, userId) => {
    const result = await applyTransferTx(db, userId, outId, inId);
    await tryEmitFeedEvent(db, userId, "transfer", null, { out: outId, in: inId });
    return result;
  });
}
