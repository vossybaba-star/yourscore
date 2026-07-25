import { NextRequest } from "next/server";
import { createSquad } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("squad", (db, userId) => createSquad(db, userId, body));
}
