"use client";

import { useRouter } from "next/navigation";

// The primary entry actions on the Versus Play tab (carousel mockup): FIND AN
// OPPONENT is THE hero action — a full-width lime button — with Challenge and
// Join Code as lighter secondaries beneath it.

const TEAL = "#00d8c0";

function RadarIcon({ color = "#13200a" }: { color?: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke={color} strokeWidth="1.6" opacity="0.4" />
      <circle cx="10" cy="10" r="4.5" stroke={color} strokeWidth="1.6" opacity="0.7" />
      <circle cx="10" cy="10" r="1.6" fill={color} />
      <path d="M10 10 16 4.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function VersusActionCards({ onChallenge, onJoinCode }: { onChallenge: () => void; onJoinCode: () => void }) {
  const router = useRouter();
  return (
    <div>
      <button onClick={() => router.push("/versus/find")}
        className="w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 font-display text-lg tracking-wide active:scale-[0.99] transition-transform"
        style={{ background: "#aeea00", color: "#13200a" }}>
        <RadarIcon />
        FIND AN OPPONENT
      </button>
      <div className="flex gap-2 mt-2">
        <button onClick={onChallenge} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-display text-[13px] tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "rgba(255,255,255,0.04)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.12)" }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><path d="M17.5 2.5 9 11M17.5 2.5 12 17.5l-3-6.5-6.5-3L17.5 2.5Z" stroke={TEAL} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
          CHALLENGE FRIEND
        </button>
        <button onClick={onJoinCode} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 font-display text-[13px] tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "rgba(255,255,255,0.04)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.12)" }}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none"><rect x="2" y="4.5" width="16" height="11" rx="2.5" stroke={TEAL} strokeWidth="1.5" /><path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" /></svg>
          JOIN CODE
        </button>
      </div>
    </div>
  );
}
