"use client";

import { useState, useEffect } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
import Image from "next/image";
import { BottomNav } from "@/components/ui/BottomNav";
import { slugify } from "@/lib/utils";
import { usePendingFriends } from "@/hooks/usePendingFriends";

const WORLD_CUP_START = new Date("2026-06-11T18:00:00Z");

export interface StandingRow {
  user_id: string;
  display_name: string;
  total_score: number;
  is_me: boolean;
}

export interface LeagueTab {
  id: string;
  name: string;
  members: StandingRow[];
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
  totalScore: number | null;
  globalRank: number | null;
  leagues: LeagueTab[];
  featuredPacks: FeaturedPack[];
}

// ── World Cup countdown ───────────────────────────────────────────────────────
// Isolated client island: the 1s ticker only re-renders this small component,
// not the whole dashboard.

function WorldCupCountdown() {
  const [diff, setDiff] = useState<number | null>(null);

  useEffect(() => {
    setDiff(WORLD_CUP_START.getTime() - Date.now());
    const iv = setInterval(() => setDiff(WORLD_CUP_START.getTime() - Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  if (diff === null) return null;
  if (diff <= 0) return <span className="font-display text-3xl text-green">THE CUP IS LIVE</span>;

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

// ── League standings tile ─────────────────────────────────────────────────────
// Data is fetched server-side and passed in; only the tab toggle is interactive.

function LeagueStandingsTile({ leagues }: { leagues: LeagueTab[] }) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (leagues.length === 0) return null;

  const active = leagues[activeIdx] ?? null;
  const MEDALS = ["🥇", "🥈", "🥉"];

  return (
    <div className="dash-slide-2 rounded-2xl overflow-hidden bg-surface border border-border">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 2h8v3L7 8l-4-3z" stroke="#aeea00" strokeWidth="1.3" strokeLinejoin="round" fill="rgba(174,234,0,0.2)"/>
            <path d="M4 5v5a3 3 0 0 0 6 0V5" stroke="#aeea00" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <p className="font-body text-xs font-semibold uppercase tracking-widest" style={{ color: "#aeea00" }}>League Standings</p>
        </div>
        <Link href="/leagues" className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>All leagues →</Link>
      </div>

      {leagues.length > 1 && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          {leagues.map((l, i) => (
            <button key={l.id} onClick={() => setActiveIdx(i)}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg flex-shrink-0 transition-all"
              style={{
                background: i === activeIdx ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.04)",
                color: i === activeIdx ? "#aeea00" : "#8a948f",
                border: `1px solid ${i === activeIdx ? "rgba(174,234,0,0.3)" : "transparent"}`,
              }}>
              {l.name}
            </button>
          ))}
        </div>
      )}

      {active ? (
        <>
          {active.members.map((member, i) => (
            <div key={member.user_id}
              className="flex items-center gap-3 px-5 py-3 transition-colors"
              style={{
                background: member.is_me ? "rgba(174,234,0,0.05)" : "transparent",
                borderTop: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}>
              <span className="font-display text-sm w-7 flex-shrink-0 text-center">
                {i < 3 ? MEDALS[i] : <span style={{ color: "#586058" }}>#{i + 1}</span>}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-body text-sm font-medium text-white truncate">{member.display_name}</p>
                  {member.is_me && (
                    <span className="font-body text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>you</span>
                  )}
                </div>
              </div>
              <span className="font-display text-base flex-shrink-0"
                style={{ color: member.is_me ? "#aeea00" : i === 0 ? "#fff" : "#8a948f" }}>
                {member.total_score.toLocaleString()}
              </span>
            </div>
          ))}
          <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <Link href={`/league/${active.id}`} className="font-body text-xs font-semibold" style={{ color: "#aeea00" }}>
              Full standings →
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

const DASH_ANIM = `
  @keyframes dashGlow {
    0%,100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.02); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes countPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(174,234,0,0.4); }
    50% { box-shadow: 0 0 0 8px rgba(174,234,0,0); }
  }
  .dash-slide-1 { animation: slideIn 0.4s ease-out 0.05s both; }
  .dash-slide-2 { animation: slideIn 0.4s ease-out 0.15s both; }
  .dash-slide-3 { animation: slideIn 0.4s ease-out 0.25s both; }
  .dash-slide-4 { animation: slideIn 0.4s ease-out 0.35s both; }
  .dash-slide-5 { animation: slideIn 0.4s ease-out 0.45s both; }
  .dash-slide-6 { animation: slideIn 0.4s ease-out 0.55s both; }
  .league-cta-pulse { animation: countPulse 2.5s ease-in-out infinite; }
  @keyframes greenPulse {
    0%, 100% { box-shadow: 0 0 20px rgba(174,234,0,0.3); }
    50% { box-shadow: 0 0 35px rgba(174,234,0,0.55); }
  }
  .green-pulse { animation: greenPulse 2.5s ease-in-out infinite; }
`;

// Featured pack type → emoji/color mapping
const PACK_TYPE_CONFIG: Record<string, { color: string; rgba: string; emoji: string }> = {
  team:     { color: "#ffb800", rgba: "255,184,0",   emoji: "⚽" },
  national: { color: "#00c9ff", rgba: "0,201,255",   emoji: "🌍" },
  records:  { color: "#aeea00", rgba: "174,234,0", emoji: "🏆" },
};

function FeaturedPacksRow({ packs }: { packs: FeaturedPack[] }) {
  if (packs.length === 0) return null;
  return (
    <div className="dash-slide-3">
      <div className="flex items-center justify-between mb-3">
        <p className="font-body text-xs text-text-muted uppercase tracking-widest">⭐ Featured This Week</p>
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
                style={{
                  width: 160,
                  background: `rgba(${cfg.rgba},0.07)`,
                  border: `1px solid rgba(${cfg.rgba},0.2)`,
                  textDecoration: "none",
                }}
              >
                {pack.coverImage ? (
                  <div style={{ position: "relative", width: "100%", aspectRatio: "3 / 2" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pack.coverImage} alt={pack.name}
                      className="absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />
                  </div>
                ) : null}
                <div className="p-4">
                  {!pack.coverImage && (
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl mb-3 flex-shrink-0"
                      style={{ background: `rgba(${cfg.rgba},0.14)` }}>
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

/** Self-contained client island — shows a friend-request nudge if the user
 *  has pending incoming requests. Renders nothing when count is 0. */
function PendingFriendsNotice() {
  const count = usePendingFriends();
  if (!count) return null;
  return (
    <Link
      href="/friends"
      className="flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
      style={{
        background: "linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.05) 100%)",
        border: "1px solid rgba(239,68,68,0.25)",
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base relative"
          style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          👥
          <span
            style={{
              position: "absolute", top: -4, right: -4,
              minWidth: 15, height: 15, borderRadius: 8,
              background: "#ef4444", color: "#fff",
              fontSize: 9, fontWeight: 700, lineHeight: "15px",
              textAlign: "center", padding: "0 3px",
              fontFamily: "var(--font-body, sans-serif)",
              border: "1.5px solid rgba(10,10,15,0.96)",
            }}
          >
            {count > 9 ? "9+" : count}
          </span>
        </div>
        <div>
          <p className="font-body text-sm font-bold text-white">
            {count === 1 ? "1 friend request" : `${count} friend requests`}
          </p>
          <p className="font-body text-xs text-text-muted">
            {count === 1 ? "Someone wants to connect" : "People want to connect with you"}
          </p>
        </div>
      </div>
      <span
        className="font-body text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0"
        style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
      >
        View →
      </span>
    </Link>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  const { displayName, totalScore, globalRank, leagues, featuredPacks } = data;
  const firstName = displayName ? displayName.split(" ")[0] : null;

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <style>{DASH_ANIM}</style>
      <GridBackground opacity={0.025} />
      <div className="fixed top-0 right-0 w-[350px] h-[350px] pointer-events-none" style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.08) 0%, transparent 60%)" }} />
      <div className="fixed bottom-0 left-0 w-[300px] h-[300px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 100%, rgba(174,234,0,0.05) 0%, transparent 60%)" }} />

      {/* Nav */}
      <div className="sticky top-0 z-30 pt-safe" style={{ background: "rgba(10,10,15,0.92)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <nav className="flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
          <Image src="/logo.png" alt="YourScore" width={95} height={28} priority style={{ height: 28, width: "auto" }} />
          <Link href="/profile" className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm transition-opacity hover:opacity-80"
            style={{ background: "linear-gradient(135deg, #1a2f4a, #3a423d)", color: "#aeea00", border: "1.5px solid rgba(174,234,0,0.25)" }}>
            {(displayName || "?")[0].toUpperCase()}
          </Link>
        </nav>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-5">

        {/* ── Hero: score + countdown ─────────────────────────────────────── */}
        <div className="dash-slide-1 rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.12) 0%, rgba(174,234,0,0.06) 100%)", border: "1px solid rgba(174,234,0,0.2)" }}>
          <div className="px-5 pt-5 pb-4">
            <p className="font-body text-xs text-text-muted mb-0.5">
              {firstName ? `Hey ${firstName} 👋` : "Welcome back"}
            </p>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-display text-5xl text-white leading-none" style={{ textShadow: "0 0 30px rgba(174,234,0,0.3)" }}>
                  {totalScore !== null ? totalScore.toLocaleString() : "—"}
                </p>
                <p className="font-body text-xs text-text-muted mt-1">Total points</p>
                {globalRank !== null && (
                  <span className="inline-flex items-center gap-1 font-body text-xs font-bold px-2.5 py-1 rounded-full mt-2 text-green"
                    style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)" }}>
                    #{globalRank} globally
                  </span>
                )}
              </div>
              <div className="text-right">
                <p className="font-body text-xs text-text-muted mb-1 uppercase tracking-widest">World Cup in</p>
                <WorldCupCountdown />
              </div>
            </div>
          </div>
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#aeea00" }} />
            <p className="font-body text-xs text-text-muted">FIFA World Cup 2026 · June 11 · USA, Canada & Mexico</p>
          </div>
        </div>

        {/* ── 38-0 tile ──────────────────────────────────────────────────── */}
        <div className="dash-slide-2">
          <Link href="/38-0"
            className="flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99] green-pulse"
            style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.08) 0%, rgba(174,234,0,0.06) 100%)", border: "1px solid rgba(174,234,0,0.18)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.22)" }}>
                👕
              </div>
              <div>
                <p className="font-body text-sm font-bold text-white">38-0</p>
                <p className="font-body text-xs text-text-muted">Pick your XI · Play friends · Go unbeaten</p>
              </div>
            </div>
            <span className="font-body text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0 text-green"
              style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.22)" }}>
              Play now
            </span>
          </Link>
        </div>

        {/* ── Challenges promo strip ─────────────────────────────────────── */}
        <div className="dash-slide-3">
          <Link href="/challenges"
            className="flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99]"
            style={{ background: "linear-gradient(135deg, rgba(255,184,0,0.1) 0%, rgba(255,71,87,0.06) 100%)", border: "1px solid rgba(255,184,0,0.18)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
                style={{ background: "rgba(255,184,0,0.15)", border: "1px solid rgba(255,184,0,0.25)" }}>
                ⭐
              </div>
              <div>
                <p className="font-body text-sm font-bold text-white">Football Challenges</p>
                <p className="font-body text-xs text-text-muted">Solo games · Score big · Climb the ranks</p>
              </div>
            </div>
            <span className="font-body text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0 text-amber"
              style={{ background: "rgba(255,184,0,0.15)", border: "1px solid rgba(255,184,0,0.25)" }}>
              Play →
            </span>
          </Link>
        </div>

        {/* ── Pending friend requests ───────────────────────────────────── */}
        <PendingFriendsNotice />

        {/* ── Featured quiz packs ───────────────────────────────────────── */}
        <FeaturedPacksRow packs={featuredPacks} />

        {/* ── League standings ───────────────────────────────────────────── */}
        <LeagueStandingsTile leagues={leagues} />

        {/* ── Draft Your XI — big green CTA ──────────────────────────────── */}
        <div className="dash-slide-4">
          <Link href="/38-0/play"
            className="w-full flex items-center justify-between px-5 py-5 rounded-2xl transition-all hover:opacity-90 active:scale-[0.99] league-cta-pulse"
            style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.16) 0%, rgba(174,234,0,0.06) 100%)", border: "1px solid rgba(174,234,0,0.35)", display: "flex" }}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(174,234,0,0.18)", border: "1px solid rgba(174,234,0,0.3)" }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M8 2.5 3 5.5 5 9.5 7.3 8.3V19a1 1 0 0 0 1 1h5.4a1 1 0 0 0 1-1V8.3L17 9.5l2-4-5-3C14 4.4 12.7 5.6 11 5.6S8 4.4 8 2.5Z"
                    stroke="#aeea00" strokeWidth="1.7" strokeLinejoin="round" fill="rgba(174,234,0,0.15)"/>
                </svg>
              </div>
              <div className="text-left">
                <p className="font-body text-base font-bold text-white">Draft Your XI</p>
                <p className="font-body text-xs text-text-muted">Pick 11 players · Challenge friends · Go unbeaten</p>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "#aeea00", flexShrink: 0 }}>
              <path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </div>

      </div>
      <BottomNav />

    </main>
  );
}
