import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  // Skip if Supabase not yet configured (local dev without .env.local)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  // Disk-IO optimization: anonymous visitors have no session to refresh and can
  // never be admins, so skip the auth round-trip entirely. supabase.auth.getUser()
  // fans out to ~5 auth-table queries per call; previously it ran on EVERY request
  // (including logged-out marketing/landing traffic), dominating DB load. We only
  // pay that cost when an actual Supabase auth cookie is present.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));

  if (!hasAuthCookie) {
    // No session => nothing to refresh. Still gate /admin (a no-cookie request is
    // definitely not an admin), matching the authenticated path's redirect.
    if (request.nextUrl.pathname.startsWith("/admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // Fail-safe response used whenever we cannot positively verify the session:
  // deny /admin (we can't confirm admin), let every other route through. Middleware
  // runs on EVERY request, so it must never throw — a throw becomes a 500 that locks
  // the user out of the whole site.
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

    // Bound the auth round-trip. Under load Supabase Auth can be slow, and a hung
    // getUser() would blow the middleware time budget on every route. If it doesn't
    // resolve in time, fail safe instead of blocking the whole site. The user's
    // existing cookie is left intact and simply refreshes on a later request.
    const authResult = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-timeout")), 3000)
      ),
    ]);
    const user = authResult.data.user;

    // Protect /admin routes — require an authenticated admin, not just any user.
    // Uses app_metadata (service-role-only), NOT user-editable user_metadata.
    // Mirrors the is_admin RLS rule (supabase/schema.sql).
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
    // Transient auth failure (timeout, Supabase Auth blip, malformed token).
    // Degrade gracefully rather than 500 the entire request.
    return failSafe();
  }
}
