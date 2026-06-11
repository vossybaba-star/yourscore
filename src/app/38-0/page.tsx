"use client";

/**
 * /38-0 — Draft XI entry. Premier League / World Cup tabs, each with their
 * own secondary-nav pills and game content below.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { Pitch } from "@/components/draft/Pitch";
import { FORMATIONS } from "@/lib/draft/types";
import type { Formation } from "@/lib/draft/types";
import { FORMATION_NOTE } from "@/lib/draft/formations";
import { emptyTeam, loadTeam, saveTeam, isComplete, type LocalTeam, type DraftMode } from "@/lib/draft/local";
import { POOL_META } from "@/lib/draft/pool";

type DraftTab = "pl" | "wc";

export default function DraftHome() {
  const router = useRouter();
  const [tab, setTab] = useState<DraftTab>("pl");
  const [selected, setSelected] = useState<Formation>("4-3-3");
  const [mode, setMode] = useState<DraftMode>("classic");
  const [existing, setExisting] = useState<LocalTeam | null>(null);

  useEffect(() => {
    setExisting(loadTeam());
  }, []);

  function startNew() {
    const team = emptyTeam(selected, mode);
    saveTeam(team);
    router.push("/38-0/play");
  }

  return (
    <div className="min-h-[100dvh] pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        {/* header */}
        <div className="flex items-center justify-between pt-5 pb-3">
          <Link href="/" className="font-body text-sm" style={{ color: "#8888aa" }}>
            ← YourScore
          </Link>
        </div>

        <h1 className="font-display tracking-wide leading-none mb-4" style={{ fontSize: 52, color: "#fff" }}>
          38<span style={{ color: "#00ff87" }}>-0</span>
        </h1>

        {/* ── Main tab switcher — matches quiz Solo/Multiplayer style ── */}
        <div className="flex gap-1 p-1 rounded-2xl mb-4"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <button
            onClick={() => setTab("pl")}
            className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
            style={tab === "pl"
              ? { background: "#00ff87", color: "#062013" }
              : { background: "transparent", color: "#8888aa" }}>
            ⚽ Premier League
          </button>
          <button
            onClick={() => setTab("wc")}
            className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
            style={tab === "wc"
              ? { background: "#ffb800", color: "#0a0a0f" }
              : { background: "transparent", color: "#8888aa" }}>
            🏆 World Cup
          </button>
        </div>

        {/* ── Secondary nav pills — different per tab ── */}
        {tab === "pl" && (
          <div className="flex gap-2 mb-6">
            {([
              { href: "/38-0/live",        label: "⚡ Live H2H",   color: "#00ff87" },
              { href: "/38-0/teams",       label: "📁 My Teams",   color: "#a78bfa" },
              { href: "/38-0/leaderboard", label: "🏆 Leaderboard", color: "#ffb800" },
            ] as { href: string; label: string; color: string }[]).map(({ href, label, color }) => (
              <Link key={href} href={href}
                className="flex-1 py-2.5 rounded-full text-center font-display tracking-wide transition-all active:scale-95"
                style={{ fontSize: 12, color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                {label}
              </Link>
            ))}
          </div>
        )}

        {tab === "wc" && (
          <div className="flex gap-2 mb-6">
            {([
              { href: "/38-0/teams",       label: "📁 My Teams",   color: "#a78bfa" },
              { href: "/38-0/leaderboard", label: "🏆 Leaderboard", color: "#ffb800" },
            ] as { href: string; label: string; color: string }[]).map(({ href, label, color }) => (
              <Link key={href} href={href}
                className="flex-1 py-2.5 rounded-full text-center font-display tracking-wide transition-all active:scale-95"
                style={{ fontSize: 12, color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                {label}
              </Link>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            PREMIER LEAGUE TAB
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "pl" && (
          <>
            <h2 className="font-display tracking-wide leading-none" style={{ fontSize: 30, color: "#fff" }}>
              ⚽ PREMIER LEAGUE <span style={{ color: "#00ff87" }}>XI</span>
            </h2>
            <p className="font-body mt-1 mb-1" style={{ color: "#cfcfe6", fontSize: 14 }}>
              Spin for legends. Draft your all-time XI. Beat the world head-to-head.
            </p>
            <p className="font-body mb-5" style={{ color: "#8888aa", fontSize: 12 }}>
              {POOL_META.players} all-time Premier League player-seasons · {POOL_META.buckets} legendary squads
            </p>

            {/* continue card */}
            {existing && existing.squad.length > 0 && (
              <Link
                href={isComplete(existing) ? "/38-0/team" : "/38-0/play"}
                className="block mb-6 rounded-2xl p-4 active:scale-[0.98] transition-transform"
                style={{ background: "linear-gradient(135deg,#13261b,#0f1a14)", border: "1px solid rgba(0,255,135,0.25)" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                      {isComplete(existing) ? "CONTINUE WITH YOUR TEAM" : "KEEP BUILDING"}
                    </div>
                    <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>
                      {existing.formation} · {existing.squad.length}/11 drafted
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 34, color: "#00ff87" }}>
                    {isComplete(existing) ? existing.strength : "→"}
                  </div>
                </div>
              </Link>
            )}

            <h2 className="font-display tracking-wide mb-3" style={{ fontSize: 22, color: "#fff" }}>
              PICK YOUR SHAPE
            </h2>

            <div className="flex flex-wrap gap-2">
              {FORMATIONS.map((f) => {
                const active = selected === f;
                return (
                  <button
                    key={f}
                    onClick={() => setSelected(f)}
                    className="rounded-xl px-4 py-2.5 font-display tracking-wide transition-all active:scale-95"
                    style={{
                      background: active ? "rgba(0,255,135,0.12)" : "#12121e",
                      border: `1px solid ${active ? "rgba(0,255,135,0.5)" : "rgba(255,255,255,0.08)"}`,
                      color: active ? "#00ff87" : "#fff",
                      fontSize: 18,
                    }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl p-3" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="max-w-[260px] mx-auto">
                <Pitch formation={selected} squad={[]} compact />
              </div>
              <p className="font-body text-center mt-3" style={{ fontSize: 12, color: "#8888aa" }}>
                {FORMATION_NOTE[selected]}
              </p>
            </div>

            <h2 className="font-display tracking-wide mt-7 mb-3" style={{ fontSize: 22, color: "#fff" }}>
              DIFFICULTY
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {([
                { key: "classic" as DraftMode, label: "CLASSIC", desc: "Ratings shown — draft the strongest XI", color: "#00ff87" },
                { key: "expert"  as DraftMode, label: "EXPERT",  desc: "Ratings hidden — for real fans",         color: "#ffb800" },
              ]).map((m) => {
                const active = mode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className="rounded-2xl p-4 text-left transition-all active:scale-95"
                    style={{
                      background: active ? `${m.color}14` : "#12121e",
                      border: `1px solid ${active ? `${m.color}88` : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-display tracking-wide" style={{ fontSize: 22, color: active ? m.color : "#fff" }}>{m.label}</span>
                      {m.key === "expert" && <span style={{ fontSize: 14 }}>🔒</span>}
                    </div>
                    <div className="font-body mt-1" style={{ fontSize: 11, color: "#8888aa", lineHeight: 1.3 }}>{m.desc}</div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={startNew}
              className="w-full mt-7 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}
            >
              SPIN TO START →
            </button>

            <p className="font-body text-center mt-4" style={{ color: "#8888aa", fontSize: 12 }}>
              No sign-up to play. Win to upgrade your team — lose and rebuild.
            </p>
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            WORLD CUP TAB
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "wc" && (
          <>
            <h2 className="font-display tracking-wide leading-none" style={{ fontSize: 30, color: "#ffb800" }}>
              🏆 WORLD CUP <span style={{ color: "#fff" }}>RUN</span>
            </h2>
            <p className="font-body mt-1 mb-5" style={{ color: "#cfcfe6", fontSize: 14 }}>
              Pick a nation. Draft their XI. Win World Cup 2026.
            </p>

            <Link href="/38-0/wc"
              className="block rounded-2xl p-5 active:scale-[0.98] transition-transform"
              style={{ background: "linear-gradient(135deg,#1a1407,#0f1a14)", border: "1px solid rgba(255,184,0,0.45)" }}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display tracking-wide" style={{ fontSize: 22, color: "#ffb800" }}>START YOUR CAMPAIGN</span>
                    <span className="rounded-full px-2 py-0.5 font-body" style={{ fontSize: 9, color: "#0a0a0f", background: "#ffb800", letterSpacing: 1 }}>NEW</span>
                  </div>
                  <div className="font-body" style={{ fontSize: 13, color: "#cfcfe6" }}>
                    14 nations · 38-game campaign · Group stage through final
                  </div>
                </div>
                <div className="font-display flex-shrink-0 ml-3" style={{ fontSize: 32, color: "#ffb800" }}>→</div>
              </div>
            </Link>

            <p className="font-body text-center mt-4" style={{ color: "#8888aa", fontSize: 12 }}>
              No sign-up required. Pick your nation and build your XI.
            </p>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
