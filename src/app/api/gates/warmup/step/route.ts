import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { warmupStep } from "@/lib/gates/warmup-server";

export const fetchCache = "force-no-store";

/**
 * POST /api/gates/warmup/step { key, version, answers: (number|null)[], k }
 *   → { correct, answerId, streak, band }
 *
 * Grades answer k server-side (the client never has the answers) and returns
 * the streak/band state that the draft spin uses for this slot. 409 = the
 * round is stale (pool rebuilt mid-round) — the client restarts.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`gates-step:${ip}`, 120, 60_000).ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const version = typeof body?.version === "string" ? body.version : "";
  const k = Number.isInteger(body?.k) ? (body.k as number) : -1;
  const answers = Array.isArray(body?.answers)
    ? (body.answers as unknown[]).map((a) => (Number.isInteger(a) ? (a as number) : null))
    : null;
  if (key.length < 8 || key.length > 64 || !answers || k < 0 || k > 10 || answers.length > 11) {
    return NextResponse.json({ error: "Bad step" }, { status: 400 });
  }
  const step = warmupStep(key, version, answers, k);
  if (!step) return NextResponse.json({ error: "Stale round" }, { status: 409 });
  return NextResponse.json(step);
}
