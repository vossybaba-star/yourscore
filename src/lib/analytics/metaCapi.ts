// ── Meta browser Pixel + Conversions API (server) mirror ─────────────────────
// Single wrapper every Meta event flows through. It does two things the bare
// `window.fbq(...)` call could not:
//
//  1. Mints ONE shared `event_id` and passes it to the browser Pixel as `eventID`
//     AND to our server route. Meta's dedup key is (event_name + event_id), so the
//     browser fire and the server (CAPI) fire collapse into a SINGLE event instead
//     of double-counting. The old browser-only calls sent no eventID at all, which
//     is why server-side could never be deduped. See project_yourscore_meta_capi_status.
//  2. Sends the same event server-side via /api/meta/capi, where the server adds the
//     logged-in user's HASHED email + IP/UA/fbp/fbc — the match keys the browser
//     can't supply — lifting Event Match Quality (was stuck ~6/10, PII near-0).
//
// Rollout is dark-safe: the server route no-ops until META_CAPI_ACCESS_TOKEN is set,
// and the client mirror only POSTs when NEXT_PUBLIC_META_CAPI_ENABLED === "1". Until
// then this behaves exactly like the old fbq calls (Pixel fires, now with an eventID).
// Every branch is guarded so tracking never throws and never blocks a page.

type Payload = Record<string, unknown>;

// Same on/off switch the callers use for the server leg. Public (inlined at build),
// so flipping it requires a redeploy — expected for a NEXT_PUBLIC_ flag.
const SERVER_MIRROR_ON = process.env.NEXT_PUBLIC_META_CAPI_ENABLED === "1";

// A collision-safe id shared by the Pixel and CAPI fire. crypto.randomUUID needs a
// secure context (prod is https); the fallback keeps dev/HTTP working.
function newEventId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the manual id */
  }
  return `e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Fire a Meta event to the browser Pixel and (when enabled) mirror it server-side.
 * Drop-in for `window.fbq?.(type, name, payload)` — identical arguments.
 *   - type "track"       → standard events (Lead, CompleteRegistration, …)
 *   - type "trackCustom" → custom events (PlayAny, FantasySquadSelected, …)
 */
export function metaTrack(type: "track" | "trackCustom", name: string, payload: Payload = {}): void {
  if (typeof window === "undefined") return;
  const eventId = newEventId();

  // 1) Browser Pixel — unchanged behaviour, now carrying the shared eventID so the
  //    server fire can dedupe against it.
  try {
    window.fbq?.(type, name, payload, { eventID: eventId });
  } catch {
    /* a blocked/absent pixel must never break the caller */
  }

  // 2) Server mirror (Conversions API). Fire-and-forget, same-origin so the auth +
  //    _fbp/_fbc cookies ride along for the server to read. keepalive lets it survive
  //    a navigation. Silent on every failure — this is a supplement, not a gate.
  if (!SERVER_MIRROR_ON) return;
  try {
    void fetch("/api/meta/capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        eventId,
        eventName: name,
        eventTime: Math.floor(Date.now() / 1000),
        eventSourceUrl: window.location.href,
        customData: payload,
      }),
    }).catch(() => {});
  } catch {
    /* never let tracking throw */
  }
}
