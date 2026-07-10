import { NextRequest } from "next/server";
import { applyTransferTx } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("transfer", (db, userId) =>
    applyTransferTx(db, userId, Number(body.out), Number(body.in)));
}
