"use client";

/**
 * /38-0 — Draft XI entry. Premier League / La Liga / World Cup tabs. The two
 * league tabs share one draft UI (parametrised by competition); World Cup is its
 * own nation-pick flow.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/ui/BottomNav";
import { Pitch } from "@/components/draft/Pitch";
import { FORMATIONS, LEAGUE_META } from "@/lib/draft/types";
import type { Formation, League } from "@/lib/draft/types";
import { FORMATION_NOTE } from "@/lib/draft/formations";
import { emptyTeam, loadTeam, saveTeam, isComplete, type LocalTeam, type DraftMode } from "@/lib/draft/local";
import { LEAGUE_COUNTS, pickableNations } from "@/lib/draft/pool";
import { trackGamePlay } from "@/lib/analytics/trackGame";
import { useUser } from "@/hooks/useUser";

type DraftTab = "pl" | "laliga" | "wc";

// The two league draft tabs share all gameplay UI — only the competition, branding
// and accent differ.
const LEAGUE_TABS: Record<"pl" | "laliga", { league: League; emoji: string; title: string; blurb: string; accent: string; onAccent: string }> = {
  pl: {
    league: "PL", emoji: "⚽", title: "PREMIER LEAGUE",
    blurb: "Spin for legends. Draft your all-time XI. Beat the world head-to-head.",
    accent: "#00ff87", onAccent: "#062013",
  },
  laliga: {
    league: "LaLiga", emoji: "🇪🇸", title: "LA LIGA",
    blurb: "Spin for galácticos. Draft your all-time XI. Beat the world head-to-head.",
    accent: "#ff5b2e", onAccent: "#1c0702",
  },
};

export default function DraftHome() {
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [tab, setTab] = useState<DraftTab>("pl");
  const [selected, setSelected] = useState<Formation>("4-3-3");
  const [mode, setMode] = useState<DraftMode>("classic");
  const [existing, setExisting] = useState<LocalTeam | null>(null);
  const nations = useMemo(() => pickableNations(), []);

  useEffect(() => {
    setExisting(loadTeam());
  }, []);

  const cfg = tab === "wc" ? null : LEAGUE_TABS[tab];

  function startNew() {
    if (!cfg) return;
    const team = emptyTeam(selected, mode, cfg.league);
    saveTeam(team);
    trackGamePlay("38-0", { mode: "draft", board: tab });
    router.push("/38-0/play");
  }

  // The in-progress local team belongs to whichever competition it was drafted in —
  // only surface its "continue" card under the matching tab.
  //
  // Signed-in users:   show both incomplete ("KEEP BUILDING") and complete ("CONTINUE WITH YOUR TEAM").
  // Anonymous users:   show incomplete only — let them finish the draft → team → season run.
  //                    A complete team with no sign-in shows a "Save Your Team" CTA instead.
  const teamInProgress = cfg && existing && existing.squad.length > 0 && existing.league === cfg.league ? existing : null;
  const continueTeam = teamInProgress && (user || !isComplete(teamInProgress)) ? teamInProgress : null;
  // Prompt anonymous users who have a complete team (they've drafted but not signed up).
  // Guard on !authLoading: while auth is still resolving user is null, which would
  // incorrectly flash the sign-up CTA at signed-in users before their session loads.
  const anonSavePrompt = !authLoading && !user && !!teamInProgress && isComplete(teamInProgress);
  const q = cfg ? `?competition=${cfg.league}` : "";

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

        {/* ── Main tab switcher ── */}
        <div className="flex gap-1 p-1 rounded-2xl mb-4"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {([
            { key: "pl" as DraftTab, label: "⚽ Premier League", on: "#00ff87", onText: "#062013" },
            { key: "laliga" as DraftTab, label: "🇪🇸 La Liga", on: "#ff5b2e", onText: "#1c0702" },
            { key: "wc" as DraftTab, label: "🏆 World Cup", on: "#ffb800", onText: "#0a0a0f" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 py-2 rounded-xl font-body text-xs font-semibold transition-all"
              style={tab === t.key
                ? { background: t.on, color: t.onText }
                : { background: "transparent", color: "#8888aa" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Secondary nav pills ── */}
        {cfg && (
          <div className="flex gap-2 mb-6">
            {([
              { href: `/38-0/live${q}`,        label: "⚡ Live H2H",    color: cfg.accent },
              { href: `/38-0/teams${q}`,       label: "📁 My Teams",    color: "#a78bfa" },
              { href: `/38-0/leaderboard${q}`, label: "🏆 Leaderboard", color: "#ffb800" },
            ]).map(({ href, label, color }) => (
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
            ]).map(({ href, label, color }) => (
              <Link key={href} href={href}
                className="flex-1 py-2.5 rounded-full text-center font-display tracking-wide transition-all active:scale-95"
                style={{ fontSize: 12, color, background: `${color}1f`, border: `1px solid ${color}40` }}>
                {label}
              </Link>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            LEAGUE DRAFT TAB (Premier League / La Liga — shared UI)
        ══════════════════════════════════════════════════════════════════ */}
        {cfg && (
          <>
            <h2 className="font-display tracking-wide leading-none" style={{ fontSize: 30, color: "#fff" }}>
              {cfg.emoji} {cfg.title} <span style={{ color: cfg.accent }}>XI</span>
            </h2>
            <p className="font-body mt-1 mb-1" style={{ color: "#cfcfe6", fontSize: 14 }}>
              {cfg.blurb}
            </p>
            <p className="font-body mb-5" style={{ color: "#8888aa", fontSize: 12 }}>
              {LEAGUE_COUNTS[cfg.league].players} all-time {LEAGUE_META[cfg.league].name} player-seasons · {LEAGUE_COUNTS[cfg.league].buckets} legendary squads
            </p>

            {/* continue card — signed-in: both complete + in-progress; anonymous: in-progress only */}
            {continueTeam && (
              <Link
                href={isComplete(continueTeam) ? "/38-0/team" : "/38-0/play"}
                className="block mb-6 rounded-2xl p-4 active:scale-[0.98] transition-transform"
                style={{ background: `linear-gradient(135deg,${cfg.accent}1f,${cfg.accent}0d)`, border: `1px solid ${cfg.accent}40` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                      {isComplete(continueTeam) ? "CONTINUE WITH YOUR TEAM" : "KEEP BUILDING"}
                    </div>
                    <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>
                      {continueTeam.formation} · {continueTeam.squad.length}/11 drafted
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 34, color: cfg.accent }}>
                    {isComplete(continueTeam) ? continueTeam.strength : "→"}
                  </div>
                </div>
              </Link>
            )}

            {/* Sign-up prompt for anonymous users who have a complete team — no "continue" without an account */}
            {anonSavePrompt && (
              <Link
                href="/auth/sign-in"
                className="block mb-6 rounded-2xl p-4 active:scale-[0.98] transition-transform"
                style={{ background: "rgba(0,201,255,0.06)", border: "1px solid rgba(0,201,255,0.25)" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>
                      SAVE YOUR TEAM
                    </div>
                    <div className="font-body" style={{ fontSize: 13, color: "#8888aa" }}>
                      Sign up to keep this XI and go head-to-head
                    </div>
                  </div>
                  <div className="font-display" style={{ fontSize: 28, color: "#00c9ff" }}>→</div>
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
                      background: active ? `${cfg.accent}1f` : "#12121e",
                      border: `1px solid ${active ? `${cfg.accent}80` : "rgba(255,255,255,0.08)"}`,
                      color: active ? cfg.accent : "#fff",
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
                { key: "classic" as DraftMode, label: "CLASSIC", desc: "Ratings shown — draft the strongest XI", color: cfg.accent },
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
              Draft an XI and play a World Cup campaign — group, then knockouts, all the way to the final. Two ways to play.
            </p>

            {/* How it works */}
            <div className="rounded-2xl p-4 mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,184,0,0.25)" }}>
              <div className="font-body mb-2.5" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW IT WORKS</div>
              {[
                ["①", "Build your XI", "Spin & pick — any rating can come up, luck of the draw."],
                ["②", "Play the World Cup", "A group, then the knockouts — vs real nations, tougher each round."],
                ["③", "Win to advance · free re-spins", "Survive the group, then it's win-or-go-home."],
                ["④", "Lose a knockout and you're out", "Reach the final and lift the trophy. 🏆"],
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

            {/* World Cup mode — open draft from any nation */}
            <Link
              href="/38-0/wc?mode=world"
              className="flex items-center gap-3 rounded-2xl px-4 py-4 mb-5 active:scale-[0.99] transition-transform"
              style={{ background: "linear-gradient(135deg,rgba(255,184,0,0.16),rgba(255,184,0,0.04))", border: "1px solid rgba(255,184,0,0.4)" }}
            >
              <span style={{ fontSize: 30, flexShrink: 0 }}>🌍</span>
              <div className="flex-1 min-w-0">
                <div className="font-display tracking-wide" style={{ fontSize: 18, color: "#ffb800" }}>WORLD CUP — ANY NATION</div>
                <div className="font-body" style={{ fontSize: 12.5, color: "#cfcfe6", lineHeight: 1.35 }}>Open draft — build a dream team from any nation&apos;s players. Beat the best in the world.</div>
              </div>
              <span style={{ fontSize: 16, color: "#ffb800", flexShrink: 0 }}>→</span>
            </Link>

            <div className="font-body mb-3" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>OR PLAY AS A NATION</div>
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

      {/* ── Sticky CTA — league draft tabs only ── */}
      {cfg && (
        <div className="fixed left-0 right-0 z-40"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))", background: "linear-gradient(0deg,#0a0a0f 70%,transparent)", paddingBottom: "4px" }}>
          <div className="max-w-lg mx-auto px-5 pt-3">
            <button
              onClick={startNew}
              className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: cfg.accent, color: cfg.onAccent, fontSize: 26 }}
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
