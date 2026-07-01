"use client";

import { useState } from "react";
import { trackShare } from "@/lib/analytics/trackGame";

export function ShareStatsButton({
  rank,
  score,
  accuracy,
}: {
  rank: number | null;
  score: number;
  accuracy: number | null;
}) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    trackShare("stats");
    const parts = [`⚽ YourScore — ranked #${rank ?? "?"}`];
    if (score > 0) parts.push(`${score.toLocaleString()} pts`);
    if (accuracy !== null) parts.push(`${accuracy}% accuracy`);
    const text = parts.join(" · ");
    const url = "https://yourscore.app";

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ text, url });
        return;
      } catch {
        // user cancelled or API unavailable — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* ignore */ }
  }

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-body text-sm font-semibold transition-all active:scale-95"
      style={{ background: "rgba(174,234,0,0.08)", color: copied ? "#aeea00" : "#9aa39d", border: `1px solid ${copied ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.1)"}` }}
    >
      {copied ? (
        <>✓ Copied!</>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Share Stats
        </>
      )}
    </button>
  );
}
