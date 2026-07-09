"use client";

/**
 * Your PL XI — the post-WC WARM-UP game (the funnel ship).
 *
 * Loop: 11 slots (4-3-3); each slot is gated by a question served from the
 * gates API (answers stay server-side). A correct answer — and a live streak —
 * raises the band you draft from (wc-draft's tuned bands); you pick a player
 * from 5 banded candidates out of the all-era PL pool, then the 38-0 season
 * engine simulates your XI. Ends on the funnel: Your PL XI is coming — get
 * early access / start a league (A/B, PostHog events when available).
 *
 * Anonymous-playable by design (localStorage session key). Gold-on-deep-pitch
 * identity per the design spec.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allBuckets,
  ensurePool,
  getBucketPlayers,
  leagueOpponents,
} from "@/lib/draft/pool";
import { canPlay, playerIdentity, scoreTeam, seededRng } from "@/lib/draft/score";
import { simulateSeason, type SeasonResult } from "@/lib/draft/season";
import { slotsFor } from "@/lib/draft/formations";
import type { Formation, PlacedPlayer, PlayerSeason, Position } from "@/lib/draft/types";

const FORMATION: Formation = "4-3-3";
const GOLD = "#F4C430";
const GOLD_DIM = "#C99A1E";
const BG = "#0A1512";
const CARD = "#14231D";
const EDGE = "#26332C";
const PITCH = "#0E3B29";
const PITCH_EDGE = "#12513A";
const TEXT_DIM = "#8CA298";

type ServedQuestion = {
  idx: number;
  format: string;
  prompt: string;
  options: { id: number; label: string }[];
  position: Position;
};
type StepResult = {
  correct: boolean;
  answerId: number;
  streak: number;
  band: { minOverall: number; maxOverall: number };
};
type Phase = "intro" | "loading" | "question" | "reveal" | "pick" | "result" | "error";

function sessionKey(): string {
  try {
    const k = localStorage.getItem("ys:warmup:key");
    if (k && k.length >= 8) return k;
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem("ys:warmup:key", fresh);
    return fresh;
  } catch {
    return `anon${Math.floor(Math.random() * 1e12)}`;
  }
}

function capture(event: string, props?: Record<string, unknown>) {
  try {
    (window as unknown as { posthog?: { capture: (e: string, p?: object) => void } }).posthog?.capture(event, props);
  } catch {
    /* analytics must never break the game */
  }
}

function bandLabel(band: { minOverall: number; maxOverall: number }): "standard" | "good" | "premium" {
  if (band.maxOverall <= 72) return "standard";
  if (band.maxOverall < 85) return "good";
  return "premium";
}

/** 5 banded candidates for a slot from the all-era PL pool (soft bounds — the
 *  band relaxes until the slot can always be filled, same spirit as the WC draft). */
function bandedCandidates(
  pos: Position,
  band: { minOverall: number; maxOverall: number },
  usedIds: Set<string>,
  usedIdentities: Set<string>,
  seed: string,
): PlayerSeason[] {
  const rng = seededRng(seed);
  let lo = band.minOverall;
  let hi = band.maxOverall;
  for (let relax = 0; relax < 12; relax++) {
    const found: PlayerSeason[] = [];
    const seenIdentity = new Set<string>();
    for (const b of allBuckets("PL")) {
      for (const p of getBucketPlayers(b)) {
        if (p.overall < lo || p.overall > hi) continue;
        if (!canPlay(p.position, pos)) continue;
        if (usedIds.has(p.id)) continue;
        const ident = playerIdentity(p.name);
        if (usedIdentities.has(ident) || seenIdentity.has(ident)) continue;
        seenIdentity.add(ident);
        found.push(p);
      }
    }
    if (found.length >= 5) {
      // seeded sample of 5
      for (let i = found.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [found[i], found[j]] = [found[j], found[i]];
      }
      return found.slice(0, 5).sort((a, b) => b.overall - a.overall);
    }
    lo = Math.max(0, lo - 6);
    hi = Math.min(99, hi + 3);
  }
  return [];
}

