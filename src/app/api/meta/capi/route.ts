import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";

// ── Meta Conversions API (server-side) mirror ────────────────────────────────
// Twin of the browser Pixel fire in src/lib/analytics/metaCapi.ts. Both send the
// SAME event_id, so Meta dedupes them into ONE event (dedup key = event_name +
// event_id). What this route adds over the browser is match quality: the logged-in
// user's HASHED email (read from the session, never the request body — unspoofable,
// no PII on the wire) plus server IP/UA and the _fbp/_fbc cookies. That is the lever
// that moves Event Match Quality off ~6/10. See project_yourscore_meta_capi_status.
//
// SHIPS DARK: with no META_CAPI_ACCESS_TOKEN it returns 204 and forwards nothing, so
// deploying this before the token exists in Vercel is a no-op. Targets the NEW pixel
// (NEXT_PUBLIC_META_PIXEL_ID_2) only. Set META_CAPI_TEST_EVENT_CODE to make events
// appear in Events Manager → Test Events for verification, then clear it.

export const fetchCache = "force-no-store";
export const runtime = "nodejs"; // node crypto for the SHA-256 email hash

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID_2;
const TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const TEST_CODE = process.env.META_CAPI_TEST_EVENT_CODE;
const GRAPH = "https://graph.facebook.com/v20.0";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(req: NextRequest) {
  // Dark until a token + pixel exist. Succeed silently so the client mirror is a no-op.
  if (!TOKEN || !PIXEL_ID) return new NextResponse(null, { status: 204 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  // Events are frequent, but a single client should never be able to flood Graph.
  const { ok } = await rateLimitDistributed(`capi:${ip || "unknown"}`, 240, 60_000);
  if (!ok) return new NextResponse(null, { status: 204 });

  let body: {
    eventId?: unknown;
    eventName?: unknown;
    eventTime?: unknown;
    eventSourceUrl?: unknown;
    customData?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const eventName = typeof body.eventName === "string" ? body.eventName : "";
  if (!eventId || !eventName) return new NextResponse(null, { status: 204 });

  const eventSourceUrl = typeof body.eventSourceUrl === "string" ? body.eventSourceUrl : undefined;
  const customData =
    body.customData && typeof body.customData === "object"
      ? (body.customData as Record<string, unknown>)
      : {};

  // event_time must match the browser fire for clean dedup. Trust the client's stamp
  // when it's sane (Meta rejects events older than 7 days or in the future), else now.
  const now = Math.floor(Date.now() / 1000);
  const clientTime = typeof body.eventTime === "number" ? Math.floor(body.eventTime) : now;
  const eventTime = clientTime > now + 60 || clientTime < now - 6 * 24 * 60 * 60 ? now : clientTime;

  // Match keys. Everything Meta can use to attribute this event to a person/click.
  const userData: Record<string, unknown> = {};
  const ua = req.headers.get("user-agent");
  if (ua) userData.client_user_agent = ua;
  if (ip) userData.client_ip_address = ip;

  const jar = await cookies();
  const fbp = jar.get("_fbp")?.value;
  let fbc = jar.get("_fbc")?.value;
  // Reconstruct fbc from an fbclid in the URL when the _fbc cookie isn't set yet
  // (first landing) — recovers click attribution the browser would otherwise miss.
  if (!fbc && eventSourceUrl) {
    try {
      const fbclid = new URL(eventSourceUrl).searchParams.get("fbclid");
      if (fbclid) fbc = `fb.1.${now * 1000}.${fbclid}`;
    } catch {
      /* unparseable url — skip fbc */
    }
  }
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;

  // The big EMQ lever: hashed email off the SESSION (not the body). Absent for
  // signed-out visitors — the event still forwards, matched on IP/UA/fbp/fbc.
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email?.trim().toLowerCase();
    if (email) userData.em = [sha256(email)];
  } catch {
    /* no session / auth hiccup — match on the rest */
  }

  const graphBody: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: userData,
        custom_data: customData,
      },
    ],
    ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}),
  };

  try {
    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graphBody),
    });
    if (!res.ok) {
      console.error("[meta-capi] graph error", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("[meta-capi] forward failed", err);
  }

  // Fire-and-forget contract: the client never waits on or reads this response.
  return new NextResponse(null, { status: 204 });
}
