"use client";

// The curated Play home (2026-08-07 simplification). One obvious game, then a
// short quick-play row, then people, then a single door into the catalogue.
// Everything here is fed by the canonical GAMES list (GameSwitcher) so a new
// game gets a card without new copy, and the home can never advertise a game
// the app doesn't have. Icon-led cards on purpose: zero image fetches, zero
// layout shift, instant paint.

import Link from "next/link";
import { GAMES } from "@/components/ui/GameSwitcher";

// Per-game quick-play metadata keyed by GAMES.key. Quiz is deliberately absent:
// the hero card above the row IS the quiz entry.
const QUICK_META: Record<string, { time: string; sub: string }> = {
  draft: { time: "~3 min", sub: "Build your XI, go unbeaten" },
  perfect10: { time: "~2 min", sub: "Name a ranked top ten" },
  "higher-lower": { time: "~45 sec", sub: "Pick the bigger number" },
  "guess-the-player": { time: "~60 sec", sub: "Clues drip in, name them" },
};

export function QuickPlayGrid() {
  const games = GAMES.filter((g) => QUICK_META[g.key]);
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {games.map(({ key, href, label, color, Icon }) => {
        const meta = QUICK_META[key];
        return (
          <Link
            key={key}
            href={href}
            className="rounded-2xl px-4 pt-3.5 pb-3 transition-all duration-150 active:scale-[0.97]"
            style={{
              background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span style={{ color }}>
                <Icon active />
              </span>
              <span
                className="font-body text-[10px] font-semibold"
                style={{ color: "#7a857f", fontVariantNumeric: "tabular-nums" }}
              >
                {meta.time}
              </span>
            </div>
            <p className="font-display text-base leading-tight text-white">{label.toUpperCase()}</p>
            <p className="font-body text-[11px] leading-snug mt-0.5 mb-2.5" style={{ color: "#8a948f" }}>
              {meta.sub}
            </p>
            <span
              className="inline-block font-display text-[11px] tracking-widest px-3.5 py-1 rounded-full"
              style={{ background: color, color: "#0a0f0a" }}
            >
              PLAY
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// "Play with people" — the three multiplayer verbs, in plain words. Compact
// rows, not a promo banner: this replaces the full-height Versus ad tile.
const PEOPLE_ACTIONS = [
  {
    href: "/versus/challenge",
    title: "Challenge a friend",
    sub: "They play in their own time",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M17 3L9.5 10.5M17 3l-4.5 14-2.5-6.5L3 8l14-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: "/versus/find",
    title: "Find an opponent",
    sub: "Match with a rival now",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="10" cy="10" r="2.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: "/versus?view=leagues",
    title: "Play your league",
    sub: "Battle your friends for the table",
    icon: (
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
        <path d="M5 4h10v3a5 5 0 01-10 0V4z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 16h6M10 12v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function PlayWithPeople() {
  return (
    <div className="space-y-2">
      {PEOPLE_ACTIONS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-150 active:scale-[0.99]"
          style={{
            background: "linear-gradient(135deg, rgba(174,234,0,0.08), rgba(174,234,0,0.02))",
            border: "1px solid rgba(174,234,0,0.22)",
          }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00" }}
          >
            {a.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-body text-sm font-bold text-white">{a.title}</p>
            <p className="font-body text-xs" style={{ color: "#8a948f" }}>{a.sub}</p>
          </div>
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" style={{ color: "#aeea00", flexShrink: 0 }}>
            <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      ))}
    </div>
  );
}

// The single door into the deep catalogue. The count is real (pack list length)
// so the door is honest without the home having to show the shelves.
export function MoreGamesDoor({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center justify-between rounded-2xl px-4 py-3.5 transition-all duration-150 active:scale-[0.99]"
      style={{ background: "#0e1611", border: "1px solid rgba(0,216,192,0.25)" }}
    >
      <div style={{ textAlign: "left" }}>
        <p className="font-display text-sm tracking-widest text-teal">MORE GAMES</p>
        <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>
          {count > 0 ? `${count} quizzes` : "Quizzes"} · clubs · records · build your own
        </p>
      </div>
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: "#00d8c0" }}>
        <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>
      {children}
    </p>
  );
}
