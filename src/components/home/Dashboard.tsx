"use client";

import { useEffect, useState } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import Image from "next/image";
import { BottomNav } from "@/components/ui/BottomNav";
import { slugify } from "@/lib/utils";
import { coverUrl } from "@/lib/img";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { getCompetitionBadgeUrlSync } from "@/lib/competitionImages";
import { usePendingFriends } from "@/hooks/usePendingFriends";
import { usePendingTurns } from "@/hooks/usePendingTurns";
import { DebateCard } from "@/components/debate/DebateCard";
import { GamedayCard } from "@/components/home/GamedayCard";
import { trackShare } from "@/lib/analytics/trackGame";
import { TodaysQuestionPreview } from "@/components/home/TodaysQuestionPreview";
import { SeasonSection } from "@/components/home/SeasonSection";
import type { TodaysGame, TodaysGameStats } from "@/lib/daily-game";

const LIME = "#aeea00";
const TEAL = "#00d8c0";
const GOLD = "#ffc233";

// ── Data contract ─────────────────────────────────────────────────────────────

export interface RankInfo {
  overall: number | null;
  score: number;
  knowledge: number;
  match: number;
  aheadName: string | null;
  aheadGap: number | null;
}

export interface WeekDot {
  label: string; // M T W T F S S
  played: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface RivalryInfo {
  live: boolean; // true = unfinished h2h challenge (expiry counts down), false = all-time record
  opponentId: string | null;
  opponentName: string;
  myScore: number | null; // live: challenge pts (null = not played yet) · record: my wins
  theirScore: number | null;
  expiresAt: string | null;
  packName: string | null;
}

export interface RecommendedPack {
  id: string;
  name: string;
  questionCount: number;
  cover: string | null;
}

export interface WcRunInfo {
  nation: string;
  stage: string;
  groupPoints: number;
}

export type PlayNextKind = "wc" | "lobby" | "draft";

export interface PlayNextInfo {
  kind: PlayNextKind;
  href: string;
  title: string;
  sub: string;
}

export interface LeaguePosition {
  id: string;
  name: string;
  myPos: number;
  total: number;
  myScore: number;
  gapAbove: number | null;
  aboveName: string | null;
}

export interface DashboardData {
  userId: string;
  displayName: string;
  rank: RankInfo;
  dayStreak: number;
  weekDots: WeekDot[];
  rivalry: RivalryInfo | null;
  recommended: RecommendedPack[];
  played38: boolean;
  wcRun: WcRunInfo | null;
  playNext: PlayNextInfo | null;
  openLobbies: number;
  leagues: LeaguePosition[];
  /** The single hero: today's featured game (Europe/London calendar day). */
  todaysGame: TodaysGame;
  /** null = not signed in / not yet checked; done=false = not played today. */
  todaysGameCompletion: { done: boolean; score: number | null } | null;
  /** The Gameday tile's fixture — a known supporter's round-1 fixture, else null
   *  (SeasonSection defaults to Arsenal v Coventry). */
  gamedayFixture: { home: string; away: string } | null;
  /** Server-computed so the bell + its dot render with the rest of the page —
   *  no client fetch, no pop-in. */
  unreadNotifications: boolean;
}

const DASH_ANIM = `
  @keyframes dashSlide { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes flameFlick { 0%,100% { transform: scale(1) rotate(-2deg); } 50% { transform: scale(1.12) rotate(2deg); } }
  .d-1 { animation: dashSlide 0.35s ease-out 0.04s both; }
  .d-2 { animation: dashSlide 0.35s ease-out 0.1s both; }
  .d-3 { animation: dashSlide 0.35s ease-out 0.16s both; }
  .d-4 { animation: dashSlide 0.35s ease-out 0.22s both; }
  .d-5 { animation: dashSlide 0.35s ease-out 0.28s both; }
  .flame { display: inline-block; animation: flameFlick 1.1s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .d-1,.d-2,.d-3,.d-4,.d-5 { animation: none; }
    .flame { animation: none; }
  }
`;

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ title, href, hrefLabel = "See all →" }: { title: string; href?: string; hrefLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <p className="font-body text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#8a948f" }}>{title}</p>
      {href && <Link href={href} className="font-body text-xs font-semibold" style={{ color: LIME }}>{hrefLabel}</Link>}
    </div>
  );
}

