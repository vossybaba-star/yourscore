"use client";

/**
 * Draft XI — full-time broadcast scorecard.
 *
 * The premium, screenshot-worthy "FULL TIME" graphic shown after a head-to-head:
 * an LED-style scoreboard, the match told down a centre-seam goal timeline, the
 * star of the match, mirrored broadcast stat bars, and both XIs. Pure presentation
 * over a finished LocalMatch — the result page owns sharing + the next-step CTAs.
 *
 * One bold element (the goal timeline); everything around it stays quiet. Honours
 * prefers-reduced-motion and never relies on motion to convey the result.
 */

import { useEffect, useRef, useState } from "react";
import { Pitch } from "@/components/draft/Pitch";
import type { LocalMatch } from "@/lib/draft/local";
import { tierColor } from "@/lib/draft/ui";

const WIN = "#00ff87";
const DRAW = "#ffb800";
const LOSS = "#ff4757";
const MUTED = "#6e6e88";

/** Count a value up from 0 on mount; static for reduced-motion / SSR. */
function useCountUp(to: number, ms = 650): number {
  const [v, setV] = useState(to);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || to === 0) {
      setV(to);
      return;
    }
    setV(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(eased * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

/** Mirrored broadcast stat bar: your value | label | opponent value, with a single
 *  split track that fills toward whoever leads. */
function StatBar({
  label,
  a,
  b,
  suffix = "",
  youColor,
}: {
  label: string;
  a: number;
  b: number;
  suffix?: string;
  youColor: string;
}) {
  const total = a + b;
  const aPct = total === 0 ? 50 : (a / total) * 100;
  const aLeads = a >= b;
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          className="font-body tabular-nums"
          style={{ fontSize: 14, fontWeight: 800, color: aLeads ? "#fff" : "#7a7a92" }}
        >
          {a}
          {suffix}
        </span>
        <span
          className="font-body uppercase"
          style={{ fontSize: 10, letterSpacing: "0.14em", color: "#7a7a92" }}
        >
          {label}
        </span>
        <span
          className="font-body tabular-nums"
          style={{ fontSize: 14, fontWeight: 800, color: !aLeads ? "#fff" : "#7a7a92" }}
        >
          {b}
          {suffix}
        </span>
      </div>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.05)" }}
        role="presentation"
      >
        <div
          style={{
            width: `${aPct}%`,
            background: youColor,
            opacity: aLeads ? 1 : 0.45,
            transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
        <div
          style={{
            width: `${100 - aPct}%`,
            background: "#5a5a78",
            opacity: !aLeads ? 1 : 0.55,
            transition: "width 0.6s cubic-bezier(0.16,1,0.3,1)",
          }}
        />
      </div>
    </div>
  );
}

export function Scorecard({ m }: { m: LocalMatch }) {
  const won = m.outcome === "you";
  const drew = m.outcome === "draw";
  const accent = won ? WIN : drew ? DRAW : LOSS;
  const headline = won ? "WIN" : drew ? "DRAW" : "LOSS";
  const rep = m.report;

  const youUp = useCountUp(m.goals.you);
  const oppUp = useCountUp(m.goals.opp);

  // Scoreline colours: the higher score wears the result accent, the lower dims.
  const youNum = m.goals.you > m.goals.opp ? accent : m.goals.you < m.goals.opp ? MUTED : accent;
  const oppNum = m.goals.opp > m.goals.you ? accent : m.goals.opp < m.goals.you ? MUTED : accent;

  const goals = [...rep.events].sort((x, y) => x.minute - y.minute);

  const stats: [string, number, number, string][] = [
    ["Possession", rep.a.possession, rep.b.possession, "%"],
    ["Shots", rep.a.shots, rep.b.shots, ""],
    ["On target", rep.a.shotsOnTarget, rep.b.shotsOnTarget, ""],
    ["Corners", rep.a.corners, rep.b.corners, ""],
    ["Fouls", rep.a.fouls, rep.b.fouls, ""],
    ["Offsides", rep.a.offsides, rep.b.offsides, ""],
    ["Throw-ins", rep.a.throwins, rep.b.throwins, ""],
  ];

  const potmIsYou = rep.potm?.side === "a";

  return (
    <div
      className="relative overflow-hidden rounded-[28px]"
      style={{
        background: "linear-gradient(180deg, #0e0e18 0%, #0a0a0f 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 80px -40px rgba(0,0,0,0.9)",
      }}
    >
      {/* result accent — top rule + ambient glow */}
      <div className="absolute left-0 right-0 top-0" style={{ height: 3, background: accent }} />
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{
          top: -120,
          width: 420,
          height: 320,
          background: `radial-gradient(closest-side, ${accent}22, transparent 70%)`,
        }}
      />

      <div className="relative px-5 pt-5 pb-6">
        {/* broadcast eyebrow */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="inline-block rounded-full motion-safe:animate-pulse-slow"
              style={{ width: 7, height: 7, background: accent, boxShadow: `0 0 8px ${accent}` }}
            />
            <span
              className="font-body uppercase"
              style={{ fontSize: 11, letterSpacing: "0.28em", color: "#aeaec8" }}
            >
              Full time
            </span>
          </div>
          <div className="font-display flex items-center" style={{ fontSize: 15, letterSpacing: "0.06em" }}>
            <span style={{ color: "#fff" }}>YOUR</span>
            <span style={{ color: WIN }}>SCORE</span>
            <span style={{ color: "#5a5a78", marginLeft: 8 }}>38-0</span>
          </div>
        </div>

        {/* scoreboard */}
        <div className="mt-6 flex items-center gap-2">
          {/* you */}
          <div className="flex-1 min-w-0 text-right">
            <div
              className="font-display truncate"
              style={{ fontSize: 22, lineHeight: 1, color: won ? WIN : "#fff", letterSpacing: "0.03em" }}
            >
              You
            </div>
            <div className="mt-1.5 flex justify-end">
              <StrengthPill value={m.you.strength} tier={m.you.projected?.tier} side="you" />
            </div>
          </div>

          {/* LED scoreline */}
          <div className="flex shrink-0 items-center gap-2 px-1">
            <span
              className="font-display tabular-nums"
              style={{ fontSize: 64, lineHeight: 0.9, fontWeight: 400, color: youNum, textShadow: youNum === accent ? `0 0 24px ${accent}55` : "none" }}
            >
              {youUp}
            </span>
            <span className="font-display" style={{ fontSize: 30, color: "#3a3a52", marginTop: -4 }}>
              :
            </span>
            <span
              className="font-display tabular-nums"
              style={{ fontSize: 64, lineHeight: 0.9, fontWeight: 400, color: oppNum, textShadow: oppNum === accent ? `0 0 24px ${accent}55` : "none" }}
            >
              {oppUp}
            </span>
          </div>

          {/* opponent */}
          <div className="flex-1 min-w-0 text-left">
            <div
              className="font-display truncate"
              style={{ fontSize: 22, lineHeight: 1, color: m.outcome === "opp" ? LOSS : "#fff", letterSpacing: "0.03em" }}
            >
              {m.opp.name}
            </div>
            <div className="mt-1.5 flex justify-start">
              <StrengthPill value={m.opp.strength} tier={m.opp.projected?.tier} side="opp" />
            </div>
          </div>
        </div>

        {m.pens && (
          <div className="mt-2 text-center font-body" style={{ fontSize: 12, color: DRAW, letterSpacing: "0.06em" }}>
            Penalties {m.pens.you}–{m.pens.opp}
          </div>
        )}

        {/* result ribbon */}
        <div className="mt-4 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14))" }} />
          <span
            className="font-display"
            style={{
              fontSize: 18,
              letterSpacing: "0.34em",
              color: accent,
              textShadow: `0 0 18px ${accent}44`,
            }}
          >
            {headline}
          </span>
          <span className="h-px flex-1" style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.14), transparent)" }} />
        </div>
      </div>

      {/* goal timeline — the signature: the match told down a centre seam */}
      <div className="px-5 pb-5">
        <SectionLabel>Goals</SectionLabel>
        {goals.length === 0 ? (
          <div className="mt-3 flex flex-col items-center py-4">
            <div
              className="grid place-items-center rounded-full font-display"
              style={{ width: 42, height: 42, border: "1px solid rgba(255,255,255,0.12)", color: "#7a7a92", fontSize: 13 }}
            >
              0–0
            </div>
            <span className="mt-2 font-body" style={{ fontSize: 12, color: "#7a7a92" }}>
              No goals
            </span>
          </div>
        ) : (
          <div className="relative mt-3">
            {/* the seam */}
            <div
              className="absolute top-1 bottom-1 left-1/2 -translate-x-1/2"
              style={{ width: 2, background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.16), transparent)" }}
            />
            <ul className="relative space-y-2.5">
              {goals.map((g, i) => {
                const mine = g.side === "a";
                const col = mine ? WIN : LOSS;
                return (
                  <li key={i} className="grid items-center" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
                    {/* your side */}
                    <div className={mine ? "pr-3 text-right" : ""}>
                      {mine && <GoalLabel name={g.scorerName} assist={g.assistName} align="right" />}
                    </div>
                    {/* minute node */}
                    <div className="flex flex-col items-center">
                      <span
                        className="grid place-items-center rounded-full font-body tabular-nums"
                        style={{
                          minWidth: 36,
                          height: 22,
                          padding: "0 7px",
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#0a0a0f",
                          background: col,
                          boxShadow: `0 0 12px ${col}55`,
                        }}
                      >
                        {g.minute}&apos;
                      </span>
                    </div>
                    {/* opponent side */}
                    <div className={!mine ? "pl-3 text-left" : ""}>
                      {!mine && <GoalLabel name={g.scorerName} assist={g.assistName} align="left" />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* star of the match */}
      {rep.potm && (
        <div className="px-5 pb-5">
          <div
            className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{
              background: "linear-gradient(100deg, rgba(255,184,0,0.12), rgba(255,184,0,0.02))",
              border: "1px solid rgba(255,184,0,0.28)",
            }}
          >
            <div
              className="grid shrink-0 place-items-center rounded-xl font-display tabular-nums"
              style={{ width: 52, height: 52, background: "rgba(255,184,0,0.16)", color: DRAW, fontSize: 24 }}
            >
              {rep.potm.rating.toFixed(1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-body uppercase" style={{ fontSize: 10, letterSpacing: "0.18em", color: DRAW }}>
                  ★ Star of the match
                </span>
                <span
                  className="font-body uppercase"
                  style={{ fontSize: 9, letterSpacing: "0.1em", color: "#8a8aa6", padding: "1px 6px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)" }}
                >
                  {potmIsYou ? "Your XI" : m.opp.name}
                </span>
              </div>
              <div className="mt-0.5 truncate font-display" style={{ fontSize: 22, color: "#fff", letterSpacing: "0.02em" }}>
                {rep.potm.name}
              </div>
              <div className="font-body" style={{ fontSize: 11, color: "#8a8aa6" }}>
                {rep.potm.pos}
                {rep.potm.goals > 0 && ` · ${rep.potm.goals} ${rep.potm.goals === 1 ? "goal" : "goals"}`}
                {rep.potm.assists > 0 && ` · ${rep.potm.assists} ${rep.potm.assists === 1 ? "assist" : "assists"}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* match stats */}
      <div className="px-5 pb-5">
        <SectionLabel>Match stats</SectionLabel>
        <div
          className="mt-3 divide-y overflow-hidden rounded-2xl"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.06)" }}
        >
          {stats.map(([label, a, b, suffix]) => (
            <div key={label} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <StatBar label={label} a={a} b={b} suffix={suffix} youColor={WIN} />
            </div>
          ))}
        </div>
      </div>

      {/* both XIs */}
      <div className="px-5 pb-6">
        <SectionLabel>The line-ups</SectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <TeamPanel
            label="Your XI"
            name="You"
            strength={m.you.strength}
            tier={m.you.projected?.tier}
            formation={m.you.formation}
            squad={m.you.squad}
            nameColor={won ? WIN : "#fff"}
          />
          <TeamPanel
            label={`${m.opp.name}'s XI`}
            name={m.opp.name}
            strength={m.opp.strength}
            tier={m.opp.projected?.tier}
            formation={m.opp.formation}
            squad={m.opp.squad}
            nameColor={m.outcome === "opp" ? LOSS : "#fff"}
          />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-body uppercase" style={{ fontSize: 10, letterSpacing: "0.22em", color: "#6a6a86" }}>
        {children}
      </span>
      <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
    </div>
  );
}

function StrengthPill({ value, tier, side }: { value: number; tier?: string; side: "you" | "opp" }) {
  const col = tierColor((tier as never) ?? "Mid-table");
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      style={{ padding: "2px 9px", background: `${col}14`, border: `1px solid ${col}33` }}
    >
      <span className="font-body uppercase" style={{ fontSize: 8, letterSpacing: "0.1em", color: "#8a8aa6" }}>
        {side === "you" ? "Strength" : "Str"}
      </span>
      <span className="font-display tabular-nums" style={{ fontSize: 14, lineHeight: 1, color: col }}>
        {value}
      </span>
    </span>
  );
}

function GoalLabel({ name, assist, align }: { name: string; assist?: string; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <div className="truncate font-body" style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
        <span style={{ marginRight: align === "right" ? 0 : 5, marginLeft: align === "right" ? 5 : 0 }}>
          {align === "left" && "⚽ "}
          {name}
          {align === "right" && " ⚽"}
        </span>
      </div>
      {assist && (
        <div className="truncate font-body" style={{ fontSize: 10, color: "#7a7a92" }}>
          assist {assist}
        </div>
      )}
    </div>
  );
}

function TeamPanel({
  label,
  name,
  strength,
  tier,
  formation,
  squad,
  nameColor,
}: {
  label: string;
  name: string;
  strength: number;
  tier?: string;
  formation: LocalMatch["you"]["formation"];
  squad: LocalMatch["you"]["squad"];
  nameColor: string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <span className="truncate font-display" style={{ fontSize: 16, color: nameColor, letterSpacing: "0.02em" }}>
          {name}
        </span>
        <span className="font-display tabular-nums" style={{ fontSize: 18, color: tierColor((tier as never) ?? "Mid-table") }}>
          {strength}
        </span>
      </div>
      <p className="mb-1.5 truncate font-body" style={{ fontSize: 10, color: "#666688", letterSpacing: "0.04em" }}>
        {label} · {formation}
      </p>
      <Pitch formation={formation} squad={squad} compact />
    </div>
  );
}
