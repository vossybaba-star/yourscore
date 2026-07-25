"use client";
/**
 * The public Fantasy tab — a "coming soon" teaser, not the game (founder,
 * 25 Jul). Everyone can open the Fantasy tab now; what they see is what we're
 * building plus a one-tap opt-in. The real build/squad experience stays behind
 * the allowlist until launch (FantasyHub, gated in /fantasy/page).
 *
 * A landing page, not a rulebook (founder, 2026-07-25). The old numbered-list
 * explainer read like terms and conditions; this SELLS. The hero leads on the
 * one thing that makes this game exist on THIS app — your football knowledge
 * earns your transfers — and draws it as a picture (a correct Gameday Quiz
 * answer to transfers earned) rather than asserting it. The opt-in sits high,
 * right under the hero.
 *
 * Every claim is the locked Phase-1 model from YOURSCORE.md — a 15-man starting
 * lineup (£100m, max 3 a club), a knowledge round each gameweek that earns
 * transfers, deterministic points from real match facts with no BPS-style bonus
 * panel, and calendar-month tables. We say "correct answers earn transfers" —
 * never that every single answer banks one.
 *
 * The opt-in is the shipped WaitlistCard (session-based, writes waitlist_emails
 * + the Resend audience): signed in → one tap, signed out → account creation,
 * resumed on return. Same funnel the blog uses.
 */
