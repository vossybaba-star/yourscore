"use client";
/**
 * The public Fantasy tab — a "coming soon" teaser, not the game (founder,
 * 25 Jul). Everyone can open the Fantasy tab now; what they see is what we're
 * building plus a one-tap opt-in. The real build/squad experience stays behind
 * the allowlist until launch (FantasyHub, gated in /fantasy/page).
 *
 * The opt-in is the shipped WaitlistCard (session-based, writes waitlist_emails
 * + the Resend audience) — the same one the blog uses.
 */
import { Header, INK, LINE, MUTED, page, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { WaitlistCard } from "@/components/blog/WaitlistCard";

const GOLD = "#ffc233";

/** Squad shape in line art — the motif from the PL tab's fantasy tile. */
const FormationArt = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true"
    style={{ position: "absolute", right: -16, bottom: -20, width: 150, height: 150, opacity: 0.09, pointerEvents: "none" }}>
    <rect x="6" y="6" width="88" height="88" rx="4" fill="none" stroke={TEAL} strokeWidth="2" />
    <line x1="6" y1="50" x2="94" y2="50" stroke={TEAL} strokeWidth="2" />
    <circle cx="50" cy="50" r="12" fill="none" stroke={TEAL} strokeWidth="2" />
    {[[50], [18, 39, 61, 82], [18, 39, 61, 82], [39, 61]].map((row, ri) =>
      row.map((x) => <circle key={`${ri}-${x}`} cx={x} cy={16 + ri * 22} r="3.4" fill={TEAL} />))}
  </svg>
);

const BEATS: { n: string; t: string; d: string }[] = [
  { n: "01", t: "Build it once", d: "Fifteen players, £100m, no more than three from any one club. That's your squad for the season." },
  { n: "02", t: "Knowledge earns your moves", d: "Everyone gets one transfer a gameweek. Answer the weekly round to earn more, so the better you know your football, the more you can change." },
  { n: "03", t: "Real points, no mystery", d: "Your score comes from what actually happened on the pitch. No bonus-point panel quietly deciding your week." },
  { n: "04", t: "A fresh table every month", d: "Months are their own competition, so a rough August doesn't bury your season." },
];

export function FantasyTeaser() {
  return (
    <main data-fantasy style={page}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative">
        <Header />

        {/* Hero */}
        <div className="rounded-2xl relative overflow-hidden px-5 pt-5 pb-5"
          style={{ background: `linear-gradient(150deg, ${tint(TEAL, "1a")}, ${tint(TEAL, "05")})`, border: `1px solid ${tint(TEAL, "38")}`, marginBottom: 14 }}>
          <FormationArt />
          <div className="relative">
            <p className="font-display tracking-widest" style={{ fontSize: 10, color: TEAL, marginBottom: 10 }}>
              YOURSCORE FANTASY FOOTBALL
            </p>
            <p className="font-display text-white" style={{ fontSize: 40, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
              <span style={{ display: "block" }}>One transfer.</span>
              <span style={{ display: "block" }}>Earn the rest.</span>
            </p>
            <p className="font-body" style={{ fontSize: 14, color: MUTED, marginTop: 12, maxWidth: "82%", lineHeight: 1.5 }}>
              A fantasy season where your football knowledge is the edge. Launching before the Premier League gets going.
            </p>
          </div>
        </div>

        {/* How it works */}
        <p className="font-display tracking-widest" style={{ fontSize: 10, color: GOLD, margin: "0 0 10px 2px" }}>HOW IT WORKS</p>
        <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {BEATS.map((b) => (
              <div key={b.n} style={{ display: "flex", gap: 14 }}>
                <div className="font-display rounded-full"
                  style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, fontSize: 11,
                    background: tint(TEAL, "18"), color: TEAL, border: `1px solid ${tint(TEAL, "35")}` }}>{b.n}</div>
                <div style={{ minWidth: 0 }}>
                  <p className="font-body" style={{ fontSize: 14, color: INK, fontWeight: 600, margin: 0 }}>{b.t}</p>
                  <p className="font-body" style={{ fontSize: 12.5, color: MUTED, margin: "3px 0 0", lineHeight: 1.55 }}>{b.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Opt-in — the shipped waitlist card, tagged to this surface. */}
        <WaitlistCard source="fantasy-tab" />
      </div>
    </main>
  );
}
