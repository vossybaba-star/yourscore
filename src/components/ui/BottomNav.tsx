"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { usePendingFriends } from "@/hooks/usePendingFriends";
import { usePendingTurns } from "@/hooks/usePendingTurns";

// Football icon for the Matchweek tab — the live, fixture-synced surface.
function FootballIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
      <circle cx="11" cy="11" r="8.2" stroke="currentColor" strokeWidth="1.7"
        fill={active ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0} />
      <path d="M11 6.6l3.2 2.3-1.2 3.8H9l-1.2-3.8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 6.6V4M14.2 8.9l2-1M12.9 12.7l1.2 2M9.1 12.7l-1.2 2M7.8 8.9l-2-1"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** How long a tapped tab stays highlighted if the navigation never lands. */
const PENDING_TIMEOUT_MS = 12_000;

/** Thin sweeping bar along the top edge of the nav while a route is in flight. */
function NavProgress({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      aria-hidden
      style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, overflow: "hidden" }}
    >
      <div
        style={{
          width: "33%",
          height: "100%",
          background: "linear-gradient(90deg, transparent, #00d8c0, transparent)",
          animation: "navSweep 1.1s ease-in-out infinite",
        }}
      />
    </div>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useUser();
  const pendingFriends = usePendingFriends();
  const pendingTurns = usePendingTurns();

  // Every screen is fetched from the server (the native app is a webview onto the
  // live site), so a tab tap on a cold connection can sit for seconds before the
  // new route arrives — and the App Router holds the OLD screen on display the
  // whole time. Worst on back/forward, where Next skips loading.tsx entirely. So
  // the tap reads as "nothing happened" and gets tapped again.
  //
  // Recording the tapped href and treating it as the active tab moves the
  // highlight the instant a finger lands, before any network work. The bar below
  // then shows that something is in flight. Purely cosmetic — it never blocks or
  // changes the navigation itself.
  const [pending, setPending] = useState<string | null>(null);

  // `usePathname` flips as soon as the transition COMMITS, not when the new screen
  // is actually ready, so it can't tell us a fetch is still in flight. Driving the
  // push through a transition ourselves gives us `isPending`, which stays true for
  // the whole wait — that's what the bar is hung off.
  const [isPending, startTransition] = useTransition();

  // The route landed (or the user went somewhere else entirely) — stop pretending.
  useEffect(() => setPending(null), [pathname]);

  // Safety net: a navigation that fails or is abandoned would otherwise leave the
  // wrong tab lit for the rest of the session.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);

  const hrefOf = (e: React.SyntheticEvent) => {
    const link = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    return link ? new URL(link.href).pathname : null;
  };

  // The highlight is set on pointer DOWN, in its own event, and deliberately not
  // alongside the push below. React entangles a state update made in the same event
  // as a transition: it renders but does not commit until the transition resolves,
  // so a highlight set next to the push simply never paints during the wait — which
  // is the entire window it exists for. Verified with a delayed RSC fetch.
  //
  // Pointer-down is also the earlier signal, so the tab lights on touch rather than
  // on release. That's the whole point: something has to move under the finger.
  const onNavPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const href = hrefOf(e);
    if (href) setPending(href);
  };

  // Finger slid off the bar, or the browser took the gesture for a scroll — the tap
  // is never coming, so drop the highlight rather than leave the wrong tab lit.
  const onNavPointerCancel = () => setPending(null);

  // One capture-phase handler covers every Link in the bar — no per-tab wiring.
  // The Links stay Links so they keep prefetching on viewport entry and still work
  // with a keyboard or a modifier-click; we only take over the plain left-tap.
  //
  // Every Link below carries `prefetch` (i.e. prefetch={true}) deliberately. The
  // App Router default for a dynamic route only prefetches as far as the nearest
  // loading.tsx — enough to show a skeleton, but the real content is still fetched
  // after the tap, which is the "I tapped and then waited" feel. This bar is
  // permanently on screen and its 5-6 destinations are the whole app, so their
  // payloads (~27kB, edge-cached shells) are worth holding in memory before the tap.
  // If this ever needs reversing, drop the attribute — behaviour falls back to the
  // loading-boundary prefetch, it does not break.
  const onNavTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const href = hrefOf(e);
    if (!href) return;
    // Keyboard activation never fires pointerdown, so set it here too.
    setPending(href);
    // Capture phase, so this lands before Link's own handler — Link sees
    // defaultPrevented and stands down, leaving the push to the transition.
    e.preventDefault();
    startTransition(() => router.push(href));
  };

  // The tapped tab wins over the current URL until the new route lands.
  const active = pending ?? pathname;

  const isHome = active === "/";
  // Play now holds everything you PLAY: the solo games (Quiz /play·/challenges·
  // /h2h, 38-0 /38-0, club) AND Versus, which folded in from its own bottom tab
  // (founder 2026-07-25) as the Solo|Versus toggle. So Versus and its
  // sub-surfaces — Friends, Leagues, and a viewed player's profile (/profile/<id>,
  // reached from Versus) — all keep the Play tab lit. The Profile tab is only
  // YOUR own profile (exact /profile) + settings.
  const isChallenges =
    active.startsWith("/play") || active.startsWith("/challenges") ||
    active.startsWith("/h2h") || active.startsWith("/38-0") ||
    active.startsWith("/club") || active.startsWith("/versus") ||
    active.startsWith("/friends") || active.startsWith("/leagues") ||
    active.startsWith("/league") || active.startsWith("/profile/");
  // Matchweek is the fixture-synced tab. A halftime pack itself opens under
  // /challenges (which holds the Quiz tab, so a pack played from anywhere reads
  // consistently); Matchweek highlights on its own route.
  const isMatchweek = active.startsWith("/matchweek");
  // Fantasy is its own tab now (founder 2026-07-25) — its squad, build, round,
  // transfers, leagues and news all live under /fantasy.
  const isFantasy = active.startsWith("/fantasy");
  const isProfile = active === "/profile" || active.startsWith("/settings");
  // Guest-only tab. Highlights on the auth routes it owns, so a guest who taps it
  // and lands on sign-in still sees where they are in the bar.
  const isSignIn = active.startsWith("/auth");

  // While auth state is resolving, show the full signed-in nav — signed-in users
  // must never flash down to the 3-tab guest nav. Guests see the extra tabs briefly
  // then they disappear, which is far less disruptive than the reverse.
  if (!user && !loading) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "rgba(8,13,10,0.97)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <NavProgress show={isPending} />
        <div className="flex items-start justify-between max-w-lg mx-auto px-1 py-2" onPointerDownCapture={onNavPointerDown} onPointerCancelCapture={onNavPointerCancel} onClickCapture={onNavTap}>
          <Link prefetch href="/" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isHome ? "#aeea00" : "#8a948f" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
              <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-body text-xs text-center leading-tight">Home</span>
          </Link>

          {/* Play — the label now matches its route (/play). It was "Quiz". */}
          <Link prefetch href="/play" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isChallenges ? "#00d8c0" : "#8a948f" }}>
            <span className="relative inline-flex items-center justify-center">
              <span className="nav-glow" aria-hidden />
              <svg width="21" height="21" viewBox="0 0 22 22" fill="none" style={{ position: "relative", zIndex: 1 }}>
                <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
              </svg>
            </span>
            <span className="font-body text-xs text-center leading-tight">Play</span>
          </Link>

          {/* Versus folded into the Play tab (founder 2026-07-25) — no longer its
              own bottom-nav tab. */}

          {/* Premier League — the flagship live surface, discoverable to guests.
              Route stays /matchweek; everything under it IS the PL (halftime
              quizzes are PL fixtures, Fantasy is a PL squad), and "Matchweek"
              names the first section inside. */}
          <Link prefetch href="/matchweek" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isMatchweek ? "#00d8c0" : "#8a948f" }}>
            <FootballIcon active={isMatchweek} />
            <span className="font-body text-xs text-center leading-tight">Premier League</span>
          </Link>

          {/* Fantasy — public now (founder 2026-07-25). The tab is a teaser +
              waitlist opt-in until launch; the real game stays allowlisted inside. */}
          <Link prefetch href="/fantasy" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isFantasy ? "#00d8c0" : "#8a948f" }}>
            <span className="relative inline-flex items-center justify-center">
              <span className="nav-glow" aria-hidden />
              <svg width="21" height="21" viewBox="0 0 22 22" fill="none" style={{ position: "relative", zIndex: 1 }}>
                <path d="M8 3L3.5 5.5 5.5 9 8 7.7V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V7.7L16.5 9l2-3.5L14 3a3 3 0 0 1-6 0z"
                  stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill={isFantasy ? "currentColor" : "none"} fillOpacity={isFantasy ? 0.15 : 0} />
              </svg>
            </span>
            <span className="font-body text-xs text-center leading-tight">Fantasy</span>
          </Link>

          {/* Sign in — the guest's own door, in the slot a signed-in user sees as
              Profile. Every other route to /auth/sign-in in the app is reactive: you
              trip a gated action and get bounced. Someone who already has an account
              on a new phone had no way to CHOOSE to sign in outside the marketing
              home's hamburger (founder 2026-07-24). Sign-up keeps its own louder CTAs
              on the surfaces that sell; this is the quiet way back in. */}
          <Link prefetch href="/auth/sign-in" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isSignIn ? "#aeea00" : "#8a948f" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M9 3H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.5 7.5L17 11l-3.5 3.5M17 11H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-body text-xs text-center leading-tight">Sign in</span>
          </Link>
        </div>
      </div>
    );
  }

  // Signed-in: Home · Play · Versus · Premier League · Profile (founder order,
  // 2026-07-16). Profile is kept — it is the only route to account + settings.
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: "rgba(8,13,10,0.97)",
        backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <NavProgress show={isPending} />
      <div className="flex items-start justify-between max-w-lg mx-auto px-1 py-2" onPointerDownCapture={onNavPointerDown} onPointerCancelCapture={onNavPointerCancel} onClickCapture={onNavTap}>
        {/* Home */}
        <Link prefetch href="/" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isHome ? "#aeea00" : "#8a948f" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
            <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-body text-xs text-center leading-tight">Home</span>
        </Link>

        {/* Play — the solo games AND Versus (folded in, founder 2026-07-25). The
            your-turn badge lives here now: a waiting Versus match is a reason to
            open Play. */}
        <Link prefetch href="/play" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isChallenges ? "#00d8c0" : "#8a948f" }}>
          <div className="relative">
            <span className="nav-glow" aria-hidden />
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none" style={{ position: "relative", zIndex: 1 }}>
              <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
            </svg>
            {pendingTurns > 0 && (
              <span
                style={{
                  position: "absolute", top: -3, right: -5,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: "#00d8c0", color: "#04231f",
                  fontSize: 9, fontWeight: 700, lineHeight: "14px",
                  textAlign: "center", padding: "0 3px",
                  fontFamily: "var(--font-body, sans-serif)",
                  border: "1.5px solid rgba(8,13,10,0.97)",
                }}
              >
                {pendingTurns > 9 ? "9+" : pendingTurns}
              </span>
            )}
          </div>
          <span className="font-body text-xs text-center leading-tight">Play</span>
        </Link>

        {/* Premier League — quizzes at half time + the club-fan leaderboard. */}
        <Link prefetch href="/matchweek" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isMatchweek ? "#00d8c0" : "#8a948f" }}>
          <FootballIcon active={isMatchweek} />
          <span className="font-body text-xs text-center leading-tight">Premier League</span>
        </Link>

        {/* Fantasy — its own tab, public now (founder 2026-07-25). A teaser +
            waitlist opt-in until launch; the real game stays allowlisted inside. */}
        <Link prefetch href="/fantasy" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isFantasy ? "#00d8c0" : "#8a948f" }}>
          <span className="relative inline-flex items-center justify-center">
            <span className="nav-glow" aria-hidden />
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none" style={{ position: "relative", zIndex: 1 }}>
              <path d="M8 3L3.5 5.5 5.5 9 8 7.7V19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V7.7L16.5 9l2-3.5L14 3a3 3 0 0 1-6 0z"
                stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill={isFantasy ? "currentColor" : "none"} fillOpacity={isFantasy ? 0.15 : 0} />
            </svg>
          </span>
          <span className="font-body text-xs text-center leading-tight">Fantasy</span>
        </Link>

        {/* Profile */}
        <Link prefetch href="/profile" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isProfile ? "#aeea00" : "#8a948f" }}>
          <div className="relative">
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" fill={isProfile ? "currentColor" : "none"} fillOpacity={isProfile ? 0.15 : 0} />
              <path d="M3 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {pendingFriends > 0 && (
              <span
                style={{
                  position: "absolute", top: -3, right: -5,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: "#ef4444", color: "#fff",
                  fontSize: 9, fontWeight: 700, lineHeight: "14px",
                  textAlign: "center", padding: "0 3px",
                  fontFamily: "var(--font-body, sans-serif)",
                  border: "1.5px solid rgba(8,13,10,0.97)",
                }}
              >
                {pendingFriends > 9 ? "9+" : pendingFriends}
              </span>
            )}
          </div>
          <span className="font-body text-xs text-center leading-tight">Profile</span>
        </Link>
      </div>
    </div>
  );
}
