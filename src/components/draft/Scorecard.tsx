"use client";

/**
 * Draft XI — full-time scorecard, styled as a collectible matchday card.
 *
 * The premium, screenshot-worthy result shown after a head-to-head. The visual
 * language is a foil-stamped trading card / certificate: a metallic frame with
 * registration marks and fine grain, foil-stamped scoreline numerals over an
 * engraved opponent, a centre-seam goal timeline, a player-of-the-match plaque,
 * a diverging stat ledger, both XIs, and an authenticity strip. Pure presentation
 * over a finished LocalMatch — the result page owns sharing + the next-step CTAs.
 *
 * Restraint is the point: metallic foil appears in only a few places (scoreline,
 * tier crests, the result word), everything else is hairlines + mono data. Honours
 * prefers-reduced-motion and never relies on motion to convey the result.
 */

import { useEffect, useRef, useState } from "react";
import { Pitch } from "@/components/draft/Pitch";
import type { LocalMatch } from "@/lib/draft/local";
import type { Tier } from "@/lib/draft/types";
import { tierColor } from "@/lib/draft/ui";

const WIN = "#00ff87";
const DRAW = "#ffb800";
const LOSS = "#ff4757";
const INK = "#07070b";

/** Metallic gradient families — used as background-clip:text for foil stamping. */
const FOIL: Record<"win" | "draw" | "loss" | "silver", string> = {
  win: "linear-gradient(120deg,#eafff5 0%,#5dffba 26%,#00b765 50%,#9effd6 70%,#13a572 100%)",
  draw: "linear-gradient(120deg,#fff6d4 0%,#ffe07a 26%,#c79318 50%,#ffe9a3 70%,#a9791a 100%)",
  loss: "linear-gradient(120deg,#ffe1e4 0%,#ff7681 26%,#b22b35 50%,#ff9aa1 70%,#bf3640 100%)",
  silver: "linear-gradient(120deg,#f4f4fa 0%,#b9b9cc 26%,#6b6b82 50%,#d6d6e2 70%,#82829a 100%)",
};
/** Recessed/engraved fill for the losing side of the scoreline. */
const ENGRAVE = "linear-gradient(180deg,#4c4c63 0%,#2a2a39 55%,#191923 100%)";

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function foilKey(outcome: LocalMatch["outcome"]): keyof typeof FOIL {
  return outcome === "you" ? "win" : outcome === "draw" ? "draw" : "loss";
}

