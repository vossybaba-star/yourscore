import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { HttpError } from "@/lib/fantasy/server";
import { joinLeague } from "@/lib/fantasy/leagues";

// Join a league by its code (private or public — the code always works).

export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to join a league" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`fantasy-league-join:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { code?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    const joined = await joinLeague(user.id, body);
    return NextResponse.json(joined);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:join]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
