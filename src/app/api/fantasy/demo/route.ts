import { NextRequest } from "next/server";
import { demoJump } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("demo", (db, userId) => demoJump(db, userId, String(body.phase)));
}
