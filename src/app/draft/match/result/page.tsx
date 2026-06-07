"use client";

/**
 * /draft/match/result — H2H result for the most recent local Quick Match: both
 * XIs, the winner, the deciding margin, and a one-tap share. (Cloud matches will
 * use /draft/match/[id] with a server-rendered OG image; this is the local view.)
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pitch } from "@/components/draft/Pitch";
import { loadLastMatch, type LocalMatch } from "@/lib/draft/local";
import { tierColor } from "@/lib/draft/ui";

export default function MatchResult() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    const lm = loadLastMatch();
    if (!lm) { router.replace("/draft"); return; }
    setM(lm);
  }, [router]);

  function ogUrl(): string {
    if (!m) return "/api/draft/og";
    const won = m.winner === "you";
    const params = new URLSearchParams({
      result: won ? "win" : "loss",
      tier: m.you.projected?.tier ?? "Champions",
      formation: m.you.formation,
      you: "Your XI",
      youStr: String(m.you.strength),
      opp: m.opp.name,
      oppStr: String(m.opp.strength),
    });
    return `/api/draft/og?${params.toString()}`;
  }

  async function share() {
    if (!m) return;
    const won = m.winner === "you";
    const text = won
      ? `My Draft XI (${m.you.strength}) beat ${m.opp.name} (${m.opp.strength}) head-to-head ⚽🔥 Build yours:`
      : `${m.opp.name} (${m.opp.strength}) knocked out my Draft XI (${m.you.strength}). Rebuilding… Take me on:`;
    const url = "https://yourscore.app/draft";
    try {
      // Try sharing the broadcast graphic itself (mobile), falling back to text+link.
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

  const won = m.winner === "you";
  const accent = won ? "#00ff87" : "#ff4757";

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-8 text-center">
          <div className="font-display tracking-wide leading-none" style={{ fontSize: 80, color: accent }}>
            {won ? "WIN" : "LOSS"}
          </div>
          <div className="font-body mt-2" style={{ fontSize: 16, color: "#fff" }}>
            Your <b style={{ color: accent }}>{m.you.strength}</b> {won ? "beat" : "lost to"} {m.opp.name}&apos;s <b>{m.opp.strength}</b>
          </div>
          <div className="font-body mt-1" style={{ fontSize: 13, color: "#8888aa" }}>
            {m.margin === 0 ? "Decided on the night — a coin-flip" : `Margin: ${m.margin} Strength`}
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
              <span className="font-display tracking-wide leading-tight truncate" style={{ fontSize: 16, color: !won ? "#ff4757" : "#fff", maxWidth: "70%" }}>{m.opp.name}</span>
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
            <Link href="/draft/swap"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 22 }}>
              SWAP ONE PLAYER →
            </Link>
          ) : (
            <Link href="/draft"
              className="block w-full rounded-2xl py-4 text-center font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#ff4757", color: "#fff", fontSize: 22 }}>
              REBUILD XI →
            </Link>
          )}

          <Link href="/draft/team"
            className="block w-full rounded-2xl py-3 text-center font-body active:scale-[0.98] transition-transform"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
            Back to my team
          </Link>
        </div>
      </div>
    </div>
  );
}
