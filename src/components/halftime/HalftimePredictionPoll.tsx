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
 * The second-half call, shown at the end of a halftime pack.
 *
 * A halftime pack can never ask about the half it is played during (the hard
 * content rule), so this is the live stake instead: one tap on who wins, graded
 * at full time. It talks only to /api/halftime/predict — the server owns the
 * fixture, the tally and whether the poll is still open; this component just
 * renders what comes back and posts a pick.
 *
 * Signed-in only: a pick has to belong to someone to be graded, and POST needs
 * auth. Guests on the results screen already get their own sign-up nudge.
 */

interface PollState {
  home: string;
  away: string;
  closed: boolean;
  myPick: Pick | null;
  result: Pick | null;
  tally: Tally;
}

export default function HalftimePredictionPoll({
  packId,
  accent,
}: {
  packId: string;
  accent: string;
}) {
  const [state, setState] = useState<PollState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/halftime/predict?pack=${encodeURIComponent(packId)}`);
        if (!res.ok) return; // not a halftime pack, or nothing to show — render nothing
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
  }, [packId]);

  async function pickIt(pick: Pick) {
    if (submitting || !state || state.myPick || state.closed) return;
    setSubmitting(true);
    // Optimistic: show their choice immediately; reconcile with the server tally.
    setState((s) => (s ? { ...s, myPick: pick } : s));
    try {
      const res = await fetch("/api/halftime/predict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId, pick }),
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
          {closed ? "YOUR CALL" : "CALL THE SECOND HALF"}
        </p>
      </div>
      <p className="font-body text-sm text-text-muted mb-4">{pollPrompt(home, away)}</p>

      <div className="flex flex-col gap-2.5">
        {PICKS.map((p) => {
          const label = optionLabel(p, home, away);
          const pct = tallyPercent(tally, p);
          const isMine = myPick === p;
          const isResult = closed && result === p;
          // Once a call is made (or the poll is closed) every row becomes a
          // result bar showing the share of fans on each side.
          const border = isMine
            ? `1.5px solid ${accent}`
            : isResult
              ? "1.5px solid rgba(255,255,255,0.35)"
              : "1px solid rgba(255,255,255,0.08)";
          return (
            <button
              key={p}
              onClick={() => pickIt(p)}
              disabled={decided || submitting}
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