export default function YourPlXiWarmup() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [questions, setQuestions] = useState<ServedQuestion[]>([]);
  const [version, setVersion] = useState("");
  const [slotIdx, setSlotIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [step, setStep] = useState<StepResult | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<PlayerSeason[]>([]);
  const [squad, setSquad] = useState<PlacedPlayer[]>([]);
  const [season, setSeason] = useState<SeasonResult | null>(null);
  const [strength, setStrength] = useState(0);
  const [err, setErr] = useState("");
  const keyRef = useRef("");

  const slots = useMemo(() => slotsFor(FORMATION), []);
  const arm = useMemo(
    () => (keyRef.current ? parseInt(keyRef.current.slice(0, 2), 16) % 2 : 0),
    [phase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = useCallback(async () => {
    setPhase("loading");
    setErr("");
    try {
      keyRef.current = sessionKey();
      const [res] = await Promise.all([
        fetch("/api/gates/warmup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: keyRef.current }),
        }),
        ensurePool(),
      ]);
      if (!res.ok) throw new Error(`round ${res.status}`);
      const data = (await res.json()) as { version: string; questions: ServedQuestion[] };
      if (!data.questions?.length) throw new Error("empty round");
      setQuestions(data.questions);
      setVersion(data.version);
      setAnswers([]);
      setSquad([]);
      setSlotIdx(0);
      setStep(null);
      setSeason(null);
      setPhase("question");
      capture("warmup_started");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to start");
      setPhase("error");
    }
  }, []);

  const answer = useCallback(
    async (optionId: number | null) => {
      const nextAnswers = [...answers, optionId];
      setAnswers(nextAnswers);
      try {
        const res = await fetch("/api/gates/warmup/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: keyRef.current, version, answers: nextAnswers, k: slotIdx }),
        });
        if (res.status === 409) return void start(); // stale pool — restart clean
        if (!res.ok) throw new Error(`step ${res.status}`);
        const data = (await res.json()) as StepResult;
        setStep(data);
        setPhase("reveal");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed to grade");
        setPhase("error");
      }
    },
    [answers, slotIdx, start, version],
  );

  const toPick = useCallback(() => {
    if (!step) return;
    const slot = slots[slotIdx];
    const usedIds = new Set(squad.map((p) => p.player_season_id));
    const usedIdents = new Set(squad.map((p) => playerIdentity(p.name)));
    const cands = bandedCandidates(
      slot.pos,
      step.band,
      usedIds,
      usedIdents,
      `${keyRef.current}:${version}:${slotIdx}`,
    );
    setCandidates(cands);
    setPicked(null);
    setPhase("pick");
  }, [slotIdx, slots, squad, step, version]);

  const pick = useCallback(
    (p: PlayerSeason) => {
      const slot = slots[slotIdx];
      const placed: PlacedPlayer = {
        slot: slot.id,
        slotPos: slot.pos,
        player_season_id: p.id,
        name: p.name,
        club: p.club,
        season: p.season,
        overall: p.overall,
        position: p.position,
      };
      const nextSquad = [...squad, placed];
      setSquad(nextSquad);
      if (slotIdx + 1 < slots.length) {
        setSlotIdx(slotIdx + 1);
        setStep(null);
        setPhase("question");
      } else {
        const str = scoreTeam(nextSquad, FORMATION);
        setStrength(str);
        const sim = simulateSeason(
          nextSquad,
          FORMATION,
          str,
          `warmup:${keyRef.current}:${version}`,
          leagueOpponents("PL"),
        );
        setSeason(sim);
        setPhase("result");
        const correctCount = answers.filter((a, i) => a !== null && i < slots.length).length;
        capture("warmup_finished", { strength: str, wins: sim.wins, correct: correctCount });
      }
    },
    [answers, slotIdx, slots, squad, version],
  );

  const share = useCallback(async () => {
    if (!season) return;
    const text = `My XI went ${season.wins}-${season.draws}-${season.losses} in Your PL XI — knowledge builds the team. Can you beat it? yourscore.app/your-pl-xi`;
    capture("warmup_shared");
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        alert("Copied — paste it in the group chat.");
      }
    } catch {
      /* user cancelled */
    }
  }, [season]);

  const q = questions[slotIdx];

  // ---- render helpers -------------------------------------------------------
  const chip = (label: string, gold = false) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: gold ? "#3A2E08" : CARD,
        color: gold ? GOLD : TEXT_DIM,
        border: `1px solid ${gold ? GOLD_DIM : EDGE}`,
      }}
    >
      {label}
    </span>
  );

  const btn = (label: string, onClick: () => void, gold = true, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "13px 16px",
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        background: gold ? GOLD : "transparent",
        color: gold ? "#2A1F00" : "#B9CABF",
        border: gold ? "none" : `1px solid ${EDGE}`,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );

  const meter = step ? bandLabel(step.band) : null;

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: BG,
        color: "#ECF4EF",
        display: "flex",
        justifyContent: "center",
        padding: "18px 14px 40px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: GOLD }}>
            YOUR PL XI
          </span>
          {phase !== "intro" && phase !== "result" && chip(`pick ${Math.min(slotIdx + 1, 11)}/11`)}
        </header>

        {phase === "intro" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: PITCH, border: `1px solid ${PITCH_EDGE}`, borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em" }}>THE WARM-UP</div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: "6px 0 8px" }}>
                Your knowledge builds your XI
              </h1>
              <p style={{ fontSize: 14, color: "#B9CABF", lineHeight: 1.55, margin: "0 0 14px" }}>
                Every position is gated by a question. Get it right — and keep a streak going — and
                you&apos;ll be picking from the Premier League&apos;s best across every era. Then your XI plays
                a full simulated season. Could it go 38-0?
              </p>
              <div style={{ display: "flex" }}>{btn("Play — it takes 2 minutes", start)}</div>
            </div>
            <p style={{ fontSize: 12, color: TEXT_DIM, textAlign: "center" }}>
              No sign-up needed. 11 questions, 11 picks, one season.
            </p>
          </section>
        )}

        {phase === "loading" && (
          <div style={{ textAlign: "center", padding: 60, color: TEXT_DIM }}>Warming up the pitch…</div>
        )}

        {phase === "error" && (
          <section style={{ background: CARD, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 16 }}>
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>Something went wrong ({err}).</p>
            <div style={{ display: "flex" }}>{btn("Try again", start)}</div>
          </section>
        )}

        {(phase === "question" || phase === "reveal") && q && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {chip(q.position, true)}
              {step && phase === "reveal"
                ? chip(`streak ${step.streak}`, step.streak > 1)
                : slotIdx > 0 && chip(`${slotIdx} answered`)}
            </div>
            <div style={{ background: CARD, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.5, whiteSpace: "pre-line" }}>
                {q.prompt}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {q.options.map((o) => {
                const revealed = phase === "reveal" && step;
                const isAnswer = revealed && o.id === step.answerId;
                const isMine = revealed && answers[slotIdx] === o.id;
                const wrongMine = isMine && !isAnswer;
                return (
                  <button
                    key={o.id}
                    disabled={phase === "reveal"}
                    onClick={() => answer(o.id)}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 11,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: phase === "question" ? "pointer" : "default",
                      background: isAnswer ? "#3A2E08" : wrongMine ? "#3A1512" : CARD,
                      color: isAnswer ? "#F8E9B0" : wrongMine ? "#F0A9A0" : "#ECF4EF",
                      border: `1px solid ${isAnswer ? GOLD : wrongMine ? "#7A2E24" : EDGE}`,
                    }}
                  >
                    {o.label}
                    {isAnswer ? "  ✓" : wrongMine ? "  ✗" : ""}
                  </button>
                );
              })}
            </div>
            {phase === "reveal" && step && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    background: step.correct ? "#3A2E08" : CARD,
                    border: `1px solid ${step.correct ? GOLD_DIM : EDGE}`,
                    borderRadius: 11,
                    padding: "10px 12px",
                    fontSize: 13,
                    color: step.correct ? "#F8E9B0" : TEXT_DIM,
                  }}
                >
                  {step.correct
                    ? meter === "premium"
                      ? `On fire — streak ${step.streak}. You're pulling from the premium tier.`
                      : `Correct — you're pulling from a ${meter} batch.`
                    : "Not this time — you're shopping in the bargain bin for this slot."}
                </div>
                <div style={{ display: "flex" }}>{btn("See your options", toPick)}</div>
              </div>
            )}
          </section>
        )}

        {phase === "pick" && step && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {chip(slots[slotIdx].pos, true)}
              {chip(`${bandLabel(step.band)} batch`, bandLabel(step.band) === "premium")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {candidates.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPicked(picked === p.id ? null : p.id)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 14px",
                    borderRadius: 11,
                    fontSize: 14,
                    cursor: "pointer",
                    background: picked === p.id ? "#3A2E08" : CARD,
                    color: "#ECF4EF",
                    border: `1px solid ${picked === p.id ? GOLD : EDGE}`,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span style={{ fontSize: 12, color: TEXT_DIM }}>
                    {p.club} {p.season} · <b style={{ color: p.overall >= 85 ? GOLD : "#ECF4EF" }}>{p.overall}</b>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex" }}>
              {btn(
                "Lock him in",
                () => {
                  const chosen = candidates.find((c) => c.id === picked);
                  if (chosen) pick(chosen);
                },
                true,
                picked === null,
              )}
            </div>
          </section>
        )}

        {phase === "result" && season && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ height: 4, background: GOLD, borderRadius: 2 }} />
            <div>
              <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em" }}>
                YOUR SIMULATED SEASON
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 42, fontWeight: 700, color: GOLD }}>
                  {season.wins}-{season.draws}-{season.losses}
                </span>
                <span style={{ fontSize: 13, color: TEXT_DIM }}>
                  {season.points} pts · finished {season.position === 1 ? "champions" : `#${season.position}`}
                </span>
              </div>
              <div style={{ fontSize: 14, color: "#F8E9B0", marginTop: 4 }}>
                {season.invincible
                  ? "INVINCIBLE. 38-0. Immortality."
                  : season.position === 1
                    ? "Champions — but not invincible. The 38-0 dream lives on."
                    : `Strength ${strength} · ${season.verdict.toLowerCase()}`}
              </div>
            </div>

            <div
              style={{
                background: PITCH,
                border: `1px solid ${PITCH_EDGE}`,
                borderRadius: 14,
                padding: "12px 8px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {/* Slots are drafted in order GK → DEF×4 → MID×3 → FWD×3, so line
                  grouping is positional (slotPos itself is granular: RB/CB/ST…). */}
              {[squad.slice(8, 11), squad.slice(5, 8), squad.slice(1, 5), squad.slice(0, 1)].map((line, li) => (
                <div key={li} style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                  {line.map((p) => (
                      <div
                        key={p.slot}
                        style={{
                          background: p.overall >= 85 ? "#3A2E08" : CARD,
                          border: `1px solid ${p.overall >= 85 ? GOLD : EDGE}`,
                          borderRadius: 9,
                          padding: "4px 7px",
                          fontSize: 11,
                          textAlign: "center",
                          minWidth: 58,
                        }}
                      >
                        <div style={{ fontWeight: 600, color: p.overall >= 85 ? "#F8E9B0" : "#ECF4EF" }}>
                          {p.name}
                        </div>
                        <div style={{ color: p.overall >= 85 ? GOLD : TEXT_DIM }}>{p.overall}</div>
                      </div>
                    ))}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {btn("Share it", share, false)}
              {btn("Run it back", start, false)}
            </div>

            <div
              style={{
                background: CARD,
                border: `1px solid ${GOLD_DIM}`,
                borderRadius: 16,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, color: GOLD, letterSpacing: "0.1em", fontWeight: 700 }}>
                COMING FOR THE NEW SEASON
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>That was a taste of Your PL XI</div>
              <p style={{ fontSize: 13, color: "#B9CABF", lineHeight: 1.55, margin: 0 }}>
                The real thing runs on the actual Premier League: your football knowledge earns your
                transfer budget, you build your XI, and real gameweek performances score it — against
                your mates, all season.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(arm === 0
                  ? [
                      { label: "Get early access", href: "/auth/sign-in", gold: true, ev: "warmup_cta_access" },
                      { label: "Start a league with your mates", href: "/leagues", gold: false, ev: "warmup_cta_league" },
                    ]
                  : [
                      { label: "Start a league with your mates", href: "/leagues", gold: true, ev: "warmup_cta_league" },
                      { label: "Get early access", href: "/auth/sign-in", gold: false, ev: "warmup_cta_access" },
                    ]
                ).map((cta) => (
                  <a
                    key={cta.ev}
                    href={cta.href}
                    onClick={() => capture(cta.ev, { arm })}
                    style={{
                      textAlign: "center",
                      padding: "13px 16px",
                      borderRadius: 12,
                      fontSize: 14,
                      fontWeight: 700,
                      textDecoration: "none",
                      background: cta.gold ? GOLD : "transparent",
                      color: cta.gold ? "#2A1F00" : "#B9CABF",
                      border: cta.gold ? "none" : `1px solid ${EDGE}`,
                    }}
                  >
                    {cta.label}
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
