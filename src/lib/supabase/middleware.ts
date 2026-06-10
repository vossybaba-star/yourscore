import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  // Skip if Supabase not yet configured (local dev without .env.local)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  // Anonymous visitors have no session to refresh and can never be admins, so
  // skip the auth round-trip entirely. This keeps logged-out (marketing/landing)
  // traffic off Supabase Auth — the per-request getUser() flood was a major
  // contributor to the launch-surge overload.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));

  if (!hasAuthCookie) {
    if (request.nextUrl.pathname.startsWith("/admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // Fail-safe response: middleware runs on EVERY request, so it must never throw
  // (a throw becomes a 500 that locks users out of the whole site). On any auth
  // failure: deny /admin (can't verify), pass everything else through.
  const failSafe = () => {
    if (request.nextUrl.pathname.startsWith("/admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  };

  try {
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    // Bound the auth round-trip so a slow/overloaded Supabase Auth can never hang
    // the middleware into a 25s timeout (that was the MIDDLEWARE_INVOCATION_TIMEOUT
    // 504 cascade during the incident).
    const authResult = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-timeout")), 3000)
      ),
    ]);
    const user = authResult.data.user;

    // Protect /admin — require an authenticated admin (app_metadata is
    // service-role-only, not user-editable). Mirrors the is_admin RLS rule.
    if (
      request.nextUrl.pathname.startsWith("/admin") &&
      user?.app_metadata?.is_admin !== true
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }

    return supabaseResponse;
  } catch {
    return failSafe();
  }
}
