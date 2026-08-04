import { NextRequest, NextResponse } from "next/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { matchExtractedSquad, sanitizeExtracted, padSlots, type ExtractedPlayer, type MatchPoolPlayer } from "@/lib/fantasy/screenshotMatch";
import { enginePool } from "@/lib/fantasy/pool";

/**
 * Signed-out screenshot intake: an FPL "Pick Team" screenshot in, matched
 * pool slots out. No account required — this is the front door for a visitor
 * who hasn't signed up yet (/fantasy/rate).
 *
 * The image lives ONLY in this request's memory. It is never written to
 * disk, storage or the database, never logged (not even the base64 length —
 * only sizes and http statuses are logged on failure), and never echoed back
 * in the response. Same fetch shape as squadRating.ts's callModelForRating():
 * raw fetch to api.anthropic.com, a forced tool call, nothing cached.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// A little headroom over the 4.5MB raw-bytes cap: base64 inflates by ~4/3.
const MAX_CONTENT_LENGTH = 4_500_000;
const MAX_BASE64_CHARS = 5_300_000;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PER_IP_HOURLY_CAP = 5;
const PER_IP_DAILY_CAP = 20;
const GLOBAL_DAILY_CAP = 500;

const EXTRACT_SYSTEM = `You read an FPL "Pick Team" screenshot for YourScore, a
football app. Extract exactly what is printed on the pitch — never invent a
player and never skip a slot you can read.

RULES
- Read each player's club from the KIT colours and the fixture line under
  their name, not from a guess based on who they usually play for.
- Transcribe the printed surname exactly, including any accents. If the
  screenshot shows an initial to disambiguate two same-surname squad members
  (e.g. "N.Williams"), keep it exactly like that.
- The row a player sits in on the pitch tells you their position: goalkeeper
  at the back, then defenders, midfielders, forwards moving up the pitch.
- A "C" armband means captain, a "V" armband means vice captain.
- The row of four below the pitch (the dugout) is the bench — mark those
  players isBench true.
- If part of the squad is cut off or unreadable, extract what you CAN read
  and leave the rest out. Fewer than fifteen players is fine. Never guess a
  name or club to fill a gap.`;

interface AnthropicResponse {
  content?: { type: string; input?: { players?: unknown } }[];
}

async function extractSquad(image: string, mediaType: string): Promise<ExtractedPlayer[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[rate-photo] no ANTHROPIC_API_KEY");
    return null;
  }

  const tool = {
    name: "extract_squad",
    description: "The players read off an FPL Pick Team screenshot.",
    input_schema: {
      type: "object",
      properties: {
        players: {
          type: "array",
          items: {
            type: "object",
            properties: {
              surname: { type: "string" },
              club: { type: "string" },
              position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] },
              isCaptain: { type: "boolean" },
              isVice: { type: "boolean" },
              isBench: { type: "boolean" },
            },
            required: ["surname", "club", "position", "isCaptain", "isVice", "isBench"],
          },
        },
      },
      required: ["players"],
    },
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: EXTRACT_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "extract_squad" },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: "Extract every player you can read off this Pick Team screenshot." },
          ],
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[rate-photo] vision call failed: http-${res.status}`);
      return null;
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use");
    const players = block?.input?.players;
    if (!Array.isArray(players)) {
      console.error("[rate-photo] vision call failed: no-tool-use-block");
      return null;
    }
    // The model output is untrusted — drop malformed entries, cap the length,
    // before any of it reaches the matcher (a non-string surname would throw).
    return sanitizeExtracted(players);
  } catch (e) {
    console.error("[rate-photo] vision call failed: exception", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: "That screenshot is too big, friend. Try a smaller one." }, { status: 413 });
  }

  // Per-IP FIRST, and only touch the global counter once the per-IP checks
  // pass. check_rate_limit increments unconditionally, so running all three at
  // once let a single blocked IP still drain the global day cap (a feature-wide
  // denial of service from one abuser). Gate per-IP, then spend a global token.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
  const [hourly, daily] = await Promise.all([
    rateLimitDistributed(`fantasy:rate-photo:hour:${ip}`, PER_IP_HOURLY_CAP, HOUR_MS),
    rateLimitDistributed(`fantasy:rate-photo:day:${ip}`, PER_IP_DAILY_CAP, DAY_MS),
  ]);
  if (!hourly.ok || !daily.ok) {
    return NextResponse.json({ error: "You've read a few screenshots already, friend. Try again in a bit." }, { status: 429 });
  }
  const global = await rateLimitDistributed("fantasy:rate-photo:global-day", GLOBAL_DAILY_CAP, DAY_MS);
  if (!global.ok) {
    return NextResponse.json({ error: "We're at capacity reading screenshots right now. Try again soon." }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { image?: unknown; mediaType?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image : null;
  const mediaType = typeof body?.mediaType === "string" ? body.mediaType : null;

  if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return NextResponse.json({ error: "That doesn't look like a photo we can read." }, { status: 400 });
  }
  if (!image) {
    return NextResponse.json({ error: "No screenshot came through." }, { status: 400 });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return NextResponse.json({ error: "That screenshot is too big, friend. Try a smaller one." }, { status: 413 });
  }

  const extracted = await extractSquad(image, mediaType);
  if (!extracted || !extracted.length) {
    return NextResponse.json(
      { error: "Couldn't read a squad off that screenshot. Try a clearer photo of your Pick Team screen." },
      { status: 502 },
    );
  }

  // Identity only (id/name/club/pos never change week to week) — no price
  // needed for matching, so the seed-price enginePool() is enough and skips
  // a DB round trip entirely.
  const matchPool: MatchPoolPlayer[] = enginePool().map((p) => ({ id: p.id, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos }));
  // Pad to a full 11 + 4 so a cropped screenshot the model only partly read
  // still lands on a confirm screen the user can complete, rather than a dead
  // end that needs exactly fifteen matched slots.
  const slots = padSlots(matchExtractedSquad(extracted, matchPool));

  return NextResponse.json({ slots });
}
