import type { NextRequest } from "next/server";
import { withSignedInUser } from "@/app/api/fantasy/_lib";
import { blockUser, unblockUser } from "@/lib/social/safety";

/** POST/DELETE /api/social/block { userId } (Social Phase 5a, AC3). Blocking
 *  a manager hides both people from each other everywhere (feeds, post
 *  detail, league feed, chat — see hiddenActorIds) and severs any follow
 *  between them. Any signed-in user, not fantasy-allowlist-gated. */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  return withSignedInUser("social-block", (db, blockerId) => blockUser(db, blockerId, userId));
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  return withSignedInUser("social-block", (db, blockerId) => unblockUser(db, blockerId, userId));
}
