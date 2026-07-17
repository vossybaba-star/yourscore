"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function BottomNav() {
  const pathname = usePathname();
  const { user, loading } = useUser();
  const pendingFriends = usePendingFriends();
  const pendingTurns = usePendingTurns();

  const isHome = pathname === "/";
  // Versus is the hub: its sub-sections (Friends, Leagues) keep the tab active.
  // A viewed player's profile (/profile/<id>) is a social detail page reached
  // from here, so it holds the Versus tab too — the Profile tab is only YOUR own
  // profile (exact /profile) + settings.
  const isVersus =
    pathname.startsWith("/versus") || pathname.startsWith("/friends") ||
    pathname.startsWith("/leagues") || pathname.startsWith("/league") ||
    pathname.startsWith("/profile/");
  const isChallenges =
    (pathname.startsWith("/play") || pathname.startsWith("/challenges") || pathname.startsWith("/h2h")) &&
    !pathname.startsWith("/38-0");
  // Matchweek is the fixture-synced tab. A halftime pack itself opens under
  // /challenges (which holds the Quiz tab, so a pack played from anywhere reads
  // consistently); Matchweek highlights on its own route.
  const isMatchweek = pathname.startsWith("/matchweek");
  const isProfile = pathname === "/profile" || pathname.startsWith("/settings");

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
        <div className="flex items-start justify-between max-w-lg mx-auto px-1 py-2">
          <Link href="/" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isHome ? "#aeea00" : "#8a948f" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
              <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-body text-xs text-center leading-tight">Home</span>
          </Link>

          {/* Play — the label now matches its route (/play). It was "Quiz". */}
          <Link href="/play" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isChallenges ? "#00d8c0" : "#8a948f" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
            </svg>
            <span className="font-body text-xs text-center leading-tight">Play</span>
          </Link>

          {/* Versus is discoverable to guests too — it renders a public preview. */}
          <Link href="/versus" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isVersus ? "#00d8c0" : "#8a948f" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M3 3l8.5 8.5M3 3v3l7.5 7.5M3 3h3l7.5 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 3l-8.5 8.5M19 3v3l-7.5 7.5M19 3h-3L8.5 11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 15.5l2 2M15.5 15.5l-2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="font-body text-xs text-center leading-tight">Versus</span>
          </Link>

          {/* Premier League — the flagship live surface, discoverable to guests.
              Route stays /matchweek; everything under it IS the PL (halftime
              quizzes are PL fixtures, Fantasy is a PL squad), and "Matchweek"
              names the first section inside. */}
          <Link href="/matchweek" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isMatchweek ? "#00d8c0" : "#8a948f" }}>
            <FootballIcon active={isMatchweek} />
            <span className="font-body text-xs text-center leading-tight">Premier League</span>
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
      <div className="flex items-start justify-between max-w-lg mx-auto px-1 py-2">
        {/* Home */}
        <Link href="/" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isHome ? "#aeea00" : "#8a948f" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
            <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-body text-xs text-center leading-tight">Home</span>
        </Link>

        {/* Play — the label now matches its route (/play). It was "Quiz". */}
        <Link href="/play" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isChallenges ? "#00d8c0" : "#8a948f" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
          </svg>
          <span className="font-body text-xs text-center leading-tight">Play</span>
        </Link>

        {/* Versus — the cross-game hub for playing other people. */}
        <Link href="/versus" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isVersus ? "#00d8c0" : "#8a948f" }}>
          <div className="relative">
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M3 3l8.5 8.5M3 3v3l7.5 7.5M3 3h3l7.5 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 3l-8.5 8.5M19 3v3l-7.5 7.5M19 3h-3L8.5 11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6.5 15.5l2 2M15.5 15.5l-2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
          <span className="font-body text-xs text-center leading-tight">Versus</span>
        </Link>

        {/* Premier League — quizzes at half time + the club-fan leaderboard. */}
        <Link href="/matchweek" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isMatchweek ? "#00d8c0" : "#8a948f" }}>
          <FootballIcon active={isMatchweek} />
          <span className="font-body text-xs text-center leading-tight">Premier League</span>
        </Link>

        {/* Profile */}
        <Link href="/profile" className="flex-1 min-w-0 flex flex-col items-center gap-1 px-1 py-1 transition-colors" style={{ color: isProfile ? "#aeea00" : "#8a948f" }}>
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
