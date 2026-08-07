"use client";

// Universal game entry screen (2026-08-07 simplification, phase 2).
// One reusable launch pattern: compact cover, title, meta chips, PLAY first,
// "How to play" collapsed, then whatever the game needs below (topic picker,
// mode list, leaderboard). Rules it encodes:
//   - the primary CTA lands above the fold on a 390x844 phone
//   - the CTA verb is PLAY (a caller may append "· 10 Qs")
//   - instructions are collapsed; gameplay teaches the mechanic
//   - the cover zone has a fixed aspect so nothing shifts while it loads
// The caller keeps ownership of BottomNav and any surrounding chrome.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function GameEntry({
  title,
  coverSrc,
  accent,
  heroMid = "#0e1611",
  tagline,
  meta,
  banner,
  how,
  primaryLabel,
  primaryTone = "teal",
  onPlay,
  playDisabled,
  error,
  children,
}: {
  title: string;
  coverSrc: string;
  accent: string;
  /** mid-stop of the hero gradient (Perfect 10 uses a warm tint) */
  heroMid?: string;
  tagline?: string;
  /** short chips under the title, e.g. ["Premier League", "10 questions"] */
  meta?: string[];
  /** optional banner node inside the hero (challenge target, topic card) */
  banner?: ReactNode;
  /** collapsed how-to-play content */
  how?: ReactNode;
  primaryLabel: string;
  primaryTone?: "teal" | "gold";
  onPlay: () => void;
  playDisabled?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
      {/* The persistent GamesNav (root layout) is the section header — no back
          button (founder 2026-07-18: own tab, no back buttons on game sections). */}
      <div
        className="relative flex flex-col items-center pt-6 pb-6 px-6"
        style={{ background: `linear-gradient(175deg, ${accent}14 0%, ${heroMid} 55%, #0a0a0f 100%)` }}
      >
        {/* Fixed-aspect cover zone: the square art can never shift the layout
            while it loads. Sized so PLAY sits on the first screen. */}
        <div
          className="w-full mb-4"
          style={{
            maxWidth: 240,
            aspectRatio: "1 / 1",
            borderRadius: 18,
            overflow: "hidden",
            border: `1.5px solid ${accent}40`,
            boxShadow: `0 12px 40px ${accent}22`,
            background: "#0e1611",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverSrc} alt={title} className="block w-full h-full" style={{ objectFit: "contain" }} />
        </div>
        <h1 className="font-display text-3xl text-white text-center leading-tight">{title}</h1>
        {tagline && (
          <p className="font-body text-sm text-center px-2 mt-1.5" style={{ color: "#9aa39d", lineHeight: 1.5 }}>
            {tagline}
          </p>
        )}
        {meta && meta.length > 0 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
            {meta.map((m, i) => (
              <span
                key={m}
                className="font-body text-xs px-3 py-1 rounded-full"
                style={
                  i === 0
                    ? { background: `${accent}14`, color: accent, border: `1px solid ${accent}40` }
                    : { background: "rgba(255,255,255,0.06)", color: "#9aa39d" }
                }
              >
                {m}
              </span>
            ))}
          </div>
        )}
        {banner}
      </div>

      <div className="max-w-lg mx-auto px-5 py-5 flex flex-col gap-4">
        {error && (
          <p className="font-body text-sm text-center" style={{ color: "#ff6b78" }}>{error}</p>
        )}

        <Button variant="primary" tone={primaryTone} size="lg" fullWidth onClick={onPlay} disabled={playDisabled}>
          {primaryLabel}
        </Button>

        {how && (
          <details className="rounded-2xl bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none">
              <p className="font-display text-sm text-white tracking-wide">How to play</p>
              <span className="ml-auto font-body text-xs" style={{ color: "#586058" }}>30 seconds</span>
            </summary>
            <div className="px-4 pb-4 font-body text-sm" style={{ color: "#9aa39d", lineHeight: 1.7 }}>
              {how}
            </div>
          </details>
        )}

        {children}
      </div>
    </div>
  );
}
