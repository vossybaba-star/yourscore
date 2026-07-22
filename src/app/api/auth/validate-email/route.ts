import { NextRequest, NextResponse } from "next/server";
import { verifyEmailDeliverable } from "@/lib/email-verify";
import { rateLimitDistributed } from "@/lib/ratelimit";

// node:dns needs the Node runtime (not edge).
export const runtime = "nodejs";

/**
 * Deliverability gate the auth form calls BEFORE asking Supabase to send a
 * magic-link / confirmation / reset email. Blocks malformed, fake, typo'd, and
 * dead-domain addresses so they never generate a bounce.
 *
 * Public + unauthenticated by design (it runs before sign-in), so it does no
 * account mutation and returns nothing sensitive — just a yes/no + reason.
 */
export async function POST(req: NextRequest) {
  // Unauthenticated + does live DNS lookups → rate-limit by IP (same pattern as
  // draft/share) so it can't be used for free MX amplification or list validation.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const { ok } = await rateLimitDistributed(`validate-email:${ip}`, 10, 60_000);
  if (!ok) return NextResponse.json({ ok: false, status: "rate_limited", reason: "Too many attempts — try again in a minute." }, { status: 429 });

  let email: unknown;
  try {
    ({ email } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, status: "bad_format", reason: "Enter a valid email address." }, { status: 400 });
  }
  if (typeof email !== "string" || !email.trim()) {
    return NextResponse.json({ ok: false, status: "bad_format", reason: "Enter a valid email address." });
  }

  const result = await verifyEmailDeliverable(email);
  return NextResponse.json(result);
}
