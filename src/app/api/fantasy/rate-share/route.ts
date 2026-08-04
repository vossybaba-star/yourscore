import { NextRequest, NextResponse } from "next/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createServiceClient } from "@/lib/supabase/service";
import { rateGuestSquad } from "@/lib/fantasy/guestRating";
import { createRateShare } from "@/lib/fantasy/rateShare";
import { clientPool } from "@/lib/fantasy/pool";
import { SQUAD_SIZE, XI_SIZE } from "@/lib/fantasy/engine";
import type { RateSharePlayer } from "@/lib/fantasy/rateShareTypes";

/**
 * Grade a confirmed 15 AND persist it as a shareable snapshot, returning the
 * share id so the caller can land the user on /r/[id]. The rating is computed
 * server-side (never trusted from the client) so a shared "rated by the Scout"
 * score is always a real one — a client can't fabricate a 10/10 card.
 *
 * The twin of /api/fantasy/rate-guest, which grades without persisting; this one
 * is the path the upload flow uses now that the result lives at /r/[id].
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const BENCH_SIZE = SQUAD_SIZE - XI_SIZE;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PER_IP_HOURLY_CAP = 10;
const GLOBAL_DAILY_CAP = 1500; // each rating burns a model call — bound total spend

function isIdArray(v: unknown, len: number): v is number[] {
  return Array.isArray(v) && v.length === len && v.every((n) => Number.isInteger(n));
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const perIp = await rateLimitDistributed(`fantasy:rate-share:${ip}`, PER_IP_HOURLY_CAP, HOUR_MS);
  if (!perIp.ok) {
    return NextResponse.json({ error: "You've asked for a lot of ratings, friend. Try again in a bit." }, { status: 429 });
  }
  const global = await rateLimitDistributed("fantasy:rate-share:global-day", GLOBAL_DAILY_CAP, DAY_MS);
  if (!global.ok) {
    return NextResponse.json({ error: "We're at capacity grading squads right now. Try again soon." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as
    { ids?: unknown; xi?: unknown; bench?: unknown; captain?: unknown; vice?: unknown } | null;
  const { ids, xi, bench, captain, vice } = body ?? {};

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
  const viceId = typeof vice === "number" && Number.isInteger(vice) ? vice : null;

  try {
    const db = createServiceClient();
    const rating = await rateGuestSquad(db, { ids, xi, bench, captain });
    if (!rating) {
      return NextResponse.json({ error: "Couldn't rate that squad right now. Try again shortly." }, { status: 503 });
    }

    // Player identity for the pitch/card — from the pool, no gameweek needed.
    const meta = new Map(clientPool().players.map((p) => [p.id, p]));
    const mk = (id: number): RateSharePlayer => {
      const p = meta.get(id);
      return {
        id, name: p?.name ?? "Unknown", pos: (p?.pos as string) ?? "MID", club: p?.club ?? "",
        isBench: bench.includes(id), isCaptain: id === captain, isVice: id === viceId,
      };
    };
    const players = [...xi.map(mk), ...bench.map(mk)];

    const id = await createRateShare({ rating, players, source: "upload" });
    return NextResponse.json({ id });
  } catch (e) {
    console.error("[rate-share]", e);
    return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
