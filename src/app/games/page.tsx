"use client";

import Link from "next/link";
import { GridBackground } from "@/components/ui/GridBackground";
import { useState, useEffect } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { GAMES } from "@/components/ui/GameSwitcher";

const ANIM_CSS = `
  @keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 24px rgba(174,234,0,0.35); }
    50% { box-shadow: 0 0 40px rgba(174,234,0,0.55); }
  }
  @keyframes greenGlow {
    0%, 100% { box-shadow: 0 0 24px rgba(174,234,0,0.35); }
    50% { box-shadow: 0 0 40px rgba(174,234,0,0.55); }
  }
  @keyframes floatUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
  .green-pulse-glow { animation: greenGlow 3s ease-in-out infinite; }
  .float-in { animation: floatUp 0.5s ease-out forwards; }
`;

// ── Quiz / Live match steps ───────────────────────────────────────────────────

const QUIZ_STEPS = [
  {
    num: "01",
    color: "#aeea00",
    emoji: "🏆",
    title: "Create a league",
    short: "Your squad, one table",
    body: "Start a private league in 30 seconds. Invite your friends via WhatsApp or a link. Points track across every game you each play, all season.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.15)" }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(174,234,0,0.15)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1.5h8v3L6 7.5l-4-3z" stroke="#aeea00" strokeWidth="1.2" strokeLinejoin="round"/><path d="M2.5 4.5v4a3.5 3.5 0 0 0 7 0v-4" stroke="#aeea00" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </div>
            <span className="font-body text-xs font-semibold text-white">The Group Chat</span>
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
            <span className="font-display text-xs w-4" style={{ color: i === 0 ? "#aeea00" : "#586058" }}>#{i+1}</span>
            <span className="text-sm">{p.f}</span>
            <span className="font-body text-sm font-medium text-white flex-1">{p.n}</span>
            {p.streak >= 2 && <span className="font-body text-xs" style={{ color: "#fb923c" }}>🔥{p.streak}</span>}
            <span className="font-body text-xs text-text-muted">{p.acc}%</span>
            <span className="font-display text-sm" style={{ color: i === 0 ? "#aeea00" : "white" }}>{p.pts.toLocaleString()}</span>
          </div>
        ))}
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
          <span className="font-body text-xs text-text-muted">Invite code</span>
          <span className="font-display text-sm tracking-widest" style={{ color: "#aeea00" }}>TL9999</span>
        </div>
      </div>
    ),
  },
  {
    num: "02",
    color: "#aeea00",
    emoji: "⚽",
    title: "Pick a quiz",
    short: "Daily packs + solo challenges",
    body: "Jump into the daily quiz or any football pack: players, records, history, the lot. Fresh questions every day. Play solo whenever you like, or spin up a lobby and take your friends on.",
    visual: (
      <div className="space-y-2">
        <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.15)" }}>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Daily quiz</p>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-body text-sm font-semibold text-white">Daily Quiz · fresh every day</p>
              <p className="font-body text-xs text-text-muted">8 questions · speed scored</p>
            </div>
            <span className="font-body text-xs px-3 py-1.5 rounded-lg font-semibold text-green" style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.3)" }}>Play →</span>
          </div>
          <div className="flex items-center gap-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            <span className="font-body text-xs text-white">🏆 New questions every day</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "03",
    color: "#00d8c0",
    emoji: "⚡",
    title: "Answer fast",
    short: "Speed scored, every question",
    body: "The clock's ticking on every question. Everyone in a lobby gets the same questions, so it's a fair race. Faster correct answers score more. Know your football and trust your gut. Speed is everything.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(0,216,192,0.15)" }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-0.5">Question 3 of 8</p>
            <p className="font-body text-sm text-white font-medium">How many caps has Mbappé earned?</p>
          </div>
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <circle cx="50" cy="50" r="45" fill="none" stroke="#00d8c0" strokeWidth="8" strokeLinecap="round" strokeDasharray="282" strokeDashoffset="100" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-display text-lg text-teal">24</span>
          </div>
        </div>
        <div className="p-3 space-y-2">
          {[
            { l: "a", t: "74 caps", sel: true,  correct: false },
            { l: "b", t: "89 caps", sel: false, correct: true  },
            { l: "c", t: "61 caps", sel: false, correct: false },
            { l: "d", t: "95 caps", sel: false, correct: false },
          ].map(opt => (
            <div key={opt.l} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: opt.sel ? "rgba(0,216,192,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${opt.sel ? "rgba(0,216,192,0.4)" : "rgba(255,255,255,0.07)"}` }}>
              <span className="w-6 h-6 rounded-md flex items-center justify-center font-display text-xs flex-shrink-0"
                style={{ background: opt.sel ? "rgba(0,216,192,0.2)" : "rgba(255,255,255,0.05)", color: opt.sel ? "#00d8c0" : "#8a948f" }}>
                {opt.l.toUpperCase()}
              </span>
              <span className="font-body text-sm text-white">{opt.t}</span>
              {opt.sel && <span className="ml-auto font-body text-xs text-teal">selected</span>}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: "04",
    color: "#aeea00",
    emoji: "📈",
    title: "Points stack",
    short: "All season, every game",
    body: "Your score updates after every game. Points stack across every quiz and challenge you play. Your league table shows raw score, accuracy %, and current streak, so there are several ways to claim you're the best.",
    visual: (
      <div className="space-y-3">
        <div className="rounded-2xl px-4 py-3" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.15)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-body text-xs font-semibold text-white uppercase tracking-widest">After 6 games</span>
            <div className="flex gap-1.5">
              <span className="font-body text-xs px-2 py-0.5 rounded" style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>Points</span>
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
              <span className="font-display text-xs w-5" style={{ color: i === 0 ? "#aeea00" : "#586058" }}>#{i+1}</span>
              <span className="font-body text-sm font-medium text-white flex-1">{p.n}</span>
              {p.streak >= 2 && <span className="font-body text-xs" style={{ color: "#fb923c" }}>🔥{p.streak}</span>}
              <span className="font-body text-xs text-green">{p.gain}</span>
              <span className="font-display text-sm" style={{ color: i === 0 ? "#aeea00" : "white" }}>{p.pts.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Raw score", val: "2,840", col: "#aeea00" },
            { label: "Accuracy",  val: "91%",   col: "#aeea00" },
            { label: "Streak",    val: "🔥 4",   col: "#fb923c" },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="font-display text-xl" style={{ color: s.col }}>{s.val}</p>
              <p className="font-body text-xs text-text-muted mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

// ── 38-0 steps ────────────────────────────────────────────────────────────────

const DRAFT_STEPS = [
  {
    num: "01",
    color: "#aeea00",
    emoji: "👕",
    title: "Draft your XI",
    short: "11 players, one formation",
    body: "Pick a formation, then build your squad from hundreds of real players across every era. Spin to discover them or browse by position. Your XI is your team. Own it.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.15)" }}>
        {/* Formation header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <span className="font-body text-xs font-semibold text-white">My XI</span>
          <span className="font-display text-xs tracking-widest" style={{ color: "#aeea00" }}>4-3-3</span>
        </div>
        {/* Mini pitch grid */}
        <div className="px-4 py-3">
          <div className="rounded-xl overflow-hidden relative" style={{ background: "rgba(174,234,0,0.04)", border: "1px solid rgba(174,234,0,0.1)", padding: "12px 8px" }}>
            {/* GK row */}
            <div className="flex justify-center mb-3">
              <div className="text-center">
                <div className="w-9 h-9 rounded-full mx-auto flex items-center justify-center font-display text-xs text-white mb-1"
                  style={{ background: "rgba(174,234,0,0.18)", border: "1.5px solid rgba(174,234,0,0.35)" }}>GK</div>
                <p className="font-body text-xs text-white" style={{ fontSize: 9 }}>Alisson</p>
              </div>
            </div>
            {/* DEF row */}
            <div className="flex justify-around mb-3">
              {["TAA", "VVD", "Dias", "Robertson"].map(n => (
                <div key={n} className="text-center">
                  <div className="w-8 h-8 rounded-full mx-auto flex items-center justify-center font-display text-xs text-white mb-1"
                    style={{ background: "rgba(174,234,0,0.12)", border: "1px solid rgba(174,234,0,0.25)" }}>
                    {n.slice(0,2)}
                  </div>
                  <p className="font-body" style={{ fontSize: 8, color: "#8a948f" }}>{n}</p>
                </div>
              ))}
            </div>
            {/* MID row */}
            <div className="flex justify-around mb-3">
              {["De Bruyne", "Rodri", "Bellingham"].map(n => (
                <div key={n} className="text-center">
                  <div className="w-8 h-8 rounded-full mx-auto flex items-center justify-center font-display text-xs text-white mb-1"
                    style={{ background: "rgba(0,216,192,0.12)", border: "1px solid rgba(0,216,192,0.25)" }}>
                    {n.slice(0,2)}
                  </div>
                  <p className="font-body" style={{ fontSize: 8, color: "#8a948f" }}>{n.split(" ")[0].slice(0,7)}</p>
                </div>
              ))}
            </div>
            {/* ATT row */}
            <div className="flex justify-around">
              {["Salah", "Haaland", "Vinicius"].map(n => (
                <div key={n} className="text-center">
                  <div className="w-8 h-8 rounded-full mx-auto flex items-center justify-center font-display text-xs text-white mb-1"
                    style={{ background: "rgba(174,234,0,0.15)", border: "1px solid rgba(174,234,0,0.3)" }}>
                    {n.slice(0,2)}
                  </div>
                  <p className="font-body" style={{ fontSize: 8, color: "#8a948f" }}>{n}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between">
          <span className="font-body text-xs text-text-muted">Team strength</span>
          <span className="font-display text-base" style={{ color: "#aeea00" }}>87</span>
        </div>
      </div>
    ),
  },
  {
    num: "02",
    color: "#aeea00",
    emoji: "⚔️",
    title: "Challenge a friend",
    short: "H2H or live lobby",
    body: "Send a challenge link to anyone. They accept with their own XI and the match runs automatically. Or start a live lobby and play in real time. No one picks the same player twice.",
    visual: (
      <div className="space-y-2.5">
        <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.2)" }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#1a2f4a,#3a423d)", color: "#aeea00", border: "1.5px solid rgba(174,234,0,0.25)" }}>Z</div>
            <div>
              <p className="font-body text-sm font-semibold text-white">Your XI</p>
              <p className="font-body text-xs text-text-muted">Strength 87 · 4-3-3</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.18)" }}>
            <span className="font-body text-xs text-text-muted flex-1">yourscore.app/38-0/challenge/RW7X</span>
            <span className="font-body text-xs font-bold px-2 py-1 rounded-lg" style={{ background: "rgba(174,234,0,0.2)", color: "#aeea00" }}>Copy</span>
          </div>
          <p className="font-body text-xs text-text-muted mt-2.5 text-center">Share this link · they pick their XI · match runs instantly</p>
        </div>
        <div className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.18)" }}>
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#aeea00" }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#aeea00" }} />
          </span>
          <span className="font-body text-xs text-white">Live lobby · play with friends right now</span>
        </div>
      </div>
    ),
  },
  {
    num: "03",
    color: "#00d8c0",
    emoji: "🎬",
    title: "Watch the match unfold",
    short: "Goals, drama, big moments",
    body: "A full 90 minute simulation plays out: goals, assists, cards, stats. Your squad's real-world performances determine who scores and who concedes. Every match tells a story.",
    visual: (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(0,216,192,0.15)" }}>
        {/* Match header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="text-center flex-1">
            <p className="font-body text-xs font-semibold text-white">Zach&apos;s XI</p>
          </div>
          <div className="px-4 text-center">
            <p className="font-display text-2xl text-white">2 – 1</p>
            <p className="font-body text-xs text-text-muted">78&apos;</p>
          </div>
          <div className="text-center flex-1">
            <p className="font-body text-xs font-semibold text-white">Marcus&apos;s XI</p>
          </div>
        </div>
        {/* Goal feed */}
        <div className="px-4 py-3 space-y-2">
          {[
            { min: "23'", scorer: "Haaland ⚽", side: "you",  col: "#aeea00" },
            { min: "41'", scorer: "Benzema ⚽", side: "them", col: "#ff7a88" },
            { min: "67'", scorer: "Salah ⚽",   side: "you",  col: "#aeea00" },
          ].map(g => (
            <div key={g.min} className="flex items-center gap-2.5 rounded-lg px-3 py-2"
              style={{ background: `${g.col}08`, border: `1px solid ${g.col}20` }}>
              <span className="font-display text-xs w-8 flex-shrink-0" style={{ color: g.col }}>{g.min}</span>
              <span className="font-body text-xs text-white flex-1">{g.scorer}</span>
              <span className="font-body text-xs" style={{ color: g.col }}>{g.side === "you" ? "← you" : "them →"}</span>
            </div>
          ))}
        </div>
        <div className="px-4 pb-3">
          <div className="rounded-lg px-3 py-2 text-center" style={{ background: "rgba(0,216,192,0.08)", border: "1px solid rgba(0,216,192,0.2)" }}>
            <span className="font-body text-xs" style={{ color: "#00d8c0" }}>12 minutes remaining…</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    num: "04",
    color: "#aeea00",
    emoji: "📊",
    title: "Build your record",
    short: "Go unbeaten. Stay at 38-0.",
    body: "Every win, draw and loss updates your W/D/L record. Lose, and your streak resets. Win enough and the dream is alive: an unbeaten season. 38 games, 0 losses. Can you do it?",
    visual: (
      <div className="space-y-3">
        <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(174,234,0,0.15)" }}>
          <div className="flex items-center justify-between mb-4">
            <span className="font-body text-xs font-semibold text-white uppercase tracking-widest">Your Record</span>
            <span className="font-display text-xs tracking-widest" style={{ color: "#aeea00" }}>Season 1</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "Won",   val: "9",  col: "#aeea00" },
              { label: "Drawn", val: "2",  col: "#00d8c0" },
              { label: "Lost",  val: "1",  col: "#ff7a88" },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: `${s.col}08`, border: `1px solid ${s.col}20` }}>
                <p className="font-display text-2xl" style={{ color: s.col }}>{s.val}</p>
                <p className="font-body text-xs text-text-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.18)" }}>
            <div>
              <p className="font-body text-xs text-text-muted">Current streak</p>
              <p className="font-display text-lg text-white">🔥 5 wins</p>
            </div>
            <div className="text-right">
              <p className="font-body text-xs text-text-muted">Season goal</p>
              <p className="font-display text-lg" style={{ color: "#aeea00" }}>38-0</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
];