// ── 1. Compact progress card ──────────────────────────────────────────────────
// Streak, points and rank in one glance; the weekday dots show this week's
// play-days. All real data — a 0-day streak gets honest "start one" copy.

function ProgressCard({ rank, dayStreak, weekDots }: { rank: RankInfo; dayStreak: number; weekDots: WeekDot[] }) {
  return (
    <Link href="/profile" className="d-1 block rounded-2xl overflow-hidden transition-transform active:scale-[0.99]"
      style={{ background: "linear-gradient(160deg, rgba(174,234,0,0.07), #0e1611)", border: "1px solid rgba(174,234,0,0.22)" }}>
      <div className="px-4 pt-3.5 pb-3">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.24em] mb-2.5" style={{ color: GOLD }}>Your progress</p>

        <div className="flex items-stretch">
          {/* Streak — the zero state invites, never scolds: it's the first thing
              a signed-in player reads. */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="flame text-xl">🔥</span>
            <div className="min-w-0">
              <p className="font-display text-lg leading-none text-white whitespace-nowrap">
                {dayStreak > 0 ? `${dayStreak} DAY STREAK` : "START A STREAK"}
              </p>
              <p className="font-body text-[10px] mt-0.5" style={{ color: "#8a948f" }}>
                {dayStreak > 0 ? "Keep it going!" : "One game today does it"}
              </p>
            </div>
          </div>

          {/* Points */}
          <div className="px-3 text-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-lg leading-none text-white tabular-nums">{rank.score.toLocaleString()}</p>
            <p className="font-body text-[10px] mt-0.5 whitespace-nowrap" style={{ color: "#8a948f" }}>YourScore points</p>
          </div>

          {/* Rank */}
          <div className="pl-3 text-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-lg leading-none tabular-nums" style={{ color: LIME }}>
              {rank.overall !== null ? `#${rank.overall.toLocaleString()}` : "—"}
            </p>
            <p className="font-body text-[10px] mt-0.5 whitespace-nowrap" style={{ color: "#8a948f" }}>Global rank</p>
          </div>
        </div>

        {/* Weekday dots — filled = played that day (UK days) */}
        <div className="flex items-center gap-1.5 mt-3">
          {weekDots.map((d, i) => (
            <span key={i} className="flex items-center justify-center rounded-full font-body font-bold"
              style={{
                width: 22, height: 22, fontSize: 10,
                background: d.played ? LIME : "rgba(255,255,255,0.05)",
                color: d.played ? "#10160c" : d.isFuture ? "#3a423d" : "#586058",
                border: d.isToday ? `1.5px solid ${d.played ? LIME : "rgba(174,234,0,0.5)"}` : "1px solid rgba(255,255,255,0.06)",
                opacity: d.isFuture ? 0.55 : 1,
              }}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* Chase line — the sharpest reason to play right now */}
      {rank.aheadName && rank.aheadGap !== null && (
        <div className="px-4 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)" }}>
          <p className="font-body text-[11px]" style={{ color: "#8a948f" }}>
            <span className="text-white font-semibold">{rank.aheadGap.toLocaleString()} pts</span> behind{" "}
            <span className="text-white font-semibold">{rank.aheadName}</span> — catch them
          </p>
        </div>
      )}
    </Link>
  );
}


// ── 3. Today's Game — THE single hero ───────────────────────────────────────
// One featured game a day, same for everyone (see src/lib/daily-game.ts).
// Playable → full-width art/accent card, one tap into the real game. Already
// played today → a done state with the score + a share action, never a
// replay nudge (founder call: the day is over, don't beg for a repeat).

const GAME_ACCENT: Record<TodaysGame["gameType"], string> = {
  quiz: TEAL,
  "perfect-10": GOLD,
  "higher-lower": "#ff7800",
  "guess-the-player": "#4fc3f7",
};

// The game category, shown as an eyebrow above the title so a pack like
// "Iconic Managers" reads as a game you play, not a mystery. Only surfaced when
// it adds something: a quiz pack's title is the pack name, so "Quiz" is news;
// the other games' titles already ARE the type, so the label is suppressed
// there (see TodaysGamePlayable) to avoid saying it twice.
const GAME_TYPE_LABEL: Record<TodaysGame["gameType"], string> = {
  quiz: "Quiz",
  "perfect-10": "Perfect 10",
  "higher-lower": "Higher or Lower",
  "guess-the-player": "Guess the Player",
};

