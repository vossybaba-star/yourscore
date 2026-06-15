import type { Metadata } from "next";
import Link from "next/link";
import { WC2026Board } from "@/components/competition/WC2026Board";

export const metadata: Metadata = {
  title: "Win £100 — World Cup Quiz Series | YourScore",
  description:
    "A new World Cup football quiz every day. Play free, keep your daily streak, top the leaderboard — the highest score wins £100.",
  openGraph: {
    title: "Win £100 — World Cup Quiz Series",
    description:
      "A new World Cup football quiz every day. Play free, keep your daily streak, top the leaderboard — the highest score wins £100.",
    type: "website",
    siteName: "YourScore",
    url: "https://yourscore.app/competition",
  },
  twitter: {
    card: "summary_large_image",
    title: "Win £100 — World Cup Quiz Series",
    description: "A new World Cup quiz every day. Keep your streak, top the board, win £100.",
  },
};

const GREEN = "#aeea00";
const AMBER = "#ffb800";

const STEPS = [
  { n: "1", t: "A new quiz every day", d: "15 quick questions on the World Cup — released daily through the tournament." },
  { n: "2", t: "Score points & keep your streak", d: "The faster you answer, the more you score. Play each day on time to build a streak bonus." },
  { n: "3", t: "Top the board, win £100", d: "Highest total when the final daily quiz closes takes the £100." },
];

const RULES = [
  "Free to enter — no purchase necessary. It’s a game of football knowledge (skill), not gambling.",
  "Open to everyone, worldwide. Under-18 winners may need a parent or guardian to receive the prize.",
  "One account per player. Your leaderboard score is your first attempt on each quiz.",
  "The series ends when the final daily quiz’s play window closes; the player at the top of the leaderboard at that moment wins.",
  "Scores are streak-boosted (see above). Ties are broken by who reached the score first.",
  "The winner is contacted by email at their account address. Allow a few days for verification and payment.",
];

export default function CompetitionPage() {
  return (
    <main className="min-h-dvh" style={{ background: "#0a0a0f", color: "#eef2f0" }}>
      <nav className="pt-safe px-6 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5"
            style={{ background: `${GREEN}12`, border: `1px solid ${GREEN}44` }}>
            <span className="font-display text-xs tracking-widest" style={{ color: GREEN }}>WORLD CUP QUIZ SERIES</span>
          </div>
          <h1 className="font-display text-white leading-none mb-4" style={{ fontSize: 72 }}>
            Win <span style={{ color: AMBER }}>£100</span>
          </h1>
          <p className="font-body text-base mx-auto" style={{ color: "#c4ccc6", maxWidth: 440 }}>
            A new football quiz every day of the World Cup. Play free, keep your daily streak, and top the
            leaderboard — the highest score wins.
          </p>
          <Link href="/play"
            className="inline-block mt-7 rounded-2xl px-8 py-4 font-display text-sm tracking-widest text-white active:scale-[0.97] transition-transform"
            style={{ background: `linear-gradient(135deg, #00b35f 0%, ${GREEN} 100%)`, boxShadow: `0 4px 24px ${GREEN}40` }}>
            PLAY TODAY’S QUIZ →
          </Link>
        </div>

        {/* How it works */}
        <h2 className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>HOW IT WORKS</h2>
        <div className="flex flex-col gap-3 mb-10">
          {STEPS.map((s) => (
            <div key={s.n} className="flex items-start gap-4 rounded-2xl p-5"
              style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center justify-center rounded-xl flex-shrink-0 font-display"
                style={{ width: 36, height: 36, background: `${GREEN}16`, color: GREEN, fontSize: 16 }}>
                {s.n}
              </div>
              <div>
                <p className="font-body text-sm font-bold text-white mb-1">{s.t}</p>
                <p className="font-body text-sm" style={{ color: "#7a857f", lineHeight: 1.55 }}>{s.d}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Streak callout */}
        <div className="rounded-2xl p-5 mb-12 flex items-start gap-4"
          style={{ background: `${AMBER}0d`, border: `1px solid ${AMBER}33` }}>
          <span className="text-2xl flex-shrink-0">🔥</span>
          <div>
            <p className="font-body text-sm font-bold mb-1" style={{ color: AMBER }}>Daily streak bonus</p>
            <p className="font-body text-sm" style={{ color: "#c8c8a8", lineHeight: 1.55 }}>
              Finish each day’s quiz before midnight (UK) to keep your streak. Every consecutive day boosts that
              day’s score by <strong style={{ color: "#fff" }}>+10%</strong>, up to <strong style={{ color: "#fff" }}>+50%</strong>.
              Miss a day and the streak resets — so play every day.
            </p>
          </div>
        </div>

        {/* Live leaderboard */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>LIVE LEADERBOARD</h2>
          <span className="font-body text-xs" style={{ color: "#586058" }}>updates every minute</span>
        </div>
        <div className="mb-12">
          <WC2026Board />
        </div>

        {/* Rules */}
        <h2 className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>THE RULES</h2>
        <div className="rounded-2xl p-6 mb-10" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
          <ul className="flex flex-col gap-3">
            {RULES.map((r, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 mt-1" style={{ color: GREEN, fontSize: 12 }}>●</span>
                <span className="font-body text-sm" style={{ color: "#c4ccc6", lineHeight: 1.55 }}>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-center">
          <Link href="/play"
            className="inline-block rounded-2xl px-8 py-4 font-display text-sm tracking-widest text-white active:scale-[0.97] transition-transform"
            style={{ background: `linear-gradient(135deg, #00b35f 0%, ${GREEN} 100%)`, boxShadow: `0 4px 24px ${GREEN}40` }}>
            PLAY TODAY’S QUIZ →
          </Link>
          <p className="font-body text-xs mt-5" style={{ color: "#586058" }}>
            Questions? <Link href="/support" style={{ color: "#8a948f", textDecoration: "underline" }}>Contact support</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
