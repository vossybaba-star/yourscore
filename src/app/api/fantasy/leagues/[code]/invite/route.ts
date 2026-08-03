import { NextRequest } from "next/server";
import { withFantasyUser } from "../../../_lib";
import { inviteToLeague } from "@/lib/fantasy/leagues";

// Invite a specific YourScore user to this league (from the feed, a profile, …).
// Auth + founder gate + rate limit via withFantasyUser; membership + already-in
// checks live in inviteToLeague.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { code: string } }) {
  const body = await req.json().catch(() => ({}));
  return withFantasyUser("league-invite", (_db, userId) => inviteToLeague(userId, params.code, body.inviteeId));
}
