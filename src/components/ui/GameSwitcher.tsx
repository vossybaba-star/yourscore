"use client";

import Link from "next/link";

// The Play tab's game switcher — Quiz and 38-0 are sibling games under the one
// bottom-nav Play tab. Coral-style icon tabs (founder direction 2026-07-18):
// icon above label, the active game keeps its own colour with an underline.
// Each game keeps its frozen route (/play, /38-0), so switching is a
// navigation, not local state; future games add an entry and the row scrolls.

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

const GAMES = [
  { key: "quiz" as const, href: "/play", label: "Quiz", color: "#00d8c0", Icon: QuizIcon },
  { key: "draft" as const, href: "/38-0", label: "38-0", color: "#aeea00", Icon: JerseyIcon },
];

export function GameSwitcher({ active }: { active: "quiz" | "draft" }) {
  return (
    <div
      className="flex gap-1 overflow-x-auto"
      style={{ scrollbarWidth: "none", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      {GAMES.map(({ key, href, label, color, Icon }) => {
        const on = key === active;
        return (
          <Link
            key={key}
            href={href}
            className="flex flex-col items-center gap-1 px-5 pt-1.5 pb-2 transition-colors flex-shrink-0"
            style={{
              color: on ? color : "#8a948f",
              borderBottom: on ? `2px solid ${color}` : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            <Icon active={on} />
            <span className="font-body text-xs font-semibold">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