// ── FAQ ───────────────────────────────────────────────────────────────────────

const QUIZ_FAQS = [
  { q: "Do I need an account?", a: "Only to answer questions and earn points. Sign in with Google, Apple, Facebook, or email (magic link), which takes 10 seconds. Browsing the leaderboard is free without signing in." },
  { q: "What's the difference between a league and a game?", a: "A game is one play-through: the daily quiz, a pack, or a lobby with your friends. Your score from that game feeds into your leagues. A league is permanent, and it tracks your whole group's points across every game each member plays, all season long." },
  { q: "Do I have to play at a set time?", a: "No. Play solo whenever you like, because the daily quiz and every pack are always there. Want to go head-to-head? Spin up a lobby and your friends jump in when they're ready." },
  { q: "What's the daily quiz?", a: "A fresh set of football questions every day: players, records, history, the lot. Same questions for everyone, speed scored, so it's a fair race up the leaderboard." },
  { q: "How are points calculated?", a: "The faster you answer correctly, the more you score. Harder questions are worth more, and back-to-back correct answers earn a streak bonus. Wrong answers or timeouts score 0." },
  { q: "Is it free?", a: "Completely free. Unlimited games, unlimited leagues, every tournament." },
];

const DRAFT_FAQS = [
  { q: "How do I build my XI?", a: "Pick a formation, then fill each position slot from the player pool. You can spin to randomly discover players or scroll through the full list. Each player can only appear once in your squad." },
  { q: "How does the match simulation work?", a: "Your players' real-world stats and form determine how the simulation plays out. Stronger squads win more often, but the simulation has enough variance to keep every match interesting." },
  { q: "Can I change my XI after saving it?", a: "Yes, you can edit and re-save your XI any time before a match starts. After accepting a challenge, your XI is locked in for that match." },
  { q: "What happens if I lose?", a: "Your win streak resets, but your team stays active. You can keep challenging people. The goal is to build an unbeaten run, so every loss just means starting the streak over." },
  { q: "How do 38-0 leagues work?", a: "In a 38-0 league, members' W/D/L records are tracked on a shared table. Every match any member plays counts toward the league standings, and most wins at the end of the season takes it." },
  { q: "Is it free?", a: "Yes, completely free. Build your XI, challenge as many friends as you like." },
];

