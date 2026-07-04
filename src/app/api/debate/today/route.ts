import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { todaysDebate, debateSplit } from "@/lib/debate";

/**
 * GET /api/debate/today
 * Today's debate + the live community split + the caller's vote (null when
 * signed out — the card still renders for guests, voting needs an account).
 */
export const dynamic = "force-dynamic"; // per-user yourVote + live counts — never static

export async function GET() {
  const svc = createServiceClient();
  const debate = await todaysDebate(svc);
  if (!debate) return NextResponse.json({ debate: null });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [split, vote] = await Promise.all([
    debateSplit(svc, debate),
    user
      ? svc.from("debate_votes").select("option_idx").eq("debate_id", debate.id).eq("user_id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return NextResponse.json({
    debate,
    counts: split.counts,
    total: split.total,
    yourVote: vote.data?.option_idx ?? null,
  });
}
