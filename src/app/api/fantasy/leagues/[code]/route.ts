import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { HttpError } from "@/lib/fantasy/server";
import { deleteLeague, leagueDetail, leaveLeague, renameLeague, setVisibility } from "@/lib/fantasy/leagues";

// GET: league detail + season/month tables. Auth OPTIONAL — this page is
// link-viewable (guest gets isMember:false), so identity is hand-rolled here
// rather than via withFantasyUser, which 401s guests.
// PATCH: owner-only rename and/or visibility flip.
// DELETE ?mode=leave|delete.

export const fetchCache = "force-no-store";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();

  // Rate limit: per-account for members, per-IP for guests (same shape as
  // src/app/api/debate/vote/route.ts's guest path).
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rlKey = user ? `fantasy-league-detail:${user.id}` : `fantasy-league-detail-ip:${ip}`;
  const { ok } = await rateLimitDistributed(rlKey, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  try {
    const detail = await leagueDetail(params.code ?? "", user?.id ?? null);
    return NextResponse.json(detail);
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:detail]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`fantasy-league-manage:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { name?: unknown; isPublic?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const hasName = typeof body.name === "string";
  const hasVisibility = typeof body.isPublic === "boolean";
  if (!hasName && !hasVisibility) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  try {
    let name: string | undefined;
    let isPublic: boolean | undefined;
    if (hasName) {
      const r = await renameLeague(user.id, params.code ?? "", body.name);
      name = r.name; isPublic = r.isPublic;
    }
    if (hasVisibility) {
      const r = await setVisibility(user.id, params.code ?? "", body.isPublic as boolean);
      name = r.name; isPublic = r.isPublic;
    }
    return NextResponse.json({ ok: true, name, isPublic });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:patch]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { code: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`fantasy-league-manage:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const mode = req.nextUrl.searchParams.get("mode") === "delete" ? "delete" : "leave";
  const code = params.code ?? "";

  try {
    if (mode === "delete") await deleteLeague(user.id, code);
    else await leaveLeague(user.id, code);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    console.error("[fantasy:leagues:delete]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
