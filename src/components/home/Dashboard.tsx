"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import Image from "next/image";
import { BottomNav } from "@/components/ui/BottomNav";
import { slugify } from "@/lib/utils";
import { usePendingFriends } from "@/hooks/usePendingFriends";

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
        <p className="font-body text-xs text-text-muted uppercase tracking-widest">⭐ Featured this week</p>
        <Link href="/challenges" className="font-body text-xs font-semibold text-amber">All →</Link>
      </div>
      <div className="overflow-x-auto pb-2 -mx-5 px-5">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
          {packs.map((pack) => {
            const cfg = PACK_TYPE_CONFIG[pack.type] ?? PACK_TYPE_CONFIG.records;
            return (
              <Link
                key={pack.id}
                href={`/challenges/${slugify(pack.name)}`}
                className="flex-shrink-0 rounded-2xl overflow-hidden transition-opacity hover:opacity-80 active:scale-[0.98]"
                style={{ width: 160, background: `rgba(${cfg.rgba},0.07)`, border: `1px solid rgba(${cfg.rgba},0.2)`, textDecoration: "none" }}
              >
                {pack.coverImage ? (
                  <div style={{ position: "relative", width: "100%", aspectRatio: "3 / 2" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pack.coverImage} alt={pack.name} className="absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />
                  </div>
                ) : null}
                <div className="p-4">
                  {!pack.coverImage && (
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl mb-3 flex-shrink-0" style={{ background: `rgba(${cfg.rgba},0.14)` }}>
                      {pack.icon ?? cfg.emoji}
                    </div>
                  )}
                  <p className="font-body text-xs font-bold text-white leading-tight mb-1 line-clamp-2">{pack.name}</p>
                  <p className="font-body text-xs" style={{ color: cfg.color }}>{pack.question_count} questions</p>
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
        <span className="text-base">👥</span>
        <p className="font-body text-sm font-semibold text-white">
          {count === 1 ? "1 friend request waiting" : `${count} friend requests waiting`}
        </p>
      </div>
      <span className="font-body text-xs font-bold" style={{ color: "#f87171" }}>View →</span>
    </Link>
  );
}

// ── Quick-play chips ────────────────────────────────────────────────────────────

function QuickChip({ href, emoji, label, accent }: { href: string; emoji: string; label: string; accent: string }) {
  return (
    <Link
      href={href}
      className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl py-3 transition-all hover:opacity-90 active:scale-[0.97]"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <span className="text-xl">{emoji}</span>
      <span className="font-display text-sm tracking-wide" style={{ color: accent }}>{label}</span>
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

        {/* ── Momentum + rank hero ──────────────────────────────────────────── */}
        <div className="d-1 rounded-3xl overflow-hidden surface-grid">
          <div className="px-5 pt-5 pb-4">
            <p className="font-body text-xs text-text-muted mb-3">{firstName ? `Back for more, ${firstName} 👋` : "Welcome back"}</p>

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
                <span className="font-display flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm"
                  style={{ background: "rgba(255,194,51,0.14)", color: "#ffc233", border: "1px solid rgba(255,194,51,0.3)" }}>
                  <span className="flame">🔥</span>{momentum.streak} win streak
                </span>
              )}
            </div>
          </div>

          {/* Rank-gap chase line */}
          {rank.aheadName && rank.aheadGap !== null ? (
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)" }}>
              <span className="text-sm">🎯</span>
              <p className="font-body text-xs text-text-muted">
                <span className="text-white font-semibold">{rank.aheadGap.toLocaleString()} pts</span> behind{" "}
                <span className="text-white font-semibold">{rank.aheadName}</span> — catch them
              </p>
            </div>
          ) : rank.overall === 1 ? (
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.18)" }}>
              <span className="text-sm">👑</span>
              <p className="font-body text-xs" style={{ color: "#ffc233" }}>Top of the world. Now defend it.</p>
            </div>
          ) : null}
        </div>

        {/* ── Play next — the smart CTA ──────────────────────────────────────── */}
        <div className="d-2 rounded-3xl overflow-hidden pn-glow"
          style={{ ["--pn-glow" as string]: `rgba(${pn.rgba},0.3)`, background: `linear-gradient(135deg, rgba(${pn.rgba},0.14) 0%, rgba(${pn.rgba},0.04) 100%)`, border: `1px solid rgba(${pn.rgba},0.3)` }}>
          <Link href={playNext.href} className="flex items-center gap-4 px-5 py-4 active:scale-[0.99] transition-transform">
            <div className="flex items-center justify-center rounded-2xl flex-shrink-0 text-2xl"
              style={{ width: 52, height: 52, background: `rgba(${pn.rgba},0.16)`, border: `1px solid rgba(${pn.rgba},0.3)` }}>
              {pn.emoji}
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

        {/* ── Quick-play chips ───────────────────────────────────────────────── */}
        <div className="d-2 flex gap-2.5">
          <QuickChip href="/38-0" emoji="👕" label="38-0" accent="#aeea00" />
          <QuickChip href="/play" emoji="🧠" label="QUIZ" accent="#00d8c0" />
          <QuickChip href="/38-0/wc" emoji="🏆" label="WORLD CUP" accent="#ffc233" />
        </div>

        {/* Active WC run is surfaced by the Play-next card above, so no separate
            tile here — it would duplicate the same call to action. */}

        {/* ── Pending friend requests ────────────────────────────────────────── */}
        <PendingFriendsNotice />

        {/* ── Your leagues — position + gap ──────────────────────────────────── */}
        <div className="d-3">
          <div className="flex items-center justify-between mb-3">
            <p className="font-body text-xs text-text-muted uppercase tracking-widest">🏆 Your leagues</p>
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

        {/* ── Draft your XI — anchor CTA ─────────────────────────────────────── */}
        <div className="d-5 pt-1">
          <Button href="/38-0/play" variant="primary" tone="lime" size="lg" fullWidth>
            DRAFT YOUR XI →
          </Button>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
