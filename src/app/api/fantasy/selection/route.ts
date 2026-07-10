import { NextRequest } from "next/server";
import { setSelection } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("selection", (db, userId) => setSelection(db, userId, body));
}