function TodaysGameDone({ game, score }: { game: TodaysGame; score: number | null }) {
  const [shared, setShared] = useState(false);
  const accent = GAME_ACCENT[game.gameType];

  async function handleShare() {
    trackShare("todays-game");
    const text = `I scored ${(score ?? 0).toLocaleString()} on today's ${game.title} on YourScore — can you beat it?`;
    const url = "https://yourscore.app";
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ text, url });
        return;
      } catch {
        // cancelled — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    } catch { /* ignore */ }
  }

  return (
    <div className="d-3">
      <SectionHead title="Today's game" />
      <div className="relative rounded-2xl overflow-hidden px-5 py-5"
        style={{ background: `linear-gradient(135deg, ${accent}26, #0c1613)`, border: `1px solid ${accent}40` }}>
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>Done for today</p>
        <p className="font-display text-2xl text-white leading-tight mt-1.5">{game.title}</p>
        <p className="font-display text-4xl mt-2" style={{ color: accent }}>{(score ?? 0).toLocaleString()}<span className="font-body text-sm ml-1.5" style={{ color: "#8a948f" }}>points</span></p>
        <button onClick={handleShare}
          className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl font-body text-sm font-semibold transition-all active:scale-95"
          style={{ background: `${accent}18`, color: shared ? accent : "#c4ccc6", border: `1px solid ${shared ? accent : "rgba(255,255,255,0.12)"}` }}>
          {shared ? "✓ Copied!" : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Share your score
            </>
          )}
        </button>
        <p className="font-body text-xs mt-3" style={{ color: "#8a948f" }}>Tomorrow&apos;s game lands at midnight — come back for the next one.</p>
      </div>
    </div>
  );
}

function StatCell({ value, label, accent, divider }: { value: string; label: string; accent: string; divider: boolean }) {
  return (
    <div className="flex-1 min-w-0 px-2 py-2.5 text-center"
      style={divider ? { borderLeft: "1px solid rgba(255,255,255,0.07)" } : undefined}>
      <p className="font-display text-lg leading-none tabular-nums" style={{ color: accent }}>{value}</p>
      {/* Wraps rather than truncates — "GOT THE HARDEST" clipped to
          "GOT THE HARDE…" at 390px, which reads as a rendering fault. */}
      <p className="font-body text-[9px] font-bold uppercase tracking-[0.12em] mt-1 leading-[1.25]" style={{ color: "#8a948f" }}>{label}</p>
    </div>
  );
}

// The stats half. Deliberately NOT the hardest question's text — that would
// spoil a question the player is one tap away from being asked. The number on
// its own is the hook: "only 9% got it" is a dare, the wording would be a leak.
function TodaysGameStatsStrip({ stats, accent }: { stats: TodaysGameStats; accent: string }) {
  if (stats.players === 0) {
    return (
      <div className="px-4 py-3 text-center" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.28)" }}>
        <p className="font-body text-[11px]" style={{ color: "#8a948f" }}>Nobody has played it yet. First score on the board is yours.</p>
      </div>
    );
  }
  return (
    <div className="flex items-stretch" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.28)" }}>
      <StatCell divider={false} accent={accent} value={stats.players.toLocaleString()} label={stats.players === 1 ? "player" : "players"} />
      <StatCell divider accent={accent} value={stats.avgScore !== null ? stats.avgScore.toLocaleString() : "—"} label="avg score" />
      <StatCell divider accent={accent} value={stats.hardestPct !== null ? `${stats.hardestPct}%` : "—"} label="got the hardest" />
    </div>
  );
}

