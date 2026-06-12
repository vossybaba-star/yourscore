"use client";

/**
 * Draft XI — the shared full-time scorecard design (rare-tier collectible card).
 *
 * One look across every 38-0 result screen. <ScorecardView> is the generic renderer
 * driven by a normalised ScorecardData; sections (goal ledger, stats, line-ups,
 * player of the match) render only when their data is present, so a head-to-head
 * card and a leaner shared-link card share the exact same chrome with different
 * detail. <Scorecard m={...}> is a thin adapter for a local quick match.
 *
 * Visual language: obsidian-glass housing in a result-tinted metallic frame with
 * registration marks, fine grain, a "MATCHDAY 38" watermark and drifting embers; a
 * holographic foil scoreline over an engraved loser; tier crests; a centre-seam goal
 * ledger; a diverging metrics ledger; an authenticity strip. All motion is decorative
 * and disabled under prefers-reduced-motion; the result is always carried by text +
 * layout (FULL TIME · WIN/DRAW/LOSS), never colour or motion alone.
 */

import { useEffect, useRef, useState } from "react";
import { Pitch } from "@/components/draft/Pitch";
import type { LocalMatch } from "@/lib/draft/local";
import type { Formation, PlacedPlayer, Tier } from "@/lib/draft/types";
import type { MatchReport } from "@/lib/draft/live-score";
import { tierColor } from "@/lib/draft/ui";
// Pure data transforms live in a server-safe util module so server components can
// import them without crossing the "use client" boundary.
export type { ScorecardStat, ScorecardGoal, ScorecardPotm } from "@/lib/draft/scorecard-utils";
export { statsFromReport, goalsFromReport, potmFromReport } from "@/lib/draft/scorecard-utils";
import {
  statsFromReport, goalsFromReport, potmFromReport,
  type ScorecardStat, type ScorecardGoal, type ScorecardPotm,
} from "@/lib/draft/scorecard-utils";

export const SC_WIN = "#00ff87";
export const SC_DRAW = "#ffb800";
export const SC_LOSS = "#ff4757";
const INK = "#020204";

/** Metallic gradient families — used as background-clip:text foil stamping. */
export const FOIL: Record<"win" | "draw" | "loss", string> = {
  win: "linear-gradient(135deg,#eafff5 0%,#00ff87 25%,#00b765 50%,#00ff87 75%,#eafff5 100%)",
  draw: "linear-gradient(135deg,#fff7d1 0%,#ffd700 25%,#c79318 50%,#ffd700 75%,#fff7d1 100%)",
  loss: "linear-gradient(135deg,#ffe1e4 0%,#ff4757 25%,#b22b35 50%,#ff4757 75%,#ffe1e4 100%)",
};
const FRAME: Record<"win" | "draw" | "loss", string> = {
  win: "linear-gradient(135deg,#00ff87 0%,rgba(0,255,135,0.18) 25%,#00ff87 50%,rgba(0,255,135,0.18) 75%,#00ff87 100%)",
  draw: "linear-gradient(135deg,#ffd700 0%,rgba(255,215,0,0.18) 25%,#ffd700 50%,rgba(255,215,0,0.18) 75%,#ffd700 100%)",
  loss: "linear-gradient(135deg,#ff4757 0%,rgba(255,71,87,0.18) 25%,#ff4757 50%,rgba(255,71,87,0.18) 75%,#ff4757 100%)",
};
const ENGRAVE = "linear-gradient(180deg,#3a3a52 0%,#22222f 55%,#16161e 100%)";
const HOLO =
  "linear-gradient(110deg,transparent 40%,rgba(255,255,255,0.45) 45%,rgba(120,200,255,0.55) 50%,rgba(255,255,255,0.45) 55%,transparent 60%)";
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Fixed ember field — constant so SSR and hydration agree (no Math.random). */
const EMBERS = [
  { l: 8, b: 12, d: 6.2, delay: 0.0 }, { l: 22, b: 64, d: 4.8, delay: 1.4 },
  { l: 35, b: 28, d: 7.1, delay: 0.7 }, { l: 47, b: 80, d: 5.5, delay: 2.6 },
  { l: 58, b: 18, d: 6.6, delay: 1.1 }, { l: 69, b: 52, d: 4.4, delay: 3.1 },
  { l: 80, b: 36, d: 7.4, delay: 0.4 }, { l: 91, b: 70, d: 5.1, delay: 2.0 },
  { l: 14, b: 44, d: 6.9, delay: 3.6 }, { l: 28, b: 90, d: 4.9, delay: 1.8 },
  { l: 42, b: 8, d: 7.0, delay: 2.9 }, { l: 53, b: 58, d: 5.8, delay: 0.9 },
  { l: 64, b: 86, d: 6.3, delay: 3.3 }, { l: 75, b: 22, d: 4.6, delay: 1.6 },
  { l: 86, b: 48, d: 7.2, delay: 0.2 }, { l: 96, b: 14, d: 5.4, delay: 2.4 },
];

