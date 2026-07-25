"use client";

/**
 * The /play Gameday rail. Renders ONLY when /api/gameday/today has rows
 * (AC29) — one card per PL fixture whose pack has been published (the day
 * before its kickoff). Every fixture returned is already playable; there is
 * no more "drops at half time" pending state to render (§0.1) — that copy and
 * the T-45-timer framing belonged to the retired whistle-release pipeline.
 *
 * Data comes entirely from useGamedayToday() — this component has zero
 * opinions about publish scheduling, it just renders what the public
 * projection gives it. Locked rule: never claim live-match play-along.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import {
  useGamedayToday,
  kickoffLabel,
  hasKickedOff,
  packHref,
  lobbyHref,
  type GamedayFixture,
} from "@/components/halftime/useGamedayToday";

const TEAL = "#00d8c0";

function useCrest(name: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTeamBadgeUrl(name).then((u) => {
      if (!cancelled && u) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return url;
}

function Crest({ name, size = 32 }: { name: string; size?: number }) {
  const url = useCrest(name);
  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-full font-display text-xs text-white flex-shrink-0"
        style={{ width: size, height: size, background: "rgba(0,216,192,0.12)", border: "1px solid rgba(0,216,192,0.25)" }}
      >
        {name[0]}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      style={{ objectFit: "contain", flexShrink: 0 }}
    />
  );
}

function FixtureCard({ f }: { f: GamedayFixture }) {
  const playHref = packHref(f);
  const friendsHref = lobbyHref(f);
  const kickedOff = hasKickedOff(f);

  // NOTE: no outer <Link> wrapping the whole card — "Play with friends" below
  // is its own <Link>, and nesting <a> inside <a> is invalid HTML.
  const header = (
    <div
      className="relative flex items-center justify-center gap-3"
      style={{
        height: 82,
        background:
          "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12) 0%, transparent 70%), linear-gradient(180deg, rgba(0,216,192,0.05) 0%, transparent 100%)",
      }}
    >
      <Crest name={f.home} />
      <span className="font-display text-[11px]" style={{ color: "#586058" }}>v</span>
      <Crest name={f.away} />
      <div
        className="absolute top-2.5 right-2.5 flex items-center gap-1 font-display text-[10px] px-2 py-0.5 rounded-lg"
        style={{ background: "rgba(0,216,192,0.2)", color: TEAL, border: "1px solid rgba(0,216,192,0.45)" }}
      >
        {kickedOff ? "KICKED OFF" : kickoffLabel(f.kickoff_at)}
      </div>
    </div>
  );

  return (
    <div
      className="rounded-3xl overflow-hidden flex-shrink-0"
      style={{
        width: 216,
        background: "linear-gradient(160deg, #0e1611 0%, #15211a 100%)",
        border: "1px solid rgba(0,216,192,0.55)",
        boxShadow: "0 0 22px rgba(0,216,192,0.16)",
      }}
    >
      {playHref ? (
        <Link href={playHref} className="block transition-opacity hover:opacity-90">
          {header}
        </Link>
      ) : (
        header
      )}

      <div className="px-4 pb-4 pt-3">
        <p className="font-body text-sm font-bold text-white leading-snug mb-0.5">
          {f.home} v {f.away}
        </p>
        <p className="font-body text-xs mb-2.5" style={{ color: "#8a948f" }}>
          Quiz pack is live · 10 questions
        </p>

        {playHref && (
          <div className="space-y-1.5">
            <Link
              href={playHref}
              className="block rounded-xl py-2 text-center transition-opacity hover:opacity-90 active:scale-[0.97]"
              style={{
                background: "linear-gradient(135deg, rgba(0,216,192,0.18) 0%, rgba(255,120,0,0.12) 100%)",
                border: "1px solid rgba(0,216,192,0.3)",
              }}
            >
              <span className="font-display text-xs tracking-widest text-teal">PLAY NOW →</span>
            </Link>
            {friendsHref && (
              <Link
                href={friendsHref}
                className="block rounded-xl py-2 text-center transition-opacity hover:opacity-80"
                style={{ border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <span className="font-body text-xs font-semibold" style={{ color: "#c4ccc6" }}>Play with friends</span>
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function GamedayRail() {
  const { fixtures, loaded } = useGamedayToday();
  if (!loaded || fixtures.length === 0) return null;

  return (
    <div className="max-w-lg mx-auto px-4 pt-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>GAMEDAY QUIZZES</span>
        <span
          className="flex items-center gap-1.5 font-body text-xs px-2 py-0.5 rounded-full"
          style={{ background: "rgba(0,216,192,0.15)", color: TEAL, border: "1px solid rgba(0,216,192,0.4)" }}
        >
          <span className="animate-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: TEAL }} />
          {fixtures.length} live
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {fixtures.map((f) => (
          <FixtureCard key={f.fixture_id} f={f} />
        ))}
      </div>
    </div>
  );
}
