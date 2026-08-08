import Link from "next/link";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

/** The gameday fixture shown on the tile. Defaults to the season opener,
 * Arsenal v Coventry; a signed-in supporter of a known club gets THEIR round-1
 * fixture instead (resolved server-side in page.tsx). */
export interface GamedayFixture { home: string; away: string }
const DEFAULT_FIXTURE: GamedayFixture = { home: "Arsenal", away: "Coventry City" };

// "Get set for the season" — the two PL-launch teasers (Fantasy + Gameday
// Quizzes), shown on BOTH the signed-in dashboard and the signed-out marketing
// home (founder 2026-07-25: "live for everyone"). Self-contained so the two
// homes render the identical section with no drift. Hype cards, not a date:
// real star cutouts front Fantasy, a lightning/quiz motif fronts Gameday. The
// shine keyframes live in globals.css so both homes animate.
//   Fantasy League  → /fantasy (its own public teaser tab)
//   Premier League  → /matchweek (the PL tab) — founder 8 Aug, replaced Gameday

const LIME = "#aeea00";

// Star faces on the Fantasy tile — local /public cutouts (verified PL
// headshots), so no external call on the home hero. Centre player forward and
// largest; the flankers tuck behind.
const FANTASY_FACES = [
  { src: "/players/saka.png", style: { left: "-14%", width: "58%", bottom: "-6%", zIndex: 1 } },
  { src: "/players/palmer.png", style: { right: "-14%", width: "58%", bottom: "-6%", zIndex: 1 } },
  { src: "/players/haaland.png", style: { left: "50%", width: "66%", bottom: "-10%", transform: "translateX(-50%)", zIndex: 2 } },
] as const;

function FantasyTile() {
  return (
    <Link href="/fantasy"
      className="relative flex flex-col rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
      style={{ aspectRatio: "0.95", background: "#0c1908", border: `1px solid ${LIME}80` }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 22%, ${LIME}44, rgba(12,25,8,0.15) 62%), #0c1908` }} />
      <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" style={{ opacity: 0.28 }}>
        <g stroke={LIME} strokeWidth="1.1" fill="none">
          <rect x="8" y="8" width="144" height="184" rx="2" /><line x1="8" y1="100" x2="152" y2="100" /><circle cx="80" cy="100" r="24" />
        </g>
      </svg>
      {FANTASY_FACES.map((f) => (
        // These faces ARE the tile — load them eagerly, not lazily. As lazy
        // images they were missing on the first (cold) render and only appeared
        // after a scroll/reload (founder, 25 Jul). Same eager/high pattern the
        // home game covers use.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={f.src} src={f.src} alt="" loading="eager" decoding="async" fetchPriority="high" aria-hidden="true"
          className="absolute pointer-events-none select-none" style={f.style} />
      ))}
      <div className="absolute inset-x-0 top-0" style={{ height: "58%", background: "linear-gradient(to bottom, #0c1908 34%, rgba(12,25,8,0.35) 75%, transparent)" }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: "26%", background: "linear-gradient(to top, rgba(10,20,6,0.85), transparent)" }} />
      <span className="season-shine" />
      <div className="relative z-[5] p-3.5 flex flex-col gap-2">
        <div>
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-2xl text-white leading-[0.92]">Fantasy<br />League</p>
            {/* solid lime ribbon, flush to the tile's right edge (-mr cancels the
                p-3.5) — the gap right of the two-line heading is only ~55px on a
                375px phone, so a free-floating pill gets clipped by the tile's
                overflow-hidden. animate-pulse on the dot, not the ribbon, so the
                label stays legible */}
            <span className="flex items-center gap-1 rounded-l-full pl-2 pr-3 py-1 mt-1 shrink-0 -mr-3.5"
              style={{ background: LIME, boxShadow: `0 0 14px ${LIME}99` }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#0c1908" }} />
              <span className="font-body text-[9px] font-extrabold uppercase tracking-wide leading-none" style={{ color: "#0c1908" }}>Live Now</span>
            </span>
          </div>
          <p className="font-body text-[11px] mt-1.5 font-semibold" style={{ color: "#cfe6a8" }}>Pick your XI.</p>
        </div>
      </div>
    </Link>
  );
}

// The fixture crests, between the title and the sub. The nudge: "here's YOUR
// team's first quiz". Falls back to no crests (never a broken image) if either
// badge is missing.
function FixtureCrests({ fixture }: { fixture: GamedayFixture }) {
  const home = getTeamBadgeUrlSync(fixture.home);
  const away = getTeamBadgeUrlSync(fixture.away);
  if (!home || !away) return null;
  return (
    <div className="flex items-center gap-2.5 mb-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={home} alt={fixture.home} width={44} height={44} style={{ objectFit: "contain", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.55))" }} />
      <span className="font-display text-xl" style={{ color: "#7ff2e4" }}>v</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={away} alt={fixture.away} width={44} height={44} style={{ objectFit: "contain", filter: "drop-shadow(0 2px 5px rgba(0,0,0,0.55))" }} />
    </div>
  );
}

// Premier League tile (founder 8 Aug): replaced the Gameday Quizzes tile here —
// this is the door to the PL tab (/matchweek). A crown emblem stands in for the
// league crest as the backdrop (the official PL crest is trademarked; drop the
// real asset in as a background-image here if/when licensed). The opening
// fixture's crests sit at the foot.
function PremierLeagueTile({ fixture }: { fixture: GamedayFixture }) {
  const PURPLE = "#8b5cf6";
  return (
    <Link href="/matchweek"
      className="relative flex flex-col rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
      style={{ aspectRatio: "0.95", background: "#140a24", border: `1px solid ${PURPLE}80` }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 20%, ${PURPLE}55, rgba(20,10,36,0.15) 60%), #140a24` }} />
      {/* Crown/crest motif standing in for the league crest backdrop. */}
      <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" style={{ opacity: 0.5 }}>
        <path d="M45 92 L58 60 L80 84 L102 60 L115 92 L108 120 L52 120 Z" fill={`${PURPLE}3a`} stroke={PURPLE} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="58" cy="56" r="4" fill={PURPLE} /><circle cx="80" cy="80" r="4" fill={PURPLE} /><circle cx="102" cy="56" r="4" fill={PURPLE} />
      </svg>
      <div className="absolute inset-x-0 top-0" style={{ height: "52%", background: "linear-gradient(to bottom, #140a24 30%, rgba(20,10,36,0.4) 78%, transparent)" }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: "46%", background: "linear-gradient(to top, #140a24 12%, rgba(20,10,36,0.72) 55%, transparent)" }} />
      <span className="season-shine" style={{ animationDelay: "1.4s" }} />
      <div className="relative z-[5] px-3.5 pt-3 pb-3 flex flex-col h-full">
        <p className="font-display text-2xl text-white leading-[0.92]">Premier<br />League</p>
        <div className="mt-auto">
          <FixtureCrests fixture={fixture} />
          <p className="font-body text-[13px] leading-snug font-semibold" style={{ color: "#d7c7f5" }}>26-27 season is two weeks out.</p>
        </div>
      </div>
    </Link>
  );
}

export function SeasonSection({ className = "", fixture }: { className?: string; fixture?: GamedayFixture | null }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#8a948f" }}>Get set for the season</p>
        <Link href="/matchweek" className="font-body text-xs font-semibold" style={{ color: LIME }}>Premier League →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <FantasyTile />
        <PremierLeagueTile fixture={fixture ?? DEFAULT_FIXTURE} />
      </div>
    </div>
  );
}
