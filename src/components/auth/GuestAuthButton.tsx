"use client";

/**
 * The signed-out escape hatch: a Sign In/Up pill in the top right of EVERY tab.
 *
 * Why it exists: a guest who installed the app from the App Store landed on
 * Play or Premier League and had no way in at all — neither tab rendered any
 * auth entry point, and the only one anywhere was a "Sign Up" button on the
 * marketing home page that is itself hidden below sm. People were downloading
 * the app and never finding sign in (founder, 23 Jul).
 *
 * Says "Sign In/Up", not "Sign Up": /auth/sign-in handles both, and its own
 * heading is "SIGN IN OR SIGN UP". A returning player who reinstalls should not
 * have to guess that the sign-UP button is also the way back to their account.
 *
 * Carries ?next= so signing in returns you to the tab you were on.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { useGamesNavHidden } from "@/lib/gamesNav";

export function GuestAuthButton() {
  const { user, loading } = useUser();
  const pathname = usePathname() ?? "/";
  // Same flag GamesNav honours: game pages raise it while a run is on screen,
  // so this never floats over live gameplay (or a quiz timer).
  const navHidden = useGamesNavHidden();

  // While auth resolves, render nothing rather than flashing a Sign In/Up at
  // someone who is already signed in.
  if (loading || user) return null;

  // The auth pages themselves, and the marketing home page, which has its own
  // header with a Sign In/Up button in it — two would be one too many.
  if (pathname === "/" || pathname.startsWith("/auth")) return null;
  // Social carries its own contextual join bar (master prompt §21: no floating
  // auth control overlapping the feed) — one ask per screen, and the bottom
  // nav's Sign in tab keeps the volitional door.
  if (pathname.startsWith("/fantasy/social")) return null;
  if (navHidden) return null;

  const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";

  return (
    <div className="fixed right-3 z-40 pt-safe pointer-events-none" style={{ top: 0 }}>
      <Link
        href={`/auth/sign-in${next}`}
        className="pointer-events-auto mt-2 flex items-center font-body font-bold rounded-xl transition-all active:scale-95 whitespace-nowrap"
        style={{
          fontSize: 13,
          padding: "8px 14px",
          background: "rgba(174,234,0,0.14)",
          border: "1px solid rgba(174,234,0,0.4)",
          color: "#aeea00",
          backdropFilter: "blur(12px)",
          textDecoration: "none",
        }}
      >
        Sign In/Up
      </Link>
    </div>
  );
}
