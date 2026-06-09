"use client";

/**
 * /38-0/match/result — full-time result for the most recent local Quick Match:
 * the real scoreline, scorers, MOTM, broadcast stats, both XIs, and a one-tap share
 * of the scoreline graphic. Mirrors the public /38-0/match/[id] live view; this is
 * the local (guest) version, reading the last match from localStorage.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { loadLastMatch, type LocalMatch } from "@/lib/draft/local";
import { tierColor } from "@/lib/draft/ui";
import { liveOgQuery } from "@/lib/draft/share";

export default function MatchResult() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    const lm = loadLastMatch();
    if (!lm) { router.replace("/38-0"); return; }
    setM(lm);
  }, [router]);

  function ogUrl(): string {
    if (!m) return "/api/draft/live-og";
    const q = liveOgQuery({
      p1: "Your XI", p2: m.opp.name,
      s1: m.goals.you, s2: m.goals.opp,
      str1: m.you.strength, str2: m.opp.strength,
      pens: m.pens ? { a: m.pens.you, b: m.pens.opp } : null,
      report: m.report,
    });
    return `/api/draft/live-og?${q}`;
  }

  async function share() {
    if (!m) return;
    const won = m.outcome === "you";
    const drew = m.outcome === "draw";
    const score = `${m.goals.you}–${m.goals.opp}`;
    const text = drew
      ? `My Draft XI drew ${score} with ${m.opp.name} head-to-head ⚽ Build yours and take me on:`
      : won
      ? `My Draft XI beat ${m.opp.name} ${score} head-to-head ⚽🔥 Build yours:`
      : `${m.opp.name} beat my Draft XI ${m.goals.opp}–${m.goals.you}. Rebuilding… Take me on:`;
    const url = "https://yourscore.app/38-0";
    try {
      try {
        const res = await fetch(ogUrl());
        const blob = await res.blob();
        const file = new File([blob], "draft-xi.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "Draft XI", text, url });
          return;
        }
      } catch { /* fall through to text share */ }

      if (navigator.share) {
        await navigator.share({ title: "Draft XI", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 1800);
      }
    } catch { /* user cancelled */ }
  }

  if (!m) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const won = m.outcome === "you";
  const drew = m.outcome === "draw";
  const accent = won ? "#00ff87" : drew ? "#ffb800" : "#ff4757";
  const headline = won ? "WIN" : drew ? "DRAW" : "LOSS";
  const rep = m.report;

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        {/* full-time scoreline */}
        <div className="pt-8 text-center">
          <div className="font-display tracking-wide leading-none" style={{ fontSize: 64, color: accent }}>
            {headline}
          </div>
          <div className="flex items-center justify-center gap-3 mt-3">
            <span className="font-display tracking-wide truncate text-right" style={{ fontSize: 16, color: won ? "#00ff87" : "#cfcfe6", maxWidth: 130 }}>You</span>
            <span className="font-display tabular-nums" style={{ fontSize: 44, fontWeight: 900, color: won ? "#00ff87" : "#cfcfe6" }}>{m.goals.you}</span>
            <span style={{ color: "#555", fontSize: 26 }}>–</span>
            <span className="font-display tabular-nums" style={{ fontSize: 44, fontWeight: 900, color: m.outcome === "opp" ? "#00ff87" : "#cfcfe6" }}>{m.goals.opp}</span>
            <span className="font-display tracking-wide truncate text-left" style={{ fontSize: 16, color: m.outcome === "opp" ? "#00ff87" : "#cfcfe6", maxWidth: 130 }}>{m.opp.name}</span>
          </div>
          {m.pens && <div className="font-body mt-1" style={{ fontSize: 13, color: "#ffb800" }}>penalties {m.pens.you}–{m.pens.opp}</div>}

          {rep.potm && (
            <div className="inline-flex items-center gap-2 rounded-full mt-3 px-4 py-1.5" style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.35)" }}>
              <span className="font-body" style={{ fontSize: 12, color: "#ffb800", letterSpacing: 1 }}>⭐ MOTM</span>
              <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>{rep.potm.name} <b style={{ color: "#ffb800" }}>{rep.potm.rating.toFixed(1)}</b></span>
            </div>
          )}
          {rep.events.length > 0 && (
            <div className="font-body mt-2 truncate" style={{ fontSize: 12, color: "#cfcfe6" }}>⚽ {rep.events.map((e) => `${e.scorerName} ${e.minute}'`).join(" · ")}</div>
          )}

          {/* broadcast stats */}
          <div className="rounded-xl overflow-hidden mt-4" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
            {([
              ["Possession", `${rep.a.possession}%`, `${rep.b.possession}%`, rep.a.possession, rep.b.possession],
              ["Shots", rep.a.shots, rep.b.shots, rep.a.shots, rep.b.shots],
              ["On target", rep.a.shotsOnTarget, rep.b.shotsOnTarget, rep.a.shotsOnTarget, rep.b.shotsOnTarget],
              ["Corners", rep.a.corners, rep.b.corners, rep.a.corners, rep.b.corners],
              ["Fouls", rep.a.fouls, rep.b.fouls, rep.a.fouls, rep.b.fouls],
              ["Offsides", rep.a.offsides, rep.b.offsides, rep.a.offsides, rep.b.offsides],
              ["Throw-ins", rep.a.throwins, rep.b.throwins, rep.a.throwins, rep.b.throwins],
            ] as [string, string | number, string | number, number, number][]).map(([label, av, bv, an, bn]) => (
              <div key={label} className="flex items-center px-3 py-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <span className="flex-1 text-left font-body tabular-nums font-bold" style={{ fontSize: 15, color: an >= bn ? "#fff" : "#8888aa" }}>{av}</span>
                <span className="text-center font-body" style={{ width: 110, fontSize: 10, letterSpacing: 1, color: "#7a7a92" }}>{label.toUpperCase()}</span>
                <span className="flex-1 text-right font-body tabular-nums font-bold" style={{ fontSize: 15, color: bn >= an ? "#fff" : "#8888aa" }}>{bv}</span>
              </div>
            ))}
          </div>
        </div>

        {/* both XIs */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide" style={{ fontSize: 16, color: won ? "#00ff87" : "#fff" }}>YOU</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(m.you.projected?.tier ?? "Mid-table") }}>{m.you.strength}</span>
            </div>
            <Pitch formation={m.you.formation} squad={m.you.squad} compact />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide leading-tight truncate" style={{ fontSize: 16, color: m.outcome === "opp" ? "#ff4757" : "#fff", maxWidth: "70%" }}>{m.opp.name}</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(m.opp.projected?.tier ?? "Mid-table") }}>{m.opp.strength}</span>
            </div>
            <Pitch formation={m.opp.formation} squad={m.opp.squad} compact />
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <button onClick={share}
            className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#ffb800", color: "#1a1300", fontSize: 24 }}>
            {shared ? "COPIED ✓" : "SHARE RESULT 📲"}
          </button>

          {won ? (
            <Link href="/38-0/swap"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 22 }}>
              SWAP ONE PLAYER →
            </Link>
          ) : drew ? (
            <Link href="/38-0/team"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "rgba(255,184,0,0.14)", color: "#ffb800", fontSize: 22, border: "1px solid rgba(255,184,0,0.4)" }}>
              GO AGAIN →
            </Link>
          ) : (
            <Link href="/38-0"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#ff4757", color: "#fff", fontSize: 22 }}>
              REBUILD XI →
            </Link>
          )}

          <Link href="/38-0/team"
            className="block w-full rounded-2xl py-3 text-center font-body active:scale-[0.98] transition-transform"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
            Back to my team
          </Link>
        </div>
      </div>
    </div>
  );
}
