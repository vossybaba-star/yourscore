import { squadUpdate } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

// Authed + service-role: force-no-store so Next's data cache can't pin this
// per-user read to a stale snapshot (the CLAUDE.md Vercel-cache gotcha).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

export async function GET() {
  return withFantasyUser("squad-update", (db, userId) => squadUpdate(db, userId));
}
