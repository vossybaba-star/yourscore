import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { knowledgeBoard, type KnowledgeCut } from "@/lib/fantasy/knowledge";

// Leaderboards are public-by-design (guests can browse before signing up), so no
// withFantasyUser here — hand-rolled optional identity, per-IP limits for guests.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  const ipKey = user?.id ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "anon";
  const { ok } = await rateLimitDistributed(`fantasy-knowledge:${ipKey}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const cutParam = req.nextUrl.searchParams.get("cut");
  const cut: KnowledgeCut = cutParam === "week" || cutParam === "month" ? cutParam : "season";
  return NextResponse.json(await knowledgeBoard(createServiceClient(), cut, user?.id ?? null));
}