const clip: React.CSSProperties = {
  WebkitBackgroundClip: "text", backgroundClip: "text",
  WebkitTextFillColor: "transparent", color: "transparent",
};

/** Count a value up from 0 on mount; static for reduced-motion / SSR. */
export function useCountUp(to: number, enabled = true, ms = 800): number {
  const [v, setV] = useState(to);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || reduce || to === 0) { setV(to); return; }
    setV(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setV(Math.round((1 - Math.pow(1 - p, 3)) * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, enabled, ms]);
  return v;
}

/** Foil-stamped text: a metallic gradient clipped to the glyphs, with a slow sheen. */
export function Foil({ gradient, sheen, className, style, children }: { gradient: string; sheen?: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span className={`${sheen ? "motion-safe:animate-foil" : ""} ${className ?? ""}`} style={{ backgroundImage: gradient, backgroundSize: sheen ? "200% auto" : undefined, ...clip, ...style }}>
      {children}
    </span>
  );
}

/** Foil text with a holographic light-bar sweeping over it (the hero treatment). */
export function Holo({ gradient, className, style, children }: { gradient: string; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      <Foil gradient={gradient} sheen className={className} style={style}>{children}</Foil>
      <span aria-hidden className={`sc-holo absolute inset-0 ${className ?? ""}`} style={{ backgroundImage: HOLO, ...clip, ...style }}>{children}</span>
    </span>
  );
}

/** Shield crest carrying a side's tier colour + an inner number (strength / rank). */
export function Crest({ color, label }: { color: string; label: string | number }) {
  return (
    <span className="relative grid place-items-center" style={{ width: 44, height: 50 }}>
      <svg width="44" height="50" viewBox="0 0 38 44" fill="none" aria-hidden style={{ position: "absolute", inset: 0 }}>
        <path d="M19 1.5 36.5 7v14.5C36.5 32 28.8 39.5 19 42.5 9.2 39.5 1.5 32 1.5 21.5V7L19 1.5Z" fill={color} fillOpacity="0.16" stroke={color} strokeOpacity="0.55" strokeWidth="1" />
        <path d="M19 5 33 9.4v11.8C33 29.7 26.7 36 19 38.6 11.3 36 5 29.7 5 21.2V9.4L19 5Z" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      </svg>
      <span className="font-mono" style={{ fontSize: 14, fontWeight: 500, color, marginTop: -1, zIndex: 1 }}>{label}</span>
    </span>
  );
}

