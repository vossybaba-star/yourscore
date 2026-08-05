import type { NextRequest } from "next/server";
import { withSignedInUser } from "@/app/api/fantasy/_lib";
import { muteUser, unmuteUser } from "@/lib/social/safety";

/** POST/DELETE /api/social/mute { userId } (Social Phase 5a, AC4). One
 *  directional: hides the muted manager's content from the muter's own
 *  feeds/chat only — they see the muter fine, and follows are untouched.
 *  Any signed-in user, not fantasy-allowlist-gated. */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  return withSignedInUser("social-mute", (db, muterId) => muteUser(db, muterId, userId));
}

export async function DELETE(req: NextRequest) {
  const { userId } = await req.json().catch(() => ({}));
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  return withSignedInUser("social-mute", (db, muterId) => unmuteUser(db, muterId, userId));
}
