import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { HttpError } from "@/lib/fantasy/server";
import { leagueHistory } from "@/lib/fantasy/leagues";

// GET — the league's per-gameweek history (final tables, winners, recaps).
// Auth OPTIONAL, like the league detail: the page is link-viewable.
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rlKey = user ? `fantasy-league-history:${user.id}` : `fantasy-league-history-ip:${ip}`;
  const { ok } = await rateLimitDistributed(rlKey, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    return NextResponse.json(await leagueHistory(params.code ?? "", user?.id ?? null));
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:history]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
