"use client";

import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Shared count-up question timer for the local-timer gameplay loops
 * (solo challenges + head-to-head). Both pages restart the timer whenever the
 * current question index changes while the round is active, read the question
 * start time to compute the per-answer elapsed, and stop the timer on answer /
 * quit. This hook encapsulates that identical timer mechanics so the math and
 * timing stay in lock-step across both modes.
 *
 * It deliberately does NOT own phase, streak, advance or answer-submission
 * state — those diverge meaningfully between the two modes (and the realtime
 * multiplayer page is server-driven and does not use this at all).
 *
 * @param active        Whether the round is in its "playing" state.
 * @param currentIdx    Current question index — the timer restarts when it changes.
 * @param tickMs        Sampling interval (default 30ms ≈ 33fps, smooth enough
 *                      for two-decimal display).
 */
export function useGameLoop(active: boolean, currentIdx: number, tickMs = 30) {
  const [timerMs, setTimerMs] = useState(0);
  const questionStartRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    questionStartRef.current = Date.now();
    setTimerMs(0);
    timerIntervalRef.current = setInterval(() => {
      setTimerMs(Date.now() - questionStartRef.current);
    }, tickMs);
  }, [stopTimer, tickMs]);

  // Start/reset the timer whenever the question index changes (or the round
  // enters its active/playing state).
  useEffect(() => {
    if (active) startTimer();
    return stopTimer;
  }, [currentIdx, active, startTimer, stopTimer]);

  return { timerMs, setTimerMs, questionStartRef, startTimer, stopTimer };
}
