"use client";

/**
 * Matchweek → Fantasy, before the game opens.
 *
 * A holding screen that SELLS the thing rather than apologising for its absence
 * ("Fantasy is coming" told nobody anything). Every claim here is the locked
 * Phase-1 model from YOURSCORE.md — 15-man squad built once (£100m, max 3 a
 * club), a knowledge round each gameweek earning transfer credits, captain ×2,
 * deterministic points from real match facts with no BPS-style bonus ever, and
 * calendar-month tables. Nothing is invented, and nothing states a number the
 * spec doesn't (the credit curve and the exact deadline time stay out of the
 * copy — they're tuning, not the pitch).
 *
 * The lead is the differentiator: in every other fantasy game transfers are just
 * handed to you. Here you earn them by knowing your football, which is the whole
 * reason this game exists on THIS app.
 *
 * CTA is the existing WaitlistCard (POSTs /api/waitlist → Resend "Fantasy
 * Waitlist") — the same funnel the blog posts feed, so the launch list stays in
 * one audience.
 */

import { WaitlistCard } from "@/components/blog/WaitlistCard";

const TEAL = "#00d8c0";

/** Squad shape in line art — 4-4-2 dots. Cropped by the tile edge, like the ball. */
function FormationArt() {
  const rows = [
    [50],
    [18, 39, 61, 82],
    [18, 39, 61, 82],
    [39, 61],
  ];
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true"
      style={{ position: "absolute", right: -14, bottom: -18, width: 158, height: 158, opacity: 0.1, pointerEvents: "none" }}>
      <rect x="6" y="6" width="88" height="88" rx="4" fill="none" stroke={TEAL} strokeWidth="2" />
      <line x1="6" y1="50" x2="94" y2="50" stroke={TEAL} strokeWidth="2" />
      <circle cx="50" cy="50" r="12" fill="none" stroke={TEAL} strokeWidth="2" />
      {rows.map((row, ri) =>
        row.map((x) => <circle key={`${ri}-${x}`} cx={x} cy={16 + ri * 22} r="3.4" fill={TEAL} />),
      )}
    </svg>
  );
}

const BEATS = [
  {
    n: "01",
    t: "Build it once",
    d: "Fifteen players, £100m, no more than three from any one club. That's your squad.",
  },
  {
    n: "02",
    t: "Earn your transfers",
    d: "Every gameweek there's a round of questions. Know your football, move your squad. Nobody hands you free transfers here.",
  },
  {
    n: "03",
    t: "Real points, no mystery",
    d: "Your score comes from what actually happened on the pitch. No bonus-point panel quietly deciding your week.",
  },
  {
    n: "04",
    t: "A fresh table every month",
    d: "Months are their own competition, so a rough August doesn't bury your season.",
  },
];

export function FantasyHold() {
  return (
    <div className="max-w-lg mx-auto px-4 pt-4" style={{ display: "grid", gap: 14 }}>
      {/* The pitch */}
      <div className="rounded-2xl relative overflow-hidden px-5 pt-5 pb-5"
        style={{
          background: "linear-gradient(150deg, rgba(0,216,192,0.1), rgba(0,216,192,0.02))",
          border: "1px solid rgba(0,216,192,0.22)",
        }}>
        <FormationArt />
        <div className="relative">
          <p className="font-display text-[10px] tracking-widest mb-2.5" style={{ color: TEAL }}>
            FANTASY · FRIDAY 21 AUGUST
          </p>
          <p className="font-display text-white" style={{ fontSize: 40, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
            <span className="block">Transfers</span>
            <span className="block">aren&apos;t free.</span>
          </p>
          <p className="font-body text-sm mt-3 max-w-[80%]" style={{ color: "#8a948f" }}>
            Fantasy football where what you know moves your squad. Opening night, with the season.
          </p>
        </div>
      </div>

      {/* How it works — an explainer earns its place here: the game doesn't
          exist yet, so this IS the content, not a tutorial in the way. */}
      <div className="rounded-2xl p-5 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex flex-col gap-4">
          {BEATS.map((b) => (
            <div key={b.n} className="flex gap-3.5">
              <div className="flex-shrink-0 flex items-center justify-center font-display text-[11px] rounded-full"
                style={{ width: 26, height: 26, background: `${TEAL}18`, color: TEAL, border: `1px solid ${TEAL}35` }}>
                {b.n}
              </div>
              <div className="min-w-0">
                <p className="font-body text-sm text-white font-semibold">{b.t}</p>
                <p className="font-body text-xs mt-0.5 leading-relaxed" style={{ color: "#8a948f" }}>{b.d}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The one thing to do while it's not open yet. */}
      <WaitlistCard />
    </div>
  );
}