function TodaysGamePlayable({ game }: { game: TodaysGame }) {
  const accent = GAME_ACCENT[game.gameType];
  const typeLabel = GAME_TYPE_LABEL[game.gameType];
  const isWcSeries = game.series === "wc2026";
  return (
    <div className="d-3">
      <SectionHead title="Today's game" />
      <Link href={game.href}
        className="block rounded-2xl overflow-hidden transition-transform active:scale-[0.99]"
        style={{ border: `1px solid ${accent}40`, background: "#0c1613" }}>
        {/* Top half — the cover art, with the game's identity over it. When the
            question card is shown below, this shrinks to sit snug against it: the
            146px art height left the lone title floating in dead space. */}
        <div className="relative" style={{ minHeight: game.firstQuestion ? 0 : 146 }}>
          {game.coverImage ? (
            // Covers are designed cards with the title baked into the TOP; here the
            // image is a backdrop (HTML title on the left), so crop from the bottom —
            // pure art, never a half-sliced baked title.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl(game.coverImage, 440) ?? game.coverImage} alt="" loading="eager" decoding="async" fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover object-bottom" />
          ) : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}40, #0c1613)` }} />
          )}
          {/* left-anchored scrim keeps the title readable on any art */}
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(6,10,8,0.92) 0%, rgba(6,10,8,0.55) 55%, rgba(6,10,8,0.15) 100%)" }} />
          <div className={`relative flex items-center gap-3 px-4 ${game.firstQuestion ? "py-3" : "py-4"}`} style={{ minHeight: game.firstQuestion ? 0 : 146 }}>
            <div className="flex-1 min-w-0">
              {/* Game category. The WC series badge already says "quiz series",
                  so it wins; otherwise show the plain type, but only when it
                  isn't just repeating the title (a fixed game like Higher or
                  Lower is its own title). */}
              {isWcSeries ? (
                <span className="inline-block font-body text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1 rounded-md mb-1.5"
                  style={{ background: "rgba(255,194,51,0.16)", color: GOLD, border: `1px solid ${GOLD}55` }}>
                  World Cup quiz series
                </span>
              ) : typeLabel && typeLabel !== game.title ? (
                <span className="inline-block font-body text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1 rounded-md mb-1.5"
                  style={{ background: `${accent}1f`, color: accent, border: `1px solid ${accent}66` }}>
                  {typeLabel}
                </span>
              ) : null}
              <p className="font-display text-2xl text-white leading-tight" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.6)" }}>{game.title}</p>
              {/* The question card below is the explanation — drop the redundant
                  "what it is" sub when it's shown (founder 2026-07-24). */}
              {!game.firstQuestion && (
                <p className="font-body text-xs mt-1" style={{ color: "#c4ccc6" }}>{game.sub}</p>
              )}
            </div>
            {/* A named CTA, not a bare arrow: "PLAY NOW" reads as an action, so
                the tile is obviously a game you start (founder 2026-07-25). */}
            <span className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full font-display text-sm tracking-wide px-4 py-2"
              style={{ background: accent, color: "#04231f" }}>
              PLAY NOW
              <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
                <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>

        {/* Today's actual question 1, when the format has one that's safe to
            show before anyone answers (Higher or Lower). */}
        {game.firstQuestion && (
          <TodaysQuestionPreview question={game.firstQuestion} accent={accent} compact />
        )}

        {/* Bottom half — how everyone else has done on it */}
        {game.stats && <TodaysGameStatsStrip stats={game.stats} accent={accent} />}
      </Link>
    </div>
  );
}

function TodaysGameHero({ game, completion }: { game: TodaysGame; completion: { done: boolean; score: number | null } | null }) {
  if (completion?.done) return <TodaysGameDone game={game} score={completion.score} />;
  return <TodaysGamePlayable game={game} />;
}

// ── 4. Behaviour-based discovery rail ─────────────────────────────────────────
// Compact three-up tiles of packs they haven't played. Label is honest about
// the signal: 38-0 players get "Because you played 38-0", everyone else
// "Picked for you".

