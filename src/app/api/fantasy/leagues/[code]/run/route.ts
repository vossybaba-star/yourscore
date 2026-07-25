import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { viewRun, HttpError } from "@/lib/fantasy/server";

// A league-mate's completed round, post-deadline only — the banter endpoint.
// All the gating (shared league, locked entry, deadline passed) lives in viewRun.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const target = req.nextUrl.searchParams.get("user") ?? "";
  return withFantasyUser("league-run", (db, userId) => {
    if (!/^[0-9a-f-]{36}$/.test(target)) throw new HttpError(400, "bad user id");
    return viewRun(db, userId, target, params.code);
  });
}
