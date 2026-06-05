import { sendWelcomeEmail } from "@/lib/email/senders";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * Test endpoint — sends the welcome email to your own inbox so you can preview it
 * without going through full signup. Safe to leave on in production.
 *
 *   In dev:  GET /api/email/test            → sends to signed-in user's email
 *            GET /api/email/test?to=foo@x   → sends to any address
 *   In prod: GET /api/email/test            → sends to signed-in user's email only.
 *            ?to= is ignored (anti-abuse). Unauthenticated callers get 401.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const overrideTo = searchParams.get("to");
  const isProd = process.env.NODE_ENV === "production";

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not set — check Vercel env vars" },
      { status: 500 },
    );
  }

  // Resolve target. In prod, only the signed-in user's own email is allowed.
  let targetEmail: string;
  let userId: string;

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (isProd) {
    if (!data.user?.email) {
      return NextResponse.json(
        { error: "Sign in to test — this endpoint only sends to your own email in prod" },
        { status: 401 },
      );
    }
    targetEmail = data.user.email;
    userId = data.user.id;
  } else {
    // Dev: allow ?to= override, else fall back to signed-in user.
    if (overrideTo) {
      targetEmail = overrideTo;
      userId = data.user?.id ?? "dev-test";
    } else if (data.user?.email) {
      targetEmail = data.user.email;
      userId = data.user.id;
    } else {
      return NextResponse.json(
        { error: "No email — sign in or pass ?to=you@example.com" },
        { status: 400 },
      );
    }
  }

  await sendWelcomeEmail({ userId, email: targetEmail });

  return NextResponse.json({
    ok: true,
    sentTo: targetEmail,
    template: "01-welcome",
    env: isProd ? "production" : "development",
  });
}
