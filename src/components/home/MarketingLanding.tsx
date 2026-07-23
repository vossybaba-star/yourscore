"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import Image from "next/image";
import { FlagImage } from "@/components/ui/FlagImage";
import { getPlayerCutoutUrl } from "@/lib/playerImages";
import { BottomNav } from "@/components/ui/BottomNav";
import { DownloadAppButton } from "@/components/app/DownloadAppButton";
import { GAMES } from "@/components/ui/GameSwitcher";
import { GAME_VISUALS } from "@/components/games/GameVisuals";
import { coverUrl } from "@/lib/img";
import type { TodaysGame } from "@/lib/daily-game";

export interface LiveMatch {
  id: string;
  home_team: string;
  away_team: string;
  match_date: string;
  tournament: string;
  status: string;
  home_score: number;
  away_score: number;
}

// Premier League 2026/27 GW1 kick-off. Same date the halftime quiz packs go
// live, so one countdown covers both promises on this page.
const SEASON_START = new Date("2026-08-21T18:30:00Z");

// ── Animations ────────────────────────────────────────────────────────────────

const ANIM_CSS = `
  @keyframes floatCard {
    0%, 100% { transform: translateY(0px) rotate(-1deg); }
    50% { transform: translateY(-10px) rotate(-1deg); }
  }
  @keyframes floatCard2 {
    0%, 100% { transform: translateY(0px) rotate(0.5deg); }
    50% { transform: translateY(-6px) rotate(0.5deg); }
  }
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 28px rgba(174,234,0,0.35), 0 0 60px rgba(174,234,0,0.12); }
    50% { box-shadow: 0 0 40px rgba(174,234,0,0.55), 0 0 80px rgba(174,234,0,0.2); }
  }
  @keyframes scoreUp {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes greenPulse {
    0%, 100% { box-shadow: 0 0 20px rgba(174,234,0,0.3); }
    50% { box-shadow: 0 0 35px rgba(174,234,0,0.55); }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  .float-card { animation: floatCard 5s ease-in-out infinite; }
  .float-card-2 { animation: floatCard2 6s ease-in-out infinite 1s; }
  .pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
  .green-pulse { animation: greenPulse 3s ease-in-out infinite; }
  .score-in { animation: scoreUp 0.4s ease-out forwards; }
`;

// ── Season countdown ─────────────────────────────────────────────────────────
// Counts to Premier League GW1. Replaces the World Cup countdown, which passed
// zero on 11 Jun and had been rendering "THE CUP IS LIVE" ever since, including
// the four days after the final. Past kick-off this one says the season is on,
// which stays true for nine months rather than going stale the same week.

