import { NextRequest } from "next/server";
import { isFunnelEvent, recordFunnel } from "@/lib/fantasy/captainFunnel";
import { withFantasyUser } from "../../_lib";

export const fetchCache = "force-no-store";

/** Records one adoption-funnel step. Deliberately cheap and forgiving: a lost
 *  analytics flag must never break a user's captain change, so an unknown event
 *  or a write failure returns ok:false rather than an error the UI must handle. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("captain-assist-event", async (db, userId) => {
    const gw = Number(body.gameweek);
    if (!isFunnelEvent(body.event) || !Number.isFinite(gw)) return { ok: false };
    return recordFunnel(db, userId, gw, body.event);
  });
}
