import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Mark a group challenge seen by the caller — clears their Your-Turns unread
// badge. Service-role write scoped to the caller's own participant row.
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
  await db.from("group_challenge_participants")
    .update({ seen: true })
    .eq("challenge_id", challengeId).eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
