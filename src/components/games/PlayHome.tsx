"use client";

// The curated Play home (2026-08-07 simplification). One obvious game, then a
// short quick-play row, then people, then a single door into the catalogue.
// Everything here is fed by the canonical GAMES list (GameSwitcher) so a new
// game gets a card without new copy, and the home can never advertise a game
// the app doesn't have. Icon-led cards on purpose: zero image fetches, zero
// layout shift, instant paint.

import Link from "next/link";
import { GAMES } from "@/components/ui/GameSwitcher";
import { PitchArt } from "@/components/versus/GameTileArt";
import { coverUrl } from "@/lib/img";
import { slugify } from "@/lib/utils";

// Per-game quick-play metadata keyed by GAMES.key. Quiz is deliberately absent:
// the hero card above the row IS the quiz entry.
const QUICK_META: Record<string, { time: string; sub: string; autostart?: boolean }> = {
  draft: { time: "~3 min", sub: "Build your XI, go unbeaten" },
  perfect10: { time: "~2 min", sub: "Name a ranked top ten" },
  // Tap = play (the gameplay teaches the mechanic): these two skip their entry
  // screen via ?start=1 and deal question one straight away.
  "higher-lower": { time: "~45 sec", sub: "Pick the bigger number", autostart: true },
  "guess-the-player": { time: "~60 sec", sub: "Clues drip in, name them", autostart: true },
};

// Cover art per game. HL / GTP / Perfect 10 have designed square covers in
// /game-covers; 38-0 draws its own pitch (PitchArt) — no photo, on-brand.
const QUICK_ART: Record<string, string> = {
  perfect10: "/game-covers/perfect-10.webp",
  "higher-lower": "/game-covers/higher-lower.webp",
  "guess-the-player": "/game-covers/guess-the-player.webp",
};

export function QuickPlayGrid() {
  const games = GAMES.filter((g) => QUICK_META[g.key]);
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {games.map(({ key, href, label, color }) => {
        const meta = QUICK_META[key];
        const art = QUICK_ART[key];
        return (
          <Link
            key={key}
            href={meta.autostart ? `${href}?start=1` : href}
            className="rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.97]"
            style={{
              background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Art zone — fixed aspect so the grid never shifts while covers load. */}
            <div className="relative w-full" style={{ aspectRatio: "16 / 10", background: "#0b120d" }}>
              {art ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={art}
                  alt=""
                  loading="eager"
                  decoding="async"
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: "cover", objectPosition: "center 32%" }}
                />
              ) : (
                <>
                  <PitchArt />
                  {/* The signature game wears its name (founder 2026-08-07:
                      "make the actual image like a big 38-0") — instantly
                      findable, like the marketing hero's 38-0 lockup. */}
                  <span
                    className="absolute inset-0 flex items-center justify-center font-display"
                    style={{
                      fontSize: 52,
                      lineHeight: 1,
                      color: "#aeea00",
                      letterSpacing: "0.01em",
                      textShadow: "0 2px 18px rgba(10,15,10,0.85)",
                    }}
                  >
                    38-0
                  </span>
                </>
              )}
              <span
                className="absolute bottom-1.5 right-1.5 font-body text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(8,13,10,0.75)", color: "#c4ccc6", fontVariantNumeric: "tabular-nums" }}
              >
                {meta.time}
              </span>
            </div>
            <div className="px-3.5 pt-2.5 pb-3">
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
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ── Today's Quiz carousel ────────────────────────────────────────────────────
// A horizontal, snap-scrolling rail of curated quiz packs (best + trending +
// a mix of clubs — the caller curates, this just renders). Cards are cover-led:
// the art is the card, with a PLAY pill riding on it.

export interface CarouselPack {
  id: string;
  name: string;
  question_count: number;
  href: string;
  cover: string | null;
}

export function QuizCarousel({ packs }: { packs: CarouselPack[] }) {
  if (packs.length === 0) return null;
  return (
    <div
      className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x -mx-4 px-4"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
    >
      {packs.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          className="flex-shrink-0 snap-start rounded-2xl overflow-hidden transition-all duration-150 active:scale-[0.97]"
          style={{ width: 168, background: "#0e1611", border: "1px solid rgba(0,216,192,0.2)" }}
        >
          <div className="relative w-full" style={{ aspectRatio: "1 / 1", background: "#0b120d" }}>
            {p.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl(p.cover, 340) ?? p.cover}
                alt={p.name}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: "contain" }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-display text-3xl" style={{ color: "rgba(0,216,192,0.5)" }}>{p.name[0]}</span>
              </div>
            )}
          </div>
          <div className="px-3 pt-2 pb-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-body text-xs font-bold text-white leading-tight line-clamp-1">{p.name}</p>
              <p className="font-body text-[10px] mt-0.5" style={{ color: "#7a857f" }}>{p.question_count} questions</p>
            </div>
            <span
              className="flex-shrink-0 font-display text-[10px] tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: "#00d8c0", color: "#04231f" }}
            >
              PLAY
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Build a carousel href for a pack (club packs open their club hub). */
export function packHref(p: { name: string; type?: string | null }, challengeTo?: string | null): string {
  const base = p.type === "club" ? `/club/${slugify(p.name)}` : `/challenges/${slugify(p.name)}`;
  return challengeTo ? `${base}?challenge=${challengeTo}` : base;
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
