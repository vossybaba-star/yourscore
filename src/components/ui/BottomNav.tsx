"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "@/hooks/useUser";

// Football-shirt icon for the Draft XI tab.
function JerseyIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
      <path
        d="M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { user } = useUser();

  const isHome = pathname === "/";
  const isLeague = pathname.startsWith("/league") || pathname.startsWith("/leagues");
const isChallenges =
    (pathname.startsWith("/play") || pathname.startsWith("/challenges") || pathname.startsWith("/h2h")) &&
    !pathname.startsWith("/38-0");
  const isDraft = pathname.startsWith("/38-0");
  const isProfile = pathname.startsWith("/profile") || pathname.startsWith("/settings");

  // Guest: Home + Play + Draft XI (Draft is playable anonymously — top of funnel).
  if (!user) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{
          background: "rgba(10,10,15,0.96)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-center justify-around max-w-lg mx-auto px-1 py-2">
          <Link href="/" className="flex flex-col items-center gap-1 px-5 py-1 transition-colors" style={{ color: isHome ? "#00ff87" : "#8888aa" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
              <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-body text-xs">Home</span>
          </Link>

          <Link href="/play" className="flex flex-col items-center gap-1 px-5 py-1 transition-colors" style={{ color: isChallenges ? "#ffb800" : "#8888aa" }}>
            <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
            </svg>
            <span className="font-body text-xs">Play</span>
          </Link>

          <Link href="/38-0" className="flex flex-col items-center gap-1 px-5 py-1 transition-colors" style={{ color: isDraft ? "#00ff87" : "#8888aa" }}>
            <JerseyIcon active={isDraft} />
            <span className="font-body text-xs">38-0</span>
          </Link>
        </div>
      </div>
    );
  }

  // Signed-in: full 6-tab nav.
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: "rgba(10,10,15,0.96)",
        backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex items-center justify-around max-w-lg mx-auto px-1 py-2">
        {/* Home */}
        <Link href="/" className="flex flex-col items-center gap-1 px-2 py-1 transition-colors" style={{ color: isHome ? "#00ff87" : "#8888aa" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={isHome ? "currentColor" : "none"} fillOpacity={isHome ? 0.15 : 0} />
            <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-body text-xs">Home</span>
        </Link>

        {/* Leagues — stay inside Draft XI's league area when the user is in 38-0. */}
        <Link href={isDraft ? "/38-0/leagues" : "/leagues"} className="flex flex-col items-center gap-1 px-2 py-1 transition-colors" style={{ color: isLeague ? "#a78bfa" : "#8888aa" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M6 2h10v5l-5 4-5-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill={isLeague ? "currentColor" : "none"} fillOpacity={isLeague ? 0.15 : 0} />
            <path d="M8 7v9a3 3 0 0 0 6 0V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="font-body text-xs">Leagues</span>
        </Link>

        {/* Play */}
        <Link href="/play" className="flex flex-col items-center gap-1 px-2 py-1 transition-colors" style={{ color: isChallenges ? "#ffb800" : "#8888aa" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" fill={isChallenges ? "currentColor" : "none"} fillOpacity={isChallenges ? 0.15 : 0} />
          </svg>
          <span className="font-body text-xs">Play</span>
        </Link>

        {/* Draft XI */}
        <Link href="/38-0" className="flex flex-col items-center gap-1 px-2 py-1 transition-colors" style={{ color: isDraft ? "#00ff87" : "#8888aa" }}>
          <JerseyIcon active={isDraft} />
          <span className="font-body text-xs">38-0</span>
        </Link>

        {/* Profile */}
        <Link href="/profile" className="flex flex-col items-center gap-1 px-2 py-1 transition-colors" style={{ color: isProfile ? "#00ff87" : "#8888aa" }}>
          <svg width="21" height="21" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" fill={isProfile ? "currentColor" : "none"} fillOpacity={isProfile ? 0.15 : 0} />
            <path d="M3 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="font-body text-xs">Profile</span>
        </Link>
      </div>
    </div>
  );
}
