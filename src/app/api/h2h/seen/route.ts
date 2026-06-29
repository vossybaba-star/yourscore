import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Mark a targeted challenge as seen by its invited opponent — clears the
// Your-Turns unread badge. Service-role write, but only the invited_user_id may
// mark their own challenge (no broad client UPDATE policy on the table).

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { challengeId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const { challengeId } = body;
  if (!challengeId) return NextResponse.json({ error: "challengeId required" }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await db
    .from("h2h_challenges")
    .update({ seen_by_opponent: true })
    .eq("id", challengeId)
    .eq("invited_user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // No row matched (not the invited user, or open challenge) — silently OK.
  return NextResponse.json({ ok: true, updated: !!data });
}
