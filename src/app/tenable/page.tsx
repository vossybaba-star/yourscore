"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/ui/BottomNav";
import { currentBoard } from "@/data/tenable/boards";
import {
  initState,
  applyGuess,
  scoreBoard,
  beatLuke,
  revealRows,
  STARTING_LIVES,
  BOARD_SIZE,
} from "@/lib/tenable/engine";
import type { TenableState, GuessOutcome } from "@/lib/tenable/types";

// LukePingu's Weekly — Football Tenable. Standalone playable prototype.
// Quiz-family format → teal accent; wins use gold.

const TEAL = "var(--teal)";
const GOLD = "var(--gold)";
const DANGER = "var(--danger)";

export default function TenablePage() {
  const board = useMemo(() => currentBoard(), []);
  const [state, setState] = useState<TenableState>(initState);
  const [value, setValue] = useState("");
  const [flash, setFlash] = useState<{ outcome: GuessOutcome; key: number } | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashKey = useRef(0);

  const finished = state.status !== "playing";
  const score = useMemo(() => scoreBoard(state), [state]);
  const verdict = beatLuke(score.found, board.lukeScore);
  const rows = useMemo(() => revealRows(board, state), [board, state]);
  const bestKey = `tenable.best.${board.slug}`;

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(bestKey) : null;
    if (raw != null) setBest(Number(raw));
  }, [bestKey]);

  useEffect(() => {
    if (!finished) return;
    setBest((prev) => {
      const next = prev == null ? score.total : Math.max(prev, score.total);
      try { window.localStorage.setItem(bestKey, String(next)); } catch {}
      return next;
    });
  }, [finished, score.total, bestKey]);

  function submit() {
    if (finished) return;
    const raw = value;
    const { state: next, outcome } = applyGuess(board, state, raw);
    setState(next);
    setValue("");
    flashKey.current += 1;
    setFlash({ outcome, key: flashKey.current });
    inputRef.current?.focus();
  }

  function reset() {
    setState(initState());
    setValue("");
    setFlash(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--text-primary)", paddingBottom: 96 }}>
      {/* Header */}
      <header
        className="pt-safe"
        style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(8,13,10,0.82)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--border)" }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ color: "var(--text-muted)", fontSize: 22, lineHeight: 1, textDecoration: "none" }}>‹</Link>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: TEAL, fontWeight: 700 }}>
              LukePingu&apos;s Weekly · Week {board.week}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Football Tenable</div>
          </div>
          <Badge>{score.found}/{BOARD_SIZE}</Badge>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "16px" }}>
        {/* Category card */}
        <section style={card()}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Name the top 10…</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, margin: 0 }}>{board.category}</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>{board.subtitle}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <PinguAvatar />
            <div style={{ fontSize: 13 }}>
              <span style={{ color: "var(--text-muted)" }}>Luke got </span>
              <b style={{ color: GOLD }}>{board.lukeScore}/10</b>
              <span style={{ color: "var(--text-muted)" }}> — beat him.</span>
            </div>
          </div>
        </section>

        {/* Lives + best */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 2px 10px" }}>
          <Lives lives={state.lives} />
          {best != null && (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Best: <b style={{ color: "var(--text-primary)" }}>{best.toLocaleString()}</b></div>
          )}
        </div>

        {/* The ladder */}
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {rows.map(({ answer, found }) => (
            <li key={answer.rank} style={rung(found, finished)}>
              <span style={{ width: 22, textAlign: "center", fontWeight: 800, color: found ? TEAL : "var(--text-muted)", fontSize: 13 }}>
                {answer.rank}
              </span>
              {found || finished ? (
                <>
                  <span style={{ flex: 1, fontWeight: 700, color: found ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {answer.label}
                  </span>
                  <span style={{ fontSize: 12, color: found ? TEAL : "var(--text-muted)", fontWeight: 600 }}>{answer.detail}</span>
                  {!found && finished && <span style={{ fontSize: 12, marginLeft: 8 }}>❌</span>}
                </>
              ) : (
                <span style={{ flex: 1, color: "var(--text-muted)", letterSpacing: 6 }}>• • • • • •</span>
              )}
            </li>
          ))}
        </ol>

        {/* Input / feedback */}
        {!finished ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="Name a player…"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                style={inputStyle()}
              />
              <button onClick={submit} style={submitBtn()}>Guess</button>
            </div>
            <FlashLine flash={flash} />
          </div>
        ) : (
          <ResultCard
            board={board}
            score={score}
            verdict={verdict}
            foundRanks={state.foundRanks}
            misses={state.misses}
            onReset={reset}
          />
        )}
      </main>
      <BottomNav />
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FlashLine({ flash }: { flash: { outcome: GuessOutcome; key: number } | null }) {
  if (!flash) return <div style={{ height: 22, marginTop: 10 }} />;
  const { outcome } = flash;
  let text = "", color = "var(--text-muted)";
  if (outcome.kind === "hit") { text = `✅ ${outcome.answer.label} — ${outcome.answer.detail}`; color = TEAL; }
  else if (outcome.kind === "miss") { text = "❌ Not on the list — life lost"; color = DANGER; }
  else if (outcome.kind === "duplicate") { text = `Already got ${outcome.answer.label} 👍`; color = "var(--text-muted)"; }
  else return <div style={{ height: 22, marginTop: 10 }} />;
  return <div key={flash.key} style={{ height: 22, marginTop: 10, fontSize: 13, fontWeight: 600, color, animation: "ten-pop 240ms ease-out" }}>{text}</div>;
}

function Lives({ lives }: { lives: number }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {Array.from({ length: STARTING_LIVES }).map((_, i) => (
        <span key={i} style={{ fontSize: 18, filter: i < lives ? "none" : "grayscale(1)", opacity: i < lives ? 1 : 0.3 }}>
          {i < lives ? "⚽" : "⚫"}
        </span>
      ))}
      <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 4 }}>{lives} {lives === 1 ? "life" : "lives"}</span>
    </div>
  );
}

