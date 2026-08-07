"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import Image from "next/image";
import { BottomNav } from "@/components/ui/BottomNav";
import { coverUrl } from "@/lib/img";
import { usePendingFriends } from "@/hooks/usePendingFriends";
import { usePendingTurns } from "@/hooks/usePendingTurns";
import { useUser } from "@/hooks/useUser";
import { DebateCard } from "@/components/debate/DebateCard";
import { GamedayCard } from "@/components/home/GamedayCard";
import { trackShare } from "@/lib/analytics/trackGame";
import { TodaysQuestionPreview } from "@/components/home/TodaysQuestionPreview";
import { SeasonSection } from "@/components/home/SeasonSection";
import { BriefingTile } from "@/components/matchweek/BriefingTile";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { PlBriefing } from "@/lib/pl/briefing";
import type { TodaysGame, TodaysGameStats } from "@/lib/daily-game";

// FeedStream is a heavy client component (long feed, media, comment threads) —
// loaded on demand so Home's first paint never pays for it (founder brief
// 2026-08-07: Home is read-first, the Feed is the last thing on the page).
const FeedStream = dynamic(
  () => import("@/components/fantasy/FeedStream").then((m) => m.FeedStream),
  { ssr: false, loading: () => null }
);

// CreatePostSheet is the composer — same reasoning as FeedStream above, it
// only loads once someone opens the Feed tab and taps the composer pill.
const CreatePostSheet = dynamic(
  () => import("@/components/fantasy/CreatePostSheet").then((m) => m.CreatePostSheet),
  { ssr: false, loading: () => null }
);

const LIME = "#aeea00";
const TEAL = "#00d8c0";
const GOLD = "#ffc233";
const PANEL = "#0e1611";
const LINE = "rgba(255,255,255,0.07)";
const MUTED = "#8a948f";
const SIGN_IN = "/auth/sign-in?next=/";

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

export interface DashboardData {
  userId: string;
  displayName: string;
  rank: RankInfo;
  dayStreak: number;
  weekDots: WeekDot[];
  rivalry: RivalryInfo | null;
  wcRun: WcRunInfo | null;
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

// ── News — "The latest": the daily briefing tile, reused from the Matchweek
// PL news feed (src/components/matchweek/PlNews.tsx). Fetches its own data so
// Home doesn't need a server round trip for it; self-hides while loading and
// on failure, same idiom as GamedayCard off-matchday.

function NewsSection() {
  const [briefing, setBriefing] = useState<PlBriefing | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/pl/briefing")
      .then((r) => r.json())
      .then((j) => { if (live) setBriefing(j.doc ?? null); })
      .catch(() => { /* no tile — home stands on its own */ });
    return () => { live = false; };
  }, []);

  if (!briefing) return null;
  return (
    <div className="d-4">
      <SectionHead title="The latest" href="/matchweek" hrefLabel="More →" />
      <BriefingTile briefing={briefing} now={Date.now()} />
    </div>
  );
}

// ── Feed — "Around the game": the fantasy activity feed, controlled scope.
// A small For You / Following toggle sits above it (matches the app's
// segmented-control idiom); the feed itself carries no chrome of its own
// (chrome={false}) since this toggle replaces it. Read-first — no composer
// mounted here, posting stays on the feed's own surfaces.

type FeedTab = "global" | "following";
type FeedSort = "top" | "recent";

