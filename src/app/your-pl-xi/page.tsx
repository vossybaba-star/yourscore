"use client";

/**
 * Your PL XI — the post-WC WARM-UP game (the funnel ship).
 *
 * Draft mechanic (founder, Jul 9): every position is gated by a question. The
 * answer earns a BUDGET GRANT for that pick (correct ≈ 2× wrong, small streak
 * bonus). Each pick then deals a club+season squad from the all-era PL pool —
 * the classic 38-0 spin moment — and you BUY one of its players at a price set
 * by their rating. Unspent budget CARRIES OVER, and after the 11th pick a
 * review phase lets you go back and upgrade any position with what's left
 * (sell → rebuy within that slot's dealt squad). Then the 38-0 season engine
 * simulates the XI, and the funnel pitches the real game.
 *
 * Anonymous-playable (localStorage session key); questions come from the gates
 * API (answers stay server-side). Gold-on-deep-pitch identity.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { ensurePool, spin } from "@/lib/draft/pool";
import { canPlay, playerIdentity, scoreTeam, seededRng } from "@/lib/draft/score";
import { simulateSeason, type SeasonResult } from "@/lib/draft/season";
import { leagueOpponents } from "@/lib/draft/pool";
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
type StepResult = { correct: boolean; answerId: number; streak: number; grant: number };
type CurrentPlayer = { id: number; name: string; club: string; clubId: number; position: string; price: number };
type WarmupMode = "legends" | "current";
type SlotSquad = { club: string; season: string; players: PlayerSeason[] };
type SlotPick = { placed: PlacedPlayer; price: number; squad: SlotSquad };
type Phase =
  | "intro"
  | "loading"
  | "question"
  | "reveal"
  | "squad"
  | "review"
  | "swap"
  | "result"
  | "error";

const r10 = (x: number) => Math.round(x * 10) / 10;

/** Rating → price (£m). ONE global curve — a 75 costs the same at Watford as at
 *  City (founder: values must be consistent across the whole pool). Rebalanced
 *  (founder, Jul 9) so a wrong-answer £5m still buys most of a weak team:
 *  60 → £4.2 · 70 → £5.0 · 75 → £5.9 · 80 → £7.4 · 85 → £9.5 · 93 → £15. */
const PRICE_EXP = 4.2;
function priceOf(overall: number): number {
  const ov = Math.max(40, Math.min(93, overall));
  return r10(4 + 11 * Math.pow((ov - 40) / 53, PRICE_EXP));
}

/** Inverse of priceOf — gives 26/27-mode players a sim rating from their price. */
function overallFromPrice(price: number): number {
  const p = Math.max(4, Math.min(15, price));
  return Math.round(40 + 53 * Math.pow((p - 4) / 11, 1 / PRICE_EXP));
}

/** Map a granular formation slot ("RB", "CM", "ST"…) to a position bucket —
 *  the 26/27 player feed only knows GK/DEF/MID/FWD. */
function slotBucket(pos: string): "GK" | "DEF" | "MID" | "FWD" {
  if (pos === "GK") return "GK";
  if (["RB", "LB", "CB", "RWB", "LWB", "DEF"].includes(pos)) return "DEF";
  if (["CM", "CDM", "CAM", "RM", "LM", "MID"].includes(pos)) return "MID";
  return "FWD";
}

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

/** 26/27 mode: deal a CURRENT club's squad for the slot — same buy flow, players
 *  priced by their real FPL value, sim rating derived from the price. */
