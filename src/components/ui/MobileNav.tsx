"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface MobileNavProps {
  displayName?: string | null;
}

export function MobileNav({ displayName }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);
  // Prevent body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const isHome = pathname === "/";
  const isLeague = pathname.startsWith("/league") || pathname.startsWith("/leagues");
  const isPlay = pathname === "/join" || pathname.startsWith("/match");
  const isChallenges = pathname.startsWith("/challenges");
  const isProfile = pathname.startsWith("/profile") || pathname.startsWith("/settings");

  const items = [
    {
      href: "/", label: "Home", active: isHome, color: "#00ff87",
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <path d="M3 9.5L11 3l8 6.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 20v-8h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      href: "/leagues", label: "Leagues", active: isLeague, color: "#a78bfa",
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <path d="M6 2h10v5l-5 4-5-4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 7v9a3 3 0 0 0 6 0V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/challenges", label: "Challenges", active: isChallenges, color: "#ffb800",
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <path d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      href: "/league/join", label: "Join league", active: isPlay, color: "#00ff87",
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.8" />
          <path d="M11 8.5L13.4 10.2L12.5 13L9.5 13L8.6 10.2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.35" />
          <path d="M11 8.5L11 3M13.4 10.2L18.6 8.5M12.5 13L15.7 17.5M9.5 13L6.3 17.5M8.6 10.2L3.4 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      href: "/profile", label: "Profile", active: isProfile, color: "#a78bfa",
      icon: (
        <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* ── Hamburger button ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close menu" : "Open menu"}
        className="w-9 h-9 rounded-full flex items-center justify-center transition-all"
        style={{
          background: open ? "rgba(0,255,135,0.12)" : "rgba(255,255,255,0.06)",
          border: `1.5px solid ${open ? "rgba(0,255,135,0.35)" : "rgba(255,255,255,0.1)"}`,
        }}
      >
        {open ? (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M2 2l11 11M13 2L2 13" stroke="#00ff87" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M1.5 3.5h12M1.5 7.5h12M1.5 11.5h12" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {/* ── Slide-down menu overlay ───────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute top-0 left-0 right-0 mx-auto max-w-lg"
            style={{
              background: "rgba(10,10,15,0.98)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header row inside menu */}
            <div className="flex items-center justify-between px-5 py-4">
              <span
                className="font-display text-2xl text-white tracking-wider"
                style={{ textShadow: "0 0 20px rgba(0,255,135,0.3)" }}
              >
                YOURSCORE
              </span>
              <div className="flex items-center gap-2">
                {displayName && (
                  <span
                    className="font-body text-sm font-semibold"
                    style={{ color: "#8888aa" }}
                  >
                    {displayName.split(" ")[0]}
                  </span>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="w-9 h-9 rounded-full flex items-center justify-center"
                  style={{
                    background: "rgba(0,255,135,0.1)",
                    border: "1.5px solid rgba(0,255,135,0.3)",
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M2 2l11 11M13 2L2 13" stroke="#00ff87" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Nav items */}
            <nav className="px-4 pb-5 space-y-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all"
                  style={{
                    background: item.active ? `${item.color}12` : "transparent",
                    border: `1px solid ${item.active ? `${item.color}28` : "transparent"}`,
                    color: item.active ? item.color : "#c0c0d8",
                  }}
                >
                  <span style={{ color: item.active ? item.color : "#6666888" }}>
                    {item.icon}
                  </span>
                  <span className="font-body text-base font-semibold">{item.label}</span>
                  {item.active && (
                    <span
                      className="ml-auto w-1.5 h-1.5 rounded-full"
                      style={{ background: item.color, boxShadow: `0 0 6px ${item.color}` }}
                    />
                  )}
                </Link>
              ))}
            </nav>

            {/* Bottom divider + sign out hint */}
            <div
              className="px-5 pb-5 pt-1"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                style={{ color: "#8888aa" }}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 1v2.5M10 16.5V19M19 10h-2.5M3.5 10H1M16.07 3.93l-1.77 1.77M5.7 14.3l-1.77 1.77M16.07 16.07l-1.77-1.77M5.7 5.7L3.93 3.93" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span className="font-body text-sm">Settings</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
