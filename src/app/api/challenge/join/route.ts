import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Join a group challenge via its link. Adds the caller as a (non-invited)
// participant if the challenge is still open and they're not already in. Playing
// also auto-joins (see /api/challenge/play) — this lets the board show them as
// "yet to play" before they start.
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { challengeId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { challengeId } = body;
  if (!challengeId) return NextResponse.json({ error: "challengeId required" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: ch } = await db
    .from("group_challenges").select("id, status, expires_at").eq("id", challengeId).single();
  if (!ch) return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  if (ch.status !== "open" || new Date(ch.expires_at) < new Date()) {
    return NextResponse.json({ error: "This challenge has ended" }, { status: 410 });
  }

  const { data: profile } = await db.from("profiles").select("display_name").eq("id", user.id).single();

  // Idempotent: unique(challenge_id, user_id) — ignore a duplicate join.
  await db.from("group_challenge_participants").upsert(
    { challenge_id: challengeId, user_id: user.id, display_name: profile?.display_name ?? "Player", invited: false, seen: true },
    { onConflict: "challenge_id,user_id", ignoreDuplicates: true }
  );

  return NextResponse.json({ id: challengeId });
}
