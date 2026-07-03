"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import Image from "next/image";
import { BottomNav } from "@/components/ui/BottomNav";
import { slugify } from "@/lib/utils";
import { coverUrl } from "@/lib/img";
import { usePendingFriends } from "@/hooks/usePendingFriends";
import { usePendingTurns } from "@/hooks/usePendingTurns";

const WORLD_CUP_START = new Date("2026-06-11T18:00:00Z");

// ── Data contract ─────────────────────────────────────────────────────────────

export interface FormResult {
  kind: "38" | "quiz";
  outcome: "W" | "L" | "D";
}

export interface RankInfo {
  overall: number | null;
  score: number;
  knowledge: number;
  match: number;
  aheadName: string | null;
  aheadGap: number | null;
}

export interface MomentumInfo {
  form: FormResult[]; // newest-first, max 5
  streak: number; // current win streak (38-0)
}

export interface WcRunInfo {
  nation: string;
  stage: string;
  groupPoints: number;
}

export type PlayNextKind = "wc" | "lobby" | "draft" | "quiz";

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
  gapAbove: number | null; // pts to the player directly above (null if 1st)
  aboveName: string | null; // name of the player directly above (null if 1st)
}

export interface FeaturedPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
  icon?: string;
  coverImage?: string;
  publishedAt?: string;
}

// Short "Jun 18" style publish date for quiz cards.
function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export interface DashboardData {
  userId: string;
  displayName: string;
  rank: RankInfo;
  momentum: MomentumInfo;
  wcRun: WcRunInfo | null;
  playNext: PlayNextInfo;
  openLobbies: number;
  leagues: LeaguePosition[];
  featuredPacks: FeaturedPack[];
}

// ── World Cup countdown ───────────────────────────────────────────────────────