import type { CSSProperties, ReactNode } from "react";
import { Header, LINE, MUTED, page, PANEL, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { WaitlistCard } from "@/components/blog/WaitlistCard";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";

const INKISH = "#cfd6d2";
const DIM = "#6b746f";

/* ── inline icons (no icon lib in this app) ─────────────────────────────── */
type IconProps = { size?: number; color?: string; style?: CSSProperties };
const svg = (size: number, color: string, style: CSSProperties | undefined, d: ReactNode) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color}
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">{d}</svg>
);
const IconClock = ({ size = 13, color = "#03211d", style }: IconProps) =>
  svg(size, color, style, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const IconCheck = ({ size = 14, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <path d="M4 12l5 5L20 6" />);
const IconArrowRight = ({ size = 22, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <path d="M4 12h15M13 6l6 6-6 6" />);
const IconSwap = ({ size = 26, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>);
const IconUsers = ({ size = 20, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0112 0" /><path d="M16 6a3 3 0 010 6" /><path d="M21 20a6 6 0 00-4-5.6" /></>);
const IconBall = ({ size = 20, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <><circle cx="12" cy="12" r="9" /><path d="M12 8l3.5 2.5-1.3 4.2h-4.4L8.5 10.5z" /></>);
const IconTrophy = ({ size = 15, color = TEAL, style }: IconProps) =>
  svg(size, color, style, <><path d="M8 4h8v4a4 4 0 01-8 0z" /><path d="M8 6H5v1a3 3 0 003 3" /><path d="M16 6h3v1a3 3 0 01-3 3" /><path d="M9.5 20h5M12 14v6" /></>);

/** Half-pitch line art behind the hero. */
const PitchArt = () => (
  <svg viewBox="0 0 120 90" aria-hidden="true"
    style={{ position: "absolute", right: -8, top: 8, width: 170, opacity: 0.22, pointerEvents: "none" }}>
    <rect x="4" y="4" width="112" height="82" rx="6" fill="none" stroke={TEAL} strokeWidth="1.5" />
    <circle cx="60" cy="45" r="14" fill="none" stroke={TEAL} strokeWidth="1.5" />
    <line x1="60" y1="4" x2="60" y2="86" stroke={TEAL} strokeWidth="1.5" />
    <rect x="4" y="28" width="16" height="34" fill="none" stroke={TEAL} strokeWidth="1.5" />
    <rect x="100" y="28" width="16" height="34" fill="none" stroke={TEAL} strokeWidth="1.5" />
  </svg>
);

/** A curated cluster of recognisable Premier League faces — a squad you'd build.
 *  Reuses the shipped, licensed HoL headshots via faceFor; PlayerAvatar draws a
 *  stable monogram for any that miss, so the row never blanks. Decorative, so the
 *  stack is aria-hidden. Spread across clubs on purpose (City, Arsenal, Chelsea,
 *  United) so it reads as "the league", not one team. */
const STARS = ["Erling Haaland", "Bukayo Saka", "Cole Palmer", "Declan Rice", "Phil Foden"];

function PortraitStack() {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex" }} aria-hidden>
        {STARS.map((name, i) => (
          <div key={name} style={{ marginLeft: i === 0 ? 0 : -14, position: "relative", zIndex: STARS.length - i, borderRadius: "50%", boxShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>
            <PlayerAvatar name={name} avatarUrl={faceFor(name)} size={46} ring={TEAL} priority />
          </div>
        ))}
      </div>
      <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 11 }}>
        Pick from the Premier League&apos;s best.
      </p>
    </div>
  );
}

export function FantasyTeaser() {
  return (
    <main data-fantasy style={{ ...page, padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(96px + env(safe-area-inset-bottom, 0px))" }}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative">
        <Header />

        {/* HERO */}
        <div className="rounded-2xl relative overflow-hidden"
          style={{ background: `linear-gradient(150deg, ${tint(TEAL, "1a")}, ${tint(TEAL, "05")})`, border: `1px solid ${tint(TEAL, "38")}`, padding: "22px 20px", marginBottom: 14 }}>
          <PitchArt />
          <div className="relative">
            <span className="font-display tracking-wider" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#03211d", background: TEAL, padding: "5px 11px", borderRadius: 20 }}>
              <IconClock /> KICKS OFF FRI 21 AUG
            </span>
            <p className="font-display text-white" style={{ fontSize: 46, lineHeight: 0.9, letterSpacing: "-0.01em", margin: "16px 0 0" }}>
              <span style={{ display: "block" }}>The more you know,</span>
              <span style={{ display: "block", color: TEAL }}>the more you move.</span>
            </p>
            <p className="font-body" style={{ fontSize: 14, color: "#9aa39e", marginTop: 14, maxWidth: "94%", lineHeight: 1.5 }}>
              The fantasy game where your football brain earns you more transfers.
            </p>
            <PortraitStack />
          </div>
        </div>

        {/* Opt-in — high up, the shipped waitlist card tagged to this surface. */}
        <WaitlistCard source="fantasy-tab" pulse />

        {/* THE DIFFERENCE */}
        <p className="font-display tracking-widest" style={{ textAlign: "center", fontSize: 13, color: TEAL, margin: "24px 0 4px" }}>THE DIFFERENCE</p>
        <p className="font-display text-white" style={{ textAlign: "center", fontSize: 26, lineHeight: 1.02, margin: "0 0 16px" }}>
          Transfers you earn,<br />not transfers you buy
        </p>

        {/* Earn showpiece */}
        <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${tint(TEAL, "38")}`, background: `linear-gradient(160deg, ${tint(TEAL, "1a")}, ${tint(TEAL, "03")})`, marginBottom: 14 }}>
          <div style={{ padding: "18px 18px 6px", display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <div style={{ width: 108, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10 }}>
              <p className="font-display tracking-wide" style={{ fontSize: 11, color: TEAL, margin: "0 0 6px" }}>GAMEDAY QUIZ</p>
              <p className="font-body" style={{ fontSize: 11, color: INKISH, margin: "0 0 8px", lineHeight: 1.3 }}>Who assisted Saka v Spurs?</p>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: tint(TEAL, "24"), border: `1px solid ${tint(TEAL, "66")}`, borderRadius: 7, padding: "5px 7px" }}>
                <IconCheck /><span className="font-body" style={{ fontSize: 10, color: "#fff" }}>Correct</span>
              </div>
            </div>
            <IconArrowRight />
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 60, height: 60, borderRadius: "50%", background: tint(TEAL, "24"), border: `2px solid ${TEAL}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
                <IconSwap />
              </div>
              <p className="font-body" style={{ fontSize: 10, color: "#9aa39e", margin: "7px 0 0", lineHeight: 1.2 }}>transfers<br />earned</p>
            </div>
          </div>
          <div style={{ padding: "8px 18px 18px", textAlign: "center" }}>
            <p className="font-display tracking-wide text-white" style={{ fontSize: 18, margin: "8px 0 4px" }}>KNOW YOUR FOOTBALL, MOVE YOUR TEAM</p>
            <p className="font-body" style={{ fontSize: 12.5, color: "#9aa39e", margin: 0, lineHeight: 1.55 }}>
              Answer the Gameday Quiz and each round&apos;s questions. Correct answers earn transfers. Everywhere else you pay for extra moves. On YourScore, you earn them.
            </p>
          </div>
        </div>

        {/* Two supporting cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, background: PANEL, padding: "16px 14px" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: tint(TEAL, "1f"), display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}><IconUsers /></div>
            <p className="font-display tracking-wide text-white" style={{ fontSize: 16, margin: "0 0 4px" }}>YOUR STARTING LINEUP</p>
            <p className="font-body" style={{ fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>Pick 15 players, £100m budget, max 3 from a club.</p>
          </div>
          <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, background: PANEL, padding: "16px 14px" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: tint(TEAL, "1f"), display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}><IconBall /></div>
            <p className="font-display tracking-wide text-white" style={{ fontSize: 16, margin: "0 0 4px" }}>RULES YOU ALREADY KNOW</p>
            <p className="font-body" style={{ fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>Familiar fantasy scoring, straight from what happens on the pitch.</p>
          </div>
        </div>

        {/* Monthly table */}
        <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, background: PANEL, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <p className="font-display tracking-wide text-white" style={{ fontSize: 17, margin: 0 }}>A FRESH TABLE EVERY MONTH</p>
              <p className="font-body" style={{ fontSize: 12, color: MUTED, margin: "3px 0 0" }}>Jump in any time. A bad August never buries you.</p>
            </div>
            <span className="font-display tracking-wide" style={{ flexShrink: 0, fontSize: 11, color: "#03211d", background: TEAL, padding: "4px 9px", borderRadius: 20 }}>RESETS 1ST</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: tint(TEAL, "1a"), border: `1px solid ${tint(TEAL, "4d")}`, borderRadius: 9, padding: "8px 11px" }}>
              <span className="font-display" style={{ color: TEAL, fontSize: 14, width: 16 }}>1</span><IconTrophy />
              <span className="font-body" style={{ fontSize: 12, color: "#fff", flex: 1 }}>You could be here</span>
              <span className="font-display" style={{ fontSize: 13, color: TEAL }}>412</span>
            </div>
            {[["2", "rossco_afc", "398"], ["3", "tashx10", "377"]].map(([pos, name, pts]) => (
              <div key={pos} style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL_2, borderRadius: 9, padding: "8px 11px" }}>
                <span className="font-display" style={{ color: DIM, fontSize: 14, width: 16 }}>{pos}</span>
                <div style={{ width: 15, height: 15, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
                <span className="font-body" style={{ fontSize: 12, color: "#9aa39e", flex: 1 }}>{name}</span>
                <span className="font-body" style={{ fontSize: 12, color: "#9aa39e" }}>{pts}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Closer — points back to the opt-in above (one funnel, no duplicate form). */}
        <div className="rounded-2xl" style={{ padding: "22px 18px", textAlign: "center", background: `radial-gradient(120% 100% at 50% 0%, ${tint(TEAL, "26")}, transparent 65%)`, border: `1px solid ${tint(TEAL, "38")}` }}>
          <p className="font-display tracking-wide text-white" style={{ fontSize: 22, margin: "0 0 4px" }}>GET IN BEFORE THE FIRST WHISTLE</p>
          <p className="font-body" style={{ fontSize: 12.5, color: "#9aa39e", margin: 0, lineHeight: 1.5 }}>
            Squads open Friday 21 August, with the season. Opt in above and we&apos;ll tell you the moment it&apos;s live.
          </p>
        </div>
      </div>
    </main>
  );
}