function ResultCard({ board, score, verdict, foundRanks, misses, onReset }: {
  board: ReturnType<typeof currentBoard>;
  score: ReturnType<typeof scoreBoard>;
  verdict: "beat" | "tied" | "lost";
  foundRanks: number[];
  misses: string[];
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const headline = score.perfect ? "PERFECT BOARD" : verdict === "beat" ? "You beat LukePingu" : verdict === "tied" ? "You matched Luke" : "Luke got you";
  const headColor = score.perfect ? GOLD : verdict === "beat" ? TEAL : verdict === "tied" ? "var(--text-primary)" : DANGER;

  async function copyShare() {
    const found = new Set(foundRanks);
    // Emoji grid in rank order — green for the ranks actually found.
    const grid = [...board.answers]
      .sort((a, b) => a.rank - b.rank)
      .map((a) => (found.has(a.rank) ? "🟩" : "⬛"))
      .join("");
    const hearts = "⚽".repeat(score.livesLeft);
    const verdictLine = verdict === "beat" ? "I beat Luke" : verdict === "tied" ? "I matched Luke" : `Luke got me (${board.lukeScore})`;
    const text = `⚽ LukePingu's Weekly — ${board.category}\n${score.found}/10 ${grid} ${hearts}\n${verdictLine}. ${score.total.toLocaleString()} pts\nyourscore.app/l/lukepingu`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ ...card(), textAlign: "center", borderColor: headColor, background: "var(--surface-2)" }}>
        <div style={{ fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>Result</div>
        <div style={{ fontSize: 24, fontWeight: 900, color: headColor, margin: "6px 0 2px" }}>{headline}</div>
        <div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1 }}>{score.found}<span style={{ fontSize: 22, color: "var(--text-muted)" }}>/10</span></div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>vs Luke&apos;s {board.lukeScore}/10</div>

        {/* points breakdown */}
        <div style={{ display: "flex", justifyContent: "center", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
          <Stat label="Answers" value={`${score.answerPoints.toLocaleString()}`} />
          <Stat label="Lives" value={`${score.lifePoints.toLocaleString()}`} />
          {score.perfectBonus > 0 && <Stat label="Perfect" value={`+${score.perfectBonus.toLocaleString()}`} gold />}
          <Stat label="Total" value={score.total.toLocaleString()} accent />
        </div>

        <div style={{ marginTop: 12, fontSize: 13, fontStyle: "italic", color: "var(--text-muted)" }}>“{board.lukeQuote}”</div>
      </div>

      {misses.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 4px" }}>
          Wrong guesses: {misses.slice(0, 8).join(", ")}{misses.length > 8 ? "…" : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button onClick={copyShare} style={{ ...submitBtn(), flex: 1, background: TEAL }}>{copied ? "Copied!" : "Share score"}</button>
        <button onClick={onReset} style={{ ...submitBtn(), flex: 1, background: "var(--surface-3)", color: "var(--text-primary)" }}>Play again</button>
      </div>
      <Link href="/" style={{ display: "block", textAlign: "center", marginTop: 14, fontSize: 13, color: TEAL, textDecoration: "none", fontWeight: 600 }}>
        Climb Luke&apos;s leaderboard → yourscore.app/l/lukepingu
      </Link>
    </div>
  );
}

function Stat({ label, value, accent, gold }: { label: string; value: string; accent?: boolean; gold?: boolean }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: gold ? GOLD : accent ? TEAL : "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, fontWeight: 800, color: TEAL, background: "rgba(0,216,192,0.12)", border: "1px solid rgba(0,216,192,0.3)", borderRadius: 999, padding: "4px 10px" }}>{children}</span>;
}

function PinguAvatar() {
  return (
    <div style={{ width: 28, height: 28, borderRadius: 999, background: "linear-gradient(135deg,#111,#2a2a2a)", display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0, border: "1px solid var(--border)" }}>🐧</div>
  );
}

// ── styles ───────────────────────────────────────────────────────────────────

function card(): React.CSSProperties {
  return { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 16 };
}
function rung(found: boolean, finished: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12,
    background: found ? "rgba(0,216,192,0.08)" : "var(--surface)",
    border: `1px solid ${found ? "rgba(0,216,192,0.35)" : "var(--border)"}`,
    opacity: finished && !found ? 0.7 : 1,
    transition: "background 160ms, border-color 160ms",
  };
}
function inputStyle(): React.CSSProperties {
  return { flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 14px", color: "var(--text-primary)", outline: "none", fontWeight: 600 };
}
function submitBtn(): React.CSSProperties {
  return { background: TEAL, color: "#04201d", fontWeight: 800, border: "none", borderRadius: 12, padding: "13px 18px", cursor: "pointer" };
}
