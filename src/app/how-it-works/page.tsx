"use client";

import Link from "next/link";
import { GridBackground } from "@/components/ui/GridBackground";
import { useState, useEffect } from "react";
import { BottomNav } from "@/components/ui/BottomNav";

const ANIM_CSS = `
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 24px rgba(167,139,250,0.35); }
    50% { box-shadow: 0 0 40px rgba(167,139,250,0.55); }
  }
  @keyframes floatUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
  .float-in { animation: floatUp 0.5s ease-out forwards; }
`;

// ── Step data ─────────────────────────────────────────────────────────────────

const STEPS = [
  {
    num: "01",
    color: "#a78bfa",
    emoji: "🏆",
    title: "Create a league",
    short: "Your squad, one table",
    body: "Start a private league in 30 seconds. Invite your mates via WhatsApp or a link. Points track across every game you each play — World Cup, Euros, Champions League, all season.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d18", border: "1px solid rgba(167,139,250,0.15)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(167,139,250,0.15)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1.5h8v3L6 7.5l-4-3z" stroke="#a78bfa" strokeWidth="1.2" strokeLinejoin="round"/><path d="M2.5 4.5v4a3.5 3.5 0 0 0 7 0v-4" stroke="#a78bfa" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </div>
            <span className="font-body text-xs font-semibold text-white">The Lads</span>
          </div>
          <span className="font-body text-xs text-text-muted">6 games</span>
        </div>
        {[
          { n: "Marcus", f: "🇧🇷", pts: 2840, acc: 91, streak: 4 },
          { n: "Priya",  f: "🇮🇳", pts: 2720, acc: 87, streak: 2 },
          { n: "Jamie",  f: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", pts: 2650, acc: 83, streak: 0 },
        ].map((p, i) => (
          <div key={p.n} className="flex items-center gap-2.5 px-4 py-2.5"
            style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
            <span className="font-display text-xs w-4" style={{ color: i === 0 ? "#a78bfa" : "#555577" }}>#{i+1}</span>
            <span className="text-sm">{p.f}</span>
            <span className="font-body text-sm font-medium text-white flex-1">{p.n}</span>
            {p.streak >= 2 && <span className="font-body text-xs" style={{ color: "#fb923c" }}>🔥{p.streak}</span>}
            <span className="font-body text-xs text-text-muted">{p.acc}%</span>
            <span className="font-display text-sm" style={{ color: i === 0 ? "#a78bfa" : "white" }}>{p.pts.toLocaleString()}</span>
          </div>
        ))}
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
          <span className="font-body text-xs text-text-muted">Invite code</span>
          <span className="font-display text-sm tracking-widest" style={{ color: "#a78bfa" }}>TL9999</span>
        </div>
      </div>
    ),
  },
  {
    num: "02",
    color: "#00ff87",
    emoji: "⚽",
    title: "Sign up for a match",
    short: "Tell us you're watching",
    body: "Browse upcoming fixtures, tap the ones you're going to watch. We'll line up the questions tailored to that matchup — the players, the history, the rivalry — and ping your phone the moment kick-off lands.",
    visual: (
      <div className="space-y-2">
        <div className="rounded-2xl px-4 py-4" style={{ background: "#0d0d18", border: "1px solid rgba(0,255,135,0.15)" }}>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Upcoming</p>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-body text-sm font-semibold text-white">England vs France</p>
              <p className="font-body text-xs text-text-muted">Jun 24 · World Cup · 20:00</p>
            </div>
            <span className="font-body text-xs px-3 py-1.5 rounded-lg font-semibold text-green" style={{ background: "rgba(0,255,135,0.12)", border: "1px solid rgba(0,255,135,0.3)" }}>I&apos;m playing</span>
          </div>
          <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff87" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#00ff87" }} />
            </span>
            <span className="font-body text-xs text-white">We&apos;ll send the first question at kick-off</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "03",
    color: "#ffb800",
    emoji: "⚡",
    title: "Answer live",
    short: "45 seconds per question",
    body: "Questions fire automatically during the match, timed to key moments. Everyone gets the same question at the same time. Faster correct answers score more. Speed is everything.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d18", border: "1px solid rgba(255,184,0,0.15)" }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Question 3 of 8</p>
            <p className="font-body text-sm text-white font-medium">How many caps has Mbappé earned?</p>
          </div>
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#ffb800" strokeWidth="8" strokeLinecap="round" strokeDasharray="282" strokeDashoffset="100" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-display text-lg text-amber">24</span>
          </div>
        </div>
        <div className="p-3 space-y-2">
          {[
            { l: "a", t: "74 caps", sel: true, correct: false },
            { l: "b", t: "89 caps", sel: false, correct: true },
            { l: "c", t: "61 caps", sel: false, correct: false },
            { l: "d", t: "95 caps", sel: false, correct: false },
          ].map(opt => (
            <div key={opt.l} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: opt.sel ? "rgba(255,184,0,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${opt.sel ? "rgba(255,184,0,0.4)" : "rgba(255,255,255,0.07)"}` }}>
              <span className="w-6 h-6 rounded-md flex items-center justify-center font-display text-xs flex-shrink-0"
                style={{ background: opt.sel ? "rgba(255,184,0,0.2)" : "rgba(255,255,255,0.05)", color: opt.sel ? "#ffb800" : "#8888aa" }}>
                {opt.l.toUpperCase()}
              </span>
              <span className="font-body text-sm text-white">{opt.t}</span>
              {opt.sel && <span className="ml-auto font-body text-xs text-amber">selected</span>}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "04",
    color: "#00ff87",
    emoji: "📈",
    title: "Points stack",
    short: "All season, every game",
    body: "Your score updates after every match. Points stack across every tournament you play. Your league table shows raw score, accuracy %, and current streak — multiple ways to claim you're the best.",
    visual: (
      <div className="space-y-3">
        <div className="rounded-2xl px-4 py-3" style={{ background: "#0d0d18", border: "1px solid rgba(0,255,135,0.15)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-body text-xs font-semibold text-white uppercase tracking-widest">After 6 games</span>
            <div className="flex gap-1.5">
              <span className="font-body text-xs px-2 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>Points</span>
              <span className="font-body text-xs px-2 py-0.5 rounded text-text-muted" style={{ background: "rgba(255,255,255,0.04)" }}>P4P</span>
            </div>
          </div>
          {[
            { n: "Marcus", pts: 2840, gain: "+340", streak: 4 },
            { n: "Priya",  pts: 2720, gain: "+280", streak: 2 },
            { n: "Jamie",  pts: 2650, gain: "+210", streak: 0 },
          ].map((p, i) => (
            <div key={p.n} className="flex items-center gap-2 py-2"
              style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
              <span className="font-display text-xs w-5" style={{ color: i === 0 ? "#a78bfa" : "#555577" }}>#{i+1}</span>
              <span className="font-body text-sm font-medium text-white flex-1">{p.n}</span>
              {p.streak >= 2 && <span className="font-body text-xs" style={{ color: "#fb923c" }}>🔥{p.streak}</span>}
              <span className="font-body text-xs text-green">{p.gain}</span>
              <span className="font-display text-sm" style={{ color: i === 0 ? "#a78bfa" : "white" }}>{p.pts.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Raw score", val: "2,840", col: "#a78bfa" },
            { label: "Accuracy", val: "91%", col: "#00ff87" },
            { label: "Streak", val: "🔥 4", col: "#fb923c" },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: "#0d0d18", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-display text-xl" style={{ color: s.col }}>{s.val}</p>
              <p className="font-body text-xs text-text-muted mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const FAQS = [
  { q: "Do I need an account?", a: "Only to answer questions and earn points. Sign in with Google, Apple, Facebook, or email (magic link) — takes 10 seconds. Watching the leaderboard is free without signing in." },
  { q: "What's the difference between a league and a match?", a: "A match is one fixture — you sign up, answer the live quiz questions as it plays out, and your score from that game feeds into your leagues. A league is permanent — it tracks your whole group's points across every match and challenge each member plays, all season long." },
  { q: "Who fires the questions?", a: "YourScore fires questions automatically during the match, timed to key moments. We push them straight to your phone — just have your notifications on." },
  { q: "Can I join mid-game?", a: "Yes. You can sign up for a fixture at any point during it. You'll miss questions that already fired, but you'll be scored on all remaining ones." },
  { q: "How are points calculated?", a: "Correct answers score 100–200 points based on speed. Consecutive correct answers trigger a streak multiplier (up to 2×). Wrong answers or timeouts score 0." },
  { q: "Is it free?", a: "Completely free. Unlimited matches, unlimited leagues, every tournament." },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HowItWorksPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setActiveStep(s => (s + 1) % STEPS.length), 4000);
    return () => clearInterval(iv);
  }, []);

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <style>{ANIM_CSS}</style>
      <GridBackground opacity={0.022} />
      <div className="fixed top-0 left-0 w-[600px] h-[600px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.06) 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav className="relative z-10 pt-safe flex items-center justify-between px-6 py-5 max-w-4xl mx-auto">
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
        <Link href="/league/new" className="font-body font-bold text-sm px-5 py-2.5 rounded-xl transition-all hover:opacity-90 pulse-glow"
          style={{ background: "#a78bfa", color: "#0a0a0f" }}>
          Create a league →
        </Link>
      </nav>

      <div className="relative z-10 max-w-4xl mx-auto px-6">

        {/* Hero */}
        <div className="text-center pt-6 pb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-body text-xs uppercase tracking-widest text-green"
            style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#00ff87" }} />
            World Cup · Euros · Champions League
          </div>
          <h1 className="font-display text-6xl sm:text-7xl text-white leading-none mb-5">
            HOW IT<br /><span className="text-green">WORKS</span>
          </h1>
          <p className="font-body text-text-muted text-lg max-w-xl mx-auto leading-relaxed">
            Four steps from zero to bragging rights. Start a league with your mates, answer questions live, and build your score all season.
          </p>
        </div>

        {/* Steps — full visual layout */}
        <div className="space-y-6 mb-16">
          {STEPS.map((step, i) => (
            <div key={step.num}
              onClick={() => setActiveStep(i)}
              className="rounded-3xl overflow-hidden cursor-pointer transition-all"
              style={{
                border: `1px solid ${activeStep === i ? `${step.color}30` : "rgba(255,255,255,0.07)"}`,
                background: activeStep === i ? `linear-gradient(135deg, ${step.color}08 0%, rgba(10,10,15,1) 60%)` : "#12121e",
              }}>
              <div className="grid md:grid-cols-2 gap-0">
                {/* Left: copy */}
                <div className="p-6 sm:p-8 relative overflow-hidden">
                  {/* Big step number watermark */}
                  <div className="font-display text-[8rem] leading-none absolute -top-4 -left-2 opacity-[0.05] select-none pointer-events-none"
                    style={{ color: step.color }}>{step.num}</div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ background: `${step.color}15`, border: `1px solid ${step.color}25` }}>
                        {step.emoji}
                      </div>
                      <div>
                        <p className="font-body text-xs tracking-widest uppercase" style={{ color: step.color }}>Step {step.num}</p>
                        <p className="font-body text-xs text-text-muted">{step.short}</p>
                      </div>
                    </div>
                    <h2 className="font-display text-3xl sm:text-4xl text-white mb-3">{step.title.toUpperCase()}</h2>
                    <p className="font-body text-sm text-white/70 leading-relaxed">{step.body}</p>
                  </div>
                </div>

                {/* Right: visual mockup */}
                <div className="p-6 sm:p-8 flex items-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.04)" }}>
                  {step.visual}
                </div>
              </div>

              {/* Step connector */}
              {i < STEPS.length - 1 && (
                <div className="flex items-center justify-center py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Step progress pills */}
        <div className="flex justify-center gap-2 mb-16">
          {STEPS.map((step, i) => (
            <button key={i} onClick={() => setActiveStep(i)}
              className="h-1.5 rounded-full transition-all"
              style={{ width: activeStep === i ? 32 : 8, background: activeStep === i ? step.color : "rgba(255,255,255,0.15)" }} />
          ))}
        </div>

        {/* Scoring breakdown */}
        <div className="rounded-2xl overflow-hidden mb-14" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="px-6 py-4 bg-surface" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <h3 className="font-display text-2xl text-white">SCORING</h3>
          </div>
          <div className="bg-surface">
            {[
              { label: "Answer in 0–15s",        pts: "+200 pts", col: "#00ff87" },
              { label: "Answer in 15–30s",        pts: "+150 pts", col: "#ffb800" },
              { label: "Answer in 30–45s",        pts: "+100 pts", col: "#ff9f43" },
              { label: "3 correct in a row",      pts: "×2 bonus", col: "#a78bfa" },
              { label: "Wrong or timed out",      pts: "0 pts",    col: "#555577" },
            ].map((row, i) => (
              <div key={row.label} className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                <span className="font-body text-sm text-white/80">{row.label}</span>
                <span className="font-display text-lg" style={{ color: row.col }}>{row.pts}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3 mb-14">
          {[
            { n: "104", label: "matches at launch" },
            { n: "45s",  label: "to answer each question" },
            { n: "∞",   label: "points you can earn" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl p-4 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-3xl sm:text-4xl text-white">{s.n}</p>
              <p className="font-body text-xs text-text-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="mb-14">
          <h3 className="font-display text-3xl text-white mb-5">FAQ</h3>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ borderBottom: i < FAQS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left transition-all hover:opacity-80"
                  style={{ background: openFaq === i ? "rgba(167,139,250,0.04)" : "#12121e" }}>
                  <span className="font-body text-sm font-semibold text-white pr-4">{faq.q}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                    style={{ transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
                    <path d="M4 6l4 4 4-4" stroke="#8888aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4" style={{ background: "rgba(167,139,250,0.02)" }}>
                    <p className="font-body text-sm text-text-muted leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="rounded-3xl p-8 sm:p-12 text-center mb-8 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.1) 0%, rgba(0,255,135,0.06) 100%)", border: "1px solid rgba(167,139,250,0.2)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
          <div className="relative z-10">
            <p className="font-display text-4xl sm:text-5xl text-white mb-3">READY TO PLAY?</p>
            <p className="font-body text-text-muted mb-8">World Cup 2026 kicks off June 11. Get your league set up.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/league/new"
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-body font-bold text-base transition-all hover:opacity-90 pulse-glow"
                style={{ background: "#a78bfa", color: "#0a0a0f" }}>
                Create a league →
              </Link>
              <Link href="/join"
                className="flex items-center justify-center px-8 py-4 rounded-xl font-body font-semibold text-base transition-all hover:opacity-80 text-green"
                style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)" }}>
                Browse matches →
              </Link>
              <Link href="/challenges"
                className="flex items-center justify-center px-8 py-4 rounded-xl font-body font-semibold text-base text-white transition-colors hover:opacity-70"
                style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                Try a challenge
              </Link>
            </div>
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