function dealCurrentSquad(
  players: readonly CurrentPlayer[],
  slotPos: Position,
  usedIds: Set<string>,
  usedIdents: Set<string>,
  budget: number,
  seedStr: string,
): SlotSquad {
  const rng = seededRng(seedStr);
  const bucket = slotBucket(slotPos as string);
  const clubs = Array.from(new Set(players.map((p) => p.club)));
  for (let i = clubs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [clubs[i], clubs[j]] = [clubs[j], clubs[i]];
  }
  const toSeason = (list: CurrentPlayer[]): PlayerSeason[] =>
    list
      .map(
        (p) =>
          ({
            id: `cur-${p.id}`,
            name: p.name,
            club: p.club,
            season: "2026/27",
            position: slotPos, // auto-fit: bucket data has no granular position
            overall: overallFromPrice(p.price),
          }) as unknown as PlayerSeason,
      )
      .sort((a, b) => b.overall - a.overall);
  let best: SlotSquad | null = null;
  for (const club of clubs) {
    const eligible = players.filter(
      (p) =>
        p.club === club &&
        p.position === bucket &&
        !usedIds.has(`cur-${p.id}`) &&
        !usedIdents.has(playerIdentity(p.name)),
    );
    if (eligible.length === 0) continue;
    const squad = { club, season: "2026/27", players: toSeason(eligible) };
    if (!best) best = squad;
    if (eligible.some((p) => priceOf(overallFromPrice(p.price)) <= budget)) return squad;
  }
  return best ?? { club: "", season: "2026/27", players: [] };
}

/** Deal a club+season squad for a slot that contains at least one player the
 *  budget can afford (retry the spin; the pool's own re-spin logic avoids
 *  dead-ends on position). Returns the squad's eligible players, price-tagged. */
function dealSquad(
  slotPos: Position,
  usedIds: Set<string>,
  usedIdents: Set<string>,
  budget: number,
  seedStr: string,
): SlotSquad {
  const rng = seededRng(seedStr);
  const seen = new Set<string>();
  let last: SlotSquad | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const sp = spin([slotPos], usedIds, usedIdents, rng, seen, "PL");
    seen.add(`${sp.club}|${sp.season}`);
    const eligible = sp.players.filter(
      (p) => canPlay(p.position, slotPos) && !usedIds.has(p.id) && !usedIdents.has(playerIdentity(p.name)),
    );
    if (eligible.length === 0) continue;
    const squad: SlotSquad = {
      club: sp.club,
      season: sp.season,
      players: eligible.sort((a, b) => b.overall - a.overall),
    };
    last = squad;
    if (eligible.some((p) => priceOf(p.overall) <= budget)) return squad;
  }
  // Vanishingly rare: nothing affordable in 40 deals — return the last squad;
  // the UI lets the cheapest player go for the full remaining budget.
  return last ?? { club: "", season: "", players: [] };
}

