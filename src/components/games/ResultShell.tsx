"use client";

// Universal result screen (2026-08-07 simplification, phase 2). The bridge
// between gaming, social and the rest of YourScore. Shape it enforces:
//   score hero → save/identity blocks → ONE primary continuation →
//   at most two lightweight secondaries → ONE ecosystem bridge.
// Not five competing destinations. Games keep personality through `children`
// (recap towers, breakdowns) rendered under the CTAs.

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function ResultShell({
  accent,
  coverSrc,
  score,
  scoreSub,
  badge,
  stats,
  save,
  primaryLabel,
  onPrimary,
  primaryTone = "teal",
  secondaries,
  bridge,
  children,
}: {
  accent: string;
  coverSrc?: string;
  /** big number (already formatted) */
  score: string;
  scoreSub?: string;
  /** verdict pill, e.g. { label: "SHARP", color: "#aeea00" } */
  badge?: { label: string; color: string };
  /** up to three stat cells: correct / accuracy / fastest etc. */
  stats?: { value: string; label: string; color?: string }[];
  /** save-score / signed-in confirmation blocks, rendered before the primary */
  save?: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryTone?: "teal" | "gold";
  /** at most two lightweight actions (share, see leaderboard) */
  secondaries?: ReactNode;
  /** ONE contextual YourScore bridge card */
  bridge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg" style={{ paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}>
      <div
        className="relative flex flex-col items-center pt-12 pb-8 px-6"
        style={{ background: `linear-gradient(175deg, ${accent}14 0%, #0e1611 60%, #0a0a0f 100%)` }}
      >
        {coverSrc && (
          <div className="mb-4" style={{ width: 110, aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", border: `1px solid ${accent}33`, background: "#0e1611" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverSrc} alt="" className="block w-full h-full" style={{ objectFit: "contain" }} />
          </div>
        )}
        <div className="font-display text-7xl mb-1" style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>{score}</div>
        {scoreSub && <p className="font-body text-sm mb-3 text-text-muted">{scoreSub}</p>}
        {badge && (
          <div
            className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{ background: `${badge.color}15`, border: `1px solid ${badge.color}35` }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: badge.color, boxShadow: `0 0 8px ${badge.color}` }} />
            <span className="font-display text-base tracking-wide" style={{ color: badge.color }}>{badge.label}</span>
          </div>
        )}
        {stats && stats.length > 0 && (
          <div className="flex items-center gap-6 mt-6">
            {stats.map((s, i) => (
              <div key={s.label} className="flex items-center gap-6">
                {i > 0 && <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />}
                <div className="text-center">
                  <div className="font-display text-2xl" style={{ color: s.color ?? "#fff", fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                  <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-5 flex flex-col gap-3 mt-5">
        {save}

        <Button variant="primary" tone={primaryTone} size="lg" fullWidth onClick={onPrimary}>
          {primaryLabel}
        </Button>

        {secondaries}

        {bridge}

        {children}
      </div>
    </div>
  );
}