// ── Step card component ───────────────────────────────────────────────────────

function StepCards({ steps, activeStep, setActiveStep }: {
  steps: typeof QUIZ_STEPS;
  activeStep: number;
  setActiveStep: (i: number) => void;
}) {
  return (
    <div className="space-y-6 mb-16">
      {steps.map((step, i) => (
        <div key={step.num}
          onClick={() => setActiveStep(i)}
          className="rounded-3xl overflow-hidden cursor-pointer transition-all"
          style={{
            border: `1px solid ${activeStep === i ? `${step.color}30` : "rgba(255,255,255,0.07)"}`,
            background: activeStep === i ? `linear-gradient(135deg, ${step.color}08 0%, rgba(10,10,15,1) 60%)` : "#0e1611",
          }}>
          <div className="grid md:grid-cols-2 gap-0">
            {/* Left: copy */}
            <div className="p-6 sm:p-8 relative overflow-hidden">
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
            {/* Right: visual */}
            <div className="p-6 sm:p-8 flex items-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.04)" }}>
              {step.visual}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,0,0,0.2)" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M4 9l4 4 4-4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Tabs are the five live games, keyed to the GAMES registry in GameSwitcher.
// YOURSCORE.md §1.1 makes that registry the single source of truth for the game
// list and says the marketing pages render from it, so adding a game is one
// edit there and this page grows a tab on its own. This page previously had two
// tabs, Quiz and 38-0, which was the retired "two games, 38-0 is the flagship"
// framing (§1.3) on a page called THE GAMES.
type Tab = (typeof GAMES)[number]["key"];

// ── Mock game visuals for the three detail-panel games ──────────────────────
// Same idiom as the Quiz / 38-0 step visuals: a small, honest mock of the real
// screen, built from divs. Each one mirrors how the game actually plays, so the
// picture teaches the mechanic the bullets describe.

// Perfect 10's tower: rank 1 at the top, each rung wider than the last
// (rungWidthPct in the real game runs 62% at rank 1 to 100% at rank 10).
function Perfect10Visual() {
  const rungs = [
    { rank: 1, name: "Alan Shearer", solved: true },
    { rank: 2, name: "Harry Kane", solved: true },
    { rank: 3, name: null, solved: false },
    { rank: 4, name: "Wayne Rooney", solved: true },
    { rank: 5, name: null, solved: false },
  ];
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(255,196,0,0.15)" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="font-body text-xs uppercase tracking-widest" style={{ color: "#8a948f" }}>PL all time scorers</p>
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="rounded-full" style={{ width: 6, height: 6, background: i < 1 ? "#ff4757" : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {rungs.map((r, i) => (
          <div key={r.rank} className="mx-auto flex items-center gap-2 rounded-lg px-2.5 py-2"
            style={{
              width: `${62 + (i * 38) / 4}%`,
              background: r.solved ? "rgba(255,196,0,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${r.solved ? "rgba(255,196,0,0.35)" : "rgba(255,255,255,0.07)"}`,
            }}>
            <span className="font-display text-xs flex-shrink-0" style={{ color: r.solved ? "#ffc400" : "#586058", width: 12 }}>{r.rank}</span>
            {r.solved
              ? <span className="font-body text-xs text-white truncate">{r.name}</span>
              : <span className="rounded-full" style={{ height: 5, width: "55%", background: "rgba(255,255,255,0.08)" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// Higher or Lower: two same-position players, one stat, tap the bigger. The
// real game reveals one number and hides the other.
function HigherLowerVisual() {
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(255,120,0,0.15)" }}>
      <p className="font-body text-xs text-center uppercase tracking-widest mb-3" style={{ color: "#8a948f" }}>Premier League goals · forwards</p>
      <div className="flex items-stretch gap-2">
        {[
          { name: "Mohamed Salah", val: "186", known: true },
          { name: "Sergio Agüero", val: "?", known: false },
        ].map((p, i) => (
          <div key={p.name} className="flex-1 rounded-xl px-3 py-3 text-center"
            style={{ background: p.known ? "rgba(255,255,255,0.03)" : "rgba(255,120,0,0.1)", border: `1px solid ${p.known ? "rgba(255,255,255,0.07)" : "rgba(255,120,0,0.4)"}` }}>
            <p className="font-body text-xs text-white/80 leading-tight mb-1.5">{p.name}</p>
            <p className="font-display text-2xl" style={{ color: p.known ? "#fff" : "#ff7800" }}>{p.val}</p>
            {!p.known && <p className="font-body text-xs mt-1" style={{ color: "#ff7800" }}>tap if more</p>}
            {i === 0 && <p className="font-body text-xs mt-1" style={{ color: "#586058" }}>goals</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Guess the Player: clues arrive one at a time (the real game shows a
// nationality flag and shirt number as visual clues), then four options.
function GuessThePlayerVisual() {
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(79,195,247,0.15)" }}>
      <div className="flex items-center gap-2 mb-3">
        {["🏴󠁧󠁢󠁥󠁮󠁧󠁿 England", "#7", "Winger"].map((c) => (
          <span key={c} className="font-body text-xs px-2 py-1 rounded-md"
            style={{ background: "rgba(79,195,247,0.12)", border: "1px solid rgba(79,195,247,0.3)", color: "#4fc3f7" }}>{c}</span>
        ))}
        <span className="font-body text-xs px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.03)", color: "#586058" }}>+2</span>
      </div>
      <div className="space-y-1.5">
        {[
          { l: "A", t: "Jack Grealish", on: false },
          { l: "B", t: "Phil Foden", on: true },
          { l: "C", t: "Bukayo Saka", on: false },
        ].map((o) => (
          <div key={o.l} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: o.on ? "rgba(79,195,247,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${o.on ? "rgba(79,195,247,0.4)" : "rgba(255,255,255,0.07)"}` }}>
            <span className="w-5 h-5 rounded flex items-center justify-center font-display text-xs flex-shrink-0"
              style={{ background: o.on ? "rgba(79,195,247,0.2)" : "rgba(255,255,255,0.05)", color: o.on ? "#4fc3f7" : "#8a948f" }}>{o.l}</span>
            <span className="font-body text-xs text-white">{o.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Quiz and 38-0 carry the most mechanics (§5A, §5B) and keep their step
// carousels. The other three are documented in §5C and get a detail panel.
const DETAIL: Partial<Record<Tab, { headline: string; points: string[]; visual: React.ReactNode }>> = {
  perfect10: {
    headline: "Name a ranked top ten",
    points: [
      "One ranked list, ten rungs. Premier League all time scorers, club records, that sort of thing.",
      "Type a name and it lands on the rung it belongs on.",
      "Three strikes and the run ends. Stuck on one, take a hint and score less for it.",
      "The same list for everyone that day, so scores compare directly. Challenge a friend with a link.",
    ],
    visual: <Perfect10Visual />,
  },
  "higher-lower": {
    headline: "Two players, one stat",
    points: [
      "Two Premier League players in the same position. Pick whoever has the bigger number.",
      "Never a keeper against a striker, so it is a fair call every time.",
      "Choose the stat you want: goals, assists, appearances and more.",
      "Ten a round, and faster answers score more.",
    ],
    visual: <HigherLowerVisual />,
  },
  "guess-the-player": {
    headline: "Name the mystery footballer",
    points: [
      "Clues drip in one at a time, or a career path unfolds club by club.",
      "Four options, and the sooner you call it the more it scores.",
      "Ten a round, fresh players every time.",
    ],
    visual: <GuessThePlayerVisual />,
  },
};

// ── Landing with the season ─────────────────────────────────────────────────
// Premier League GW1 is Fri 21 Aug 2026, and both of these open with it. Dates
// and mechanics are taken from the shipping surfaces (FantasyHold, HalftimeRail)
// so the pitch reads the same here as it does in the app.

const TEAL = "#00d8c0";

const FANTASY_POINTS = [
  { n: "01", t: "Build it once", d: "Fifteen players, £100m, no more than three from any one club. That's your squad." },
  { n: "02", t: "Earn extra transfers", d: "Everyone gets one transfer a gameweek. Answer the round to earn more, so the better you know your football, the more moves you get." },
  { n: "03", t: "Real points, no mystery", d: "Your score comes from what actually happened on the pitch. No bonus point panel quietly deciding your week." },
  { n: "04", t: "A fresh table every month", d: "Months are their own competition, so a rough August doesn't bury your season." },
];

const HALFTIME_POINTS = [
  { n: "01", t: "One pack per fixture", d: "Every Premier League match gets its own quiz pack, built for that game, every week of the season." },
  { n: "02", t: "It drops at the whistle", d: "Not on a timer, not an estimate. The real half time whistle releases it." },
  { n: "03", t: "Ten questions, fifteen minutes", d: "The length of the interval. Play it before the players come back out." },
  { n: "04", t: "Play it against your friends", d: "Same pack, same window, so there is one right answer to who knew more." },
];

function FeatureSection({
  eyebrow, title, sub, points, accent, href, cta,
}: {
  eyebrow: string; title: React.ReactNode; sub: string;
  points: { n: string; t: string; d: string }[];
  accent: string; href: string; cta: string;
}) {
  return (
    <div className="rounded-3xl overflow-hidden mb-8"
      style={{ background: `linear-gradient(150deg, ${accent}1a, ${accent}05)`, border: `1px solid ${accent}38` }}>
      <div className="px-6 py-8 sm:px-10 sm:py-10">
        <p className="font-display tracking-widest mb-3" style={{ fontSize: 11, color: accent }}>{eyebrow}</p>
        <h2 className="font-display text-white leading-none mb-4" style={{ fontSize: 40, letterSpacing: "-0.015em" }}>{title}</h2>
        <p className="font-body text-base leading-relaxed mb-8 max-w-lg" style={{ color: "#8a948f" }}>{sub}</p>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          {points.map((p) => (
            <div key={p.n} className="flex items-start gap-3">
              <span className="flex-shrink-0 flex items-center justify-center font-display rounded-full"
                style={{ width: 26, height: 26, fontSize: 11, color: accent, background: `${accent}1f`, border: `1px solid ${accent}40` }}>
                {p.n}
              </span>
              <div>
                <p className="font-body text-sm text-white font-semibold">{p.t}</p>
                <p className="font-body text-xs mt-0.5 leading-relaxed" style={{ color: "#8a948f" }}>{p.d}</p>
              </div>
            </div>
          ))}
        </div>

        <Link href={href}
          className="inline-flex items-center gap-2 font-body font-bold text-sm px-6 py-3.5 rounded-xl transition-all active:scale-95"
          style={{ background: accent, color: "#04231f", textDecoration: "none" }}>
          {cta}
        </Link>
      </div>
    </div>
  );
}

function SeasonFeatures() {
  return (
    <div className="mb-16">
      <div className="text-center mb-8">
        <h2 className="font-display text-4xl sm:text-5xl text-white mb-3">LANDING WITH THE SEASON</h2>
        <p className="font-body text-text-muted max-w-lg mx-auto">
          Two more ways to score, both opening on Friday 21 August with the first Premier League whistle of the season.
        </p>
      </div>

      <FeatureSection
        eyebrow="FANTASY · FRIDAY 21 AUGUST"
        title={<>One transfer.<br />Earn the rest.</>}
        sub="Everyone gets a move each gameweek. What you know earns you more. Opening night, with the season."
        points={FANTASY_POINTS}
        accent={TEAL}
        href="/matchweek"
        cta="See fantasy →"
      />

      <FeatureSection
        eyebrow="GAMEDAY QUIZ · FRIDAY 21 AUGUST"
        title={<>A quiz at<br />half time.</>}
        sub="Every fixture gets a pack, released the moment the referee blows for the interval. Fifteen minutes, ten questions, then the football comes back."
        points={HALFTIME_POINTS}
        accent="#aeea00"
        href="/matchweek"
        cta="See gameday →"
      />
    </div>
  );
}

export default function GamesPage() {
  const [tab, setTab] = useState<Tab>("quiz");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);

  // Reset step + FAQ when switching tabs
  const switchTab = (t: Tab) => {
    setTab(t);
    setActiveStep(0);
    setOpenFaq(null);
  };

  const game = GAMES.find((g) => g.key === tab) ?? GAMES[0];
  const steps = tab === "quiz" ? QUIZ_STEPS : tab === "draft" ? DRAFT_STEPS : null;
  const faqs  = tab === "quiz" ? QUIZ_FAQS  : tab === "draft" ? DRAFT_FAQS  : null;
  const detail = DETAIL[tab];

  useEffect(() => {
    if (!steps) return;
    const iv = setInterval(() => setActiveStep(s => (s + 1) % steps.length), 4000);
    return () => clearInterval(iv);
  }, [tab, steps]);

  // Each game owns its section colour (§5C: "not Quiz teal / 38-0 lime"), so the
  // page tints to whichever game is being read about.
  const accentColor = game.color;
  const accentRgba = [1, 3, 5].map((i) => parseInt(game.color.slice(i, i + 2), 16)).join(",");

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <style>{ANIM_CSS}</style>
      <GridBackground opacity={0.022} />
      <div className="fixed top-0 left-0 w-[600px] h-[600px] pointer-events-none" style={{ background: `radial-gradient(circle at 0% 0%, rgba(${accentRgba},0.06) 0%, transparent 60%)` }} />

      {/* Nav */}
      <nav className="relative z-10 pt-safe flex items-center justify-between px-6 py-5 max-w-4xl mx-auto">
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
        {/* Was "Draft Your XI" into 38-0. That is the retired flagship framing
            (§1.3: the five games are peers) on a page about all of them. */}
        <Link href="/play"
          className="font-body font-bold text-sm px-5 py-2.5 rounded-xl transition-all hover:opacity-90 green-pulse-glow"
          style={{ background: "#aeea00", color: "#0a0a0f" }}>
          Play a game →
        </Link>
      </nav>

      <div className="relative z-10 max-w-4xl mx-auto px-6">

        {/* Hero */}
        <div className="text-center pt-6 pb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 font-body text-xs uppercase tracking-widest text-green"
            style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#aeea00" }} />
            Five live games · Halftime Quiz and Fantasy from 21 August
          </div>
          <h1 className="font-display text-6xl sm:text-7xl text-white leading-none mb-5">
            THE<br /><span style={{ color: accentColor }}>GAMES</span>
          </h1>
          <p className="font-body text-text-muted text-lg max-w-xl mx-auto leading-relaxed">
            Five games, one score, one rank. Versus, leagues and your YourScore rank tie them together.
          </p>
        </div>

        {/* ── Tab switcher ──────────────────────────────────────────────────
            Rendered from GAMES, never hand-listed. Horizontally scrollable:
            five labels do not fit at 375px and wrapping reads as a broken
            grid. ── */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
          {GAMES.map((g) => {
            const on = g.key === tab;
            return (
              <button key={g.key} onClick={() => switchTab(g.key)}
                className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full font-body text-sm font-semibold whitespace-nowrap transition-all active:scale-95"
                style={{
                  background: on ? `${g.color}1f` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${on ? `${g.color}66` : "rgba(255,255,255,0.08)"}`,
                  color: on ? g.color : "#8a948f",
                }}>
                {g.label}
              </button>
            );
          })}
        </div>

        {/* One line on the game being read about, from the registry. */}
        <p className="font-body text-center text-text-muted mb-8">{game.blurb}</p>

        {/* Quiz and 38-0 carry enough mechanics to earn a step carousel. The
            other three say what they are and get out of the way. */}
        {steps ? (
          <>
            <StepCards steps={steps} activeStep={activeStep} setActiveStep={setActiveStep} />
            <div className="flex justify-center gap-2 mb-16">
              {steps.map((step, i) => (
                <button key={i} onClick={() => setActiveStep(i)}
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: activeStep === i ? 32 : 8, background: activeStep === i ? step.color : "rgba(255,255,255,0.15)" }} />
              ))}
            </div>
          </>
        ) : detail ? (
          <div className="rounded-3xl overflow-hidden mb-16"
            style={{ background: `linear-gradient(150deg, ${game.color}14, rgba(10,10,15,1) 60%)`, border: `1px solid ${game.color}33` }}>
            <div className="px-6 py-8 sm:px-10 sm:py-10">
              <div className="flex items-center gap-3 mb-6">
                <span className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${game.color}1f`, border: `1px solid ${game.color}40`, color: game.color }}>
                  <game.Icon active />
                </span>
                <div>
                  <p className="font-body text-xs uppercase tracking-widest" style={{ color: game.color }}>{game.label}</p>
                  <h2 className="font-display text-2xl sm:text-3xl text-white leading-tight">{detail.headline}</h2>
                </div>
              </div>
              {/* Bullets and a mock of the real screen. Two columns from sm up;
                  stacked on a phone with the picture first, because the picture
                  explains the game faster than the list does. */}
              <div className="grid sm:grid-cols-2 gap-6 sm:gap-8 items-start mb-8">
                <div className="order-2 sm:order-1 space-y-3">
                  {detail.points.map((p) => (
                    <div key={p} className="flex items-start gap-3">
                      <span className="flex-shrink-0 mt-1.5 rounded-full" style={{ width: 6, height: 6, background: game.color }} />
                      <p className="font-body text-sm sm:text-base text-white/80 leading-relaxed">{p}</p>
                    </div>
                  ))}
                </div>
                <div className="order-1 sm:order-2">{detail.visual}</div>
              </div>
              <Link href={game.href}
                className="inline-flex items-center gap-2 font-body font-bold text-base px-7 py-3.5 rounded-xl transition-all active:scale-95"
                style={{ background: game.color, color: "#0a0a0f", textDecoration: "none" }}>
                Play {game.label} →
              </Link>
            </div>
          </div>
        ) : null}

        {/* Scoring breakdown — quiz only */}
        {tab === "quiz" && (
          <div className="rounded-2xl overflow-hidden mb-14" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="px-6 py-4 bg-surface" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <h3 className="font-display text-2xl text-white">SCORING</h3>
            </div>
            <div className="bg-surface">
              {/* Top-line only (founder call): the exact bands/multipliers stay in-game. */}
              {[
                { label: "Right answer, fast", pts: "Top points", col: "#aeea00" },
                { label: "Right answer, slower", pts: "Fewer points", col: "#00d8c0" },
                { label: "Back-to-back correct", pts: "Streak bonus", col: "#aeea00" },
                { label: "Harder questions", pts: "Worth more", col: "#ff9f43" },
                { label: "Wrong or timed out", pts: "0 pts", col: "#586058" },
              ].map((row, i) => (
                <div key={row.label} className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <span className="font-body text-sm text-white/80">{row.label}</span>
                  <span className="font-display text-lg" style={{ color: row.col }}>{row.pts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 38-0 strength explainer — draft only */}
        {tab === "draft" && (
          <div className="rounded-2xl overflow-hidden mb-14" style={{ border: "1px solid rgba(174,234,0,0.15)" }}>
            <div className="px-6 py-4" style={{ background: "rgba(174,234,0,0.05)", borderBottom: "1px solid rgba(174,234,0,0.1)" }}>
              <h3 className="font-display text-2xl text-white">HOW STRENGTH WORKS</h3>
            </div>
            <div style={{ background: "#0e1611" }}>
              {[
                { label: "Player overall rating",       pts: "0–100",        col: "#aeea00" },
                { label: "Formation fit bonus",         pts: "+up to 15%",   col: "#00d8c0" },
                { label: "Balanced squad (all lines)",  pts: "+cohesion",    col: "#aeea00" },
                { label: "Win: streak reward",          pts: "1 free swap",  col: "#aeea00" },
                { label: "Unbeaten season",             pts: "38-0 badge",   col: "#00d8c0" },
              ].map((row, i) => (
                <div key={row.label} className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <span className="font-body text-sm text-white/80">{row.label}</span>
                  <span className="font-display text-lg" style={{ color: row.col }}>{row.pts}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats strip — only for the two games that have a step carousel; the
            other three already said their numbers in the panel above. */}
        {steps && (() => {
          const statsItems = tab === "quiz"
            ? [
                { n: "Daily", label: "fresh quiz, every day" },
                { n: "⏱",    label: "every question on the clock" },
                { n: "∞",     label: "points you can earn" },
              ]
            : [
                { n: "100+", label: "players to choose from" },
                { n: "11",   label: "players per team" },
                { n: "38-0", label: "the dream record" },
              ];
          return (
            <div className="grid grid-cols-3 gap-3 mb-14">
              {statsItems.map((s) => (
                <div key={s.label} className="rounded-2xl p-4 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="font-display text-3xl sm:text-4xl text-white">{s.n}</p>
                  <p className="font-body text-xs text-text-muted mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* FAQ — Quiz and 38-0 only; the other three have no questions worth a
            panel yet, and an empty accordion is worse than none. */}
        {faqs && (
        <div className="mb-14">
          <h3 className="font-display text-3xl text-white mb-5">FAQ</h3>
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            {faqs.map((faq, i) => (
              <div key={i} style={{ borderBottom: i < faqs.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left transition-all hover:opacity-80"
                  style={{ background: openFaq === i ? `rgba(${accentRgba},0.04)` : "#0e1611" }}>
                  <span className="font-body text-sm font-semibold text-white pr-4">{faq.q}</span>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                    style={{ transform: openFaq === i ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}>
                    <path d="M4 6l4 4 4-4" stroke="#8a948f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4" style={{ background: `rgba(${accentRgba},0.02)` }}>
                    <p className="font-body text-sm text-text-muted leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        )}

        {/* ── Landing with the season ───────────────────────────────────────
            Fantasy and the gameday quiz get their own sections rather than a
            tab each: neither is playable yet, so they can't sit in a tab strip
            whose other entries all say "play now". Both land on 21 Aug.

            The copy is lifted from the surfaces that already ship it, not
            reinvented: FantasyHold (matchweek → Fantasy) and HalftimeRail.
            One pitch per feature, in one voice, wherever it's read. ── */}
        <SeasonFeatures />

        {/* CTA */}
        <div className="rounded-3xl p-8 sm:p-12 text-center mb-8 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, rgba(${accentRgba},0.1) 0%, rgba(174,234,0,0.04) 100%)`, border: `1px solid rgba(${accentRgba},0.2)` }}>
          <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.015) 1px,transparent 1px)", backgroundSize: "30px 30px" }} />
          <div className="relative z-10">
            <p className="font-display text-4xl sm:text-5xl text-white mb-3">READY TO PLAY?</p>
            <p className="font-body text-text-muted mb-8">Pick a game, get a score, and start climbing.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {/* Three CTAs, two of them 38-0 and league specific. Now: play
                  whichever game you have just read about, or start a league. */}
              <Link href={game.href}
                className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-body font-bold text-base transition-all hover:opacity-90 green-pulse-glow"
                style={{ background: game.color, color: "#0a0a0f" }}>
                Play {game.label} →
              </Link>
              <Link href="/league/new"
                className="flex items-center justify-center px-8 py-4 rounded-xl font-body font-semibold text-base text-white transition-colors hover:opacity-70"
                style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                Start a league
              </Link>
            </div>
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
