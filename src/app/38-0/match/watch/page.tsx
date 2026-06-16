"use client";

/**
 * /38-0/match/watch — plays the most recent Quick Match out on screen: first half
 * (~45s) → a brief half-time → second half (~45s) → hands off to the result screen.
 * Local ticker drives progress; the visuals come from <MatchPitch> (2D pitch playback).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadLastMatch, type LocalMatch } from "@/lib/draft/local";
import { MatchPitch } from "@/components/draft/MatchPitch";
import { WATCH_CONFIG } from "@/lib/draft/playback";

const BG = "#0a0a0f";
type Stage = "half1" | "halftime" | "half2";

export default function WatchPage() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [stage, setStage] = useState<Stage>("half1");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const lm = loadLastMatch();
    // No playable sim (e.g. an async/challenge result) → straight to the result screen.
    if (!lm || !lm.sim?.h1 || !lm.sim?.h2) { router.replace("/38-0/match/result"); return; }
    setM(lm);
  }, [router]);

  // Drive the active half 0→1 over halfSeconds, then advance.
  useEffect(() => {
    if (!m || stage === "halftime") return;
    const dur = WATCH_CONFIG.halfSeconds * 1000;
    const start = performance.now();
    setProgress(0);
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / dur);
      setProgress(p);
      if (p >= 1) {
        clearInterval(id);
        if (stage === "half1") setStage("halftime");
        // Level after 90? The shootout settles it before the result screen.
        else router.replace(m.pensPending ? "/38-0/match/pens" : "/38-0/match/result");
      }
    }, 100);
    return () => clearInterval(id);
  }, [m, stage, router]);

  // Half-time interstitial auto-advances (tap to skip the wait).
  useEffect(() => {
    if (stage !== "halftime") return;
    const id = setTimeout(() => setStage("half2"), 5000);
    return () => clearTimeout(id);
  }, [stage]);

  if (!m || !m.sim?.h1 || !m.sim?.h2) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: BG, color: "#8a948f" }}>Loading…</div>;
  }

  const h1 = m.sim.h1;
  const h1Goals = { a: h1.goals.a, b: h1.goals.b };

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: BG, color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-4 pt-10">
        <p className="text-center font-display tracking-wide mb-4" style={{ fontSize: 13, color: "#8a948f", letterSpacing: 1 }}>
          {stage === "half1" ? "FIRST HALF" : stage === "half2" ? "SECOND HALF" : "HALF TIME"}
        </p>

        {stage === "halftime" ? (
          <div className="text-center">
            <div className="font-display tracking-wide" style={{ fontSize: 56, color: "#ffb800" }}>HT</div>
            <div className="font-display tabular-nums mt-2" style={{ fontSize: 40, fontWeight: 900 }}>
              {h1Goals.a} – {h1Goals.b}
            </div>
            <p className="font-body mt-2" style={{ fontSize: 13, color: "#9aa39d" }}>You vs {m.opp.name}</p>
            <button onClick={() => setStage("half2")}
              className="mt-6 rounded-2xl px-6 py-3 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#aeea00", color: "#062013", fontSize: 18 }}>
              SECOND HALF →
            </button>
          </div>
        ) : (
          <MatchPitch
            sim={stage === "half1" ? m.sim.h1 : m.sim.h2}
            half={stage === "half1" ? 1 : 2}
            matchId={m.id}
            progress={progress}
            priorGoals={stage === "half1" ? { a: 0, b: 0 } : h1Goals}
            meSide="a"
            myName="You"
            oppName={m.opp.name}
          />
        )}
      </div>
    </div>
  );
}
