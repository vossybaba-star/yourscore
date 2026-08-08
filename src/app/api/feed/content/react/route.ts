/** POST/DELETE /api/feed/content/react — emoji reaction on a content-feed item
 *  (news / video), keyed by its synthetic subject uuid (see contentSubjectId).
 *  ONE reaction per user per item: POST upserts the chosen emoji (switching if
 *  already reacted), DELETE clears it. Auth-gated + rate limited. Public feed, so
 *  this is the standard authed client — NOT the fantasy founder gate. */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { FEED_REACTIONS } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";

const ALLOWED = new Set<string>(FEED_REACTIONS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const { subjectId, emoji } = await req.json().catch(() => ({}));
  if (typeof subjectId !== "string" || !UUID.test(subjectId) || typeof emoji !== "string" || !ALLOWED.has(emoji)) {
    return NextResponse.json({ error: "Bad reaction" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to react" }, { status: 401 });
  const { ok } = await rateLimitDistributed(`content-react:${user.id}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Slow down a little" }, { status: 429 });

  const { error } = await (supabase as unknown as SupabaseClient)
    .from("content_reactions")
    .upsert({ subject_id: subjectId, user_id: user.id, emoji }, { onConflict: "subject_id,user_id" });
  if (error) return NextResponse.json({ error: "Could not react" }, { status: 500 });
  return NextResponse.json({ reacted: emoji });
}

export async function DELETE(req: NextRequest) {
  const { subjectId } = await req.json().catch(() => ({}));
  if (typeof subjectId !== "string" || !UUID.test(subjectId)) {
    return NextResponse.json({ error: "Missing subjectId" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to react" }, { status: 401 });

  await (supabase as unknown as SupabaseClient)
    .from("content_reactions")
    .delete()
    .eq("subject_id", subjectId)
    .eq("user_id", user.id);
  return NextResponse.json({ reacted: null });
}
