"use client";

/**
 * /38-0 — Draft XI entry. Premier League / World Cup tabs, each with their
 * own secondary-nav pills and game content below.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { Pitch } from "@/components/draft/Pitch";
import { FORMATIONS } from "@/lib/draft/types";
import type { Formation } from "@/lib/draft/types";
import { FORMATION_NOTE } from "@/lib/draft/formations";
import { emptyTeam, loadTeam, saveTeam, isComplete, type LocalTeam, type DraftMode } from "@/lib/draft/local";
import { POOL_META, pickableNations } from "@/lib/draft/pool";
import { trackGamePlay } from "@/lib/analytics/trackGame";

type DraftTab = "pl" | "wc";

export default function DraftHome() {
  const router = useRouter();
  const [tab, setTab] = useState<DraftTab>("pl");
  const [selected, setSelected] = useState<Formation>("4-3-3");
  const [mode, setMode] = useState<DraftMode>("classic");
  const [existing, setExisting] = useState<LocalTeam | null>(null);
  const nations = useMemo(() => pickableNations(), []);

  useEffect(() => {
    setExisting(loadTeam());
  }, []);

  function startNew() {
    const team = emptyTeam(selected, mode);
    saveTeam(team);
    trackGamePlay("38-0", { mode: "draft", board: tab });
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

            {/* spacer so sticky button doesn't cover the last card */}
            <div className="h-28" />
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
            <p className="font-body mt-1 mb-4" style={{ color: "#cfcfe6", fontSize: 14 }}>
              Pick a nation. Draft their XI from their real player pool. Play their actual World Cup 2026 path.
            </p>

            {/* How it works */}
            <div className="rounded-2xl p-4 mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.25)" }}>
              <div className="font-body mb-2.5" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW IT WORKS</div>
              {[
                ["①", "Pick your nation & draft your XI", "Only players from that nation are in your pool."],
                ["②", "Play the real WC 2026 fixtures",   "Your group, then the knockouts — vs the actual opponents."],
                ["③", "Win to advance · upgrade each round", "Survive the group, then it's win-or-go-home."],
                ["④", "Lose a knockout and you're out",   "Reach the final and lift the trophy. 🏆"],
              ].map(([n, title, desc]) => (
                <div key={n as string} className="flex gap-3 mb-2.5 last:mb-0">
                  <span className="font-display flex-shrink-0" style={{ fontSize: 17, color: "#ffb800" }}>{n}</span>
                  <div>
                    <div className="font-body" style={{ fontSize: 13, color: "#fff" }}>{title}</div>
                    <div className="font-body" style={{ fontSize: 12, color: "#8888aa", lineHeight: 1.35 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="font-body mb-3" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>PICK YOUR NATION</div>
            <div className="grid grid-cols-2 gap-2.5 pb-6">
              {nations.map((n) => (
                <Link
                  key={n.nation}
                  href={`/38-0/wc?nation=${encodeURIComponent(n.nation)}`}
                  className="flex items-center gap-3 rounded-2xl px-3 py-3.5 active:scale-[0.98] transition-transform"
                  style={{ background: "linear-gradient(135deg,rgba(255,184,0,0.09),rgba(255,184,0,0.03))", border: "1px solid rgba(255,184,0,0.28)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={n.crest} alt={n.nation} width={36} height={36} style={{ width: 36, height: 36, objectFit: "contain", flexShrink: 0 }} />
                  <span className="font-body flex-1 truncate" style={{ fontSize: 14, color: "#fff" }}>{n.nation}</span>
                  <span style={{ fontSize: 16, color: "#ffb800", flexShrink: 0 }}>→</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Sticky CTA — Premier League tab only ── */}
      {tab === "pl" && (
        <div className="fixed left-0 right-0 z-40"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))", background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "4px" }}>
          <div className="max-w-lg mx-auto px-5 pt-3">
            <button
              onClick={startNew}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 26 }}
            >
              DRAFT YOUR XI →
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