/** Section rule: kicked-out small-caps label with a hairline tail. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5" style={{ marginBottom: 16 }}>
      <span className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: "0.3em", color: "#5a5a78" }}>{children}</span>
      <span className="h-px flex-1" style={{ background: "linear-gradient(90deg,rgba(255,255,255,0.1),transparent)" }} />
    </div>
  );
}

/** Diverging metric row: value · label · value over a centre-origin bar. */
export function Metric({ label, a, b, accent, suffix = "" }: { label: string; a: number; b: number; accent: string; suffix?: string }) {
  const total = a + b || 1;
  const aFill = (a / total) * 50, bFill = (b / total) * 50;
  const aLeads = a >= b;
  return (
    <div>
      <div className="grid items-baseline" style={{ gridTemplateColumns: "1fr auto 1fr", gap: 16 }}>
        <span className="text-left font-mono" style={{ fontSize: 13, fontWeight: 500, color: aLeads ? accent : "#62627a" }}>{a}{suffix}</span>
        <span className="text-center font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: "0.2em", color: "#6a6a86", minWidth: 96 }}>{label}</span>
        <span className="text-right font-mono" style={{ fontSize: 13, fontWeight: 500, color: !aLeads ? accent : "#62627a" }}>{b}{suffix}</span>
      </div>
      <div className="relative mt-1.5 h-[3px] w-full rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 1, height: 8, background: "rgba(255,255,255,0.16)" }} />
        <span className="absolute top-0 bottom-0 rounded-l-full" style={{ right: "50%", width: `${aFill}%`, background: aLeads ? accent : "#23232f", boxShadow: aLeads ? `0 0 8px ${accent}66` : "none" }} />
        <span className="absolute top-0 bottom-0 rounded-r-full" style={{ left: "50%", width: `${bFill}%`, background: !aLeads ? accent : "#23232f", boxShadow: !aLeads ? `0 0 8px ${accent}66` : "none" }} />
      </div>
    </div>
  );
}

function GoalDiamond({ color }: { color: string }) {
  return <svg width="10" height="10" viewBox="0 0 11 11" aria-hidden style={{ flexShrink: 0 }}><path d="M5.5 0.6 10.4 5.5 5.5 10.4 0.6 5.5Z" fill={color} /></svg>;
}

/**
 * The collectible-card housing + chrome. Wraps any result content; the eyebrow
 * carries FULL TIME · <headline>, and the foot carries the authenticity strip.
 */
export function ScorecardShell({ fk, accent, eyebrow = "Full time", headline, serial, context, children }: {
  fk: "win" | "draw" | "loss"; accent: string; eyebrow?: string; headline: string;
  serial?: string; context?: string; children: React.ReactNode;
}) {
  return (
    <article
      className="relative overflow-hidden"
      style={{
        borderRadius: 32, background: "rgba(8,8,14,0.85)",
        backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.8), 0 40px 120px -30px rgba(0,0,0,0.92), inset 0 1px 2px rgba(255,255,255,0.14)",
      }}
    >
      {/* ember field */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {EMBERS.map((e, i) => (
          <span key={i} className="sc-particle absolute rounded-full" style={{ left: `${e.l}%`, bottom: `${e.b}%`, width: 2, height: 2, background: accent, boxShadow: `0 0 8px ${accent}`, opacity: 0, animationDuration: `${e.d}s`, animationDelay: `${e.delay}s` }} />
        ))}
      </div>
      {/* watermark */}
      <div className="pointer-events-none absolute select-none font-display" aria-hidden style={{ right: -26, top: "50%", transform: "translateY(-50%) rotate(90deg)", fontSize: 110, letterSpacing: "0.1em", color: "rgba(255,255,255,0.022)", whiteSpace: "nowrap" }}>MATCHDAY 38</div>
      {/* grain */}
      <div className="pointer-events-none absolute inset-0" aria-hidden style={{ backgroundImage: GRAIN, backgroundSize: "160px 160px", opacity: 0.035, mixBlendMode: "overlay" }} />
      {/* metallic frame */}
      <div className="pointer-events-none absolute" aria-hidden style={{ inset: 6, borderRadius: 26, border: "1.5px solid transparent", opacity: 0.4, background: `linear-gradient(${INK},${INK}) padding-box, ${FRAME[fk]} border-box`, WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)" }} />
      {/* registration marks */}
      {(["tl", "tr", "bl", "br"] as const).map((c) => {
        const top = c[0] === "t", left = c[1] === "l";
        return <span key={c} className="pointer-events-none absolute" aria-hidden style={{ width: 13, height: 13, [top ? "top" : "bottom"]: 16, [left ? "left" : "right"]: 16, [top ? "borderTop" : "borderBottom"]: "1px solid rgba(255,255,255,0.2)", [left ? "borderLeft" : "borderRight"]: "1px solid rgba(255,255,255,0.2)" } as React.CSSProperties} />;
      })}

      <div className="relative" style={{ padding: 30 }}>
        {/* eyebrow */}
        <div className="flex items-center justify-between" style={{ marginBottom: 30 }}>
          <div className="flex items-center gap-2">
            <span className="rounded-full motion-safe:animate-pulse-slow" style={{ width: 6, height: 6, background: accent, boxShadow: `0 0 10px ${accent}` }} />
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.2em", color: "#8888aa" }}>{eyebrow}</span>
            <span style={{ width: 1, height: 9, background: "rgba(255,255,255,0.16)" }} />
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.2em", color: accent }}>{headline}</span>
          </div>
          <div className="font-display" style={{ fontSize: 14, letterSpacing: "0.05em" }}>
            <span style={{ color: "rgba(255,255,255,0.9)" }}>YOUR</span>
            <Holo gradient={FOIL[fk]} style={{ fontWeight: 700 }}>SCORE</Holo>
          </div>
        </div>

        {children}

        {/* authenticity strip */}
        <div className="flex items-center gap-3" style={{ opacity: 0.65 }}>
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
          <span className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: "0.18em", color: "#55556e" }}>{serial ? `№ ${serial} · ` : ""}{context ? `${context} · ` : ""}yourscore.app</span>
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.08)" }} />
        </div>
      </div>
    </article>
  );
}

