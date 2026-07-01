"use client";

/**
 * DraftHubHero — the 38-0 hub hero. Left: title + tagline (real app font/tokens) and an
 * optional PLAY. Right: the real Pitch showing a showcase XI in a tactical view (squad
 * numbers 1–11), so a new player instantly sees the game. Used per competition tab (World
 * Cup / Premier League / La Liga) with its own title + accent. WcHubHero is the WC preset.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Pitch } from "./Pitch";
import type { PlacedPlayer } from "@/lib/draft/types";

// Tokens show the traditional football squad NUMBER (1–11), not a rating:
// 1 GK · 2 RB · 3 LB · 4/5 CBs · 6 holding mid · 8 & 10 central mids · 7 RW · 9 ST · 11 LW.
// (The `overall` field carries the shirt number here so the tokens read as a real squad.)
const SHOWCASE: PlacedPlayer[] = [
  { slot: "gk",  slotPos: "GK",  position: "GK",  name: "GK",  overall: 1,  club: "", season: "", player_season_id: "s-gk" },
  { slot: "rb",  slotPos: "RB",  position: "RB",  name: "RB",  overall: 2,  club: "", season: "", player_season_id: "s-rb" },
  { slot: "rcb", slotPos: "CB",  position: "CB",  name: "CB",  overall: 5,  club: "", season: "", player_season_id: "s-rcb" },
  { slot: "lcb", slotPos: "CB",  position: "CB",  name: "CB",  overall: 4,  club: "", season: "", player_season_id: "s-lcb" },
  { slot: "lb",  slotPos: "LB",  position: "LB",  name: "LB",  overall: 3,  club: "", season: "", player_season_id: "s-lb" },
  { slot: "cdm", slotPos: "CDM", position: "CDM", name: "DM",  overall: 6,  club: "", season: "", player_season_id: "s-cdm" },
  { slot: "rcm", slotPos: "CM",  position: "CM",  name: "CM",  overall: 8,  club: "", season: "", player_season_id: "s-rcm" },
  { slot: "lcm", slotPos: "CM",  position: "CM",  name: "AM",  overall: 10, club: "", season: "", player_season_id: "s-lcm" },
  { slot: "rw",  slotPos: "RW",  position: "RW",  name: "RW",  overall: 7,  club: "", season: "", player_season_id: "s-rw" },
  { slot: "st",  slotPos: "ST",  position: "ST",  name: "ST",  overall: 9,  club: "", season: "", player_season_id: "s-st" },
  { slot: "lw",  slotPos: "LW",  position: "LW",  name: "LW",  overall: 11, club: "", season: "", player_season_id: "s-lw" },
];

export function DraftHubHero({
  eyebrow, titleLines, sub, accent, accentText, href, onPlay, showPlay,
}: {
  eyebrow: string;
  titleLines: string[];
  sub: ReactNode;
  accent: string;      // border + eyebrow + PLAY
  accentText: string;  // the big title colour
  href?: string;       // when set, the whole hero is a link (and can show PLAY)
  onPlay?: () => void; // when set (and no href), the whole hero is a button that starts play
  showPlay?: boolean;
}) {
  const inner = (
    <div className="flex items-center">
      <div className="flex-1 min-w-0 flex flex-col justify-center px-5 py-5">
        <div className="font-body" style={{ fontSize: 11, letterSpacing: 2, color: accent }}>{eyebrow}</div>
        <div className="font-display leading-[0.92] mt-1" style={{ fontSize: 46, color: accentText }}>
          {titleLines.map((l, i) => (
            <span key={i}>{l}{i < titleLines.length - 1 ? <br /> : null}</span>
          ))}
        </div>
        <div className="font-body mt-2" style={{ fontSize: 13, color: "#e2e8e2", lineHeight: 1.4 }}>{sub}</div>
        {showPlay && (
          <div className="inline-flex items-center gap-1.5 mt-3.5 self-start font-display tracking-wide rounded-xl px-4 py-2" style={{ fontSize: 15, background: accent, color: "#1a1300" }}>
            ▶ PLAY
          </div>
        )}
      </div>
      <div className="flex-shrink-0" style={{ width: 150, padding: "16px 14px 16px 0" }}>
        <Pitch formation="4-3-3" squad={SHOWCASE} compact noLabels />
      </div>
    </div>
  );
  const style = { border: `1px solid ${accent}59`, background: `linear-gradient(135deg,${accent}1a 0%,#0b0b0d 62%)` };
  const cls = "block w-full text-left relative overflow-hidden rounded-2xl active:scale-[0.99] transition-transform";
  if (href) return <Link href={href} className={cls} style={{ ...style, textDecoration: "none" }}>{inner}</Link>;
  if (onPlay) return <button type="button" onClick={onPlay} className={cls} style={style}>{inner}</button>;
  return <div className="relative overflow-hidden rounded-2xl" style={style}>{inner}</div>;
}

/** World Cup preset — taps into the ranked daily. */
export function WcHubHero() {
  return (
    <DraftHubHero
      eyebrow="DAILY · RANKED"
      titleLines={["WORLD", "CUP"]}
      sub={<>Build a World XI and <span style={{ color: "#fff", fontWeight: 600 }}>win it all</span>.</>}
      accent="#ffb800"
      accentText="#ffcf4d"
      href="/38-0/wc"
      showPlay
    />
  );
}
