import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { HttpError } from "@/lib/fantasy/server";
import { createLeague, myLeagues, publicLeagues } from "@/lib/fantasy/leagues";
import { withFantasyUser } from "../_lib";

// POST: create a league (private by default, owner can opt public).
// GET:  the signed-in user's leagues + public leagues they aren't already in.

export const fetchCache = "force-no-store"; // service-role reads must never be data-cache-pinned

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to create a league" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`fantasy-league-create:${user.id}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { name?: unknown; isPublic?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const created = await createLeague(user.id, body);
    return NextResponse.json(created);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:create]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function GET() {
  return withFantasyUser("leagues-list", async (_db, userId) => {
    const [leagues, publicList] = await Promise.all([myLeagues(userId), publicLeagues(userId)]);
    return { leagues, public: publicList };
  });
}