function SeasonCountdown() {
  const [diff, setDiff] = useState<number | null>(null);

  useEffect(() => {
    setDiff(SEASON_START.getTime() - Date.now());
    const iv = setInterval(() => setDiff(SEASON_START.getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (diff === null) return null;
  if (diff <= 0) return <span className="font-display text-3xl text-green">THE SEASON IS ON</span>;

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);

  return (
    <div className="flex items-end justify-center gap-4 sm:gap-6">
      {[{ v: days, l: "days" }, { v: hours, l: "hrs" }, { v: mins, l: "min" }, { v: secs, l: "sec" }].map(({ v, l }) => (
        <div key={l} className="text-center">
          <p className="font-display text-4xl sm:text-5xl text-white leading-none tabular-nums">{String(v).padStart(2, "0")}</p>
          <p className="font-body text-xs text-text-muted mt-1 uppercase tracking-widest">{l}</p>
        </div>
      ))}
    </div>
  );
}

// ── Animated league card (hero visual) ───────────────────────────────────────

const LEAGUE_PLAYERS = [
  { name: "Marcus", flag: "🇧🇷", pts: 2840, streak: 4, acc: 91 },
  { name: "Priya",  flag: "🇮🇳", pts: 2720, streak: 2, acc: 87 },
  { name: "Jamie",  flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", pts: 2650, streak: 0, acc: 83 },
  { name: "Zach",   flag: "🇳🇬", pts: 2590, streak: 1, acc: 80 },
];

const PALETTES = [
  { bg: "#1a2f4a", text: "#60a5fa" },
  { bg: "#3a423d", text: "#aeea00" },
  { bg: "#1a4a2a", text: "#4ade80" },
  { bg: "#4a2a1a", text: "#fb923c" },
];

// ── Games hero card ──────────────────────────────────────────────────────────
// The signed-out hero's visual: what feeds your score, one row lighting up at a
// time in its own accent, same animated-card idiom as LeagueHeroCard below it.
// The list is imported from GameSwitcher (the nav's own source), never retyped
// here, so the marketing page cannot describe a game the app doesn't have.
//
// Deliberately NOT framed as a count. Fantasy and the gameday quizzes become
// rows here when they land on 21 Aug, and nothing above them has to change.

function GamesHeroCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 2400);
    return () => clearInterval(iv);
  }, []);

  const lit = tick % GAMES.length;

  return (
    <div className="float-card w-full max-w-[340px] bg-surface"
      style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, overflow: "hidden", boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(174,234,0,0.08)" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(174,234,0,0.04)" }}>
        <div>
          <p className="font-body text-xs font-semibold text-white">What feeds your score</p>
          <p className="font-body text-xs text-text-muted">Free, no account needed</p>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)" }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#aeea00" }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#aeea00" }} />
          </span>
          <span className="font-body text-xs font-semibold text-green">Play now</span>
        </div>
      </div>

      {/* One row per game; the lit one takes its own accent. */}
      {GAMES.map(({ key, href, label, color, Icon, blurb }, i) => {
        const isLit = i === lit;
        return (
          <Link key={key} href={href}
            className="flex items-center gap-3 px-4 py-3 transition-all"
            style={{
              background: isLit ? `${color}14` : i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
              borderBottom: i < GAMES.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              borderLeft: `2px solid ${isLit ? color : "transparent"}`,
              textDecoration: "none",
            }}>
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
              style={{ background: isLit ? `${color}26` : "rgba(255,255,255,0.04)", color: isLit ? color : "#586058" }}>
              <Icon active={isLit} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-medium transition-colors" style={{ color: isLit ? "#fff" : "#c4ccc6" }}>{label}</p>
              <p className="font-body text-xs truncate" style={{ color: "#586058" }}>{blurb}</p>
            </div>
            <span className="font-body text-xs font-semibold flex-shrink-0 transition-opacity"
              style={{ color, opacity: isLit ? 1 : 0 }}>Play →</span>
          </Link>
        );
      })}

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
        <span className="font-body text-xs text-text-muted">It all adds up to one rank</span>
        <span className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>See them all →</span>
      </div>
    </div>
  );
}

// ── Games explainer ──────────────────────────────────────────────────────────
// One tab per game, each explaining that game on its own terms. Replaces the
// old numbered "HOW IT WORKS" steps, which walked through the 38-0 arc and so
// described one game as though it were the whole app.
//
// Keyed off GAMES so a new game gets a tab automatically; a key with no entry
// here falls back to its GAMES blurb rather than rendering an empty panel.
// Every line below is drawn from the game's own code, not from imagination:
// round sizes from ROUND_SIZE, speed bands from GAME_WINDOW_MS, the Perfect 10
// strike limit from MAX_STRIKES, the Higher or Lower topics from HL_TOPICS.

const GAME_DETAIL: Record<string, { headline: string; points: string[] }> = {
  quiz: {
    headline: "Football questions, on the clock",
    points: [
      "Packs of 15 or 20 across clubs, competitions and eras",
      "Answer inside 6 seconds for double points, inside 12 for one and a half",
      "Back to back correct answers build a streak bonus",
      "Every pack keeps its own leaderboard",
    ],
  },
  draft: {
    headline: "Draft an XI and go unbeaten",
    points: [
      "Spin for real rated players and build your best eleven",
      "Put it up against the world head to head",
      "Win and swap a player, lose and go again",
      "The target is 38 games without a defeat",
    ],
  },
  perfect10: {
    headline: "Name a ranked top ten",
    points: [
      "Ten rungs, one list, from all time scorers to club records",
      "Type a name and it climbs to the rung it belongs on",
      "Three strikes and the run ends",
      "Stuck on one? Take a hint and score less for it",
    ],
  },
  "higher-lower": {
    headline: "Two players, one stat",
    points: [
      "Ten rounds, pick whoever has the bigger number",
      "Choose the stat: goals, assists, appearances and more",
      "Same position only, so a keeper is never up against a striker",
      "25 seconds a question, and faster is worth more",
    ],
  },
  "guess-the-player": {
    headline: "Name the mystery footballer",
    points: [
      "Clues arrive one at a time: nationality, shirt number, career path",
      "Ten a round, and the sooner you call it the more it scores",
      "Fresh players every time you play",
    ],
  },
};