// ── Generic head-to-head card ────────────────────────────────────────────────

export type ScorecardSide = { name: string; strength?: number; tier?: Tier; formation?: Formation; squad?: PlacedPlayer[] };
export type ScorecardData = {
  id?: string; context?: string;
  you: ScorecardSide; opp: ScorecardSide;
  goals: { you: number; opp: number };
  pens?: { you: number; opp: number } | null;
  outcome: "you" | "opp" | "draw";
  stats?: ScorecardStat[];
  /** undefined = goals unknown (hide ledger); [] = known to be 0-0. */
  goalEvents?: ScorecardGoal[];
  potm?: ScorecardPotm | null;
  countUp?: boolean;
};

function serialOf(id?: string): string {
  return (id || "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0") || "0038";
}

export function ScorecardView({ data }: { data: ScorecardData }) {
  const won = data.outcome === "you", drew = data.outcome === "draw";
  const accent = won ? SC_WIN : drew ? SC_DRAW : SC_LOSS;
  const fk: "win" | "draw" | "loss" = won ? "win" : drew ? "draw" : "loss";
  const headline = won ? "WIN" : drew ? "DRAW" : "LOSS";

  const youUp = useCountUp(data.goals.you, data.countUp ?? true);
  const oppUp = useCountUp(data.goals.opp, data.countUp ?? true);
  const youWon = data.goals.you >= data.goals.opp;
  const oppWon = data.goals.opp >= data.goals.you;
  const numShadow = (lead: boolean) => (lead ? `drop-shadow(0 0 26px ${accent}40)` : "drop-shadow(0 1px 0 rgba(255,255,255,0.05))");

  const youTier = tierColor(data.you.tier ?? ("Mid-table" as Tier));
  const oppTier = tierColor(data.opp.tier ?? ("Mid-table" as Tier));
  const goals = data.goalEvents;

  return (
    <ScorecardShell fk={fk} accent={accent} headline={headline} serial={serialOf(data.id)} context={data.context}>
      {/* scoreboard */}
      <div className="grid items-center" style={{ gridTemplateColumns: "1fr auto 1fr", gap: 12, marginBottom: 30 }}>
        <div className="flex min-w-0 flex-col items-center gap-2.5">
          {data.you.strength != null && <Crest color={youTier} label={data.you.strength} />}
          <span className="font-display truncate max-w-full" style={{ fontSize: 20, letterSpacing: "0.04em", color: won ? SC_WIN : "#fff" }}>{data.you.name}</span>
        </div>
        <div className="flex items-center" style={{ gap: 18 }}>
          {youWon
            ? <Holo gradient={FOIL[fk]} className="font-display tabular-nums" style={{ fontSize: 84, lineHeight: 0.8, filter: numShadow(true) }}>{youUp}</Holo>
            : <Foil gradient={ENGRAVE} className="font-display tabular-nums" style={{ fontSize: 84, lineHeight: 0.8, filter: numShadow(false) }}>{youUp}</Foil>}
          <span style={{ width: 2, height: 60, background: "linear-gradient(180deg,transparent,rgba(255,255,255,0.22),transparent)", transform: "skewX(-15deg)" }} />
          {oppWon
            ? <Holo gradient={FOIL[fk]} className="font-display tabular-nums" style={{ fontSize: 84, lineHeight: 0.8, filter: numShadow(true) }}>{oppUp}</Holo>
            : <Foil gradient={ENGRAVE} className="font-display tabular-nums" style={{ fontSize: 84, lineHeight: 0.8, filter: numShadow(false) }}>{oppUp}</Foil>}
        </div>
        <div className="flex min-w-0 flex-col items-center gap-2.5">
          {data.opp.strength != null && <Crest color={oppTier} label={data.opp.strength} />}
          <span className="font-display truncate max-w-full" style={{ fontSize: 20, letterSpacing: "0.04em", color: data.outcome === "opp" ? SC_LOSS : "#fff" }}>{data.opp.name}</span>
        </div>
      </div>

      {data.pens && (
        <p className="text-center font-mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: SC_DRAW, marginTop: -18, marginBottom: 24 }}>PENALTIES {data.pens.you}–{data.pens.opp}</p>
      )}

      {/* goal ledger */}
      {goals && (
        <>
          <SectionLabel>Goal ledger</SectionLabel>
          {goals.length === 0 ? (
            <p className="text-center font-mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "#62627a", marginBottom: 30 }}>NO GOALS · 0–0</p>
          ) : (
            <div className="relative" style={{ marginBottom: 30 }}>
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2" style={{ width: 1, background: "linear-gradient(180deg,transparent,rgba(255,255,255,0.1) 12%,rgba(255,255,255,0.1) 88%,transparent)" }} />
              <ul className="relative" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {goals.map((g, i) => {
                  const col = g.mine ? SC_WIN : SC_LOSS;
                  return (
                    <li key={i} className="grid items-center" style={{ gridTemplateColumns: "1fr 40px 1fr", gap: 10 }}>
                      <div className={g.mine ? "flex items-center justify-end gap-2" : ""}>
                        {g.mine && (<><GoalInfo name={g.name} assist={g.assist} align="right" /><GoalDiamond color={col} /></>)}
                      </div>
                      <div className="flex justify-center">
                        <span className="font-mono tabular-nums" style={{ fontSize: 11, color: col, padding: "2px 6px", borderRadius: 4, background: `${col}12`, border: `1px solid ${col}40` }}>{g.minute}&apos;</span>
                      </div>
                      <div className={!g.mine ? "flex items-center justify-start gap-2" : ""}>
                        {!g.mine && (<><GoalDiamond color={col} /><GoalInfo name={g.name} assist={g.assist} align="left" /></>)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {/* player of the match */}
      {data.potm && (
        <>
          <SectionLabel>Player of the match</SectionLabel>
          <div className="flex items-center gap-4 rounded-3xl" style={{ marginBottom: 30, padding: 18, background: "linear-gradient(135deg,rgba(255,184,0,0.08),rgba(255,184,0,0.02))", border: "1px solid rgba(255,184,0,0.2)", boxShadow: "0 14px 40px -16px rgba(255,184,0,0.18)" }}>
            <div className="relative grid shrink-0 place-items-center rounded-full" style={{ width: 56, height: 56, border: "1px solid rgba(255,184,0,0.32)" }}>
              <span className="absolute rounded-full" style={{ inset: 4, border: "1px solid rgba(255,184,0,0.12)" }} />
              <Foil gradient={FOIL.draw} sheen className="font-display tabular-nums" style={{ fontSize: 23, position: "relative" }}>{data.potm.rating.toFixed(1)}</Foil>
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display truncate" style={{ fontSize: 22, color: "#fff", letterSpacing: "0.03em" }}>{data.potm.name}</div>
              <div className="mt-1 flex items-center gap-2 font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: "0.1em", color: "#8a8aa6" }}>
                {data.potm.sideName && <span style={{ color: SC_DRAW }}>{data.potm.sideName}</span>}
                {data.potm.pos && (<><span style={{ opacity: 0.3 }}>|</span><span>{data.potm.pos}</span></>)}
                {!!data.potm.goals && (<><span style={{ opacity: 0.3 }}>|</span><span>{data.potm.goals}G</span></>)}
                {!!data.potm.assists && (<><span style={{ opacity: 0.3 }}>|</span><span>{data.potm.assists}A</span></>)}
              </div>
            </div>
          </div>
        </>
      )}

      {/* match metrics */}
      {data.stats && data.stats.length > 0 && (
        <>
          <SectionLabel>Match metrics</SectionLabel>
          <div className="flex flex-col" style={{ gap: 14, marginBottom: 30 }}>
            {data.stats.map((s) => <Metric key={s.label} label={s.label} a={s.a} b={s.b} suffix={s.suffix} accent={accent} />)}
          </div>
        </>
      )}

      {/* line-ups */}
      {data.you.squad && data.opp.squad && data.you.formation && data.opp.formation && (
        <>
          <SectionLabel>The line-ups</SectionLabel>
          <div className="grid grid-cols-2 gap-4" style={{ marginBottom: 30 }}>
            <TeamPanel name={data.you.name} strength={data.you.strength} tierCol={youTier} formation={data.you.formation} squad={data.you.squad} nameColor={won ? SC_WIN : "#fff"} label="Your XI" />
            <TeamPanel name={data.opp.name} strength={data.opp.strength} tierCol={oppTier} formation={data.opp.formation} squad={data.opp.squad} nameColor={data.outcome === "opp" ? SC_LOSS : "#fff"} label={`${data.opp.name}'s XI`} />
          </div>
        </>
      )}
    </ScorecardShell>
  );
}

function GoalInfo({ name, assist, align }: { name: string; assist?: string; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "min-w-0 text-right" : "min-w-0 text-left"}>
      <div className="truncate font-body" style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{name}</div>
      <div className="truncate font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.06em", color: "#6a6a86" }}>{assist ?? "Unassisted"}</div>
    </div>
  );
}

function TeamPanel({ name, strength, tierCol, formation, squad, nameColor, label }: { name: string; strength?: number; tierCol: string; formation: Formation; squad: PlacedPlayer[]; nameColor: string; label: string }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display" style={{ fontSize: 15, color: nameColor, letterSpacing: "0.03em" }}>{name}</span>
        {strength != null && <span className="font-mono shrink-0" style={{ fontSize: 13, fontWeight: 500, color: tierCol }}>{strength}</span>}
      </div>
      <p className="mb-2 mt-0.5 truncate font-mono uppercase" style={{ fontSize: 8, letterSpacing: "0.1em", color: "#5a5a74" }}>{label} · {formation}</p>
      <Pitch formation={formation} squad={squad} compact />
    </div>
  );
}

// ── Adapter: local quick match ───────────────────────────────────────────────

export function Scorecard({ m, context = "Quick Match" }: { m: LocalMatch; context?: string }) {
  const data: ScorecardData = {
    id: m.id, context,
    you: { name: "You", strength: m.you.strength, tier: m.you.projected?.tier, formation: m.you.formation, squad: m.you.squad },
    opp: { name: m.opp.name, strength: m.opp.strength, tier: m.opp.projected?.tier, formation: m.opp.formation, squad: m.opp.squad },
    goals: { you: m.goals.you, opp: m.goals.opp },
    pens: m.pens ? { you: m.pens.you, opp: m.pens.opp } : null,
    outcome: m.outcome,
    stats: statsFromReport(m.report),
    goalEvents: goalsFromReport(m.report),
    potm: potmFromReport(m.report, "You", m.opp.name),
  };
  return <ScorecardView data={data} />;
}