/** Count a value up from 0 on mount; static for reduced-motion / SSR. */
function useCountUp(to: number, ms = 750): number {
  const [v, setV] = useState(to);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || to === 0) { setV(to); return; }
    setV(0);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(eased * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

/** Foil-stamped text: a metallic gradient clipped to the glyphs. */
function Foil({
  gradient,
  sheen,
  className,
  style,
  children,
}: {
  gradient: string;
  sheen?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`${sheen ? "motion-safe:animate-foil" : ""} ${className ?? ""}`}
      style={{
        backgroundImage: gradient,
        backgroundSize: sheen ? "200% auto" : undefined,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: "transparent",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A small shield crest carrying the side's accent + tier rating — the badge that
 *  makes each side read as a "club", without inventing a logo. */
function Crest({ accent, rating }: { accent: string; rating: number }) {
  return (
    <span className="relative inline-grid place-items-center" style={{ width: 38, height: 44 }}>
      <svg width="38" height="44" viewBox="0 0 38 44" fill="none" style={{ position: "absolute", inset: 0 }}>
        <path
          d="M19 1.5 36.5 7v14.5C36.5 32 28.8 39.5 19 42.5 9.2 39.5 1.5 32 1.5 21.5V7L19 1.5Z"
          fill="rgba(255,255,255,0.015)"
          stroke={accent}
          strokeOpacity="0.5"
          strokeWidth="1"
        />
        <path
          d="M19 5 33 9.4v11.8C33 29.7 26.7 36 19 38.6 11.3 36 5 29.7 5 21.2V9.4L19 5Z"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="1"
        />
      </svg>
      <span className="font-mono" style={{ fontSize: 14, fontWeight: 500, color: accent, marginTop: -2 }}>
        {rating}
      </span>
    </span>
  );
}

/** Diverging stat row: a centred ledger — value · label · value over a centre-origin
 *  bar that grows toward whoever leads. Mono data, hairline rules. */
function StatRow({ label, a, b, suffix = "" }: { label: string; a: number; b: number; suffix?: string }) {
  const total = a + b || 1;
  const aHalf = (a / total) * 100;
  const bHalf = (b / total) * 100;
  const aLeads = a >= b;
  return (
    <div className="py-2.5">
      <div className="grid items-baseline" style={{ gridTemplateColumns: "1fr auto 1fr" }}>
        <span
          className="text-left font-mono"
          style={{ fontSize: 13, color: aLeads ? "#eef" : "#62627a", fontWeight: aLeads ? 500 : 400 }}
        >
          {a}{suffix}
        </span>
        <span className="px-3 text-center font-body uppercase" style={{ fontSize: 9.5, letterSpacing: "0.24em", color: "#6a6a86" }}>
          {label}
        </span>
        <span
          className="text-right font-mono"
          style={{ fontSize: 13, color: !aLeads ? "#eef" : "#62627a", fontWeight: !aLeads ? 500 : 400 }}
        >
          {b}{suffix}
        </span>
      </div>
      <div className="relative mt-1.5 h-px w-full" style={{ background: "rgba(255,255,255,0.06)" }}>
        {/* centre origin tick */}
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 1, height: 7, background: "rgba(255,255,255,0.18)" }} />
        {/* you (left of centre) */}
        <span
          className="absolute top-1/2 -translate-y-1/2"
          style={{ right: "50%", height: 2, width: `${aHalf / 2}%`, background: aLeads ? WIN : "rgba(0,255,135,0.32)", boxShadow: aLeads ? `0 0 6px ${WIN}55` : "none" }}
        />
        {/* opponent (right of centre) */}
        <span
          className="absolute top-1/2 -translate-y-1/2"
          style={{ left: "50%", height: 2, width: `${bHalf / 2}%`, background: !aLeads ? "#aab" : "#54546c" }}
        />
      </div>
    </div>
  );
}

function GoalMark({ color }: { color: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M5.5 0.6 10.4 5.5 5.5 10.4 0.6 5.5Z" fill={color} />
    </svg>
  );
}

export function Scorecard({ m, context = "Quick Match" }: { m: LocalMatch; context?: string }) {
  const won = m.outcome === "you";
  const drew = m.outcome === "draw";
  const accent = won ? WIN : drew ? DRAW : LOSS;
  const headline = won ? "WIN" : drew ? "DRAW" : "LOSS";
  const fk = foilKey(m.outcome);
  const rep = m.report;

  const youUp = useCountUp(m.goals.you);
  const oppUp = useCountUp(m.goals.opp);

  const youWonScore = m.goals.you >= m.goals.opp;
  const oppWonScore = m.goals.opp >= m.goals.you;

  const goals = [...rep.events].sort((x, y) => x.minute - y.minute);
  const serial = (m.id || "").replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0") || "0038";

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
  const youTierCol = tierColor(m.you.projected?.tier ?? ("Mid-table" as Tier));
  const oppTierCol = tierColor(m.opp.projected?.tier ?? ("Mid-table" as Tier));

  return (
    <article
      className="relative overflow-hidden"
      style={{
        borderRadius: 26,
        background:
          "radial-gradient(120% 80% at 50% -10%, rgba(255,255,255,0.05), transparent 55%)," +
          "linear-gradient(180deg,#101019 0%,#0a0a10 42%,#07070b 100%)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.05) inset," +
          "0 0 0 1px rgba(255,255,255,0.05)," +
          "0 40px 90px -50px rgba(0,0,0,0.95)",
      }}
    >
      {/* foil frame edge */}
      <div
        className="pointer-events-none absolute inset-[5px] rounded-[20px]"
        style={{ border: "1px solid transparent", background: `linear-gradient(${INK},${INK}) padding-box, ${FOIL[fk]} border-box`, opacity: 0.55 }}
      />
      {/* grain */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: GRAIN, backgroundSize: "140px 140px", opacity: 0.05, mixBlendMode: "overlay" }} />
      {/* registration corner marks */}
      {([["12px", "12px", false, false], ["12px", "12px", true, false], ["12px", "12px", false, true], ["12px", "12px", true, true]] as const).map(
        ([t, l, right, bottom], i) => (
          <span key={i} className="pointer-events-none absolute" style={{ [bottom ? "bottom" : "top"]: t, [right ? "right" : "left"]: l, width: 9, height: 9, [bottom ? "borderBottom" : "borderTop"]: "1px solid rgba(255,255,255,0.18)", [right ? "borderRight" : "borderLeft"]: "1px solid rgba(255,255,255,0.18)" } as React.CSSProperties} />
        )
      )}

      <div className="relative px-6 pt-7 pb-7">
        {/* ── header / authenticity row ─────────────────────────────── */}
        <div className="flex items-center justify-between" style={{ marginBottom: 26 }}>
          <div className="flex items-center gap-2">
            <span className="relative grid place-items-center" style={{ width: 14, height: 14 }}>
              <span className="absolute inset-0 rounded-full motion-safe:animate-pulse-slow" style={{ border: `1px solid ${accent}`, opacity: 0.5 }} />
              <span className="rounded-full" style={{ width: 5, height: 5, background: accent, boxShadow: `0 0 6px ${accent}` }} />
            </span>
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.22em", color: "#9a9ab4" }}>Full time</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: "0.16em", color: "#55556e" }}>{context}</span>
            <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.12)" }} />
            <span className="font-display" style={{ fontSize: 13, letterSpacing: "0.05em" }}>
              <span style={{ color: "#e9e9f2" }}>YOUR</span><span style={{ color: WIN }}>SCORE</span>
            </span>
          </div>
        </div>

        {/* ── scoreboard ────────────────────────────────────────────── */}
        <div className="grid items-center" style={{ gridTemplateColumns: "1fr auto 1fr", gap: 8 }}>
          {/* you */}
          <div className="flex flex-col items-center gap-2 min-w-0">
            <Crest accent={youTierCol} rating={m.you.strength} />
            <span className="font-display truncate max-w-full" style={{ fontSize: 19, lineHeight: 1, letterSpacing: "0.04em", color: won ? WIN : "#f2f2f8" }}>You</span>
            <span className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#6a6a86" }}>{m.you.projected?.tier ?? "—"}</span>
          </div>

          {/* score cluster */}
          <div className="flex flex-col items-center px-1">
            <div className="flex items-center" style={{ gap: 14 }}>
              <Foil
                sheen={youWonScore}
                gradient={youWonScore ? FOIL[fk] : ENGRAVE}
                className="font-display tabular-nums"
                style={{ fontSize: 78, lineHeight: 0.82, filter: youWonScore ? `drop-shadow(0 0 22px ${accent}33)` : "drop-shadow(0 1px 0 rgba(255,255,255,0.05))" }}
              >
                {youUp}
              </Foil>
              <span style={{ width: 1.5, height: 52, background: FOIL.silver, opacity: 0.55, transform: "skewX(-12deg)" }} />
              <Foil
                sheen={oppWonScore}
                gradient={oppWonScore ? FOIL[fk] : ENGRAVE}
                className="font-display tabular-nums"
                style={{ fontSize: 78, lineHeight: 0.82, filter: oppWonScore ? `drop-shadow(0 0 22px ${accent}33)` : "drop-shadow(0 1px 0 rgba(255,255,255,0.05))" }}
              >
                {oppUp}
              </Foil>
            </div>
            <Foil gradient={FOIL[fk]} sheen className="font-display" style={{ fontSize: 16, letterSpacing: "0.42em", marginTop: 10, paddingLeft: "0.42em" }}>
              {headline}
            </Foil>
            {m.pens && (
              <span className="font-mono" style={{ fontSize: 10, color: "#8a8aa6", marginTop: 6, letterSpacing: "0.08em" }}>
                PENS {m.pens.you}–{m.pens.opp}
              </span>
            )}
          </div>

          {/* opponent */}
          <div className="flex flex-col items-center gap-2 min-w-0">
            <Crest accent={oppTierCol} rating={m.opp.strength} />
            <span className="font-display truncate max-w-full" style={{ fontSize: 19, lineHeight: 1, letterSpacing: "0.04em", color: m.outcome === "opp" ? LOSS : "#f2f2f8" }}>{m.opp.name}</span>
            <span className="font-mono uppercase truncate max-w-full" style={{ fontSize: 9, letterSpacing: "0.12em", color: "#6a6a86" }}>{m.opp.projected?.tier ?? "—"}</span>
          </div>
        </div>

        {/* ── goal ledger (centre-seam timeline) ────────────────────── */}
        <Rule label="Goals" className="mt-7" />
        {goals.length === 0 ? (
          <p className="mt-3 text-center font-mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "#62627a" }}>NO GOALS · 0–0</p>
        ) : (
          <div className="relative mt-3.5">
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2" style={{ width: 1, background: "linear-gradient(180deg,transparent,rgba(255,255,255,0.14) 12%,rgba(255,255,255,0.14) 88%,transparent)" }} />
            <ul className="relative" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {goals.map((g, i) => {
                const mine = g.side === "a";
                const col = mine ? WIN : LOSS;
                return (
                  <li key={i} className="grid items-center" style={{ gridTemplateColumns: "1fr 44px 1fr" }}>
                    <div className={mine ? "flex items-center justify-end gap-2 pr-1" : ""}>
                      {mine && (
                        <>
                          <GoalDetail name={g.scorerName} assist={g.assistName} align="right" />
                          <GoalMark color={col} />
                        </>
                      )}
                    </div>
                    <div className="flex justify-center">
                      <span className="font-mono tabular-nums" style={{ fontSize: 11, fontWeight: 500, color: col, padding: "2px 7px", borderRadius: 4, background: `${col}14`, border: `1px solid ${col}33` }}>
                        {g.minute}&apos;
                      </span>
                    </div>
                    <div className={!mine ? "flex items-center justify-start gap-2 pl-1" : ""}>
                      {!mine && (
                        <>
                          <GoalMark color={col} />
                          <GoalDetail name={g.scorerName} assist={g.assistName} align="left" />
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ── player of the match plaque ────────────────────────────── */}
        {rep.potm && (
          <>
            <Rule label="Player of the match" className="mt-7" />
            <div className="mt-3.5 flex items-center gap-4 rounded-2xl px-4 py-3.5" style={{ background: "linear-gradient(100deg,rgba(255,184,0,0.10),rgba(255,184,0,0.015))", border: "1px solid rgba(255,184,0,0.22)" }}>
              <div className="relative grid shrink-0 place-items-center" style={{ width: 58, height: 58 }}>
                <Star />
                <Foil gradient={FOIL.draw} sheen className="font-display tabular-nums" style={{ fontSize: 23, position: "relative" }}>{rep.potm.rating.toFixed(1)}</Foil>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display truncate" style={{ fontSize: 22, color: "#fff", letterSpacing: "0.03em", lineHeight: 1.05 }}>{rep.potm.name}</div>
                <div className="mt-1 flex items-center gap-2 font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: "0.12em", color: "#8a8aa6" }}>
                  <span style={{ color: DRAW }}>{potmIsYou ? "Your XI" : m.opp.name}</span>
                  <span style={{ width: 1, height: 8, background: "rgba(255,255,255,0.14)" }} />
                  <span>{rep.potm.pos}</span>
                  {rep.potm.goals > 0 && <span>· {rep.potm.goals}G</span>}
                  {rep.potm.assists > 0 && <span>· {rep.potm.assists}A</span>}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── stat ledger ───────────────────────────────────────────── */}
        <Rule label="Match stats" className="mt-7" />
        <div className="mt-2 divide-y" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
          {stats.map(([label, a, b, suffix], i) => (
            <div key={label} style={{ borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.05)" }}>
              <StatRow label={label} a={a} b={b} suffix={suffix} />
            </div>
          ))}
        </div>

        {/* ── line-ups ──────────────────────────────────────────────── */}
        <Rule label="The line-ups" className="mt-7" />
        <div className="mt-3.5 grid grid-cols-2 gap-3.5">
          <TeamPanel label="Your XI" name="You" strength={m.you.strength} tierCol={youTierCol} formation={m.you.formation} squad={m.you.squad} nameColor={won ? WIN : "#fff"} />
          <TeamPanel label={`${m.opp.name}'s XI`} name={m.opp.name} strength={m.opp.strength} tierCol={oppTierCol} formation={m.opp.formation} squad={m.opp.squad} nameColor={m.outcome === "opp" ? LOSS : "#fff"} />
        </div>

        {/* ── authenticity strip ────────────────────────────────────── */}
        <div className="mt-7 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
          <span className="font-mono uppercase" style={{ fontSize: 9, letterSpacing: "0.18em", color: "#55556e" }}>№ {serial} · yourscore.app/38-0</span>
          <span className="h-px flex-1" style={{ background: "rgba(255,255,255,0.07)" }} />
        </div>
      </div>
    </article>
  );
}

/** Section rule: a kicked-out small-caps label with a hairline tail. */
function Rule({ label, className }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <span className="font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: "0.26em", color: "#6a6a86" }}>{label}</span>
      <span className="h-px flex-1" style={{ background: "linear-gradient(90deg,rgba(255,255,255,0.12),transparent)" }} />
    </div>
  );
}

function GoalDetail({ name, assist, align }: { name: string; assist?: string; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "min-w-0 text-right" : "min-w-0 text-left"}>
      <div className="truncate font-body" style={{ fontSize: 13, fontWeight: 600, color: "#f0f0f6", letterSpacing: "0.01em" }}>{name}</div>
      {assist && <div className="truncate font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.08em", color: "#6a6a86" }}>{assist}</div>}
    </div>
  );
}

function Star() {
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" fill="none" aria-hidden style={{ position: "absolute", inset: 0 }}>
      <circle cx="29" cy="29" r="27.5" stroke="rgba(255,184,0,0.28)" strokeWidth="1" />
      <circle cx="29" cy="29" r="23" stroke="rgba(255,184,0,0.14)" strokeWidth="1" />
      <path d="M29 13.5l3.7 9.9 10.6.5-8.3 6.6 2.8 10.2L29 45.1l-8.8 5.6 2.8-10.2-8.3-6.6 10.6-.5z" fill="rgba(255,184,0,0.16)" stroke="rgba(255,184,0,0.45)" strokeWidth="0.75" strokeLinejoin="round" />
    </svg>
  );
}

function TeamPanel({
  label, name, strength, tierCol, formation, squad, nameColor,
}: {
  label: string; name: string; strength: number; tierCol: string;
  formation: LocalMatch["you"]["formation"]; squad: LocalMatch["you"]["squad"]; nameColor: string;
}) {
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate font-display" style={{ fontSize: 15, color: nameColor, letterSpacing: "0.03em" }}>{name}</span>
        <span className="font-mono shrink-0" style={{ fontSize: 13, fontWeight: 500, color: tierCol }}>{strength}</span>
      </div>
      <p className="mb-2 truncate font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.1em", color: "#5a5a74" }}>{label} · {formation}</p>
      <Pitch formation={formation} squad={squad} compact />
    </div>
  );
}
