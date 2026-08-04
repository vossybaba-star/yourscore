import { NextRequest, NextResponse } from "next/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { matchExtractedSquad, sanitizeExtracted, enforceOneGkStarter, repairInvalidFormation, padSlots, type ExtractedPlayer, type MatchPoolPlayer } from "@/lib/fantasy/screenshotMatch";
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

const EXTRACT_SYSTEM = `You read an FPL squad screenshot for YourScore, a
football app. Extract exactly what is printed — never invent a player and
never skip one you can read.

There are TWO different FPL screens you might see, and they need different
handling:

1. "PICK TEAM" screen — a formation drawn on a pitch, with a separate strip of
   4 substitutes set apart from it (to the side or below, often smaller or
   shaded, numbered). Here the bench is VISUALLY OBVIOUS: put the 11 inside the
   formation in "starters", the 4 set-apart ones in "substitutes".
2. "TRANSFERS" (or squad-list) screen — your full 15 shown grouped ONLY by
   position count (always 2 goalkeepers, 5 defenders, 5 midfielders, 3
   forwards), usually under a "Transfers" heading with a budget/deadline bar
   above and a Pitch/List toggle. This screen shows NO starting XI and NO
   bench — that distinction simply is not on screen, so do not guess it from
   row position. Instead, split starters/substitutes using PRICE as your best
   guide: the higher-priced player at each position is more likely to start
   (a manager's best players cost more), while keeping to a legal XI shape —
   one goalkeeper, 3 to 5 defenders, 2 to 5 midfielders, 1 to 3 forwards, eleven
   total. Never leave the highest-priced forward among the substitutes if a
   cheaper one could make way instead.

RULES
- Read each player's club from the KIT they are wearing, not from a guess
  based on who they usually play for. Name the club IN FULL, the common name
  a fan would use: "Chelsea", "Manchester City", "Nottingham Forest",
  "Tottenham". Do NOT return the three letter code (CHE, MCI, NFO) shown in the
  fixture line under the name — that code is the opponent, not their club.
- Transcribe the printed surname exactly, including any accents ("Sánchez",
  "Groß", "João Pedro"). If the screenshot shows an initial to disambiguate two
  same-surname squad members (e.g. "N.Williams"), keep it exactly like that. If
  a name is clearly cut off on screen (e.g. "Calvert-Le..."), give the player's
  full surname ("Calvert-Lewin").
- Read each player's price if one is printed near them (e.g. "£4.5m" -> 4.5).
  Leave it out if no price is shown.
- On EITHER screen: the starting eleven has EXACTLY ONE goalkeeper; the second
  goalkeeper is always a substitute.
- A "C" armband means captain, a "V" armband means vice captain. If no armband is
  visible on anyone, set isCaptain and isVice false for everyone.
- If part of the squad is cut off or unreadable, extract what you CAN read and
  leave the rest out. Never invent a name or club to fill a gap.`;

interface AnthropicResponse {
  content?: { type: string; input?: { starters?: unknown; substitutes?: unknown } }[];
}

async function extractSquad(image: string, mediaType: string): Promise<ExtractedPlayer[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[rate-photo] no ANTHROPIC_API_KEY");
    return null;
  }

  const playerItem = {
    type: "object",
    properties: {
      surname: { type: "string" },
      club: { type: "string" },
      position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] },
      isCaptain: { type: "boolean" },
      isVice: { type: "boolean" },
      price: { type: "number", description: "£m price printed near the player, e.g. 4.5 for '£4.5m'. Omit if not shown." },
    },
    required: ["surname", "club", "position", "isCaptain", "isVice"],
  };
  const tool = {
    name: "extract_squad",
    description: "The players read off an FPL squad screenshot, split into the eleven starters and the four substitutes.",
    input_schema: {
      type: "object",
      properties: {
        starters: { type: "array", description: "The 11 players you judge to be starting (exactly one is a goalkeeper).", items: playerItem },
        substitutes: { type: "array", description: "The 4 remaining players (the bench), including the backup goalkeeper.", items: playerItem },
      },
      required: ["starters", "substitutes"],
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
    const starters = Array.isArray(block?.input?.starters) ? block!.input!.starters as unknown[] : [];
    const substitutes = Array.isArray(block?.input?.substitutes) ? block!.input!.substitutes as unknown[] : [];
    if (!starters.length && !substitutes.length) {
      console.error("[rate-photo] vision call failed: no-tool-use-block");
      return null;
    }
    // Flatten the two groups into the isBench shape the matcher expects: the
    // pitch eleven are starters, the set-apart four are the bench.
    const combined = [
      ...starters.map((p) => (p && typeof p === "object" ? { ...(p as object), isBench: false } : p)),
      ...substitutes.map((p) => (p && typeof p === "object" ? { ...(p as object), isBench: true } : p)),
    ];
    // The model output is untrusted — drop malformed entries, cap the length —
    // then deterministically repair what vision most often gets wrong: exactly
    // one goalkeeper starts, then the outfield formation is actually legal (FPL's
    // "Transfers" screen has no bench signal at all, so a naive top-to-bottom
    // read can leave zero forwards starting — see repairInvalidFormation).
    return repairInvalidFormation(enforceOneGkStarter(sanitizeExtracted(combined)));
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
