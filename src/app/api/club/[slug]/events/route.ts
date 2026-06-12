import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { getLeagueBySlug, getMembership } from "@/lib/club";

// GET  /api/club/[slug]/events — owner-only: the caller's published quiz packs,
//      for the "create event" picker on the Manage tab.
// POST /api/club/[slug]/events — owner schedules a quiz event.
// The source pack's questions are SNAPSHOTTED onto the event row so later pack
// edits/deletes can't break a live quiz night (spec §3/§6).

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const league = await getLeagueBySlug(params.slug);
  if (!league || !league.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const membership = await getMembership(league.id, user.id);
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createServiceClient();
  const { data: packs } = await db
    .from("quiz_packs")
    .select("id, name, question_count, created_at")
    .eq("status", "published")
    .or(`user_id.eq.${user.id},created_by.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ packs: packs ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`club-event:${user.id}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const league = await getLeagueBySlug(params.slug);
  if (!league || !league.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const membership = await getMembership(league.id, user.id);
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: string;
    description?: string;
    packId?: string;
    startsAt?: string;
    endsAt?: string;
    prizeText?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title || title.length > 80) {
    return NextResponse.json({ error: "Title required (max 80 chars)" }, { status: 400 });
  }
  if (!body.packId || typeof body.packId !== "string") {
    return NextResponse.json({ error: "packId required" }, { status: 400 });
  }
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (
    !startsAt ||
    !endsAt ||
    isNaN(startsAt.getTime()) ||
    isNaN(endsAt.getTime()) ||
    endsAt <= startsAt
  ) {
    return NextResponse.json({ error: "Valid startsAt/endsAt required" }, { status: 400 });
  }
  if (endsAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Event window is already over" }, { status: 400 });
  }

  const db = createServiceClient();

  // The partner may use any published pack they created (incl. via /quiz/create).
  const { data: pack } = await db
    .from("quiz_packs")
    .select("id, questions, status, user_id, created_by")
    .eq("id", body.packId)
    .maybeSingle();
  const ownsPack = pack && (pack.user_id === user.id || pack.created_by === user.id);
  if (!pack || pack.status !== "published" || !ownsPack) {
    return NextResponse.json({ error: "Quiz pack not found" }, { status: 404 });
  }
  const questions = pack.questions as unknown as unknown[];
  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json({ error: "Quiz pack has no questions" }, { status: 400 });
  }

  const { data: event, error } = await db
    .from("club_league_events")
    .insert({
      league_id: league.id,
      title,
      description: (body.description ?? "").trim() || null,
      pack_id: pack.id,
      questions: pack.questions,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      prize_text: (body.prizeText ?? "").trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !event) {
    return NextResponse.json({ error: "Could not create event" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, eventId: event.id });
}
