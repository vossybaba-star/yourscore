import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDraftDb } from "@/lib/draft/server";
import { sideOf } from "@/lib/draft/live-server";

// Authoritative state read for initial load / reconnect. The realtime channel
// keeps the client live after this; this is the snapshot it starts from.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const db = createDraftDb();
  const { data: row } = await db.from("draft_live_matches").select("*").eq("id", params.id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (sideOf(row, user.id) === null) return NextResponse.json({ error: "Not a participant" }, { status: 403 });

  return NextResponse.json({ match: row });
}
