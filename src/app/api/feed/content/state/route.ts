/** GET /api/feed/content/state?ids=<uuid,uuid,...> — interaction state for a
 *  batch of content-feed items in ONE call, so the feed shows reaction + comment
 *  counts without a request per card. Public: works signed out (mine = null).
 *  Returns { [subjectId]: { reactions: [{emoji,count}], mine, comments } }. */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { FEED_REACTIONS } from "@/lib/fantasy/feed";

export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ItemState { reactions: { emoji: string; count: number }[]; mine: string | null; comments: number }

export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",").map((s) => s.trim()).filter((s) => UUID.test(s)).slice(0, 60);
  if (!ids.length) return NextResponse.json({ states: {} });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const svc = createServiceClient() as unknown as SupabaseClient;

  const [reactRes, commentRes] = await Promise.all([
    svc.from("content_reactions").select("subject_id, user_id, emoji").in("subject_id", ids),
    svc.from("comments").select("subject_id").eq("subject_type", "content").in("subject_id", ids).is("deleted_at", null),
  ]);

  const order = new Map(FEED_REACTIONS.map((e, i) => [e as string, i]));
  const tally = new Map<string, Map<string, number>>(); // subject → emoji → count
  const mineMap = new Map<string, string>();
  for (const r of (reactRes.data ?? []) as { subject_id: string; user_id: string; emoji: string }[]) {
    let m = tally.get(r.subject_id);
    if (!m) { m = new Map(); tally.set(r.subject_id, m); }
    m.set(r.emoji, (m.get(r.emoji) ?? 0) + 1);
    if (user && r.user_id === user.id) mineMap.set(r.subject_id, r.emoji);
  }

  const commentCount = new Map<string, number>();
  for (const c of (commentRes.data ?? []) as { subject_id: string }[]) {
    commentCount.set(c.subject_id, (commentCount.get(c.subject_id) ?? 0) + 1);
  }

  const states: Record<string, ItemState> = {};
  for (const id of ids) {
    const m = tally.get(id);
    const reactions = m
      ? Array.from(m, ([emoji, count]) => ({ emoji, count })).sort((a, b) => (order.get(a.emoji) ?? 9) - (order.get(b.emoji) ?? 9))
      : [];
    states[id] = { reactions, mine: mineMap.get(id) ?? null, comments: commentCount.get(id) ?? 0 };
  }

  return NextResponse.json({ states }, { headers: { "cache-control": "private, no-store" } });
}
