import { sendWelcomeEmail } from "@/lib/email/senders";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";

  if (errorParam) {
    const desc = searchParams.get("error_description") ?? errorParam;
    console.error("[auth/callback] OAuth error from Supabase:", desc);
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(desc)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Fire welcome email only on first sign-in (created_at ≈ last_sign_in_at).
      // Fire-and-forget; sender catches its own errors so we never block redirect.
      const user = data.user;
      const firstSignIn = isFirstSignIn(user?.created_at, user?.last_sign_in_at);
      if (user?.email && firstSignIn) {
        void sendWelcomeEmail({ userId: user.id, email: user.email });
      }
      // Tag brand-new users so the client can fire the X signup conversion once.
      const dest = new URL(next, origin);
      if (firstSignIn) dest.searchParams.set("signup", "1");
      return NextResponse.redirect(dest.toString());
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/`);
}

/** True when created_at and last_sign_in_at are within 10 seconds — i.e. brand-new user. */
function isFirstSignIn(createdAt?: string, lastSignIn?: string | null): boolean {
  if (!createdAt || !lastSignIn) return Boolean(createdAt && !lastSignIn);
  const delta = Math.abs(new Date(createdAt).getTime() - new Date(lastSignIn).getTime());
  return delta < 10_000;
}
