"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// "Live now" — compact community-activity strip for the Versus Play tab. Every
// number comes from /api/versus/activity (see lib/versus/activity.ts for what's
// real vs presence-placeholder); nothing is hardcoded here. Tiles with trivially
// low counts drop out rather than looking dead.

const TEAL = "#00d8c0";
const LIME = "#aeea00";

interface Activity {
  lookingForMatch: number;
  battlesToday: number;
  activeToday: number;
  openLobbies: number;
  trending: { packId: string; name: string; attempts: number } | null;
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-2xl px-3.5 py-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
      <p className="font-display text-xl leading-none" style={{ color }}>{value}</p>
      <p className="font-body text-[10px] uppercase tracking-widest text-text-muted mt-1.5 leading-snug">{label}</p>
    </div>
  );
}

export function LiveActivityStrip() {
  const [a, setA] = useState<Activity | null>(null);

  useEffect(() => {
    fetch("/api/versus/activity").then((r) => r.json()).then(setA).catch(() => {});
  }, []);

  if (!a) return null;

  const tiles: { value: string; label: string; color: string }[] = [];
  if (a.lookingForMatch >= 3) tiles.push({ value: a.lookingForMatch.toLocaleString(), label: "Looking for a match", color: TEAL });
  if (a.battlesToday >= 3) tiles.push({ value: a.battlesToday.toLocaleString(), label: "Quiz Battles today", color: LIME });
  else if (a.activeToday >= 3) tiles.push({ value: a.activeToday.toLocaleString(), label: "Playing today", color: LIME });
  if (tiles.length === 0 && !a.trending) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mt-7 mb-2.5">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: TEAL }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: TEAL }} />
        </span>
        <p className="font-body text-xs font-bold uppercase tracking-widest" style={{ color: "#586058" }}>Live now</p>
      </div>
      <div className="flex gap-2">
        {tiles.map((t) => <Stat key={t.label} value={t.value} label={t.label} color={t.color} />)}
      </div>
      {a.trending && (
        <Link href="/versus/quiz" className="flex items-center gap-2.5 rounded-2xl px-3.5 py-3 mt-2 active:scale-[0.99] transition-transform" style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.22)" }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M8 1.5s3.5 3 3.5 6.5A3.5 3.5 0 1 1 5 6c0 1.4 1 2 1 2 .3-2.5 2-6.5 2-6.5Z" fill={TEAL} /></svg>
          <p className="font-body text-xs text-white min-w-0 truncate">
            <span className="font-semibold">{a.trending.name}</span>
            <span className="text-text-muted"> is trending — play it in a Quiz Battle</span>
          </p>
          <span className="font-display text-[11px] tracking-wide ml-auto flex-shrink-0" style={{ color: TEAL }}>PLAY →</span>
        </Link>
      )}
    </div>
  );
}
