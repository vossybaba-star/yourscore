import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { warmupQuestions } from "@/lib/gates/warmup-server";

export const fetchCache = "force-no-store";

/**
 * POST /api/gates/warmup { key } → { version, questions }
 *
 * The warm-up round for a session key (guest-friendly — the key is a per-device
 * random id from localStorage). Deterministic per (pool version, key), so a
 * refresh resumes the same round. Answers are never included.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`gates-warmup:${ip}`, 30, 60_000).ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (key.length < 8 || key.length > 64) {
    return NextResponse.json({ error: "Bad session key" }, { status: 400 });
  }
  return NextResponse.json(warmupQuestions(key));
}
