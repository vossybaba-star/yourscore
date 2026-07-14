import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { getLeagueBySlug } from "@/lib/club";
import { notifyUsers } from "@/lib/notify";

// POST /api/club/[slug]/join — join a Club League via its public link/QR.
// Idempotent: joining twice is a no-op success.

export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`club-join:${user.id}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const league = await getLeagueBySlug(params.slug);
  if (!league || !league.is_active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = createServiceClient();
  const { error } = await db
    .from("club_league_members")
    .upsert(
      { league_id: league.id, user_id: user.id },
      { onConflict: "league_id,user_id", ignoreDuplicates: true }
    );
  if (error) return NextResponse.json({ error: "Could not join" }, { status: 500 });

  // Notify the club owner a member joined — clubs notify on no other channel
  // today. Skip the owner's own join. Deduped per (league, joiner) so a re-join
  // never re-pings.
  if (league.owner_id && league.owner_id !== user.id) {
    void (async () => {
      const [{ data: me }, { count }] = await Promise.all([
        db.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
        db.from("club_league_members").select("user_id", { count: "exact", head: true }).eq("league_id", league.id),
      ]);
      const joiner = me?.display_name ?? "A new player";
      const n = count ?? 1;
      await notifyUsers({
        userIds: [league.owner_id],
        title: `${joiner} joined ${league.name} 🎉`,
        body: `You're up to ${n} member${n === 1 ? "" : "s"}.`,
        url: `/l/${league.slug}`,
        dedupeKey: `club-join:${league.id}:${user.id}`,
      });
    })().catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