function GamesExplainer() {
  const [active, setActive] = useState(0);
  const game = GAMES[active];
  const detail = GAME_DETAIL[game.key];
  const { color, Icon, label, href, blurb } = game;
  // Perfect 10 / Higher or Lower / Guess the Player each have a mock-screen
  // graphic (shared with the /games page); Quiz and 38-0 do not, and stay
  // bullets-only. undefined for those two, so the panel just skips the picture.
  const visual = GAME_VISUALS[game.key];

  return (
    <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
      <div className="text-center mb-8">
        <h2 className="font-display text-5xl text-white mb-3">THE GAMES</h2>
        <p className="font-body text-text-muted">Different games, one score. Pick one and see how it works.</p>
      </div>

      {/* Tabs. Horizontally scrollable on a phone: five labels never fit at
          375px, and wrapping them into two rows reads as a broken grid. */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {GAMES.map((g, i) => {
          const on = i === active;
          return (
            <button key={g.key} onClick={() => setActive(i)}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full font-body text-sm font-semibold whitespace-nowrap transition-all active:scale-95"
              style={{
                background: on ? `${g.color}1f` : "rgba(255,255,255,0.04)",
                border: `1px solid ${on ? `${g.color}66` : "rgba(255,255,255,0.08)"}`,
                color: on ? g.color : "#8a948f",
              }}>
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="rounded-3xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}0f 0%, rgba(10,10,15,1) 60%)`, border: `1px solid ${color}33` }}>
        <div className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${color}1f`, border: `1px solid ${color}40`, color }}>
              <Icon active />
            </span>
            <div>
              <p className="font-body text-xs uppercase tracking-widest" style={{ color }}>{label}</p>
              <h3 className="font-display text-2xl sm:text-3xl text-white leading-tight">{detail?.headline ?? blurb}</h3>
            </div>
          </div>

          {/* When the game has a mock (the three §5C games), show it beside the
              bullets from sm up, stacked above them on a phone with the picture
              first. Quiz and 38-0 have no mock and render bullets full width. */}
          <div className={`mb-8 ${visual ? "grid sm:grid-cols-2 gap-6 sm:gap-8 items-start" : ""}`}>
            {visual && <div className="order-1 sm:order-2">{visual}</div>}
            <div className={`space-y-3 ${visual ? "order-2 sm:order-1" : ""}`}>
              {(detail?.points ?? [blurb]).map((p) => (
                <div key={p} className="flex items-start gap-3">
                  <span className="flex-shrink-0 mt-1.5 rounded-full" style={{ width: 6, height: 6, background: color }} />
                  <p className="font-body text-sm sm:text-base text-white/80 leading-relaxed">{p}</p>
                </div>
              ))}
            </div>
          </div>

          <Link href={href}
            className="inline-flex items-center gap-2 font-body font-bold text-base px-7 py-3.5 rounded-xl transition-all active:scale-95"
            style={{ background: color, color: "#0a0a0f", textDecoration: "none" }}>
            Play {label} →
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Animated league card ─────────────────────────────────────────────────────

function LeagueHeroCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 3200);
    return () => clearInterval(iv);
  }, []);

  const highlighted = tick % 4;

  return (
    <div className="float-card w-full max-w-[340px] bg-surface"
      style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, overflow: "hidden", boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(174,234,0,0.08)" }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(174,234,0,0.04)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(174,234,0,0.15)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 2h8v3L7 8l-4-3z" stroke="#aeea00" strokeWidth="1.3" strokeLinejoin="round" fill="rgba(174,234,0,0.2)"/>
              <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke="#aeea00" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <p className="font-body text-xs font-semibold text-white">The Group Chat 🏆</p>
            <p className="font-body text-xs text-text-muted">6 games played</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)" }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#aeea00" }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: "#aeea00" }} />
          </span>
          <span className="font-body text-xs font-semibold text-green">Live</span>
        </div>
      </div>

      {/* Tab toggle mini */}
      <div className="px-4 pt-3 pb-2 flex gap-1.5">
        <span className="font-body text-xs font-semibold px-2.5 py-1 rounded-md" style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>Points</span>
        <span className="font-body text-xs text-text-muted px-2.5 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.04)" }}>P4P</span>
      </div>

      {/* Players */}
      {LEAGUE_PLAYERS.map((p, i) => {
        const isHighlighted = i === highlighted;
        const pal = PALETTES[i];
        return (
          <div key={p.name}
            className="flex items-center gap-3 px-4 py-3 transition-all"
            style={{
              background: isHighlighted ? "rgba(174,234,0,0.06)" : i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
              borderBottom: i < LEAGUE_PLAYERS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}>
            <span className="font-display text-sm w-5 flex-shrink-0" style={{ color: i === 0 ? "#aeea00" : "#586058" }}>#{i + 1}</span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-xs flex-shrink-0 border border-border"
              style={{ background: pal.bg, color: pal.text }}>
              {p.name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-body text-sm font-medium text-white">{p.name}</span>
                <span className="text-sm">{p.flag}</span>
                {p.streak >= 2 && (
                  <span className="font-body text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(251,146,60,0.1)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.2)" }}>
                    🔥{p.streak}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="h-0.5 rounded-full" style={{ width: 32, background: "rgba(255,255,255,0.06)" }}>
                  <div className="h-full rounded-full" style={{ width: `${p.acc}%`, background: p.acc >= 85 ? "#aeea00" : "#aeea00" }} />
                </div>
                <span className="font-body text-xs tabular-nums" style={{ color: "#586058" }}>{p.acc}%</span>
              </div>
            </div>
            <span className="font-display text-base flex-shrink-0" style={{ color: i === 0 ? "#aeea00" : "white" }}>
              {p.pts.toLocaleString()}
            </span>
          </div>
        );
      })}

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
        <span className="font-body text-xs text-text-muted">🔥 Marcus · 4 wins in a row</span>
        <span className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>Full table →</span>
      </div>
    </div>
  );
}

// ── Today's Game (guest acquisition surface) ─────────────────────────────────
// Same hero content as the signed-in dashboard — one game a day, same for
// everyone. Guests can already play quizzes solo, so this links straight
// into the real game; no sign-in gate.

const TODAYS_GAME_ACCENT: Record<TodaysGame["gameType"], string> = {
  quiz: "#00d8c0",
  "perfect-10": "#ffc233",
  "higher-lower": "#ff7800",
  "guess-the-player": "#4fc3f7",
};

function TodaysGameCard({ game }: { game: TodaysGame }) {
  const accent = TODAYS_GAME_ACCENT[game.gameType];
  return (
    <section className="relative z-10 max-w-6xl mx-auto px-6 pb-10">
      <p className="font-body text-xs uppercase tracking-widest mb-3" style={{ color: accent }}>Today&apos;s game</p>
      <Link href={game.href}
        className="relative flex items-center gap-4 rounded-2xl overflow-hidden transition-transform active:scale-[0.99] hover:opacity-95"
        style={{ border: `1px solid ${accent}40`, minHeight: 110 }}>
        {game.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl(game.coverImage, 440) ?? game.coverImage} alt="" loading="eager" decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-bottom" />
        ) : (
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}30, #0c1613)` }} />
        )}
        <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(6,10,8,0.92) 0%, rgba(6,10,8,0.55) 55%, rgba(6,10,8,0.15) 100%)" }} />
        <div className="relative flex items-center gap-4 px-6 py-5 w-full">
          <div className="flex-1 min-w-0">
            <p className="font-display text-2xl sm:text-3xl text-white leading-tight" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.6)" }}>{game.title}</p>
            <p className="font-body text-sm mt-1" style={{ color: "#c4ccc6" }}>{game.sub} · play free, no sign-in needed</p>
          </div>
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 44, height: 44, background: accent }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "#04231f" }}>
              <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </Link>
    </section>
  );
}

