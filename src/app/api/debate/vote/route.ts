import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { debateSplit } from "@/lib/debate";

export const fetchCache = "force-no-store"; // live split — see today/route.ts

/**
 * POST /api/debate/vote { debateId, optionIdx }
 * One vote per debate, changeable (upsert). Returns the fresh split so the
 * card can animate straight to the result.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to vote" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`debate-vote:${user.id}`, 10, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many votes — slow down" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const debateId = typeof body?.debateId === "string" ? body.debateId : null;
  const optionIdx = Number.isInteger(body?.optionIdx) ? (body.optionIdx as number) : null;
  if (!debateId || optionIdx === null || optionIdx < 0) {
    return NextResponse.json({ error: "Missing debateId or optionIdx" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: row } = await svc.from("debates").select("id, question, options, active").eq("id", debateId).maybeSingle();
  const options = Array.isArray(row?.options) ? (row.options as string[]) : [];
  if (!row || !row.active || optionIdx >= options.length) {
    return NextResponse.json({ error: "Debate not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("debate_votes")
    .upsert({ debate_id: debateId, user_id: user.id, option_idx: optionIdx }, { onConflict: "debate_id,user_id" });
  if (error) return NextResponse.json({ error: "Could not save your vote" }, { status: 500 });

  const split = await debateSplit(svc, { id: row.id, question: row.question, options });
  return NextResponse.json({ counts: split.counts, total: split.total, yourVote: optionIdx });
}
