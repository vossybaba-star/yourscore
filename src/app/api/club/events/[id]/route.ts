import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getMembership, eventWindowState } from "@/lib/club";
import type { Database } from "@/types/database";

// GET /api/club/events/[id] — member view of one event: meta + derived window
// state + event board + the caller's attempt. While the window is LIVE and the
// caller hasn't played, the response includes the questions — WITHOUT the
// `answer` field. Unlike solo challenges (public packs, client-side feedback),
// event nights can carry prizes, so correct answers never reach the client;
// grading is server-only (/attempt) and per-question feedback is neutral.

type EventQuestion = {
  question?: string;
  options?: unknown;
  difficulty?: string;
  answer?: string;
  [k: string]: unknown;
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: event } = await db
    .from("club_league_events")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(event.league_id, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: league } = await db
    .from("club_leagues")
    .select("slug, name, brand_color, logo_url, is_active")
    .eq("id", event.league_id)
    .single();
  if (!league?.is_active) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const window = eventWindowState(event);

  const { data: attempts } = await db
    .from("club_event_attempts")
    .select("user_id, score, max_score, correct_count, completed_at")
    .eq("event_id", event.id)
    .order("score", { ascending: false })
    .order("completed_at", { ascending: true })
    .limit(200);

  const attemptIds = (attempts ?? []).map((a) => a.user_id);
  const { data: profiles } = attemptIds.length
    ? await db.from("profiles").select("id, display_name, avatar_url").in("id", attemptIds)
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };

  const names = new Map((profiles ?? []).map((p) => [p.id, p]));
  const board = (attempts ?? []).map((a, i) => ({
    position: i + 1,
    userId: a.user_id,
    displayName: names.get(a.user_id)?.display_name || "Player",
    avatarUrl: names.get(a.user_id)?.avatar_url ?? null,
    score: a.score,
    maxScore: a.max_score,
    correctCount: a.correct_count,
  }));
  const myAttempt = (attempts ?? []).find((a) => a.user_id === user.id) ?? null;

  const canPlay = window === "live" && !myAttempt;
  const questions = canPlay
    ? (event.questions as unknown as EventQuestion[]).map((q) => {
        // Strip the correct answer before it reaches the client — see header.
        const sanitized = { ...q };
        delete sanitized.answer;
        return sanitized;
      })
    : undefined;

  return NextResponse.json({
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      prizeText: event.prize_text,
      window,
      questionCount: (event.questions as unknown as unknown[]).length,
    },
    league,
    board,
    myAttempt: myAttempt
      ? { score: myAttempt.score, maxScore: myAttempt.max_score, correctCount: myAttempt.correct_count }
      : null,
    canPlay,
    ...(questions ? { questions } : {}),
  });
}

// PATCH /api/club/events/[id] — owner edits title/description/prize/window, or
// cancels. Questions are immutable after creation (they're a snapshot).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data: event } = await db
    .from("club_league_events")
    .select("id, league_id, starts_at, ends_at, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const membership = await getMembership(event.league_id, user.id);
  if (membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: string;
    description?: string;
    prizeText?: string;
    startsAt?: string;
    endsAt?: string;
    cancel?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Database["public"]["Tables"]["club_league_events"]["Update"] = {};
  if (body.cancel === true) update.status = "cancelled";
  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (!t || t.length > 80) {
      return NextResponse.json({ error: "Title required (max 80 chars)" }, { status: 400 });
    }
    update.title = t;
  }
  if (typeof body.description === "string") update.description = body.description.trim() || null;
  if (typeof body.prizeText === "string") update.prize_text = body.prizeText.trim() || null;

  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date(event.starts_at);
  const endsAt = body.endsAt ? new Date(body.endsAt) : new Date(event.ends_at);
  if (body.startsAt || body.endsAt) {
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      return NextResponse.json({ error: "Invalid window" }, { status: 400 });
    }
    update.starts_at = startsAt.toISOString();
    update.ends_at = endsAt.toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await db.from("club_league_events").update(update).eq("id", event.id);
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