function DiscoveryRail({ packs, played38 }: { packs: RecommendedPack[]; played38: boolean }) {
  if (packs.length === 0) return null;
  return (
    <div className="d-4">
      <SectionHead title={played38 ? "Because you played 38-0" : "Picked for you"} href="/play" />
      <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
        {packs.map((p) => {
          // Packs without a cover show a real badge instead of a bare letter:
          // a club crest for club packs, a competition badge for records packs
          // ("Champions League Records · ...", "Premier League Records · ...").
          // Both are local /badges/*.png (founder call: crests are fine to use).
          const seg = p.name.split(" ·")[0];
          const crest = p.cover ? null : (getTeamBadgeUrlSync(seg) ?? getCompetitionBadgeUrlSync(seg));
          return (
          <Link key={p.id} href={`/challenges/${slugify(p.name)}`}
            className="flex-shrink-0 rounded-xl overflow-hidden flex flex-col transition-transform active:scale-[0.98]"
            style={{ width: 118, background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Square — matches the designed covers' own aspect so they show whole */}
            <div className="relative" style={{ width: "100%", aspectRatio: "1 / 1" }}>
              {p.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl(p.cover, 118) ?? p.cover} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              ) : crest ? (
                <div className="absolute inset-0 flex items-center justify-center"
                  style={{ background: "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.1), #0b1310 75%)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={crest} alt={p.name} width={84} height={84}
                    style={{ objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" }} />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center font-display text-2xl"
                  style={{ background: "rgba(0,216,192,0.1)", color: TEAL }}>
                  {p.name[0]?.toUpperCase() ?? "Q"}
                </div>
              )}
            </div>
            <div className="p-2 flex flex-col flex-1">
              <p className="font-body text-[11px] font-bold text-white leading-snug line-clamp-2">{p.name}</p>
              <p className="font-body text-[10px] mt-auto pt-1" style={{ color: "#8a948f" }}>{p.questionCount} Qs</p>
            </div>
          </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── 5. Compact mode tiles — Quiz / 38-0 / Mastermind in one row ───────────────

const MODE_TILES = [
  { href: "/38-0", label: "38-0", sub: "Draft XI", accent: LIME, rgba: "174,234,0" },
  { href: "/play", label: "QUIZZES", sub: "Fast Qs", accent: TEAL, rgba: "0,216,192" },
  { href: "/38-0/wc", label: "MASTERMIND", sub: "Daily · £100", accent: GOLD, rgba: "255,194,51" },
];

function ModeTiles() {
  return (
    <div className="d-5 grid grid-cols-3 gap-2.5">
      {MODE_TILES.map((t) => (
        <Link key={t.href} href={t.href}
          className="rounded-xl px-2 py-3 text-center transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(160deg, rgba(${t.rgba},0.13), #0c1410)`, border: `1px solid rgba(${t.rgba},0.3)` }}>
          <p className="font-display text-[15px] leading-none text-white tracking-wide">{t.label}</p>
          <p className="font-body text-[10px] mt-1" style={{ color: t.accent }}>{t.sub}</p>
        </Link>
      ))}
    </div>
  );
}

// ── 38-0 promo tile — sits under Today's debate on the app home only (not the
//    marketing web homepage). Sells the viral team-builder, one tap into a game.
//    Decorative pitch graphic shows the XI you draft (4-3-3), lime on turf.

// A mini pitch with the eleven laid out in a 4-3-3 — the thing you build in 38-0.
function PitchGraphic() {
  const dots = [
    { x: 60, y: 120 },                                             // GK
    { x: 16, y: 92 }, { x: 45, y: 96 }, { x: 75, y: 96 }, { x: 104, y: 92 }, // DEF
    { x: 30, y: 62 }, { x: 60, y: 66 }, { x: 90, y: 62 },          // MID
    { x: 24, y: 30 }, { x: 60, y: 24 }, { x: 96, y: 30 },          // FWD
  ];
  return (
    <svg viewBox="0 0 120 138" className="absolute right-0 top-0 h-full w-auto pointer-events-none"
      style={{ opacity: 0.9 }} aria-hidden="true">
      <defs>
        <radialGradient id="p38-turf" cx="70%" cy="0%" r="90%">
          <stop offset="0%" stopColor="#aeea00" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#0c1410" stopOpacity="0" />
        </radialGradient>
        <filter id="p38-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="0" y="0" width="120" height="138" fill="url(#p38-turf)" />
      {/* pitch markings */}
      <g stroke="#aeea00" strokeOpacity="0.28" strokeWidth="1" fill="none">
        <rect x="8" y="6" width="104" height="126" rx="4" />
        <line x1="8" y1="69" x2="112" y2="69" />
        <circle cx="60" cy="69" r="16" />
        <rect x="36" y="6" width="48" height="20" />
        <rect x="36" y="112" width="48" height="20" />
      </g>
      {/* the eleven */}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="4.5" fill="#aeea00"
          filter="url(#p38-glow)" stroke="#0a0a0f" strokeWidth="0.75" />
      ))}
    </svg>
  );
}

function Play38Tile() {
  return (
    <Link
      href="/38-0"
      className="d-4 relative block overflow-hidden rounded-2xl px-5 py-4 transition-transform active:scale-[0.99]"
      style={{
        background: `linear-gradient(115deg, rgba(174,234,0,0.18), #0c1410 62%)`,
        border: `1px solid rgba(174,234,0,0.32)`,
      }}
    >
      {/* corner glow + pitch on the right, content sits over a scrim so it stays legible */}
      <div className="absolute top-0 right-0 w-[200px] h-[200px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.16) 0%, transparent 60%)" }} />
      <PitchGraphic />
      <div className="absolute inset-y-0 left-0 w-3/4 pointer-events-none"
        style={{ background: "linear-gradient(90deg, #0c1410 55%, transparent)" }} />

      <div className="relative flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-body text-[9px] font-bold uppercase tracking-[0.22em] px-2 py-0.5 rounded-full"
              style={{ color: "#0a0a0f", background: LIME }}>
              The viral game
            </span>
            {/* the perfect scoreline, as a little scoreboard chip */}
            <span className="font-display text-[11px] tracking-[0.14em] px-2 py-0.5 rounded"
              style={{ color: LIME, border: "1px solid rgba(174,234,0,0.4)", background: "rgba(174,234,0,0.08)" }}>
              38&ndash;0
            </span>
          </div>
          <p className="font-display text-[26px] leading-none text-white tracking-wide">Build your XI</p>
          <p className="font-body text-xs text-text-muted mt-1.5 leading-snug">
            Draft the perfect team, chase a flawless 38&ndash;0 season, and see how you rank.
          </p>
          <span className="inline-flex items-center gap-1.5 mt-3 rounded-xl px-4 py-2 font-display text-sm tracking-wide"
            style={{ background: LIME, color: "#0a0a0f" }}>
            PLAY 38&ndash;0 →
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Notices (unchanged behavior) ──────────────────────────────────────────────

function PendingFriendsNotice() {
  const count = usePendingFriends();
  if (!count) return null;
  return (
    <Link
      href="/friends"
      className="flex items-center justify-between px-4 py-3 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)" }}
    >
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#ef4444" }} />
        <p className="font-body text-sm font-semibold text-white">
          {count === 1 ? "1 friend request waiting" : `${count} friend requests waiting`}
        </p>
      </div>
      <span className="font-body text-xs font-bold" style={{ color: "#f87171" }}>View →</span>
    </Link>
  );
}

function PendingTurnsNotice() {
  const count = usePendingTurns();
  if (!count) return null;
  return (
    <Link
      href="/versus"
      className="flex items-center justify-between px-4 py-3 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
      style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.25)" }}
    >
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: TEAL }} />
        <p className="font-body text-sm font-semibold text-white">
          {count === 1 ? "It's your turn in 1 battle" : `It's your turn in ${count} battles`}
        </p>
      </div>
      <span className="font-body text-xs font-bold" style={{ color: TEAL }}>Play →</span>
    </Link>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export function Dashboard({ data }: { data: DashboardData }) {
  const { displayName, rank, dayStreak, weekDots, recommended, played38, openLobbies, leagues, todaysGame, todaysGameCompletion, gamedayFixture, unreadNotifications } = data;

  // Don't recommend the pack that's already the hero.
  const rail = recommended.filter((p) => p.id !== todaysGame.packId).slice(0, 5);

  // Deep-link from a daily push: /?focus=today|debate scrolls that home card
  // into view so a tap lands the player right on the game / debate to act on.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    const id = focus === "debate" ? "todays-debate" : focus === "today" ? "todays-game" : null;
    if (!id) return;
    // Small delay lets the hero + cards lay out before we scroll (avoids landing
    // short when images above shift the layout in).
    const t = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <style>{DASH_ANIM}</style>
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 right-0 w-[350px] h-[350px] pointer-events-none" style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.08) 0%, transparent 60%)" }} />

      {/* Nav */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <Image src="/logo.png" alt="YourScore" width={95} height={28} priority style={{ height: 28, width: "auto" }} />
          <div className="flex items-center gap-3">
            <Link href="/notifications" aria-label="Notifications" className="relative w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
              style={{ background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.1)" }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#eef2f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unreadNotifications && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: LIME, boxShadow: "0 0 0 1.5px #0a0a0f" }} />
              )}
            </Link>
            <Link href="/profile" className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm transition-opacity hover:opacity-80"
              style={{ background: "linear-gradient(135deg, #1a2f4a, #3a423d)", color: LIME, border: "1.5px solid rgba(174,234,0,0.25)" }}>
              {(displayName || "?")[0].toUpperCase()}
            </Link>
          </div>
        </nav>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4 pt-4">

        {/* 1. Progress at a glance */}
        <ProgressCard rank={rank} dayStreak={dayStreak} weekDots={weekDots} />

        {/* Anything waiting on you comes before discovery */}
        <PendingTurnsNotice />
        <PendingFriendsNotice />

        {/* Live/upcoming halftime pack — self-hides off-matchday */}
        <GamedayCard />

        {/* 2. Get set for the season — Fantasy + Gameday Quiz (replaced Rivalries,
              founder 2026-07-25). */}
        <SeasonSection className="d-2" fixture={gamedayFixture} />

        {/* 3. Today's Game — THE single hero, playable or done+share. The
            onboarding tour's final step points here (data-tour). */}
        <div id="todays-game" data-tour="todays-game"><TodaysGameHero game={todaysGame} completion={todaysGameCompletion} /></div>

        {/* Today's debate — one tap, daily habit (moved here from Versus) */}
        <div id="todays-debate" className="d-4">
          <DebateCard signInNext="/" withSignUpPitch={false} />
        </div>

        {/* 38-0 promo — under the debate, app home only (not MarketingLanding) */}
        <Play38Tile />

        {/* 4. Behaviour-based discovery */}
        <DiscoveryRail packs={rail} played38={played38} />

        {/* 5. Compact mode entries */}
        <ModeTiles />

        {/* Open lobbies nudge */}
        {openLobbies > 0 && (
          <Link href="/play" className="flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all hover:opacity-90 active:scale-[0.99]"
            style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.22)" }}>
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: TEAL }} />
              <p className="font-body text-sm font-semibold text-white">
                {openLobbies === 1 ? "1 open lobby" : `${openLobbies} open lobbies`} waiting for players
              </p>
            </div>
            <span className="font-display text-sm tracking-wide" style={{ color: TEAL }}>JOIN →</span>
          </Link>
        )}

        {/* Your leagues */}
        <div>
          <SectionHead title="Your leagues" href="/leagues" hrefLabel="All →" />
          {leagues.length === 0 ? (
            <Link href="/leagues" className="block rounded-2xl px-5 py-5 text-center transition-all hover:opacity-90 active:scale-[0.99]"
              style={{ background: "rgba(174,234,0,0.06)", border: "1px dashed rgba(174,234,0,0.3)" }}>
              <p className="font-display text-lg text-white">Start a league with your friends</p>
              <p className="font-body text-xs text-text-muted mt-1">Compete on a private board all season →</p>
            </Link>
          ) : (
            <div className="space-y-2.5">
              {leagues.map((lg) => {
                const top = lg.myPos === 1;
                return (
                  <Link key={lg.id} href={`/league/${lg.id}`}
                    className="flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all hover:opacity-90 active:scale-[0.99] bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="flex flex-col items-center justify-center flex-shrink-0" style={{ width: 44 }}>
                      <span className="font-display leading-none" style={{ fontSize: 24, color: top ? GOLD : LIME }}>
                        {top ? "🥇" : `#${lg.myPos}`}
                      </span>
                      <span className="font-body text-[10px] text-text-muted mt-0.5">of {lg.total}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-bold text-white truncate">{lg.name}</p>
                      <p className="font-body text-xs text-text-muted truncate">
                        {top
                          ? `Leading · ${lg.myScore.toLocaleString()} pts`
                          : lg.gapAbove !== null && lg.aboveName
                          ? `${lg.gapAbove.toLocaleString()} pts behind ${lg.aboveName}`
                          : `${lg.myScore.toLocaleString()} pts`}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: "#8a948f", flexShrink: 0 }}>
                      <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
