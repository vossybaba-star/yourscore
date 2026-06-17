"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { useUser } from "@/hooks/useUser";
import { FlagImage } from "@/components/ui/FlagImage";
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  resetOnboarding,
} from "@/lib/onboarding";
import { OnboardingShell } from "./OnboardingShell";
import { OnboardingPanel } from "./OnboardingPanel";
import { PanelCarousel } from "./PanelCarousel";
import { OnboardingAuthStep } from "./OnboardingAuthStep";

const LIME = "#aeea00";
const TEAL = "#00d8c0";
const GOLD = "#ffc233";

// ── Panel visuals (zero new assets — built from existing primitives) ──────────

function CountdownRing({ color }: { color: string }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="-rotate-90">
      <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
      <circle
        cx="17"
        cy="17"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * 0.32}
      />
    </svg>
  );
}

function QuizVisual() {
  const opts = [
    { k: "A", t: "Cannavaro" },
    { k: "B", t: "Zidane", on: true },
    { k: "C", t: "Pirlo" },
    { k: "D", t: "Buffon" },
  ];
  return (
    <div className="card-raised w-full p-5 text-left">
      <div className="flex items-center justify-between mb-3">
        <span className="font-body text-[11px] uppercase tracking-widest text-text-muted">
          Question 3 / 8
        </span>
        <CountdownRing color={TEAL} />
      </div>
      <p className="font-body text-sm text-white mb-4 leading-snug">
        Who won the 2006 World Cup Golden Ball?
      </p>
      <div className="space-y-2">
        {opts.map((o) => (
          <div
            key={o.k}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
            style={{
              background: o.on ? "rgba(0,216,192,0.14)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${o.on ? "rgba(0,216,192,0.5)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <span className="font-body text-xs font-semibold" style={{ color: o.on ? TEAL : "#8a948f" }}>
              {o.k}
            </span>
            <span className="font-body text-[13px]" style={{ color: o.on ? "#fff" : "#c7cdca" }}>
              {o.t}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DraftVisual() {
  const rows = [
    { label: "ATT", names: ["Henry", "Ronaldo", "Messi"] },
    { label: "MID", names: ["Zidane", "Xavi", "Iniesta"] },
    { label: "DEF", names: ["Cafu", "Maldini", "Puyol", "Roberto C."] },
    { label: "GK", names: ["Buffon"] },
  ];
  return (
    <div className="card-raised ob-float w-full p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-display text-xl text-white tracking-wide">MY XI · 4-3-3</span>
        <span className="font-body text-xs text-text-muted">
          Strength <b style={{ color: LIME }}>87</b>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="w-8 font-body text-[10px] text-text-muted shrink-0">{r.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {r.names.map((n) => (
                <span
                  key={n}
                  className="rounded-md px-2 py-1 font-body text-[11px] text-white"
                  style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.3)" }}
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankVisual() {
  const rows = [
    { pos: 1, team: "Brazil", name: "You", pts: 2840, me: true },
    { pos: 2, team: "India", name: "Priya", pts: 2720 },
    { pos: 3, team: "England", name: "Jamie", pts: 2650 },
    { pos: 4, team: "Nigeria", name: "Marcus", pts: 2590 },
  ];
  return (
    <div className="card-raised ob-float w-full p-4 relative">
      <div
        className="absolute -top-3 -right-2 rounded-full px-2.5 py-1 font-body text-[11px] font-semibold"
        style={{ background: GOLD, color: "#241a00", boxShadow: "0 6px 14px rgba(255,194,51,0.35)" }}
      >
        👑 #1
      </div>
      <span className="font-display text-base text-white tracking-wide block mb-3">YOURSCORE RANK</span>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.pos}
            className="flex items-center gap-3 rounded-lg px-2.5 py-2"
            style={{
              background: r.me ? "rgba(255,194,51,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${r.me ? "rgba(255,194,51,0.4)" : "rgba(255,255,255,0.05)"}`,
            }}
          >
            <span className="font-display text-sm w-4" style={{ color: r.me ? GOLD : "#8a948f" }}>
              {r.pos}
            </span>
            <FlagImage team={r.team} size={22} />
            <span className="font-body text-[13px] flex-1" style={{ color: r.me ? "#fff" : "#c7cdca" }}>
              {r.name}
            </span>
            <span className="font-body text-xs" style={{ color: r.me ? GOLD : "#8a948f" }}>
              {r.pts.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface PanelDef {
  tag: string;
  accent: string;
  headline: string[];
  subcopy: string;
  visual: React.ReactNode;
}

// Quiz leads — lowest-friction, most universally approachable for a brand-new user.
const PANELS: PanelDef[] = [
  {
    tag: "Quiz",
    accent: TEAL,
    headline: ["Know your", "football."],
    subcopy:
      "Test your football knowledge against the clock. Faster answers score more. Climb the ranked ladder.",
    visual: <QuizVisual />,
  },
  {
    tag: "38-0",
    accent: LIME,
    headline: ["Build your XI.", "Go 38-0."],
    subcopy:
      "Draft eleven real players, go head-to-head with your mates, and chase the dream: 38 games, zero losses.",
    visual: <DraftVisual />,
  },
  {
    tag: "YourScore Rank",
    accent: GOLD,
    headline: ["Climb the", "rankings."],
    subcopy:
      "Every game feeds your YourScore Rank. See exactly where you stand against your mates.",
    visual: <RankVisual />,
  },
];

// ── Carousel chrome ───────────────────────────────────────────────────────────

function Dots({
  count,
  index,
  accent,
  onSelect,
}: {
  count: number;
  index: number;
  accent: string;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          aria-label={`Go to panel ${i + 1}`}
          onClick={() => onSelect(i)}
          className="h-2 rounded-full transition-all"
          style={{
            width: i === index ? 28 : 8,
            background: i === index ? accent : "rgba(255,255,255,0.16)",
          }}
        />
      ))}
    </div>
  );
}

// ── Splash (anti-flash cover while the client session resolves) ───────────────

function Splash() {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "var(--bg)" }}
    >
      <span className="font-display text-4xl tracking-wide" style={{ color: LIME }}>
        YourScore
      </span>
    </div>
  );
}

// ── Flow (mounted only when native + first-run) ───────────────────────────────

type Phase = { kind: "panels"; index: number } | { kind: "auth" };

function OnboardingFlow() {
  const { user, loading } = useUser();
  const [done, setDone] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "panels", index: 0 });

  // Returning user already has a session → never onboard; mark seen and bail.
  useEffect(() => {
    if (!loading && user) {
      markOnboardingSeen();
      setDone(true);
    }
  }, [loading, user]);

  if (done) return null;
  if (loading) return <Splash />; // covers MarketingLanding underneath, no flash
  if (user) return null; // teardown imminent (effect above)

  const last = PANELS.length - 1;
  const accent = phase.kind === "panels" ? PANELS[phase.index].accent : LIME;
  const isQuizPanel = phase.kind === "panels" && phase.index === 0;

  // Commit point: reaching the auth step marks onboarding seen *before* any OAuth
  // detour, so the post-auth deep-link reload can't re-trigger the carousel.
  function goToAuth() {
    markOnboardingSeen();
    setPhase({ kind: "auth" });
  }

  function continueAsGuest() {
    markOnboardingSeen();
    window.location.href = "/38-0"; // straight into the playable game, not the web page
  }

  return (
    <OnboardingShell accent={accent}>
      {phase.kind === "panels" ? (
        <>
          <div className="pt-safe flex justify-end px-5 pt-3">
            <button
              onClick={goToAuth}
              className="font-body text-xs text-text-muted py-2 px-2 hover:text-white transition-colors"
            >
              Skip
            </button>
          </div>

          <PanelCarousel
            index={phase.index}
            onIndex={(i) => setPhase({ kind: "panels", index: i })}
          >
            {PANELS.map((p) => (
              <OnboardingPanel
                key={p.tag}
                tag={p.tag}
                accent={p.accent}
                headline={p.headline}
                subcopy={p.subcopy}
              >
                {p.visual}
              </OnboardingPanel>
            ))}
          </PanelCarousel>

          <div
            className="px-7 pt-2 space-y-5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 18px)" }}
          >
            <Dots
              count={PANELS.length}
              index={phase.index}
              accent={accent}
              onSelect={(i) => setPhase({ kind: "panels", index: i })}
            />
            <button
              onClick={() =>
                phase.index < last
                  ? setPhase({ kind: "panels", index: phase.index + 1 })
                  : goToAuth()
              }
              className={`${isQuizPanel ? "btn-ticket btn-ticket--teal" : "btn-ticket"} w-full justify-center py-4 text-lg`}
            >
              {phase.index < last ? "Next" : "Get started"}
            </button>
          </div>
        </>
      ) : (
        <OnboardingAuthStep onGuest={continueAsGuest} />
      )}
    </OnboardingShell>
  );
}

// ── Gate ──────────────────────────────────────────────────────────────────────
// Outer guard keeps useUser (and its Supabase call) from ever running on web or
// after the flow is done — the inner flow only mounts on native first-run.
export function NativeOnboarding() {
  const [engage, setEngage] = useState<boolean | null>(null);

  useEffect(() => {
    setEngage(isNative() && !hasSeenOnboarding());
    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
      (window as unknown as { __resetOnboarding?: () => void }).__resetOnboarding = resetOnboarding;
    }
  }, []);

  if (!engage) return null;
  return <OnboardingFlow />;
}