// ── Upcoming fixtures (data fetched server-side, passed as prop) ──────────────

function UpcomingFixturesSection({ matches }: { matches: LiveMatch[] }) {
  if (matches.length === 0) return null;
  return (
    <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-3xl text-white">UPCOMING FIXTURES</h2>
        <Link href="/league/new" className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>Create a league →</Link>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
          {matches.map((m) => {
            const isLive = m.status === "live";
            const dateStr = new Date(m.match_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return (
              <Link key={m.id} href={`/match/${m.id}`}
                className="flex flex-col gap-2 rounded-2xl p-4 hover:opacity-80 transition-opacity flex-shrink-0 group"
                style={{ background: isLive ? "rgba(174,234,0,0.06)" : "#0e1611", border: isLive ? "1px solid rgba(174,234,0,0.2)" : "1px solid rgba(255,255,255,0.08)", width: 160 }}>
                <div className="flex items-center justify-between">
                  <FlagImage team={m.home_team} size={28} />
                  {isLive
                    ? <span className="font-display text-sm text-white">{m.home_score}-{m.away_score}</span>
                    : <span className="font-body text-xs text-text-muted">vs</span>}
                  <FlagImage team={m.away_team} size={28} />
                </div>
                <p className="font-body text-xs font-semibold text-white leading-tight">{m.home_team} vs {m.away_team}</p>
                <div className="flex items-center justify-between">
                  <p className="font-body text-xs text-text-muted">{isLive ? "Live" : dateStr}</p>
                  <span className="font-body text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: isLive ? "#aeea00" : "#aeea00" }}>
                    {isLive ? "Play →" : "Open →"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Marketing landing (logged-out) ───────────────────────────────────────────

export function MarketingLanding({ matches, todaysGame }: { matches: LiveMatch[]; todaysGame: TodaysGame }) {
  const [countdownLeftUrl, setCountdownLeftUrl] = useState<string | null>(null);
  const [countdownRightUrl, setCountdownRightUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Fetch player cutouts for countdown strip
  useEffect(() => {
    getPlayerCutoutUrl("Vinicius Junior").then(url => { if (url) setCountdownLeftUrl(url); });
    getPlayerCutoutUrl("Jude Bellingham").then(url => { if (url) setCountdownRightUrl(url); });
  }, []);

  // The countdown-ring timer that used to live here drove the demo question
  // card in the "SPEED SCORED" section. That section is gone, so the ticking
  // 45-second interval it ran on every signed-out page load is gone with it.

  return (
    <main className="min-h-dvh bg-bg" style={{ paddingBottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}>
      <style>{ANIM_CSS}</style>

      {/* Grid + glow background */}
      <GridBackground opacity={0.022} />
      <div className="fixed top-0 left-0 w-[700px] h-[700px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(174,234,0,0.07) 0%, transparent 60%)" }} />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 100% 100%, rgba(174,234,0,0.05) 0%, transparent 60%)" }} />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <Image src="/logo.png" alt="YourScore" width={122} height={36} priority style={{ height: 36, width: "auto" }} />
        <div className="flex items-center gap-2">
          <Link href="/games" className="hidden sm:block font-body text-sm text-text-muted hover:text-white transition-colors px-3 py-2">Games</Link>
          <Link href="/challenges" className="hidden sm:block font-body text-sm hover:opacity-80 transition-colors px-3 py-2 text-amber">Quiz</Link>
          <Link href="/league/join" className="hidden sm:block font-body text-sm text-text-muted hover:text-white transition-colors px-3 py-2">Join league</Link>
          <Link href="/auth/sign-in" className="hidden sm:block font-body font-semibold text-sm px-4 py-2.5 rounded-xl hover:opacity-90 transition-all text-white whitespace-nowrap"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
            Sign In
          </Link>
          <Link href="/auth/sign-in" className="font-body font-bold text-sm px-4 py-2.5 rounded-xl hover:opacity-90 transition-all green-pulse text-green whitespace-nowrap"
            style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.35)" }}>
            Sign Up
          </Link>
          <Link href="/league/new" className="hidden sm:block font-body font-bold text-sm px-5 py-2.5 rounded-xl hover:opacity-90 transition-all pulse-glow"
            style={{ background: "#aeea00", color: "#0a0a0f" }}>
            Create a league
          </Link>
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="sm:hidden w-9 h-9 rounded-full flex items-center justify-center transition-all"
            style={{
              background: menuOpen ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.06)",
              border: `1.5px solid ${menuOpen ? "rgba(174,234,0,0.35)" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            {menuOpen ? (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M2 2l11 11M13 2L2 13" stroke="#aeea00" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M1.5 3.5h12M1.5 7.5h12M1.5 11.5h12" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </nav>
      </div>

      {/* ── Mobile menu shelf ────────────────────────────────────────────── */}
      {menuOpen && (
        <>
          {/* Tap-outside-to-close dimmer — doesn't cover the shelf */}
          <div
            className="sm:hidden fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.3)" }}
            onClick={() => setMenuOpen(false)}
          />
          {/* Shelf panel — drops down from nav, z above dimmer */}
          <div
            className="sm:hidden fixed top-0 left-0 right-0 z-50"
            style={{
              background: "rgba(12,12,18,0.98)",
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            {/* Shelf header */}
            <div className="flex items-center justify-between px-6 py-5">
              <Image src="/logo.png" alt="YourScore" width={95} height={28} style={{ height: 28, width: "auto" }} />
              <button
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke="#8a948f" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {/* Nav links */}
            <nav className="px-4 pb-3">
              {[
                { href: "/challenges", label: "Quiz", color: "#ffb800" },
                { href: "/join", label: "Upcoming Matches", color: "#aeea00" },
                { href: "/league/join", label: "Join league", color: "#c4ccc6" },
                { href: "/games", label: "Games", color: "#c4ccc6" },
                { href: "/auth/sign-in", label: "Sign in", color: "#8a948f" },
              ].map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:opacity-80"
                  style={{ color: item.color }}
                >
                  <span className="font-body text-base font-semibold">{item.label}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M4 2l6 5-6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              ))}
            </nav>
            {/* CTAs */}
            <div className="px-4 pb-5 pt-2 grid grid-cols-2 gap-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <Link
                href="/auth/sign-in"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-center py-3 rounded-xl font-body font-bold text-sm green-pulse text-green"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.28)" }}
              >
                Sign Up Free
              </Link>
              <Link
                href="/league/new"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-center py-3 rounded-xl font-body font-bold text-sm pulse-glow"
                style={{ background: "#aeea00", color: "#0a0a0f" }}
              >
                Create a league
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ── Today's Game — acquisition surface, no sign-in required, so it goes
          ABOVE the hero: it's the only thing here a guest can do without
          committing, and below the hero it sat ~1280px down (ux-walk, 23 Jul).
          The onboarding tour's final step points here for guests (data-tour). */}
      <div data-tour="todays-game" className="pt-3"><TodaysGameCard game={todaysGame} /></div>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-2 pb-16 lg:pt-6" style={{ overflow: "hidden" }}>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* Left: copy + CTAs */}
          <div>
            <div style={{ position: "relative", zIndex: 1 }}>
            <div className="inline-flex items-center gap-2.5 rounded-full px-4 py-2 mb-5"
              style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.18)" }}>
              <span className="w-2 h-2 rounded-full animate-pulse flex-shrink-0" style={{ background: "#aeea00" }} />
              {/* Breadth goes here, in the cheapest place on the page: read in a
                  second, no decision asked for. The headline stays one promise. */}
              <span className="font-body text-xs text-text-muted uppercase tracking-widest">Quizzes · Gameday · Fantasy · Versus</span>
            </div>

            {/* Never a count of games. A number is a ceiling the reader tests
                against alternatives, and it goes stale the day a game ships.
                The rank is the product and it has no upper bound. */}
            <h1 className="font-display text-6xl sm:text-7xl lg:text-8xl text-white leading-none mb-5">
              YOUR FOOTBALL<br />KNOWLEDGE.<br />
              <span className="text-green" style={{ textShadow: "0 0 50px rgba(174,234,0,0.35)" }}>RANKED.</span>
            </h1>

            {/* One sentence. The "play one now" nudge that used to close this
                was redundant with the button directly beneath it, and the extra
                line pushed that button under the fixed bottom nav on a phone. */}
            <p className="font-body text-text-muted text-lg leading-relaxed mb-6 max-w-lg">
              Every game you play feeds one score and one rank against every other fan.
            </p>

            {/* Primary CTA — into the games, not into one game */}
            <Link href="/play"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 font-body font-bold text-lg px-10 py-5 rounded-2xl hover:opacity-90 transition-all mb-3 pulse-glow"
              style={{ background: "#aeea00", color: "#062013", display: "flex" }}>
              {/* A play triangle, not the 38-0 shirt: this button stopped being
                  "Draft your XI" and now opens the games, not one of them. */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                <path d="M6 3.5l10 6.5-10 6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
              Play a game
            </Link>

            {/* Secondary CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <Link href="/auth/sign-in"
                className="flex-1 flex items-center justify-center gap-2 font-body font-semibold text-base px-6 py-4 rounded-xl transition-all hover:opacity-90 green-pulse text-green"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                Sign Up Free
              </Link>
              <DownloadAppButton
                source="hero"
                label="Get the app"
                className="flex-1 flex items-center justify-center gap-2 font-body font-semibold text-base px-6 py-4 rounded-xl transition-all hover:opacity-80 text-white"
                style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
              />
            </div>

            <p className="font-body text-xs text-text-muted">
              Free to play ·{" "}
              <Link href="/games" className="underline hover:text-white transition-colors">The games →</Link>
            </p>
            </div>{/* end content wrapper */}
          </div>

          {/* Right: league card */}
          <div className="flex items-center justify-center lg:justify-end">
            <div className="relative">
              {/* Glow behind card */}
              <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 50%, rgba(174,234,0,0.15) 0%, transparent 70%)", transform: "scale(1.3)", zIndex: 1 }} />
              <div className="relative" style={{ zIndex: 2 }}>
              <GamesHeroCard />

              {/* Floating badges — both now say something about the games card
                  they hang off, not about a league the guest hasn't joined.
                  Desktop only: on a phone the card is full width, so these sat
                  on top of it and covered two rows. */}
              <div className="float-card-2 absolute -bottom-4 -left-4 hidden lg:flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-surface"
                style={{ border: "1px solid rgba(174,234,0,0.25)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                <span className="font-body text-base">⚡</span>
                <div>
                  <p className="font-body text-xs font-bold text-white">Answer fast</p>
                  <p className="font-body text-xs text-text-muted">Score double</p>
                </div>
              </div>

              {/* Floating badge: streak */}
              <div className="float-card absolute -top-4 -right-4 hidden lg:flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-surface"
                style={{ border: "1px solid rgba(251,146,60,0.3)", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                <span className="font-body text-base">🔥</span>
                <div>
                  <p className="font-body text-xs font-bold text-white">Play daily</p>
                  <p className="font-body text-xs text-text-muted">Build a streak</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* The 38-0 and Football Quiz tiles used to live here. The games card in
          the hero now lists all five games with the same links, so these two
          were the old two-game framing repeated a screen later. Removed 23 Jul.
          Anything that needs a mid-page game entry should use GAMES, not a
          hand-written tile that drifts. */}

      {/* ── What a league gets you ────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-3xl overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.06) 0%, rgba(10,10,15,1) 60%)", border: "1px solid rgba(174,234,0,0.15)" }}>
          <div className="px-8 py-10 lg:py-12">
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 font-body text-xs uppercase tracking-widest"
                  style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)", color: "#aeea00" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 1.5h7v3L6 8l-3.5-3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M3 4.5v4a3 3 0 0 0 6 0v-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  Leagues
                </div>
                <h2 className="font-display text-4xl sm:text-5xl text-white mb-4">YOUR FRIENDS.<br />ONE TABLE.</h2>
                <p className="font-body text-text-muted text-base leading-relaxed mb-6">
                  Your whole group, one table. Every game any of you plays feeds the standings. Live, automatically, all season.
                </p>
                <div className="space-y-3 mb-8">
                  {[
                    { icon: "⚔️", text: "Go head to head. Challenge any friend to any game" },
                    { icon: "👑", text: "Raw points vs Pound for Pound accuracy. Real debates built in" },
                    { icon: "🔥", text: "Streaks, badges and rankings across every competition" },
                    { icon: "📊", text: "Your league standing updates the moment a game ends" },
                  ].map(f => (
                    <div key={f.text} className="flex items-start gap-3">
                      <span className="text-base mt-0.5 flex-shrink-0">{f.icon}</span>
                      <p className="font-body text-sm text-white/80">{f.text}</p>
                    </div>
                  ))}
                </div>
                <Link href="/league/new"
                  className="inline-flex items-center gap-2 font-body font-bold text-base px-8 py-4 rounded-xl hover:opacity-90 transition-all"
                  style={{ background: "#aeea00", color: "#0a0a0f", boxShadow: "0 0 28px rgba(174,234,0,0.3)" }}>
                  Start your league →
                </Link>
              </div>

              {/* The league table card lives here now, next to the section that
                  actually explains leagues. It was the hero visual, where it
                  sold a private table to a guest who has nobody to add to it. */}
              {/* Just the table. The three invented activity rows underneath it
                  (Marcus +340, Priya +1,500, Zach +280) restated what the table
                  already shows, and the dashed caption restated the bullets on
                  the left. The card says it on its own. */}
              <div className="flex justify-center lg:justify-start">
                <LeagueHeroCard />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The games ─────────────────────────────────────────────────────
          Replaces the old "HOW IT WORKS" 01-04 steps and the "SPEED SCORED"
          question preview. Both described one game as if it were the product:
          the steps were the 38-0 arc, the speed panel was quiz scoring. This
          section is per game instead, one tab each, driven by GAMES so a new
          game gets a tab without anyone editing marketing copy. ── */}
      <GamesExplainer />

      {/* ── Countdown strip ───────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-16">
        <div className="rounded-3xl overflow-hidden relative" style={{ background: "linear-gradient(135deg, #0d1a0f 0%, #0a0a0f 50%, #080d0a 100%)", border: "1px solid rgba(174,234,0,0.12)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />

          {/* Left flanking player (Vinicius) */}
          {countdownLeftUrl && (
            <div className="absolute hidden lg:block pointer-events-none"
              style={{ left: -30, bottom: 0, width: 190, height: 290, zIndex: 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={countdownLeftUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "bottom", opacity: 0.32 }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 30%, #0a0a0f 85%)" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #0d1a0f 0%, transparent 20%)" }} />
            </div>
          )}

          {/* Right flanking player (Bellingham) */}
          {countdownRightUrl && (
            <div className="absolute hidden lg:block pointer-events-none"
              style={{ right: -30, bottom: 0, width: 190, height: 290, zIndex: 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={countdownRightUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "bottom", opacity: 0.32, transform: "scaleX(-1)" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to left, transparent 30%, #080d0a 85%)" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to top, #0a0a0f 0%, transparent 20%)" }} />
            </div>
          )}

          <div className="relative z-10 px-8 py-10 text-center">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-5">Premier League</p>
            <SeasonCountdown />
            {/* The eyebrow lists fantasy and gameday flat, as things the brand
                does. This is where the honest specifics live: both land on
                21 Aug with the season, and this section says so. */}
            <p className="font-body text-sm text-text-muted mt-4 mb-6">Fantasy and gameday quizzes land with the season. A quiz pack at the half time whistle of every fixture, and a squad that scores all year. Everything else is playable now.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/play" className="inline-flex items-center gap-2 font-body font-bold text-sm px-6 py-3 rounded-xl transition-all hover:opacity-90 pulse-glow"
                style={{ background: "#aeea00", color: "#0a0a0f" }}>
                Play a game →
              </Link>
              <Link href="/auth/sign-in" className="inline-flex items-center gap-2 font-body font-semibold text-sm px-6 py-3 rounded-xl transition-all hover:opacity-80 green-pulse text-green"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)" }}>
                Sign Up Free →
              </Link>
            </div>
          </div>
        </div>
      </section>


      {/* ── Upcoming fixtures ────────────────────────────────────────────── */}
      <UpcomingFixturesSection matches={matches} />

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <div className="rounded-3xl p-10 sm:p-14 text-center relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.1) 0%, rgba(174,234,0,0.06) 100%)", border: "1px solid rgba(174,234,0,0.2)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
          <div className="relative z-10">
            {/* Was five national flags, which was World Cup dressing on a page
                that is no longer about the World Cup. */}
            <div className="flex items-center justify-center gap-4 mb-6 text-5xl">
              ⚽ 🏆 👕 🧠 🔥
            </div>
            {/* Closes on the same promise the headline opened with. Starting a
                league was the old ending: it asks a guest who arrived alone to
                go and organise their friends. That is the second visit's ask. */}
            <h2 className="font-display text-5xl sm:text-6xl text-white mb-3">FIND OUT WHERE YOU RANK</h2>
            <p className="font-display text-2xl mb-6" style={{ color: "#aeea00" }}>Free · no account needed</p>
            <p className="font-body text-text-muted mb-8 max-w-md mx-auto">
              One game is enough to get a score. Play a few and you get a rank, a streak, and something to argue about.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link href="/play"
                className="inline-flex items-center gap-2 font-body font-bold text-lg px-10 py-5 rounded-2xl hover:opacity-90 transition-all pulse-glow"
                style={{ background: "#aeea00", color: "#0a0a0f" }}>
                Play a game →
              </Link>
              <Link href="/auth/sign-in"
                className="inline-flex items-center gap-2 font-body font-bold text-base px-8 py-4 rounded-2xl hover:opacity-90 transition-all green-pulse text-green"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}>
                Sign Up Free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <BottomNav />

      {/* Footer */}
      <footer className="relative z-10" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Image src="/logo.png" alt="YourScore" width={75} height={22} style={{ height: 22, width: "auto", opacity: 0.5 }} />
          <div className="flex items-center gap-6 text-sm font-body text-text-muted">
            <Link href="/games" className="hover:text-white transition-colors">Games</Link>
            <Link href="/challenges" className="hover:opacity-80 transition-colors text-amber">Quiz</Link>
            <Link href="/league/join" className="hover:text-white transition-colors">Join a league</Link>
            <Link href="/league/new" className="hover:text-white transition-colors">Create a league</Link>
            <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
            <a href="mailto:hello@yourscore.app" className="hover:text-white transition-colors">Contact</a>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