function WorldCupCountdown() {
  const [diff, setDiff] = useState<number | null>(null);
  useEffect(() => {
    setDiff(WORLD_CUP_START.getTime() - Date.now());
    const iv = setInterval(() => setDiff(WORLD_CUP_START.getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  if (diff === null || diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return (
    <span className="font-display tabular-nums" style={{ color: "#ffc233" }}>
      {days}d {String(hours).padStart(2, "0")}h {String(mins).padStart(2, "0")}m
    </span>
  );
}

// ── Form pips ─────────────────────────────────────────────────────────────────

const PIP: Record<"W" | "L" | "D", { bg: string; fg: string; label: string }> = {
  W: { bg: "rgba(174,234,0,0.18)", fg: "#aeea00", label: "W" },
  L: { bg: "rgba(255,71,87,0.16)", fg: "#ff6b78", label: "L" },
  D: { bg: "rgba(255,194,51,0.16)", fg: "#ffc233", label: "D" },
};

function FormPips({ form }: { form: FormResult[] }) {
  if (form.length === 0) {
    return <span className="font-body text-xs text-text-muted">No games yet — go make some history</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      {form.slice(0, 5).map((r, i) => {
        const p = PIP[r.outcome];
        return (
          <span
            key={i}
            className="font-display flex items-center justify-center rounded-md"
            style={{ width: 26, height: 26, fontSize: 14, background: p.bg, color: p.fg, border: `1px solid ${p.fg}33` }}
            title={r.kind === "38" ? "38-0" : "Quiz"}
          >
            {p.label}
          </span>
        );
      })}
    </div>
  );
}

// ── Play-next config (icon + accent per kind) ──────────────────────────────────

const PLAY_NEXT_STYLE: Record<PlayNextKind, { emoji: string; accent: string; rgba: string; tone: "lime" | "teal" | "gold" }> = {
  wc: { emoji: "🏆", accent: "#ffc233", rgba: "255,194,51", tone: "gold" },
  lobby: { emoji: "👥", accent: "#00d8c0", rgba: "0,216,192", tone: "teal" },
  draft: { emoji: "👕", accent: "#aeea00", rgba: "174,234,0", tone: "lime" },
  quiz: { emoji: "🧠", accent: "#00d8c0", rgba: "0,216,192", tone: "teal" },
};

const DASH_ANIM = `
  @keyframes dashSlide { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes flameFlick { 0%,100% { transform: scale(1) rotate(-2deg); } 50% { transform: scale(1.12) rotate(2deg); } }
  @keyframes pnGlow { 0%,100% { box-shadow: 0 0 0 0 var(--pn-glow); } 50% { box-shadow: 0 0 26px 2px var(--pn-glow); } }
  .d-1 { animation: dashSlide 0.4s ease-out 0.04s both; }
  .d-2 { animation: dashSlide 0.4s ease-out 0.12s both; }
  .d-3 { animation: dashSlide 0.4s ease-out 0.2s both; }
  .d-4 { animation: dashSlide 0.4s ease-out 0.28s both; }
  .d-5 { animation: dashSlide 0.4s ease-out 0.36s both; }
  .flame { display: inline-block; animation: flameFlick 1.1s ease-in-out infinite; }
  .pn-glow { animation: pnGlow 2.6s ease-in-out infinite; }
`;

const PACK_TYPE_CONFIG: Record<string, { color: string; rgba: string; emoji: string }> = {
  team: { color: "#ffb800", rgba: "255,184,0", emoji: "⚽" },
  national: { color: "#00c9ff", rgba: "0,201,255", emoji: "🌍" },
  records: { color: "#aeea00", rgba: "174,234,0", emoji: "🏆" },
};

function FeaturedPacksRow({ packs }: { packs: FeaturedPack[] }) {
  if (packs.length === 0) return null;
  return (
    <div className="d-5">
      <div className="flex items-center justify-between mb-3">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest">Featured this week</p>
        <Link href="/challenges" className="font-body text-xs font-semibold text-amber">All →</Link>
      </div>
      <div className="overflow-x-auto pb-2 -mx-5 px-5">
        <div className="flex gap-3 items-stretch" style={{ minWidth: "max-content" }}>
          {packs.map((pack) => {
            const cfg = PACK_TYPE_CONFIG[pack.type] ?? PACK_TYPE_CONFIG.records;
            const date = shortDate(pack.publishedAt);
            return (
              <Link
                key={pack.id}
                href={`/challenges/${slugify(pack.name)}`}
                className="flex-shrink-0 rounded-2xl overflow-hidden transition-opacity hover:opacity-80 active:scale-[0.98] flex flex-col"
                style={{ width: 168, background: `rgba(${cfg.rgba},0.07)`, border: `1px solid rgba(${cfg.rgba},0.2)`, textDecoration: "none" }}
              >
                {pack.coverImage ? (
                  <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9" }}>
                    {/* eager + async so featured art paints immediately, not lazily.
                        CDN-resized: the originals are 2-3MB PNGs. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverUrl(pack.coverImage, 168) ?? pack.coverImage} alt={pack.name} loading="eager" decoding="async" fetchPriority="high"
                      className="absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />
                  </div>
                ) : (
                  <div className="flex items-center justify-center font-display text-white"
                    style={{ width: "100%", aspectRatio: "16 / 9", fontSize: 40, background: `rgba(${cfg.rgba},0.12)`, color: cfg.color }}>
                    {pack.name[0]?.toUpperCase() ?? "Q"}
                  </div>
                )}
                {/* Title gets full room (no clamp) so it's never cut; date sits at the base. */}
                <div className="p-3 flex flex-col flex-1">
                  <p className="font-body text-xs font-bold text-white leading-snug mb-2">{pack.name}</p>
                  <p className="font-body text-[11px] mt-auto" style={{ color: "#8a948f" }}>
                    {date ? <span style={{ color: cfg.color }}>{date}</span> : null}
                    {date ? " · " : ""}{pack.question_count} Qs
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

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
      href="/play"
      className="flex items-center justify-between px-4 py-3 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
      style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.25)" }}
    >
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#00d8c0" }} />
        <p className="font-body text-sm font-semibold text-white">
          {count === 1 ? "A mate is waiting on your move" : `${count} challenges waiting on you`}
        </p>
      </div>
      <span className="font-body text-xs font-bold" style={{ color: "#00d8c0" }}>Play →</span>
    </Link>
  );
}

// ── Premium game-mode tiles ─────────────────────────────────────────────────────
// The three primary calls to action. No emoji — each is a distinct, branded
// surface with its own colour, texture and oversized ghost wordmark.

interface GameTile {
  href: string;
  kicker: string;
  title: string;
  tagline: string;
  accent: string;
  rgba: string;
  ink: string; // dark text colour for the accent chip
  texture: string; // CSS background-image for the pattern layer
  ghost: string; // huge faded wordmark in the corner
}

const GAME_TILES: GameTile[] = [
  {
    href: "/38-0",
    kicker: "DRAFT XI",
    title: "38-0",
    tagline: "Build the perfect XI. Go unbeaten.",
    accent: "#aeea00",
    rgba: "174,234,0",
    ink: "#0a1400",
    // pitch mow-lines
    texture: "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 30px)",
    ghost: "38",
  },
  {
    href: "/play",
    kicker: "QUIZ",
    title: "QUIZZES",
    tagline: "Test your football knowledge, fast.",
    accent: "#00d8c0",
    rgba: "0,216,192",
    ink: "#012420",
    // dot grid
    texture: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
    ghost: "?",
  },
  {
    href: "/38-0/wc",
    kicker: "WORLD CUP",
    title: "MASTERMIND",
    tagline: "Daily run. Top the board. Win £100.",
    accent: "#ffc233",
    rgba: "255,194,51",
    ink: "#2a1d00",
    // diagonal rays
    texture: "repeating-linear-gradient(120deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 16px)",
    ghost: "★",
  },
];

function GameTileCard({ t, delayClass }: { t: GameTile; delayClass: string }) {
  return (
    <Link
      href={t.href}
      className={`${delayClass} relative block overflow-hidden rounded-2xl transition-transform active:scale-[0.99]`}
      style={{
        height: 92,
        border: `1px solid rgba(${t.rgba},0.35)`,
        background: `linear-gradient(105deg, rgba(${t.rgba},0.16) 0%, rgba(${t.rgba},0.05) 48%, #0c1410 100%)`,
        boxShadow: `0 6px 22px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* texture layer */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: t.texture, backgroundSize: t.texture.includes("radial") ? "15px 15px" : undefined, opacity: 0.6 }} />
      {/* accent glow, right edge */}
      <div className="absolute inset-y-0 right-0 w-2/3 pointer-events-none"
        style={{ background: `radial-gradient(120% 100% at 100% 50%, rgba(${t.rgba},0.22), transparent 68%)` }} />
      {/* oversized ghost wordmark */}
      <span className="absolute font-display pointer-events-none select-none"
        style={{ right: 56, top: "50%", transform: "translateY(-50%)", fontSize: 88, lineHeight: 1, color: `rgba(${t.rgba},0.13)` }}>
        {t.ghost}
      </span>

      <div className="relative h-full flex items-center justify-between pl-5 pr-4">
        <div className="min-w-0">
          <p className="font-body text-[10px] font-bold uppercase tracking-[0.22em] mb-1" style={{ color: t.accent }}>{t.kicker}</p>
          <p className="font-display text-[28px] leading-none text-white tracking-wide">{t.title}</p>
          <p className="font-body text-xs mt-1.5 truncate" style={{ color: "#9aa39d" }}>{t.tagline}</p>
        </div>
        <span className="flex items-center justify-center rounded-full flex-shrink-0"
          style={{ width: 30, height: 30, background: t.accent }}>
          <svg width="14" height="14" viewBox="0 0 18 18" fill="none" style={{ color: t.ink }}>
            <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────

export function Dashboard({ data }: { data: DashboardData }) {
  const { displayName, rank, momentum, playNext, openLobbies, leagues, featuredPacks } = data;
  const firstName = displayName ? displayName.split(" ")[0] : null;
  const pn = PLAY_NEXT_STYLE[playNext.kind];

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
            <span className="font-body text-xs" style={{ color: "#8a948f" }}>WC <WorldCupCountdown /></span>
            <Link href="/profile" className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm transition-opacity hover:opacity-80"
              style={{ background: "linear-gradient(135deg, #1a2f4a, #3a423d)", color: "#aeea00", border: "1.5px solid rgba(174,234,0,0.25)" }}>
              {(displayName || "?")[0].toUpperCase()}
            </Link>
          </div>
        </nav>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-4 pt-4">

        {/* ── Momentum + rank hero — tap to open full profile ───────────────── */}
        <Link href="/profile" className="d-1 block rounded-3xl overflow-hidden surface-grid transition-transform active:scale-[0.99]">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-body text-xs text-text-muted">{firstName ? `Back for more, ${firstName}` : "Welcome back"}</p>
              <span className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>Your profile →</span>
            </div>

            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="font-display leading-none text-white" style={{ fontSize: 56, textShadow: "0 0 30px rgba(174,234,0,0.25)" }}>
                  {rank.score.toLocaleString()}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">YourScore points</p>
              </div>
              {rank.overall !== null && (
                <div className="text-right">
                  <p className="font-display leading-none" style={{ fontSize: 34, color: "#aeea00" }}>#{rank.overall.toLocaleString()}</p>
                  <p className="font-body text-xs text-text-muted mt-1">global rank</p>
                </div>
              )}
            </div>

            {/* Form + streak row */}
            <div className="flex items-center justify-between gap-3">
              <FormPips form={momentum.form} />
              {momentum.streak >= 2 && (
                <span className="font-display px-2.5 py-1 rounded-full text-sm tracking-wide"
                  style={{ background: "rgba(255,194,51,0.14)", color: "#ffc233", border: "1px solid rgba(255,194,51,0.3)" }}>
                  {momentum.streak} WIN STREAK
                </span>
              )}
            </div>
          </div>

          {/* Rank-gap chase line */}
          {rank.aheadName && rank.aheadGap !== null ? (
            <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)" }}>
              <p className="font-body text-xs text-text-muted">
                <span className="text-white font-semibold">{rank.aheadGap.toLocaleString()} pts</span> behind{" "}
                <span className="text-white font-semibold">{rank.aheadName}</span> — catch them
              </p>
            </div>
          ) : rank.overall === 1 ? (
            <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)" }}>
              <p className="font-body text-xs" style={{ color: "#ffc233" }}>Top of the world. Now defend it.</p>
            </div>
          ) : null}
        </Link>

        {/* ── Play next — the smart CTA ──────────────────────────────────────── */}
        <div className="d-2 rounded-3xl overflow-hidden pn-glow"
          style={{ ["--pn-glow" as string]: `rgba(${pn.rgba},0.3)`, background: `linear-gradient(135deg, rgba(${pn.rgba},0.14) 0%, rgba(${pn.rgba},0.04) 100%)`, border: `1px solid rgba(${pn.rgba},0.3)` }}>
          <Link href={playNext.href} className="flex items-center gap-4 px-5 py-4 active:scale-[0.99] transition-transform">
            <div className="flex items-center justify-center rounded-2xl flex-shrink-0"
              style={{ width: 52, height: 52, background: `rgba(${pn.rgba},0.16)`, border: `1px solid rgba(${pn.rgba},0.3)` }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M7 5l10 6-10 6V5z" fill={pn.accent} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body text-xs uppercase tracking-widest mb-0.5" style={{ color: pn.accent }}>Play next</p>
              <p className="font-display text-2xl text-white leading-none">{playNext.title}</p>
              <p className="font-body text-xs text-text-muted mt-1 truncate">{playNext.sub}</p>
            </div>
            <svg width="20" height="20" viewBox="0 0 18 18" fill="none" style={{ color: pn.accent, flexShrink: 0 }}>
              <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* ── Premium game-mode tiles — the primary CTAs ─────────────────────── */}
        <div className="space-y-2.5">
          {GAME_TILES.map((t, i) => (
            <GameTileCard key={t.href} t={t} delayClass={i === 0 ? "d-2" : i === 1 ? "d-3" : "d-4"} />
          ))}
        </div>

        {/* Active WC run is surfaced by the Play-next card above, so no separate
            tile here — it would duplicate the same call to action. */}

        {/* ── Pending friend requests ────────────────────────────────────────── */}
        <PendingTurnsNotice />
        <PendingFriendsNotice />

        {/* ── Your leagues — position + gap ──────────────────────────────────── */}
        <div className="d-3">
          <div className="flex items-center justify-between mb-3">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest">Your leagues</p>
            <Link href="/leagues" className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>All →</Link>
          </div>
          {leagues.length === 0 ? (
            <Link href="/leagues" className="block rounded-2xl px-5 py-5 text-center transition-all hover:opacity-90 active:scale-[0.99]"
              style={{ background: "rgba(174,234,0,0.06)", border: "1px dashed rgba(174,234,0,0.3)" }}>
              <p className="font-display text-lg text-white">Start a league with your mates</p>
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
                      <span className="font-display leading-none" style={{ fontSize: 24, color: top ? "#ffc233" : "#aeea00" }}>
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

        {/* ── Open lobbies nudge ─────────────────────────────────────────────── */}
        {openLobbies > 0 && (
          <Link href="/play" className="d-4 flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all hover:opacity-90 active:scale-[0.99]"
            style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.22)" }}>
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#00d8c0" }} />
              <p className="font-body text-sm font-semibold text-white">
                {openLobbies === 1 ? "1 open lobby" : `${openLobbies} open lobbies`} waiting for players
              </p>
            </div>
            <span className="font-display text-sm tracking-wide" style={{ color: "#00d8c0" }}>JOIN →</span>
          </Link>
        )}

        {/* ── Featured quiz packs ────────────────────────────────────────────── */}
        <FeaturedPacksRow packs={featuredPacks} />

      </div>
      <BottomNav />
    </main>
  );
}
