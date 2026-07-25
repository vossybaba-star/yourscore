import Link from "next/link";

// "Get set for the season" — the two PL-launch teasers (Fantasy + Gameday
// Quizzes), shown on BOTH the signed-in dashboard and the signed-out marketing
// home (founder 2026-07-25: "live for everyone"). Self-contained so the two
// homes render the identical section with no drift. Hype cards, not a date:
// real star cutouts front Fantasy, a lightning/quiz motif fronts Gameday, and a
// "COMING SOON" tag pulses on each. The shine/pulse keyframes live in
// globals.css so both homes animate.
//   Fantasy League  → /fantasy (its own public teaser tab)
//   Gameday Quizzes → /matchweek?section=live (the Gameday Quiz section)

const LIME = "#aeea00";
const TEAL = "#00d8c0";

function ComingSoon({ accent, text }: { accent: string; text: string }) {
  return (
    <span className="relative z-[5] font-body text-[9.5px] font-bold uppercase tracking-[0.16em] px-2.5 py-1.5 rounded-full inline-flex items-center gap-1.5 self-start"
      style={{ background: `${accent}22`, color: text, border: `1px solid ${accent}80` }}>
      <span className="season-dot rounded-full" style={{ width: 6, height: 6, background: accent }} />
      COMING SOON
    </span>
  );
}

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
      style={{ aspectRatio: "0.82", background: "#0c1908", border: `1px solid ${LIME}80` }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 22%, ${LIME}44, rgba(12,25,8,0.15) 62%), #0c1908` }} />
      <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" style={{ opacity: 0.28 }}>
        <g stroke={LIME} strokeWidth="1.1" fill="none">
          <rect x="8" y="8" width="144" height="184" rx="2" /><line x1="8" y1="100" x2="152" y2="100" /><circle cx="80" cy="100" r="24" />
        </g>
      </svg>
      {FANTASY_FACES.map((f) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={f.src} src={f.src} alt="" loading="lazy" decoding="async" aria-hidden="true"
          className="absolute pointer-events-none select-none" style={f.style} />
      ))}
      <div className="absolute inset-x-0 top-0" style={{ height: "58%", background: "linear-gradient(to bottom, #0c1908 34%, rgba(12,25,8,0.35) 75%, transparent)" }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: "26%", background: "linear-gradient(to top, rgba(10,20,6,0.85), transparent)" }} />
      <span className="season-shine" />
      <div className="relative z-[5] p-3.5 flex flex-col gap-2">
        <ComingSoon accent={LIME} text="#d4ff4d" />
        <div>
          <p className="font-display text-2xl text-white leading-[0.92]">Fantasy<br />League</p>
          <p className="font-body text-[11px] mt-1.5 font-semibold" style={{ color: "#cfe6a8" }}>Pick your XI.</p>
        </div>
      </div>
    </Link>
  );
}

function GamedayTile() {
  return (
    <Link href="/matchweek?section=live"
      className="relative flex flex-col justify-end rounded-2xl overflow-hidden transition-transform active:scale-[0.98]"
      style={{ aspectRatio: "0.82", background: "#06110f", border: `1px solid ${TEAL}80` }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 22%, ${TEAL}48, rgba(6,17,15,0.15) 62%), #06110f` }} />
      <svg viewBox="0 0 160 200" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" style={{ opacity: 0.5 }}>
        <path d="M92 24 55 108h30l-8 70 60-92h-33l14-64Z" fill={`${TEAL}44`} stroke={TEAL} strokeWidth="1.4" strokeLinejoin="round" />
        <g stroke={TEAL} strokeWidth="1" fill="none" opacity="0.35">
          <rect x="12" y="150" width="42" height="54" rx="5" /><rect x="24" y="140" width="42" height="54" rx="5" />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0" style={{ height: "62%", background: "linear-gradient(to top, #06110f 42%, transparent)" }} />
      <span className="season-shine" style={{ animationDelay: "1.4s" }} />
      <div className="relative z-[5] p-3.5 flex flex-col gap-2">
        <ComingSoon accent={TEAL} text="#7ff2e4" />
        <div>
          <p className="font-display text-2xl text-white leading-[0.92]">Gameday<br />Quizzes</p>
          <p className="font-body text-[11px] mt-1.5" style={{ color: "#a8ede4" }}>A quiz pack for every fixture. Play on game day and rep your fanbase.</p>
        </div>
      </div>
    </Link>
  );
}

export function SeasonSection({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2.5">
        <p className="font-body text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: "#8a948f" }}>Get set for the season</p>
        <Link href="/matchweek" className="font-body text-xs font-semibold" style={{ color: LIME }}>Premier League →</Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <FantasyTile />
        <GamedayTile />
      </div>
    </div>
  );
}
