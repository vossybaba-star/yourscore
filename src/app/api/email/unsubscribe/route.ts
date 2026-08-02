import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { verifyUnsubToken } from "@/lib/email/unsubToken";

// Email subscription control — the target of every email's Unsubscribe / Pause link
// and of the RFC 8058 List-Unsubscribe one-click POST.
//
//   action 'unsub' | 'pause' → write a reason='manual' row to email_suppressions
//     (the same table loadSuppressions() reads, so every send script then skips them).
//   action 'resub' → remove ONLY the user's own manual suppression (a bounce/complaint
//     suppression stays — we must not re-enable an address the ESP told us is bad).
//
// The link carries t=<signed token> (see lib/email/unsubToken); we verify it and
// resolve the email server-side with the service role. Accepts the action+token from
// the JSON body, the query string, or a one-click form POST, so it works for the page
// fetch AND for a mailbox provider's automated one-click request.
//
// It used to carry u=<userId>, documented here as "a random UUIDv4 — an unguessable
// bearer token". That was wrong: user ids are published by ungated public endpoints
// (/api/leaderboard/wc2026, /api/comments, /api/draft/wc/leaderboard), so anyone could
// scrape them and suppress every user's email permanently. Hence the signature.

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action = "unsub" | "pause" | "resub";

export async function POST(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  // Body may be JSON (page fetch) or form-encoded (RFC 8058 one-click). Either is optional.
  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) body = await req.json();
    else if (ct.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries((await req.formData()).entries());
    }
  } catch { /* no/!parseable body — fall back to query params */ }

  // Signed token (`t`) is the supported form. `u` is the legacy raw user id — see
  // resolveUserId below for why it is still accepted and how to switch it off.
  const t = String(body.t ?? q.get("t") ?? "").trim();
  const u = String(body.u ?? q.get("u") ?? "").trim();
  // A provider one-click POST sends `List-Unsubscribe=One-Click` and no action → unsubscribe.
  const oneClick = body["List-Unsubscribe"] === "One-Click" || q.get("unsub") === "all";
  const raw = String(body.action ?? q.get("action") ?? (oneClick ? "unsub" : "")).toLowerCase();
  const action: Action | null = raw === "unsub" || raw === "pause" || raw === "resub" ? raw : (oneClick ? "unsub" : null);
  const scope = String(body.scope ?? q.get("scope") ?? q.get("pause") ?? "all").slice(0, 40);

  const resolved = resolveUserId(t, u);
  if (!resolved) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  const { userId, legacy } = resolved;
  if (!action) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || userId;
  const { ok } = await rateLimitDistributed(`email-unsub:${ip}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  // A signed link proves the request came from mail we sent, so its only limit is
  // the per-IP one above. A legacy link carries no proof — the id in it is public —
  // so it also gets a tight per-USER limit. That doesn't make legacy links safe, it
  // just means the window before LEGACY_LINKS_UNTIL can't be walked at speed.
  if (legacy) {
    const { ok: okUser } = await rateLimitDistributed(`email-unsub-legacy:${userId}`, 3, 24 * 60 * 60_000);
    if (!okUser) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const admin = createServiceClient() as unknown as SupabaseClient;

  // Resolve the email from the user id.
  const { data: got } = await admin.auth.admin.getUserById(userId);
  const email = got?.user?.email?.toLowerCase().trim();
  if (!email) {
    // Account gone / no email on file — nothing to suppress, but don't leak that.
    return NextResponse.json({ ok: true, state: action === "resub" ? "subscribed" : "unsubscribed" });
  }

  try {
    if (action === "resub") {
      // Only lift the user's OWN opt-out. A bounce/complaint suppression must remain.
      await admin.from("email_suppressions").delete().eq("email", email).eq("reason", "manual");
      return NextResponse.json({ ok: true, state: "subscribed", email: maskEmail(email) });
    }

    // unsub / pause → ensure a manual suppression exists. ignoreDuplicates so we never
    // clobber a stronger bounce/complaint reason already on the row.
    await admin.from("email_suppressions").upsert(
      { email, reason: "manual", detail: action === "pause" ? `pause:${scope}` : "unsubscribe" },
      { onConflict: "email", ignoreDuplicates: true },
    );
    return NextResponse.json({ ok: true, state: action === "pause" ? "paused" : "unsubscribed", email: maskEmail(email) });
  } catch {
    return NextResponse.json({ error: "Could not update your preferences. Please try again." }, { status: 500 });
  }
}

/**
 * Legacy `u=<userId>` links stop working after this date.
 *
 * Every email already in an inbox on 2026-08-01 carries one, and people do use them
 * (219 manual unsubscribes, the most recent two days before this change). Rejecting
 * them outright would break unsubscribe for that mail — which is a compliance
 * failure, not just a poor experience. So they keep working for ~2 months, which
 * comfortably covers the tail of a marketing email, and the hole closes on its own
 * without needing anyone to remember.
 *
 * ⚠️ Until this date the original vulnerability is still reachable, just heavily
 * throttled (3 per user per day, above). Bring the date forward to close it sooner —
 * the cost is that unsubscribe links in mail sent before this change stop working.
 */
const LEGACY_LINKS_UNTIL = Date.parse("2026-10-01T00:00:00Z");

/** Signed token wins; the raw id is accepted only inside the legacy window. */
function resolveUserId(t: string, u: string): { userId: string; legacy: boolean } | null {
  if (t) {
    const id = verifyUnsubToken(t);
    return id ? { userId: id, legacy: false } : null;
  }
  if (u && UUID_RE.test(u) && Date.now() < LEGACY_LINKS_UNTIL) {
    return { userId: u, legacy: true };
  }
  return null;
}

function maskEmail(e: string): string {
  const [name, domain] = e.split("@");
  if (!domain) return e;
  const head = name.length <= 2 ? name[0] ?? "" : name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
}
