import { NextRequest, NextResponse } from "next/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createServiceClient } from "@/lib/supabase/service";
import { rateGuestSquad } from "@/lib/fantasy/guestRating";
import { SQUAD_SIZE, XI_SIZE } from "@/lib/fantasy/engine";

/**
 * Rate a signed-out visitor's just-confirmed 15 — the guest twin of
 * /api/fantasy/squad-rating's POST, but reading raw ids from the request
 * instead of a stored fantasy_squads row, and writing NOTHING (no cache row,
 * no squad row — a guest has neither). See guestRating.ts for why the score
 * itself is bit-for-bit the same code path a member's rating runs.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const BENCH_SIZE = SQUAD_SIZE - XI_SIZE;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PER_IP_HOURLY_CAP = 10;
// Each rating burns a claude-sonnet-5 verdict call, and this route is callable
// directly without ever hitting rate-photo, so an IP-rotating caller could run
// up unbounded spend on the per-IP cap alone. A global day cap bounds it.
const GLOBAL_DAILY_CAP = 1500;

function isIdArray(v: unknown, len: number): v is number[] {
  return Array.isArray(v) && v.length === len && v.every((n) => Number.isInteger(n));
}

export async function POST(req: NextRequest) {
  // Per-IP first; only spend a global token once the per-IP check passes (the
  // limiter increments unconditionally, so a blocked IP must not drain global).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const perIp = await rateLimitDistributed(`fantasy:rate-guest:${ip}`, PER_IP_HOURLY_CAP, HOUR_MS);
  if (!perIp.ok) {
    return NextResponse.json({ error: "You've asked for a lot of ratings, friend. Try again in a bit." }, { status: 429 });
  }
  const global = await rateLimitDistributed("fantasy:rate-guest:global-day", GLOBAL_DAILY_CAP, DAY_MS);
  if (!global.ok) {
    return NextResponse.json({ error: "We're at capacity grading squads right now. Try again soon." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { ids?: unknown; xi?: unknown; bench?: unknown; captain?: unknown } | null;
  const { ids, xi, bench, captain } = body ?? {};

  if (!isIdArray(ids, SQUAD_SIZE) || new Set(ids).size !== SQUAD_SIZE) {
    return NextResponse.json({ error: "That's not a complete fifteen." }, { status: 400 });
  }
  if (!isIdArray(xi, XI_SIZE)) {
    return NextResponse.json({ error: "That's not a complete starting eleven." }, { status: 400 });
  }
  if (!isIdArray(bench, BENCH_SIZE)) {
    return NextResponse.json({ error: "That's not a complete bench." }, { status: 400 });
  }
  if (typeof captain !== "number" || !Number.isInteger(captain) || !xi.includes(captain)) {
    return NextResponse.json({ error: "Pick a captain from your starting eleven." }, { status: 400 });
  }
  const idSet = new Set(ids);
  if (!xi.every((id) => idSet.has(id)) || !bench.every((id) => idSet.has(id))
    || new Set([...xi, ...bench]).size !== SQUAD_SIZE) {
    return NextResponse.json({ error: "Your eleven and your bench don't match your fifteen." }, { status: 400 });
  }

  try {
    const db = createServiceClient();
    const rating = await rateGuestSquad(db, { ids, xi, bench, captain });
    if (!rating) {
      return NextResponse.json({ error: "Couldn't rate that squad right now. Try again shortly." }, { status: 503 });
    }
    return NextResponse.json(rating);
  } catch (e) {
    console.error("[rate-guest]", e);
    return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
