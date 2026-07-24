"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { coverUrl } from "@/lib/img";

// "Beat someone's score" — the solo→versus bridge. Recommends quizzes the
// player HASN'T attempted where other players' scored runs are waiting, so
// tapping in is fair (unseen questions) and always matches (those runs are
// the shadow pool). Falls back to a plain find-an-opponent button while
// loading fails or the pool is empty — the bridge never just disappears.

const TEAL = "#00d8c0";

interface Rec {
  packId: string;
  name: string;
  cover: string | null;
  top: { userId: string; name: string; avatarUrl: string | null; score: number };
  others: number;
  median: number;
  faces: { userId: string; name: string; avatarUrl: string | null }[];
}

function FindFallback() {
  return (
    <Link href="/versus/find?game=quiz" className="block w-full text-center rounded-2xl py-4 font-display text-lg tracking-wide active:scale-[0.99] transition-transform" style={{ background: TEAL, color: "#04231f" }}>
      ⚔️ FIND AN OPPONENT →
    </Link>
  );
}

export function BeatScoreRail() {
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/versus/recommended")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRecs(d.quizzes ?? []))
      .catch(() => setFailed(true));
  }, []);

  if (failed || (recs && recs.length === 0)) return <FindFallback />;
  if (!recs) return null;

  return (
    <div>
      <p className="font-body text-[10px] font-bold uppercase tracking-[0.28em] mb-2.5" style={{ color: "#586058" }}>Beat someone&rsquo;s score</p>
      <div className="space-y-2">
        {recs.map((r, i) => {
          const hero = i === 0;
          return (
            <Link key={r.packId} href={`/versus/find?game=quiz&pack=${r.packId}`}
              className="block rounded-2xl px-3.5 py-3 active:scale-[0.99] transition-transform"
              style={{ background: "#0e1611", border: `1px solid ${hero ? "rgba(0,216,192,0.28)" : "rgba(255,255,255,0.08)"}` }}>
              <div className="flex items-center gap-3">
                {r.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl(r.cover, 84) ?? undefined} alt="" className="w-[42px] h-[42px] rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-[42px] h-[42px] rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.1)" }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white truncate">{r.name}</p>
                  <p className="font-body text-[11px] text-text-muted mt-0.5 truncate">
                    <span style={{ color: TEAL }}>{r.top.name}</span> scored {r.top.score.toLocaleString()}
                    {r.others > 0 ? ` · ${r.others} other${r.others === 1 ? "" : "s"} played` : ""}
                  </p>
                </div>
                <span className="font-display text-[11px] tracking-wide px-3 py-2 rounded-lg flex-shrink-0"
                  style={hero ? { background: TEAL, color: "#04231f" } : { background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>
                  BEAT IT →
                </span>
              </div>
              {hero && (
                <div className="flex items-center gap-1.5 mt-2.5">
                  <div className="flex -space-x-1.5">
                    {r.faces.map((f) => (
                      <PlayerAvatar key={f.userId} seed={f.userId} name={f.name} avatarUrl={f.avatarUrl} size={18} />
                    ))}
                  </div>
                  <p className="font-body text-[10px] text-text-muted ml-1">
                    top score {r.top.score.toLocaleString()} · median {r.median.toLocaleString()}
                  </p>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