function FeedToggle({ tab, onChange }: { tab: FeedTab; onChange: (t: FeedTab) => void }) {
  const opts: { id: FeedTab; label: string }[] = [
    { id: "global", label: "For You" },
    { id: "following", label: "Following" },
  ];
  return (
    <div className="inline-flex items-center gap-1 mb-3 p-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
      {opts.map((o) => {
        const active = tab === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className="font-display text-[13px] tracking-wide px-3.5 py-1.5 rounded-full transition-colors"
            style={{ background: active ? TEAL : "transparent", color: active ? "#04231f" : "#8a948f" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── League highlight ─────────────────────────────────────────────────────────
// Home shows a league ONLY when something real is happening in one (founder
// 2026-08-07 eve). One card max: the league with the most unread chat, else a
// join within the last day. Quiet leagues render nothing — the Leagues tab is
// where the full list lives. 401s (guest) and errors self-hide.

interface LeagueHighlightRow {
  id: string;
  name: string;
  code: string;
  unread: number;
  highlight?: { tone: string; author: string | null; text: string; at: string | null } | null;
}

function LeagueHighlightCard() {
  const [pick, setPick] = useState<LeagueHighlightRow | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!live || !j?.leagues) return;
        const rows = j.leagues as LeagueHighlightRow[];
        const unread = rows.filter((l) => l.unread > 0).sort((a, b) => b.unread - a.unread)[0];
        if (unread) { setPick(unread); return; }
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const fresh = rows.find(
          (l) => l.highlight && (l.highlight.tone === "join" || l.highlight.tone === "chat") &&
            l.highlight.at && Date.parse(l.highlight.at) > dayAgo
        );
        if (fresh) setPick(fresh);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!pick) return null;
  const line = pick.unread > 0
    ? `${pick.unread} new message${pick.unread === 1 ? "" : "s"}`
    : pick.highlight
    ? `${pick.highlight.author ? `${pick.highlight.author}: ` : ""}${pick.highlight.text}`
    : "";
  return (
    <div>
      <SectionHead title="Your leagues" href="/fantasy/leagues" hrefLabel="All →" />
      <Link
        href={`/fantasy/leagues/${pick.code}`}
        className="flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all hover:opacity-90 active:scale-[0.99]"
        style={{ background: "rgba(255,194,51,0.07)", border: "1px solid rgba(255,194,51,0.25)" }}
      >
        <span
          className="flex items-center justify-center flex-shrink-0 rounded-xl"
          style={{ width: 40, height: 40, background: "rgba(255,194,51,0.12)", border: "1px solid rgba(255,194,51,0.3)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.5 8.5 0 01-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1121 11.5z" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm font-bold text-white truncate">{pick.name}</p>
          <p className="font-body text-xs truncate" style={{ color: "#c9a43f" }}>{line}</p>
        </div>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: GOLD, flexShrink: 0 }}>
          <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}

function FeedSection() {
  const router = useRouter();
  const { user } = useUser();
  const [tab, setTab] = useState<FeedTab>("global");
  const [sort, setSort] = useState<FeedSort>("top");
  // The composer + a key that reloads For You after a new post lands (same
  // pattern as SocialHome's liveKey).
  const [composeOpen, setComposeOpen] = useState(false);
  const [liveKey, setLiveKey] = useState(0);

  return (
    <div className="d-5">
      <SectionHead title="Around the game" />

      {/* Composer entry point — write a post to the public feed. Home only
          renders this signed in, but keep the sign-in guard for the rare case
          the session drops out from under the tab. */}
      <button onClick={() => (user ? setComposeOpen(true) : router.push(SIGN_IN))} style={{
        width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
        padding: "9px 12px", borderRadius: 999, background: PANEL, border: `1px solid ${LINE}`, marginBottom: 12,
      }}>
        <PlayerAvatar
          name={user?.user_metadata?.display_name ?? "You"}
          avatarUrl={user?.user_metadata?.avatar_url ?? null}
          size={30}
        />
        <span style={{ fontSize: 13.5, color: MUTED }}>What&apos;s happening?</span>
      </button>

      <FeedToggle tab={tab} onChange={setTab} />

      {/* Sort the open feed by engagement (Top) or newest (Latest). Following
          stays newest-first — same split as SocialHome. */}
      {tab === "global" && (
        <div className="flex items-center justify-end gap-1 mb-3">
          {([["top", "Top"], ["recent", "Latest"]] as [FeedSort, string][]).map(([s, label]) => {
            const active = sort === s;
            return (
              <button key={s} onClick={() => setSort(s)} style={{
                padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: active ? "rgba(0,216,192,0.14)" : "transparent", color: active ? TEAL : MUTED,
                border: `1px solid ${active ? "rgba(0,216,192,0.55)" : LINE}`,
              }}>{label}</button>
            );
          })}
        </div>
      )}

      <FeedStream key={tab === "global" ? liveKey : "following"} embedded chrome={false} controlledScope={tab}
        controlledSort={tab === "global" ? sort : "recent"} signInNext="/" />

      <CreatePostSheet open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPosted={() => setLiveKey((k) => k + 1)} />
    </div>
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
  const { displayName, rank, dayStreak, weekDots, todaysGame, todaysGameCompletion, gamedayFixture, unreadNotifications } = data;

  // Home has two views (founder 2026-08-07 night): Today — the football-
  // happening modules — and Feed, which gives AROUND THE GAME its own tab
  // instead of the bottom of one long page. Mirrored to ?view=feed so back
  // and deep links retrace to the right view.
  const [view, setView] = useState<"today" | "feed">("today");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "feed") setView("feed");
  }, []);
  const selectView = (v: "today" | "feed") => {
    setView(v);
    const u = new URL(window.location.href);
    if (v === "feed") u.searchParams.set("view", "feed");
    else u.searchParams.delete("view");
    window.history.replaceState(null, "", u);
  };

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
            <Link href="/notifications" aria-label={unreadNotifications ? "Notifications, unread" : "Notifications"} className="relative w-9 h-9 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
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
        {/* Home view switch — Today (football happening) | Feed (around the
            game, promoted off the bottom of the page: founder 2026-08-07). */}
        <div className="max-w-lg mx-auto px-5 pb-3">
          <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)" }}>
            {([["today", "Today"], ["feed", "Feed"]] as const).map(([k, label]) => {
              const on = view === k;
              return (
                <button
                  key={k}
                  onClick={() => selectView(k)}
                  aria-current={on ? "page" : undefined}
                  className="flex-1 font-display text-sm py-2 rounded-xl transition-colors"
                  style={{ background: on ? LIME : "transparent", color: on ? "#10160c" : "#8a948f", letterSpacing: "0.02em" }}
                >
                  {label.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {view === "today" ? (
        <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4 pt-4">

          {/* 1. Progress at a glance */}
          <ProgressCard rank={rank} dayStreak={dayStreak} weekDots={weekDots} />

          {/* Anything waiting on you comes before what's happening today */}
          <PendingTurnsNotice />
          <PendingFriendsNotice />

          {/* 2. What's happening today — live/upcoming halftime pack (self-hides
              off-matchday) + the season section, under one small label. */}
          <div className="d-2">
            <SectionHead title="Today" />
            <div className="space-y-4">
              <GamedayCard />
              <SeasonSection fixture={gamedayFixture} />
            </div>
          </div>

          {/* 3. Today's Game — THE single hero, playable or done+share. The
              onboarding tour's final step points here (data-tour). */}
          <div id="todays-game" data-tour="todays-game"><TodaysGameHero game={todaysGame} completion={todaysGameCompletion} /></div>

          {/* News — the daily briefing, reused from Matchweek */}
          <NewsSection />

          {/* Today's debate — one tap, daily habit (moved here from Versus) */}
          <div id="todays-debate" className="d-4">
            <DebateCard signInNext="/" withSignUpPitch={false} />
          </div>

          {/* League highlight — leagues live in their own tab now (founder
              2026-08-07 eve: "not on the home screen unless there's a major
              highlight"). This renders at most ONE card, and only when a
              league has something genuinely new: unread chat or a fresh join. */}
          <LeagueHighlightCard />

        </div>
      ) : (
        <div className="relative z-0 max-w-lg mx-auto px-5 pt-4">
          {/* The Feed view — AROUND THE GAME, full height. FeedStream only
              mounts when this tab opens (dynamic import), so the Today view
              never pays for it. */}
          <FeedSection />
        </div>
      )}
      <BottomNav />
    </main>
  );
}
