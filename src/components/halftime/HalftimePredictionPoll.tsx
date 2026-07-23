"use client";

import { useEffect, useState } from "react";
import {
  PICKS,
  optionLabel,
  pendingLine,
  pollPrompt,
  settledLine,
  tallyPercent,
  type Pick,
  type Tally,
} from "@/lib/halftime/predict";

/**
 * A prediction poll for ONE phase of ONE fixture (§0.6) — keys on the fixture,
 * never a quiz pack. Two call sites, two phases:
 *   - end of a Gameday pack attempt, phase="prematch" (challenges/[slug]/page.tsx)
 *   - standalone on the matchweek page, phase="halftime", shown to every
 *     player whether or not they played the quiz
 *
 * SELF-HIDES when its phase is not open, the player has not already picked,
 * and nothing is settled yet — i.e. there is genuinely nothing to show. Once
 * a pick exists (even after the window has since closed for new picks) or the
 * result has settled, it keeps rendering so the fan sees their call graded.
 *
 * Signed-in only: a pick has to belong to someone to be graded, and POST needs
 * auth. Guests on the results screen already get their own sign-up nudge.
 */

interface PollState {
  home: string;
  away: string;
  phase: "prematch" | "halftime";
  open: boolean;
  closed: boolean;
  myPick: Pick | null;
  result: Pick | null;
  tally: Tally;
}

export default function HalftimePredictionPoll({
  fixtureId,
  phase,
  accent,
}: {
  fixtureId: number;
  phase: "prematch" | "halftime";
  accent: string;
}) {
  const [state, setState] = useState<PollState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/halftime/predict?fixture=${fixtureId}&phase=${phase}`);
        if (!res.ok) return; // no such fixture — render nothing
        const body = (await res.json()) as PollState;
        if (live) setState(body);
      } catch {
        /* offline / transient — the poll just doesn't appear */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [fixtureId, phase]);

  async function pickIt(pick: Pick) {
    if (submitting || !state || state.myPick || !state.open) return;
    setSubmitting(true);
    // Optimistic: show their choice immediately; reconcile with the server tally.
    setState((s) => (s ? { ...s, myPick: pick } : s));
    try {
      const res = await fetch("/api/halftime/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fixtureId, phase, pick }),
      });
      if (res.ok || res.status === 409) {
        const body = (await res.json()) as PollState;
        setState(body);
      }
    } catch {
      /* keep the optimistic pick; next open reconciles */
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !state) return null;

  const { home, away, closed, myPick, result, tally } = state;

  // Nothing to show: the phase hasn't opened, nobody picked, nothing settled.
  if (!state.open && !closed && myPick === null) return null;

  const decided = myPick !== null || closed;
  const statusLine = closed
    ? settledLine(myPick, result as Pick, home, away)
    : myPick
      ? pendingLine(myPick, home, away)
      : null;

  return (
    <div
      className="rounded-2xl p-5 bg-surface"
      style={{ border: `1px solid ${accent}30` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🔮</span>
        <p className="font-display text-xs tracking-widest" style={{ color: accent }}>
          {closed ? "YOUR CALL" : phase === "prematch" ? "CALL THE FULL TIME" : "CALL THE SECOND HALF"}
        </p>
      </div>
      <p className="font-body text-sm text-text-muted mb-4">{pollPrompt(home, away)}</p>

      <div className="flex flex-col gap-2.5">
        {PICKS.map((p) => {
          const label = optionLabel(p, home, away);
          const pct = tallyPercent(tally, p);
          const isMine = myPick === p;
          const isResult = closed && result === p;
          const border = isMine
            ? `1.5px solid ${accent}`
            : isResult
              ? "1.5px solid rgba(255,255,255,0.35)"
              : "1px solid rgba(255,255,255,0.08)";
          return (
            <button
              key={p}
              onClick={() => pickIt(p)}
              disabled={decided || submitting || !state.open}
              className="relative w-full overflow-hidden rounded-xl text-left active:scale-[0.99] transition-transform"
              style={{ border, background: "rgba(255,255,255,0.03)", cursor: decided ? "default" : "pointer" }}
            >
              {decided && (
                <div
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${pct}%`,
                    background: isMine ? `${accent}22` : "rgba(255,255,255,0.06)",
                    transition: "width 400ms ease",
                  }}
                />
              )}
              <div className="relative flex items-center justify-between px-4 py-3">
                <span className="font-body text-sm text-white flex items-center gap-2">
                  {label}
                  {isMine && <span style={{ color: accent }}>·&nbsp;you</span>}
                  {isResult && <span className="text-text-muted">·&nbsp;full&nbsp;time</span>}
                </span>
                {decided && (
                  <span className="font-display text-sm" style={{ color: isMine ? accent : "#8a948f" }}>
                    {pct}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {statusLine && (
        <p className="font-body text-xs mt-3.5" style={{ color: closed ? "#9aa39d" : accent }}>
          {statusLine}
        </p>
      )}
      {!decided && (
        <p className="font-body text-xs mt-3.5 text-text-muted">
          One pick, locked in. We&apos;ll grade it at full time.
        </p>
      )}
    </div>
  );
}
