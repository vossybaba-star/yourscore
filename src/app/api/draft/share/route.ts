import { NextRequest, NextResponse } from "next/server";
import { createDraftDb } from "@/lib/draft/server";
import { rateLimitDistributed } from "@/lib/ratelimit";

// Short share links for season-result cards.
//
// The card payload (record, XI, awards…) used to live entirely in the URL query
// string, producing very long links. We now store it under a short id so the
// shared URL stays compact (…/s/<id>).
//   POST { payload } → { id }
//   GET  ?id=        → { payload }
//
// Fails soft (clear error) before the migration is applied.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function genId(len = 7): string {
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

// Keys the season-og card understands, plus matchId for live H2H result links,
// and challengeSlug for quiz result share cards.
const KEYS = ["w", "d", "l", "pts", "pos", "ovr", "mode", "inv", "boot", "pots", "xi", "gf", "ga", "verdict", "form", "play", "glov", "matchId", "challengeSlug"] as const;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    const db = createDraftDb();
    const { data } = await db.from("draft_shares").select("payload").eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ payload: data.payload });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const { ok } = await rateLimitDistributed(`draft-share:${ip}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { payload?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const src = (body.payload && typeof body.payload === "object" ? body.payload : {}) as Record<string, unknown>;

  // Whitelist keys and cap value sizes so the row can't be abused as free storage.
  const payload: Record<string, string> = {};
  for (const k of KEYS) {
    const v = src[k];
    if (typeof v === "string" && v) payload[k] = v.slice(0, 1500);
  }
  if (!payload.w && !payload.xi && !payload.matchId && !payload.challengeSlug) return NextResponse.json({ error: "Empty result" }, { status: 400 });

  try {
    const db = createDraftDb();
    // PK is unique → retry on the (vanishingly rare) slug collision.
    for (let attempt = 0; attempt < 6; attempt++) {
      const id = genId();
      const { error } = await db.from("draft_shares").insert({ id, payload: payload as unknown as never });
      if (!error) return NextResponse.json({ id });
      if ((error as { code?: string }).code !== "23505") break;
    }
    return NextResponse.json({ error: "Could not create link" }, { status: 500 });
  } catch {
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }
}
