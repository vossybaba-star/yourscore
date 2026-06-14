import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";

// Email subscription control — the target of every email's Unsubscribe / Pause link
// and of the RFC 8058 List-Unsubscribe one-click POST.
//
//   action 'unsub' | 'pause' → write a reason='manual' row to email_suppressions
//     (the same table loadSuppressions() reads, so every send script then skips them).
//   action 'resub' → remove ONLY the user's own manual suppression (a bounce/complaint
//     suppression stays — we must not re-enable an address the ESP told us is bad).
//
// The link carries u=<userId> (a random UUIDv4 — an unguessable bearer token); we
// resolve the email server-side with the service role. Accepts the action+id from the
// JSON body, the query string, or a one-click form POST, so it works for the page fetch
// AND for a mailbox provider's automated one-click request.

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

  const u = String(body.u ?? q.get("u") ?? "").trim();
  // A provider one-click POST sends `List-Unsubscribe=One-Click` and no action → unsubscribe.
  const oneClick = body["List-Unsubscribe"] === "One-Click" || q.get("unsub") === "all";
  const raw = String(body.action ?? q.get("action") ?? (oneClick ? "unsub" : "")).toLowerCase();
  const action: Action | null = raw === "unsub" || raw === "pause" || raw === "resub" ? raw : (oneClick ? "unsub" : null);
  const scope = String(body.scope ?? q.get("scope") ?? q.get("pause") ?? "all").slice(0, 40);

  if (!UUID_RE.test(u)) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  if (!action) return NextResponse.json({ error: "Nothing to do." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || u;
  const { ok } = await rateLimitDistributed(`email-unsub:${ip}`, 30, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const admin = createServiceClient() as unknown as SupabaseClient;

  // Resolve the email from the user id.
  const { data: got } = await admin.auth.admin.getUserById(u);
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

function maskEmail(e: string): string {
  const [name, domain] = e.split("@");
  if (!domain) return e;
  const head = name.length <= 2 ? name[0] ?? "" : name.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
}