export default function YourPlXiWarmup() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [questions, setQuestions] = useState<ServedQuestion[]>([]);
  const [version, setVersion] = useState("");
  const [slotIdx, setSlotIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [step, setStep] = useState<StepResult | null>(null);
  const [budget, setBudget] = useState(0);
  const [squadDeal, setSquadDeal] = useState<SlotSquad | null>(null);
  const [picks, setPicks] = useState<SlotPick[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [swapSlot, setSwapSlot] = useState<number | null>(null);
  const [season, setSeason] = useState<SeasonResult | null>(null);
  const [strength, setStrength] = useState(0);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<WarmupMode>("legends");
  const [currentPlayers, setCurrentPlayers] = useState<CurrentPlayer[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [prevBest, setPrevBest] = useState<{ points: number; wins: number } | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const keyRef = useRef("");

  const slots = useMemo(() => slotsFor(FORMATION), []);
  const arm = useMemo(
    () => (keyRef.current ? parseInt(keyRef.current.slice(0, 2), 16) % 2 : 0),
    [phase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = useCallback(async (playMode: WarmupMode = "legends") => {
    setPhase("loading");
    setErr("");
    setMode(playMode);
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
      const data = (await res.json()) as {
        version: string;
        questions: ServedQuestion[];
        currentPlayers?: CurrentPlayer[];
      };
      if (!data.questions?.length) throw new Error("empty round");
      if (playMode === "current" && !(data.currentPlayers?.length)) throw new Error("26/27 pool unavailable");
      setQuestions(data.questions);
      setVersion(data.version);
      setCurrentPlayers(data.currentPlayers ?? []);
      setAnswers([]);
      setPicks([]);
      setBudget(0);
      setSlotIdx(0);
      setStep(null);
      setSeason(null);
      setSwapSlot(null);
      setCorrectCount(0);
      setPhase("question");
      capture("warmup_started", { mode: playMode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed to start");
      setPhase("error");
    }
  }, []);

  const answering = useRef(false);
  const answer = useCallback(
    async (optionId: number | null) => {
      // Double-tap guard: write by slot index (idempotent) and refuse re-entry —
      // a second tap must never corrupt the answers array or double-grant budget.
      if (answering.current) return;
      answering.current = true;
      const nextAnswers = [...answers];
      nextAnswers[slotIdx] = optionId;
      setAnswers(nextAnswers);
      try {
        const res = await fetch("/api/gates/warmup/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: keyRef.current, version, answers: nextAnswers, k: slotIdx }),
        });
        if (res.status === 409) return void start(mode); // stale pool — restart clean
        if (!res.ok) throw new Error(`step ${res.status}`);
        const data = (await res.json()) as StepResult;
        setStep(data);
        setBudget((b) => r10(b + data.grant));
        if (data.correct) setCorrectCount((c) => c + 1);
        setPhase("reveal");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed to grade");
        setPhase("error");
      } finally {
        answering.current = false;
      }
    },
    [answers, mode, slotIdx, start, version],
  );

  const toSquad = useCallback(() => {
    const slot = slots[slotIdx];
    const usedIds = new Set(picks.map((p) => p.placed.player_season_id));
    const usedIdents = new Set(picks.map((p) => playerIdentity(p.placed.name)));
    const seedStr = `${keyRef.current}:${version}:deal:${slotIdx}`;
    setSquadDeal(
      mode === "current"
        ? dealCurrentSquad(currentPlayers, slot.pos, usedIds, usedIdents, budget, seedStr)
        : dealSquad(slot.pos, usedIds, usedIdents, budget, seedStr),
    );
    setPicked(null);
    setPhase("squad");
  }, [budget, currentPlayers, mode, picks, slotIdx, slots, version]);

  /** Cheapest eligible price in the dealt squad — the stretch-buy fallback. */
  const cheapest = useMemo(
    () => (squadDeal ? Math.min(...squadDeal.players.map((p) => priceOf(p.overall))) : 0),
    [squadDeal],
  );

  const buy = useCallback(
    (p: PlayerSeason) => {
      if (!squadDeal) return;
      if (picks.length !== slotIdx) return; // double-fire guard: one signing per slot
      const rawPrice = priceOf(p.overall);
      const nothingAffordable = cheapest > budget;
      // Stretch buy: if the deal had nothing affordable, the cheapest player
      // goes for whatever's left in the bank.
      const price = rawPrice <= budget ? rawPrice : nothingAffordable && rawPrice === cheapest ? budget : null;
      if (price === null) return;
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
      const nextPicks = [...picks, { placed, price: r10(price), squad: squadDeal }];
      setPicks(nextPicks);
      setBudget((b) => r10(b - price));
      if (slotIdx + 1 < slots.length) {
        setSlotIdx(slotIdx + 1);
        setStep(null);
        setPhase("question");
      } else {
        setPhase("review");
        capture("warmup_review", { budgetLeft: r10(budget - price) });
      }
    },
    [budget, cheapest, picks, slotIdx, slots, squadDeal],
  );

  const doSwap = useCallback(
    (slotI: number, p: PlayerSeason) => {
      const current = picks[slotI];
      if (!current) return;
      if (p.id === current.placed.player_season_id) return void setSwapSlot(null);
      const refund = current.price;
      const price = priceOf(p.overall);
      if (price > r10(budget + refund)) return;
      const slot = slots[slotI];
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
      const nextPicks = picks.map((pk, i) => (i === slotI ? { ...pk, placed, price } : pk));
      setPicks(nextPicks);
      setBudget((b) => r10(b + refund - price));
      setSwapSlot(null);
    },
    [budget, picks, slots],
  );

  const lockAndSimulate = useCallback(() => {
    const squad = picks.map((p) => p.placed);
    const str = scoreTeam(squad, FORMATION);
    setStrength(str);
    const sim = simulateSeason(squad, FORMATION, str, `warmup:${keyRef.current}:${version}`, leagueOpponents("PL"));
    setSeason(sim);
    // Personal best per mode (on-device) — gives repeat plays something to chase.
    try {
      const bestKey = `ys:warmup:best:${mode}`;
      const prev = JSON.parse(localStorage.getItem(bestKey) ?? "null") as { points: number; wins: number } | null;
      setPrevBest(prev);
      const better = !prev || sim.points > prev.points;
      setIsNewBest(better && prev !== null);
      if (better) localStorage.setItem(bestKey, JSON.stringify({ points: sim.points, wins: sim.wins }));
    } catch {
      setPrevBest(null);
      setIsNewBest(false);
    }
    setPhase("result");
    capture("warmup_finished", { strength: str, wins: sim.wins, budgetLeft: budget, correct: correctCount, mode });
  }, [budget, correctCount, mode, picks, version]);

  const share = useCallback(async () => {
    if (!season) return;
    const text = `My XI went ${season.wins}-${season.draws}-${season.losses} in Your PL XI (${correctCount}/11 questions right — knowledge builds the team). Can you beat it? yourscore.app/your-pl-xi`;
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
  }, [correctCount, season]);

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
        whiteSpace: "nowrap",
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

  const wallet = chip(`£${budget.toFixed(1)}m`, true);

  const playerCard = (
    p: PlayerSeason,
    opts: { canBuy: boolean; price: number; selected: boolean; onTap: () => void; stretch?: boolean },
  ) => (
    <button
      key={p.id}
      onClick={opts.onTap}
      disabled={!opts.canBuy}
      style={{
        flex: "0 0 128px",
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "12px 10px",
        borderRadius: 12,
        textAlign: "left",
        cursor: opts.canBuy ? "pointer" : "default",
        background: opts.selected ? "#3A2E08" : CARD,
        border: `1px solid ${opts.selected ? GOLD : EDGE}`,
        opacity: opts.canBuy ? 1 : 0.42,
        color: "#ECF4EF",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.25 }}>{p.name}</span>
      <span style={{ fontSize: 11, color: TEXT_DIM }}>{p.position}</span>
      <span style={{ fontSize: 15, fontWeight: 700, color: "#ECF4EF" }}>{p.overall}</span>
      <span style={{ fontSize: 12, color: opts.canBuy ? GOLD : TEXT_DIM, fontWeight: 600 }}>
        {opts.stretch ? `£${budget.toFixed(1)}m (all in)` : `£${opts.price.toFixed(1)}m`}
      </span>
    </button>
  );

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
      <div style={{ width: "100%", maxWidth: 430, display: "flex", flexDirection: "column", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: GOLD }}>YOUR PL XI</span>
          <span style={{ display: "flex", gap: 6 }}>
            {(phase === "question" || phase === "reveal" || phase === "squad") &&
              chip(`pick ${Math.min(slotIdx + 1, 11)}/11`)}
            {(phase === "question" || phase === "reveal" || phase === "squad" || phase === "review" || phase === "swap") &&
              chip(`✓ ${correctCount}`, correctCount > 0)}
            {phase !== "intro" && phase !== "loading" && phase !== "error" && phase !== "result" && wallet}
          </span>
        </header>

        {phase === "intro" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: PITCH, border: `1px solid ${PITCH_EDGE}`, borderRadius: 16, padding: 18 }}>
              <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em" }}>THE WARM-UP</div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: "6px 0 8px" }}>Your knowledge is your budget</h1>
              <p style={{ fontSize: 14, color: "#B9CABF", lineHeight: 1.55, margin: "0 0 14px" }}>
                Eleven picks, each gated by a question. Right answers earn a bigger transfer budget — spend
                it or bank it, because whatever you save carries over, and after your 11th signing you can
                go back and upgrade any position with what&apos;s left. Then your XI plays a full simulated
                season. Could it go 38-0?
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {btn("Play — all-time legends", () => start("legends"))}
                {btn("Play — the 2026/27 season", () => start("current"), false)}
              </div>
            </div>
            <p style={{ fontSize: 12, color: TEXT_DIM, textAlign: "center" }}>
              No sign-up needed. 11 questions, 11 signings, one season. Legends = squads from all of PL
              history; 2026/27 = build from the upcoming season&apos;s real squads.
            </p>
          </section>
        )}

        {phase === "loading" && (
          <div style={{ textAlign: "center", padding: 60, color: TEXT_DIM }}>Warming up the pitch…</div>
        )}

        {phase === "error" && (
          <section style={{ background: CARD, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 16 }}>
            <p style={{ fontSize: 14, margin: "0 0 12px" }}>Something went wrong ({err}).</p>
            <div style={{ display: "flex" }}>{btn("Try again", () => start(mode))}</div>
          </section>
        )}

        {(phase === "question" || phase === "reveal") && q && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {chip(slots[slotIdx].pos, true)}
              {step && phase === "reveal" && step.streak > 1 && chip(`streak ${step.streak} 🔥`, true)}
            </div>
            <div style={{ background: CARD, border: `1px solid ${EDGE}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.5, whiteSpace: "pre-line" }}>{q.prompt}</div>
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
                    ? `Correct — £${step.grant.toFixed(1)}m added to your budget${step.streak > 1 ? ` (streak ${step.streak})` : ""}.`
                    : `Not this time — £${step.grant.toFixed(1)}m for this one. Spend it wisely.`}
                </div>
                <div style={{ display: "flex" }}>{btn("Deal me a squad", toSquad)}</div>
              </div>
            )}
          </section>
        )}

        {phase === "squad" && squadDeal && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {chip(slots[slotIdx].pos, true)}
              {chip(`${squadDeal.club} · ${squadDeal.season}`)}
            </div>
            <p style={{ fontSize: 13, color: TEXT_DIM, margin: 0 }}>
              Sign one for the {slots[slotIdx].pos} slot — slide for more. Whatever you don&apos;t spend rolls
              over{slotIdx < 10 ? ", and after your 11th signing you can come back and upgrade any position" : ""}.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 6,
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {squadDeal.players.map((p) => {
                const price = priceOf(p.overall);
                const nothingAffordable = cheapest > budget;
                const stretch = nothingAffordable && price === cheapest;
                const canBuy = price <= budget || stretch;
                return playerCard(p, {
                  canBuy,
                  price,
                  stretch,
                  selected: picked === p.id,
                  onTap: () => setPicked(picked === p.id ? null : p.id),
                });
              })}
            </div>
            <div style={{ display: "flex" }}>
              {btn(
                picked
                  ? (() => {
                      const p = squadDeal.players.find((x) => x.id === picked)!;
                      const price = priceOf(p.overall);
                      const stretch = cheapest > budget && price === cheapest;
                      return `Sign ${p.name} — £${(stretch ? budget : price).toFixed(1)}m`;
                    })()
                  : "Pick a player to sign",
                () => {
                  const p = squadDeal.players.find((x) => x.id === picked);
                  if (p) buy(p);
                },
                true,
                picked === null,
              )}
            </div>
          </section>
        )}

        {(phase === "review" || phase === "swap") && (() => {
          // Gold in review = "an upgrade is actually possible here with the bank
          // + this player's sell-back" (founder: show where upgrading is even an
          // option). A better player must exist in the slot's dealt squad, be
          // affordable, and not already be in the XI elsewhere.
          const upgradable = picks.map((pk, i) => {
            const wallet = r10(budget + pk.price);
            return pk.squad.players.some((p) => {
              if (p.overall <= pk.placed.overall) return false;
              if (priceOf(p.overall) > wallet) return false;
              const ident = playerIdentity(p.name);
              return !picks.some(
                (o, oi) => oi !== i && (o.placed.player_season_id === p.id || playerIdentity(o.placed.name) === ident),
              );
            });
          });
          const anyUpgrade = upgradable.some(Boolean);
          return (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em" }}>SQUAD REVIEW</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                £{budget.toFixed(1)}m left in the bank
              </div>
              <div style={{ fontSize: 13, color: TEXT_DIM }}>
                {anyUpgrade
                  ? "Gold positions can be upgraded with what you've got — tap one, or lock it in."
                  : "No upgrades in reach with what's left — lock it in when you're ready."}
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
              {[picks.slice(8, 11), picks.slice(5, 8), picks.slice(1, 5), picks.slice(0, 1)].map((line, li) => (
                <div key={li} style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                  {line.map((pk) => {
                    const i = picks.indexOf(pk);
                    const canUp = upgradable[i];
                    return (
                      <button
                        key={pk.placed.slot}
                        onClick={() => {
                          setSwapSlot(i);
                          setPicked(null);
                          setPhase("swap");
                        }}
                        style={{
                          background: canUp ? "#3A2E08" : CARD,
                          border: `1px solid ${canUp ? GOLD : EDGE}`,
                          borderRadius: 9,
                          padding: "5px 7px",
                          fontSize: 11,
                          textAlign: "center",
                          minWidth: 60,
                          cursor: "pointer",
                          color: "#ECF4EF",
                          opacity: canUp || phase === "review" ? 1 : 0.7,
                        }}
                      >
                        <div style={{ fontWeight: 600, color: canUp ? "#F8E9B0" : "#ECF4EF" }}>
                          {pk.placed.name}
                          {canUp ? " ↑" : ""}
                        </div>
                        <div style={{ color: canUp ? GOLD : TEXT_DIM }}>
                          {pk.placed.overall} · £{pk.price.toFixed(1)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {phase === "swap" && swapSlot !== null && picks[swapSlot] && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  {chip(picks[swapSlot].placed.slotPos, true)}
                  {chip(`${picks[swapSlot].squad.club} · ${picks[swapSlot].squad.season}`)}
                  {chip(`sell ${picks[swapSlot].placed.name} back for £${picks[swapSlot].price.toFixed(1)}m`)}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    overflowX: "auto",
                    paddingBottom: 6,
                    scrollSnapType: "x mandatory",
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {picks[swapSlot].squad.players
                    .filter((p) => {
                      // exclude players already in the XI at OTHER slots
                      const ident = playerIdentity(p.name);
                      return !picks.some(
                        (pk, i) => i !== swapSlot && (pk.placed.player_season_id === p.id || playerIdentity(pk.placed.name) === ident),
                      );
                    })
                    .map((p) => {
                      const price = priceOf(p.overall);
                      const isCurrent = p.id === picks[swapSlot].placed.player_season_id;
                      const canBuy = isCurrent || price <= r10(budget + picks[swapSlot].price);
                      return playerCard(p, {
                        canBuy,
                        price,
                        selected: picked === p.id || isCurrent,
                        onTap: () => setPicked(picked === p.id ? null : p.id),
                      });
                    })}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {btn("Keep him", () => { setSwapSlot(null); setPhase("review"); }, false)}
                  {btn(
                    "Make the swap",
                    () => {
                      const p = picks[swapSlot].squad.players.find((x) => x.id === picked);
                      if (p) {
                        doSwap(swapSlot, p);
                        setPhase("review");
                      }
                    },
                    true,
                    picked === null || picked === picks[swapSlot].placed.player_season_id,
                  )}
                </div>
              </div>
            )}

            {phase === "review" && (
              <div style={{ display: "flex" }}>{btn("Lock team & play the season", lockAndSimulate)}</div>
            )}
          </section>
          );
        })()}

        {phase === "result" && season && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ height: 4, background: GOLD, borderRadius: 2 }} />
            <div>
              <div style={{ fontSize: 12, color: TEXT_DIM, letterSpacing: "0.08em" }}>YOUR SIMULATED SEASON</div>
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
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {chip(`✓ ${correctCount}/11 correct`, correctCount >= 8)}
                {budget > 0 && chip(`£${budget.toFixed(1)}m left unspent`)}
                {isNewBest
                  ? chip("🏆 new personal best", true)
                  : prevBest && chip(`personal best: ${prevBest.points} pts`)}
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
              {[picks.slice(8, 11), picks.slice(5, 8), picks.slice(1, 5), picks.slice(0, 1)].map((line, li) => (
                <div key={li} style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                  {line.map((pk) => (
                    <div
                      key={pk.placed.slot}
                      style={{
                        background: CARD,
                        border: `1px solid ${EDGE}`,
                        borderRadius: 9,
                        padding: "4px 7px",
                        fontSize: 11,
                        textAlign: "center",
                        minWidth: 58,
                      }}
                    >
                      <div style={{ fontWeight: 600, color: "#ECF4EF" }}>{pk.placed.name}</div>
                      <div style={{ color: TEXT_DIM }}>{pk.placed.overall}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {btn("Share it", share, false)}
              {btn("Run it back", () => start(mode), false)}
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
