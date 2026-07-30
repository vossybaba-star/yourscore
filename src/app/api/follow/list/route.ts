/** GET /api/follow/list — the people behind the follow counts, and who to follow.
 *
 *   ?type=followers&userId=<id>  → who follows that user
 *   ?type=following&userId=<id>  → who that user follows
 *   ?type=discover               → managers to follow (most-followed first,
 *                                  minus you and anyone you already follow)
 *
 * Each row carries whether the VIEWER already follows them, so the Follow button
 * renders the right state without a per-row fetch. Public graph (mig 225). */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const fetchCache = "force-no-store";

interface Row { userId: string; name: string; avatarUrl: string | null; iFollow: boolean }

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "followers";
  const userId = url.searchParams.get("with") ?? url.searchParams.get("userId");

  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const viewerId = user?.id ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const follows = () => (db as any).from("user_follows");

  let ids: string[] = [];

  if (type === "followers" || type === "following") {
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    const col = type === "followers" ? "followee_id" : "follower_id";
    const other = type === "followers" ? "follower_id" : "followee_id";
    const { data } = await follows().select(other).eq(col, userId).limit(500);
    ids = ((data ?? []) as Record<string, string>[]).map((r) => r[other]);
  } else {
    // discover: rank all followees by how many follow them (the graph is small,
    // so count in memory rather than a group-by round trip).
    const { data } = await follows().select("followee_id").limit(2000);
    const tally = new Map<string, number>();
    for (const r of (data ?? []) as { followee_id: string }[]) tally.set(r.followee_id, (tally.get(r.followee_id) ?? 0) + 1);
    ids = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  // Who the viewer already follows — to mark rows (and, for discover, to exclude).
  let iFollowSet = new Set<string>();
  if (viewerId && ids.length) {
    const { data } = await follows().select("followee_id").eq("follower_id", viewerId).in("followee_id", ids);
    iFollowSet = new Set(((data ?? []) as { followee_id: string }[]).map((r) => r.followee_id));
  }

  if (type === "discover") {
    ids = ids.filter((id) => id !== viewerId && !iFollowSet.has(id));
  }
  ids = ids.slice(0, 50);
  if (!ids.length) return NextResponse.json({ rows: [] });

  const { data: profs } = await db.from("profiles").select("id, display_name, avatar_url").in("id", ids);
  const profById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));

  // Preserve the ranked order for discover; natural order otherwise.
  const rows: Row[] = ids.map((id) => ({
    userId: id,
    name: profById.get(id)?.display_name ?? "Player",
    avatarUrl: profById.get(id)?.avatar_url ?? null,
    iFollow: iFollowSet.has(id),
  }));

  return NextResponse.json({ rows });
}
