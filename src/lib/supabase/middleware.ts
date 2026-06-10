import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

export async function updateSession(request: NextRequest) {
  // Skip if Supabase not yet configured (local dev without .env.local)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  // ── Hot path: do NO network auth work for non-/admin routes ────────────────
  // Auth is only *enforced* server-side for /admin. Previously this middleware
  // called supabase.auth.getUser() (a network round-trip to Supabase Auth) on
  // every request to refresh the session. Under the World Cup launch surge that
  // saturated Supabase Auth — getUser() hung, the middleware blew its 25s budget,
  // and every page returned MIDDLEWARE_INVOCATION_TIMEOUT (504). Since middleware
  // runs on every route, that took the whole site down.
  //
  // The browser Supabase client (@supabase/ssr createBrowserClient) refreshes the
  // access token on its own, so sessions still persist without a per-request
  // middleware refresh. We therefore skip the auth round-trip entirely except on
  // /admin, where we must verify the user is an admin.
  if (!request.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next({ request });
  }

  // ── /admin only: verify an authenticated admin, bounded + fail-safe ─────────
  let supabaseResponse = NextResponse.next({ request });

  const denyToHome = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
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

    // Bound the auth round-trip so a slow Auth server can never hang middleware.
    const authResult = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-timeout")), 3000)
      ),
    ]);

    // app_metadata is service-role-only (not user-editable). Mirrors is_admin RLS.
    if (authResult.data.user?.app_metadata?.is_admin !== true) {
      return denyToHome();
    }

    return supabaseResponse;
  } catch {
    // Transient auth failure → can't verify admin → deny rather than 500.
    return denyToHome();
  }
}
