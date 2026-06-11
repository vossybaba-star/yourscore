"use client";

/**
 * /38-0/match/result — full-time result for the most recent local Quick Match:
 * the broadcast scorecard (scoreline, goal timeline, star of the match, stats, both
 * XIs — see <Scorecard>) plus a one-tap share and the next-step action. Mirrors the
 * public /38-0/match/[id] live view; this is the local (guest) version, reading the
 * last match from localStorage.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scorecard } from "@/components/draft/Scorecard";
import { loadLastMatch, type LocalMatch } from "@/lib/draft/local";
import { liveOgQuery } from "@/lib/draft/share";
import { AddFriendCard } from "@/components/social/AddFriendCard";
import { trackGameComplete } from "@/lib/analytics/trackGame";

export default function MatchResult() {
  const router = useRouter();
  const [m, setM] = useState<LocalMatch | null>(null);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    const lm = loadLastMatch();
    if (!lm) { router.replace("/38-0"); return; }
    setM(lm);
    trackGameComplete("38-0", { mode: "match", outcome: lm.outcome });
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

  /**
   * The shared link unfurls as the landscape stat card (/api/draft/live-og via the
   * /38-0/card page) so followers see the full scoreline + head-to-head stats in the
   * tweet. Quick matches aren't server-persisted, so the finished match is encoded
   * into the URL (side a = you, b = opponent). Falls back to the generic link.
   */
  function shareUrl(): string {
    if (!m) return "https://yourscore.app/38-0";
    const query = liveOgQuery({
      p1: "You", p2: m.opp.name,
      s1: m.goals.you, s2: m.goals.opp,
      str1: m.you.strength, str2: m.opp.strength,
      pens: m.pens ? { a: m.pens.you, b: m.pens.opp } : null,
      report: m.report,
    });
    return `https://yourscore.app/38-0/card?${query}`;
  }

  async function shareNative() {
    if (!m) return;
    const text = shareText();
    const url = shareUrl();
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
    const url = shareUrl();
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
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text} ${shareUrl()}`)}`;
  }

  if (!m) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
  }

  const won = m.outcome === "you";
  const drew = m.outcome === "draw";
  const accent = won ? "#00ff87" : drew ? "#ffb800" : "#ff4757";

  return (
    <div className="min-h-[100dvh] pb-28" style={{ background: "#0a0a0f" }}>
      {/* ambient pitch grid */}
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />

      <div className="relative mx-auto max-w-lg px-4 pt-safe">
        <div className="flex items-center justify-between py-3">
          <Link href="/38-0" className="font-mono text-sm uppercase" style={{ color: "#8888aa", letterSpacing: "0.1em" }}>← 38-0</Link>
        </div>

        <Scorecard m={m} context="Quick Match" />

        {/* Friend card — only for real opponent (challenge) matches */}
        {m.oppUserId && (
          <div className="mt-5">
            <AddFriendCard
              userId={m.oppUserId}
              displayName={m.opp.name}
              context={`You just played ${m.opp.name}!`}
            />
          </div>
        )}

        <div className="mt-5 space-y-3">
          <button onClick={() => setShowShareSheet(true)}
            className="w-full rounded-[20px] py-4 font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]"
            style={{ background: "#ffb800", color: "#1a1300", fontSize: 23, outlineColor: "#ffb800", boxShadow: "0 14px 34px -16px rgba(255,184,0,0.7)" }}>
            SHARE FULL-TIME CARD
          </button>

          {won ? (
            <Link href="/38-0/swap"
              className="block w-full rounded-[20px] py-4 text-center font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]"
              style={{ background: "#00ff87", color: "#062013", fontSize: 22, outlineColor: "#00ff87" }}>
              SWAP ONE PLAYER →
            </Link>
          ) : drew ? (
            <Link href="/38-0/team"
              className="block w-full rounded-[20px] py-4 text-center font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]"
              style={{ background: "rgba(255,184,0,0.14)", color: "#ffb800", fontSize: 22, border: "1px solid rgba(255,184,0,0.4)", outlineColor: "#ffb800" }}>
              GO AGAIN →
            </Link>
          ) : (
            <Link href="/38-0"
              className="block w-full rounded-[20px] py-4 text-center font-display tracking-wide transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]"
              style={{ background: "#ff4757", color: "#fff", fontSize: 22, outlineColor: "#ff4757" }}>
              REBUILD XI →
            </Link>
          )}

          <Link href="/38-0/team"
            className="block w-full rounded-[20px] py-3 text-center font-body transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98]"
            style={{ background: "#12121e", color: "#8888aa", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)", outlineColor: accent }}>
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
