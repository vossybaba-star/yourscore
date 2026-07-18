"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

// The Play tab's game switcher — every game is a sibling section under the one
// bottom-nav Play tab (founder ruling 2026-07-18: Perfect 10, Higher or Lower
// and Guess the Player are separate games next to Quiz and 38-0, not tiles
// inside the Quiz hub). Coral-style icon tabs: icon above label, the active
// game keeps its own colour with an underline. Each game keeps its frozen
// route, so switching is a navigation, not local state; the row scrolls and
// centres the active tab, since five tabs don't fit a phone.

function QuizIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M11 2L13.5 8.5H20.5L14.9 12.5L17 19L11 15L5 19L7.1 12.5L1.5 8.5H8.5L11 2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.15 : 0}
      />
    </svg>
  );
}

function JerseyIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
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

// Perfect 10's floodlit tower — three rungs tapering toward the top.
function TowerIcon({ active }: { active: boolean }) {
  const fill = active ? "currentColor" : "none";
  const op = active ? 0.15 : 0;
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x="7.5" y="3" width="7" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.6" fill={fill} fillOpacity={op} />
      <rect x="5" y="9.2" width="12" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.6" fill={fill} fillOpacity={op} />
      <rect x="2.5" y="15.4" width="17" height="3.6" rx="1" stroke="currentColor" strokeWidth="1.6" fill={fill} fillOpacity={op} />
    </svg>
  );
}

// Higher or Lower — one bar up, one bar down.
function ArrowsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18.5V5M3.4 8.6 7 5l3.6 3.6" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} />
      <path d="M15 3.5V17M11.4 13.4 15 17l3.6-3.6" stroke="currentColor" strokeWidth={active ? 2.1 : 1.7} />
    </svg>
  );
}

// Guess the Player — the cover's mystery "?" motif.
function MysteryIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path
        d="M7.2 8a3.9 3.9 0 117.1 2.2c-.8 1.1-2.2 1.5-2.9 2.6-.25.4-.35.9-.35 1.5"
        stroke="currentColor"
        strokeWidth={active ? 2.1 : 1.7}
        strokeLinecap="round"
      />
      <circle cx="11.1" cy="18" r="1.2" fill="currentColor" />
    </svg>
  );
}

const GAMES = [
  { key: "quiz" as const, href: "/play", label: "Quiz", color: "#00d8c0", Icon: QuizIcon },
  { key: "draft" as const, href: "/38-0", label: "38-0", color: "#aeea00", Icon: JerseyIcon },
  { key: "perfect10" as const, href: "/play/game/perfect-10", label: "Perfect 10", color: "#ffc400", Icon: TowerIcon },
  { key: "higher-lower" as const, href: "/play/game/higher-lower", label: "Higher or Lower", color: "#ff7800", Icon: ArrowsIcon },
  { key: "guess-the-player" as const, href: "/play/game/guess-the-player", label: "Guess the Player", color: "#4fc3f7", Icon: MysteryIcon },
];

export type GameKey = (typeof GAMES)[number]["key"];

export function GameSwitcher({ active }: { active: GameKey }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Five tabs overflow a phone — centre the active one so the current game is
  // never parked off-screen. Instant on first paint; animated on tab change
  // (the bar persists in the layout, so a switch is the SAME element gliding —
  // part of what makes it read as one nav rather than a new page).
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>(`[data-game="${active}"]`);
    if (!row || !el) return;
    const left = el.offsetLeft - (row.clientWidth - el.clientWidth) / 2;
    row.scrollTo({ left, behavior: mountedRef.current ? "smooth" : "auto" });
    mountedRef.current = true;
  }, [active]);

  return (
    <div
      ref={rowRef}
      className="flex gap-1 overflow-x-auto"
      style={{ scrollbarWidth: "none", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {GAMES.map(({ key, href, label, color, Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={href}
            data-game={key}
            className="flex flex-col items-center gap-1 px-4 pt-1.5 pb-2 transition-colors flex-shrink-0"
            style={{
              color: on ? color : "#8a948f",
              borderBottom: on ? `2px solid ${color}` : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            <Icon active={on} />
            <span className="font-body text-xs font-semibold whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
