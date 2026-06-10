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
import { AddFriendCard } from "@/components/social/AddFriendCard";

export default function MatchResult() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const lm = loadLastMatch();
    if (!lm) { router.replace("/38-0"); return; }
    setM(lm);
  }, [router]);

  function shareText(): string {
    if (!m) return "";
    const won = m.outcome === "you";
    const drew = m.outcome === "draw";
    const score = `${m.goals.you}–${m.goals.opp}`;
    return drew
      ? `My Draft XI drew ${score} with ${m.opp.name} head-to-head ⚽ Build yours and take me on:`
      : won
      ? `My Draft XI beat ${m.opp.name} ${score} head-to-head ⚽🔥 Build yours:`
      : `${m.opp.name} beat my Draft XI ${m.goals.opp}–${m.goals.you}. Rebuilding… Take me on:`;
  }

  async function shareNative() {
    if (!m) return;
    const text = shareText();
    const url = "https://yourscore.app/38-0";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Draft XI", text, url });
      } else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 1800);
      }
    } catch { /* user cancelled */ }
  }

  async function copyLink() {
    const url = "https://yourscore.app/38-0";
    const text = shareText();
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* ignore */ }
  }

  function twitterUrl(): string {
    if (!m) return "#";
    const text = shareText();
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text + " https://yourscore.app/38-0")}`;
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
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-display tracking-wide" style={{ fontSize: 16, color: won ? "#00ff87" : "#fff" }}>YOU</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(m.you.projected?.tier ?? "Mid-table") }}>{m.you.strength}</span>
            </div>
            <p className="font-body mb-1.5" style={{ fontSize: 10, color: "#666688", letterSpacing: "0.04em" }}>Your XI</p>
            <Pitch formation={m.you.formation} squad={m.you.squad} compact />
          </div>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="font-display tracking-wide leading-tight truncate" style={{ fontSize: 16, color: m.outcome === "opp" ? "#ff4757" : "#fff", maxWidth: "70%" }}>{m.opp.name}</span>
              <span className="font-display" style={{ fontSize: 18, color: tierColor(m.opp.projected?.tier ?? "Mid-table") }}>{m.opp.strength}</span>
            </div>
            <p className="font-body mb-1.5 truncate" style={{ fontSize: 10, color: "#666688", letterSpacing: "0.04em" }}>{m.opp.name}&apos;s XI</p>
            <Pitch formation={m.opp.formation} squad={m.opp.squad} compact />
          </div>
        </div>

        {/* Friend card — only for real opponent (challenge) matches */}
        {m.oppUserId && (
          <div className="mt-6">
            <AddFriendCard
              userId={m.oppUserId}
              displayName={m.opp.name}
              context={`You just played ${m.opp.name}!`}
            />
          </div>
        )}

        <div className="mt-6 space-y-3">
          <button onClick={() => setShowShareSheet(true)}
            className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: "#ffb800", color: "#1a1300", fontSize: 24 }}>
            SHARE RESULT 📲
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

      {/* Share sheet */}
      {showShareSheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setShowShareSheet(false)}
        >
          <div className="w-full max-w-lg px-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-3xl overflow-hidden" style={{ background: "#16162a", border: "1px solid rgba(255,255,255,0.1)" }}>
              {/* handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="rounded-full" style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)" }} />
              </div>

              <div className="px-5 pt-2 pb-5">
                <p className="font-display text-center text-white mb-5" style={{ fontSize: 16, letterSpacing: "0.05em" }}>SHARE RESULT</p>

                {/* platform grid */}
                <div className="grid grid-cols-4 gap-3 mb-5">
                  {/* X / Twitter */}
                  <a href={twitterUrl()} target="_blank" rel="noopener noreferrer"
                    onClick={() => setShowShareSheet(false)}
                    className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center rounded-2xl"
                      style={{ width: 56, height: 56, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                      </svg>
                    </div>
                    <span className="font-body text-xs" style={{ color: "#8888aa" }}>Post on 𝕏</span>
                  </a>

                  {/* Instagram */}
                  <button onClick={() => { setShowShareSheet(false); shareNative(); }}
                    className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center rounded-2xl"
                      style={{ width: 56, height: 56, background: "rgba(225,48,108,0.15)", border: "1px solid rgba(225,48,108,0.3)" }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="2" width="20" height="20" rx="5" stroke="#e1306c" strokeWidth="2"/>
                        <circle cx="12" cy="12" r="4" stroke="#e1306c" strokeWidth="2"/>
                        <circle cx="17.5" cy="6.5" r="1" fill="#e1306c"/>
                      </svg>
                    </div>
                    <span className="font-body text-xs" style={{ color: "#8888aa" }}>Instagram</span>
                  </button>

                  {/* TikTok */}
                  <button onClick={() => { setShowShareSheet(false); shareNative(); }}
                    className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center rounded-2xl"
                      style={{ width: 56, height: 56, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.83 1.54V6.78a4.86 4.86 0 01-1.06-.09z"/>
                      </svg>
                    </div>
                    <span className="font-body text-xs" style={{ color: "#8888aa" }}>TikTok</span>
                  </button>

                  {/* More */}
                  <button onClick={() => { setShowShareSheet(false); shareNative(); }}
                    className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center rounded-2xl"
                      style={{ width: 56, height: 56, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle cx="5" cy="12" r="2" fill="white"/>
                        <circle cx="12" cy="12" r="2" fill="white"/>
                        <circle cx="19" cy="12" r="2" fill="white"/>
                      </svg>
                    </div>
                    <span className="font-body text-xs" style={{ color: "#8888aa" }}>More</span>
                  </button>
                </div>

                {/* copy link row */}
                <button onClick={copyLink}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
                  style={{ background: linkCopied ? "rgba(0,255,135,0.1)" : "rgba(255,255,255,0.06)", border: `1px solid ${linkCopied ? "rgba(0,255,135,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={linkCopied ? "#00ff87" : "#aaaacc"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={linkCopied ? "#00ff87" : "#aaaacc"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="font-body text-sm font-semibold" style={{ color: linkCopied ? "#00ff87" : "#aaaacc" }}>
                    {linkCopied ? "Copied!" : "Copy link"}
                  </span>
                </button>

              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
