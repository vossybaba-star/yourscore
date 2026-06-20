"use client";

/**
 * /38-0/wc — the World Cup game. Two player-facing modes, both an open World XI draft:
 *   World Cup Mastermind (quiz-gated) — each pick is unlocked by a timed WC question; the
 *     better you answer, the stronger the players dealt. Has Today's Run (ranked, one
 *     go/day, season board) and Practice (unranked). Deep-links: ?daily=1 / ?practice=1.
 *   World Cup Run (open draft, ?run=1) — no quiz; spin any-nation players at full quality
 *     and play the gauntlet. Not ranked, replayable.
 *
 * (National Team / nation-locked mode is retired from the UI — World XI only.)
 *
 * The chosen XI is POSTed to /api/draft/wc (start) which validates + plans the bracket and
 * returns a run id; we then go to the Road-to-the-Final screen. Server is authoritative.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { BackPill } from "@/components/ui/BackPill";
import { Pitch } from "@/components/draft/Pitch";
import { InviteMastermind } from "@/components/draft/InviteMastermind";
import { useUser } from "@/hooks/useUser";
import { pickableNations, spinForNation, spinWorld, type PickableNation } from "@/lib/draft/pool";
import { WORLD_TEAM_NAME, type RunMode } from "@/lib/draft/wc";
import { drawQuestion, type ServedQuestion } from "@/lib/draft/wc-quiz";
import { gradeAnswer, type DraftBand } from "@/lib/draft/draft-quiz";
import {
  emptyTeam, openSlots, isComplete, usedPlayerIds, usedPlayerNames, placePlayer, hydrateSavedTeam, type LocalTeam,
} from "@/lib/draft/local";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, lineRatings, posCategory, CATEGORY_COLOR } from "@/lib/draft/score";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import type { Formation, PlacedPlayer, PlayerSeason, Slot } from "@/lib/draft/types";
import { trackGamePlay } from "@/lib/analytics/trackGame";

const FORMATION = "4-3-3" as Formation; // sensible default; nation pools are deepest here
const SIGN_IN_PATH = "/38-0/wc";
const QUESTION_SECONDS = 25; // per-question clock on every draft (timeout = wrong answer)

// Persist an in-progress pick across a sign-in round-trip, so a signed-out player who
// drafts an XI lands back on the exact same team after authenticating.
type SavedDraft = { mode: RunMode; nation: string | null; formation: Formation; squad: PlacedPlayer[]; pendingEnter: boolean };
const DRAFT_KEY = "wc:draft:v1";
function saveDraft(d: SavedDraft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } }
function loadDraft(): SavedDraft | null { try { const r = localStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) as SavedDraft : null; } catch { return null; } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

export default function WorldCupEntry() {
  const router = useRouter();
  const nations = useMemo(() => pickableNations(), []);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [nation, setNation] = useState<PickableNation | null>(null);
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [slate, setSlate] = useState<PlayerSeason[] | null>(null);
  const [spunNation, setSpunNation] = useState<{ nation: string; crest?: string; era?: string } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [reel, setReel] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlayerSeason | null>(null);
  const [starting, setStarting] = useState(false);
  const [h2hBusy, setH2hBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Quiz-gated draft: each spin is unlocked by a World Cup quiz question. A correct
  // answer (and a correct STREAK) raises the quality of the players dealt; a wrong one
  // caps it. The more football you know, the stronger your XI.
  const [quiz, setQuiz] = useState<ServedQuestion | null>(null);
  const [answered, setAnswered] = useState<number | null>(null); // selected option index (locked)
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [askedCount, setAskedCount] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; streak: number } | null>(null);
  const askedIds = useRef<Set<string>>(new Set());

  // Ranked = the daily competition (one go/day, season board). It is SERVER-AUTHORITATIVE:
  // the server serves each question (no answer), grades it, and spins each pick's slate from
  // a secret seed; the client only displays + picks (see /api/draft/wc/draft). Practice is
  // unranked + fully client-side. Every draft is timed.
  const [ranked, setRanked] = useState(false);
  // Quiz-gated (Mastermind: Today's Run + Practice) vs open (World Cup Run: no quiz).
  const [quizGated, setQuizGated] = useState(true);
  const [timeLeft, setTimeLeft] = useState(QUESTION_SECONDS);
  // Ranked draft state: the server's answer-free questions, and the answers/picks we replay
  // to the server on submit so it can verify the XI was legitimately earned.
  const serverQs = useRef<{ id: string; prompt: string; options: string[]; category: string }[]>([]);
  const draftAnswers = useRef<number[]>([]);
  const draftPicks = useRef<{ slot: string; player_season_id: string }[]>([]);
  // Today's ranked attempt is locked once it's been played OR drafted past the 6th pick
  // (anti-preview). When locked, the Today's Run card is blurred + unselectable.
  const [rankedLocked, setRankedLocked] = useState(false);
  // One-day catch-up: can this user still play yesterday's (the previous) edition?
  const [catchupAvail, setCatchupAvail] = useState(false);
  const catchupRef = useRef(false); // true while drafting the catch-up (previous) edition

  const world = mode === "world";

  function resetQuiz() {
    setQuiz(null); setAnswered(null); setStreak(0); setCorrectCount(0); setAskedCount(0); setFeedback(null);
    askedIds.current = new Set();
  }

  // Begin a World XI draft. Daily = the ranked competition (server-authoritative); Practice
  // = unlimited, client-side, random back-catalogue questions. (National Team mode is hidden
  // for now — every run is World XI.)
  function beginDraft(rankedRun: boolean, gated: boolean = true) {
    setRanked(rankedRun);
    setQuizGated(gated);
    setMode("world"); setNation(null); setSlate(null); setSelected(null); setReel(null); resetQuiz();
    setTeam(emptyTeam(FORMATION));
    draftAnswers.current = []; draftPicks.current = []; serverQs.current = [];
    if (rankedRun) void loadRankedQuestions();
  }

  // Ranked: pull today's questions from the server WITHOUT answers (the server grades them
  // and spins each slate). The run isn't created until submit, so this is safe pre-sign-in.
  async function loadRankedQuestions() {
    try {
      const res = await fetch("/api/draft/wc/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", catchup: catchupRef.current }) });
      const data = await res.json();
      if (data.locked) { if (catchupRef.current) setCatchupAvail(false); else setRankedLocked(true); setMode(null); setError(data.error ?? "You've already used that ranked run."); return; }
      if (res.ok && Array.isArray(data.questions)) serverQs.current = data.questions;
      else setError(data.error ?? "Couldn't load the questions — refresh and retry.");
    } catch { setError("Couldn't load the questions — refresh and retry."); }
  }

  // Today's Run is a logged-in competition (it feeds the board + Rank), and the server draft
  // verifies against the signed-in run. Require sign-in up front, returning here to start.
  // `isCatchup` plays the immediately-previous edition (one-day catch-up) instead.
  function startRanked(isCatchup = false) {
    if (isCatchup ? !catchupAvail : rankedLocked) return;
    catchupRef.current = isCatchup;
    if (!user) { router.push(`/auth/sign-in?next=${encodeURIComponent(`/38-0/wc?${isCatchup ? "catchup" : "daily"}=1`)}`); return; }
    beginDraft(true);
  }

  // World Cup Run — the open, no-quiz draft. Spin any-nation players at full quality and
  // play the gauntlet; not ranked, not gated, replayable.
  function beginRun() { beginDraft(false, false); }

  // National Team mode is hidden in the UI for now (World XI only), but the flow is kept
  // intact behind this helper so it can be re-enabled without a rebuild.
  function chooseNation(n: PickableNation) {
    setNation(n); setRanked(false);
    setTeam(emptyTeam(FORMATION));
    setSlate(null); setSelected(null); setReel(null); resetQuiz();
  }

  // Tap SCOUT → answer a quiz question first (timed). Ranked pulls the next server question
  // (no answer); practice draws at random. Empty pool → a neutral spin so it never dead-ends.
  function startSpin() {
    if (!team || spinning || quiz) return;
    setFeedback(null);
    // World Cup Run (open draft) has no quiz gate — spin straight away at full quality.
    if (!quizGated) { runSpin({ minOverall: 0, maxOverall: 99 }); return; }
    if (ranked) {
      const sq = serverQs.current[draftAnswers.current.length];
      if (!sq) { setError("Couldn't load today's questions — refresh and retry."); return; }
      setQuiz({ id: sq.id, prompt: sq.prompt, options: sq.options, correctIndex: -1, category: sq.category });
      setAnswered(null); setTimeLeft(QUESTION_SECONDS);
      return;
    }
    const q = drawQuestion(Math.random, askedIds.current);
    if (!q) { runSpin({ minOverall: 0, maxOverall: 99 }); return; }
    setQuiz(q); setAnswered(null); setTimeLeft(QUESTION_SECONDS);
  }

  // Lock the answer, grade it, reveal correct/wrong briefly, then spin the earned slate.
  function answerQuiz(idx: number) {
    if (!quiz || answered !== null) return;
    setAnswered(idx);
    if (ranked) { void answerRanked(idx); return; }
    // Practice: graded + spun fully client-side (no integrity needs — not ranked).
    const correct = idx === quiz.correctIndex;
    const { streak: newStreak, band } = gradeAnswer(streak, correct);
    askedIds.current.add(quiz.id);
    setStreak(newStreak);
    setAskedCount((n) => n + 1);
    if (correct) setCorrectCount((n) => n + 1);
    setFeedback({ correct, streak: newStreak });
    setTimeout(() => { setQuiz(null); setAnswered(null); runSpin(band); }, 900);
  }

  // Ranked: the server grades the answer and returns the earned slate (it spins from a secret
  // seed). We reveal the correct option only AFTER answering, and never learn the slate's seed.
  async function answerRanked(idx: number) {
    const i = draftAnswers.current.length;
    const answers = [...draftAnswers.current, idx];
    try {
      const res = await fetch("/api/draft/wc/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "slate", i, answers, picks: draftPicks.current, catchup: catchupRef.current }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Couldn't load your pick — try again."); setAnswered(null); return; }
      draftAnswers.current = answers;
      const newStreak = data.correct ? streak + 1 : 0;
      setStreak(newStreak);
      setAskedCount((n) => n + 1);
      if (data.correct) setCorrectCount((n) => n + 1);
      setQuiz((q) => (q ? { ...q, correctIndex: data.correctIndex } : q)); // reveal now (post-answer)
      setFeedback({ correct: data.correct, streak: newStreak });
      const players = (data.players ?? []) as PlayerSeason[];
      const spun = data.nation ? { nation: data.nation as string, crest: data.crest as string | undefined, era: data.era as string | undefined } : null;
      setTimeout(() => { setQuiz(null); setAnswered(null); revealSlate(players, spun); }, 900);
    } catch { setError("Network error — try again."); setAnswered(null); }
  }

  function runSpin(band: DraftBand) {
    if (!team || (mode === "nation" && !nation)) return;
    const open = openSlots(team).map((s) => s.pos);
    // The quiz band shapes quality; within it the spin is still luck. World mode lands on
    // ONE nation; nation mode is locked to the chosen nation.
    let players: PlayerSeason[];
    let spun: { nation: string; crest?: string; era?: string } | null = null;
    if (world) {
      const sp = spinWorld(open, usedPlayerIds(team), usedPlayerNames(team), { count: 6, minOverall: band.minOverall, maxOverall: band.maxOverall });
      players = sp.players;
      spun = { nation: sp.nation, crest: sp.crest, era: sp.era };
    } else {
      players = spinForNation(nation!.nation, open, usedPlayerIds(team), usedPlayerNames(team), { count: 6, minOverall: band.minOverall, maxOverall: band.maxOverall });
    }
    revealSlate(players, spun);
  }

  // The slot-machine reveal over a slate (shared by the client spin and the ranked server slate).
  function revealSlate(players: PlayerSeason[], spun: { nation: string; crest?: string; era?: string } | null) {
    setSpinning(true); setSlate(null); setSelected(null); setSpunNation(null);
    let ticks = 0;
    reelTimer.current = setInterval(() => {
      setReel(players.length ? players[Math.floor(Math.random() * players.length)].name : "—");
      if (++ticks > 11) {
        if (reelTimer.current) clearInterval(reelTimer.current);
        setReel(null);
        setSlate(players);
        if (spun) setSpunNation(spun);
        setSpinning(false);
      }
    }, 70);
  }

  function placeAt(slot: Slot) {
    if (!team || !selected) return;
    // Ranked: record the pick in placement order so the server can replay + verify on submit.
    if (ranked) draftPicks.current = [...draftPicks.current, { slot: slot.id, player_season_id: selected.id }];
    const next = placePlayer(team, selected, slot);
    setTeam(next); setSlate(null); setSelected(null);
  }

  // Per-question 25s clock. Hitting zero locks in a timeout as a wrong answer (idx -1),
  // so you can't sit on a question looking the answer up.
  useEffect(() => {
    if (!quiz || answered !== null) return;
    if (timeLeft <= 0) { answerQuiz(-1); return; }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz, answered, timeLeft]);

  const { user, loading: authLoading } = useUser();

  // Is today's ranked attempt already used (played, or drafted past pick 6)? Blurs the card.
  useEffect(() => {
    if (!user) { setRankedLocked(false); setCatchupAvail(false); return; }
    let off = false;
    (async () => {
      try {
        const res = await fetch("/api/draft/wc/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
        const data = await res.json();
        if (off) return;
        if (data?.lockedToday) setRankedLocked(true);
        if (data?.catchup?.available) setCatchupAvail(true);
      } catch { /* leave unlocked; the begin call still guards */ }
    })();
    return () => { off = true; };
  }, [user]);

  // Submit a finished XI. If the player isn't signed in, save the pick and send them
  // to sign-in with a return path; we resume automatically when they come back.
  async function enter(runMode: RunMode, nationName: string, formation: Formation, squad: PlacedPlayer[]) {
    setStarting(true); setError(null);
    try {
      const res = await fetch("/api/draft/wc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Ranked submits the answers + picks for the server to replay & verify (it rebuilds
        // the XI itself). Practice/open submit the client-built squad.
        body: JSON.stringify(ranked
          ? { action: "start", ranked: true, catchup: catchupRef.current, answers: draftAnswers.current, picks: draftPicks.current }
          : { action: "start", mode: runMode, nation: nationName, formation, squad, ranked: false }),
      });
      if (res.status === 401) {
        saveDraft({ mode: runMode, nation: runMode === "world" ? null : nationName, formation, squad, pendingEnter: true });
        router.push(`/auth/sign-in?next=${encodeURIComponent(SIGN_IN_PATH)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      // Already played today's ranked run → take them to that run (their result stands).
      if (res.status === 409) {
        clearDraft();
        if (data.runId) { router.push(`/38-0/wc/run/${data.runId}`); return; }
        setError(data.error ?? "You've already played today's ranked run."); setStarting(false); return;
      }
      if (!res.ok) { setError(data.error ?? "Could not start"); setStarting(false); return; }
      clearDraft();
      trackGamePlay("38-0", { mode: ranked ? "world_cup_daily" : quizGated ? "world_cup_open" : "world_cup_run" });
      router.push(`/38-0/wc/run/${data.runId}`);
    } catch {
      setError("Network error — try again."); setStarting(false);
    }
  }

  function start() {
    if (!team || !mode || !isComplete(team) || starting) return;
    if (mode === "nation" && !nation) return;
    enter(mode, mode === "world" ? WORLD_TEAM_NAME : nation!.nation, team.formation, team.squad);
  }

  // Take this finished XI straight into the World Cup H2H lane instead of a campaign:
  // save it as the active WC team (competition="WC", its own board) and go to /wc/h2h.
  async function playH2H() {
    if (!team || !isComplete(team) || h2hBusy) return;
    setH2hBusy(true); setError(null);
    try {
      const res = await fetch("/api/draft/team", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competition: "WC", formation: team.formation,
          squad: team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id })),
        }),
      });
      if (res.status === 401) {
        saveDraft({ mode: mode!, nation: world ? null : (nation?.nation ?? null), formation: team.formation, squad: team.squad, pendingEnter: false });
        router.push(`/auth/sign-in?next=${encodeURIComponent("/38-0/wc/h2h")}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Couldn't ready your squad for H2H"); setH2hBusy(false); return; }
      router.push("/38-0/wc/h2h");
    } catch { setError("Network error — try again."); setH2hBusy(false); }
  }

  // On load: (1) restore a saved draft; (2) auto-select nation from ?nation= query param;
  // (3) if the player was mid-"enter" and is now signed in, resume automatically.
  useEffect(() => {
    if (authLoading) return;
    const d = loadDraft();
    if (d) {
      if (!mode) {
        setMode(d.mode);
        if (d.mode === "world") {
          setTeam(hydrateSavedTeam(d.formation, d.squad));
        } else {
          const n = nations.find((x) => x.nation === d.nation);
          if (n) { setNation(n); setTeam(hydrateSavedTeam(d.formation, d.squad)); }
        }
      }
      if (d.pendingEnter && user) {
        saveDraft({ ...d, pendingEnter: false });
        enter(d.mode, d.mode === "world" ? WORLD_TEAM_NAME : (d.nation ?? ""), d.formation, d.squad);
      }
      return;
    }
    // No saved draft — honour deep-link params: ?daily=1 → today's ranked run; otherwise
    // (?mode=world / ?practice=1) → a practice run. (Nation deep-links are retired while
    // National Team mode is hidden.)
    const params = new URLSearchParams(window.location.search);
    if (!mode && params.get("daily") === "1") { startRanked(false); return; }
    if (!mode && params.get("catchup") === "1") { startRanked(true); return; }
    if (!mode && params.get("run") === "1") { beginRun(); return; }
    if (!mode && (params.get("mode") === "world" || params.get("practice") === "1")) { beginDraft(false); return; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, nations]);

  // ── Mode picker ───────────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4"><BackPill href="/38-0" label="Back" tone="wc" /></div>
          <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 30, color: "#fff" }}>🧠 WORLD CUP MASTERMIND</h1>
          <p className="font-body mt-1 mb-4" style={{ fontSize: 14, color: "#c4ccc6" }}>
            Answer World Cup questions to build your XI — the more you know, the stronger your team — then play the tournament. Today&apos;s Run is ranked; Just Play is unlimited practice.
          </p>

          <div className="flex flex-col gap-3 mb-5">
            {/* Today's Run (ranked). Locked once it's been played or drafted past pick 6. */}
            <button onClick={() => startRanked()} disabled={rankedLocked} aria-disabled={rankedLocked}
              className="text-left rounded-2xl p-4 active:scale-[0.99] transition-transform disabled:active:scale-100"
              style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.45)", opacity: rankedLocked ? 0.5 : 1, filter: rankedLocked ? "grayscale(0.6)" : "none", cursor: rankedLocked ? "not-allowed" : "pointer" }}>
              <div className="flex items-center gap-2.5 mb-1">
                <span style={{ fontSize: 22 }}>🏆</span>
                <span className="font-display tracking-wide" style={{ fontSize: 20, color: "#ffb800" }}>TODAY&apos;S RUN</span>
                <span className="font-body rounded-full px-2 py-0.5" style={{ fontSize: 10, color: "#1a1300", background: "#ffb800", letterSpacing: 0.5 }}>{rankedLocked ? "PLAYED" : "RANKED"}</span>
              </div>
              <div className="font-body" style={{ fontSize: 13, color: "#c4ccc6", lineHeight: 1.4 }}>
                {rankedLocked
                  ? <>You&apos;ve used today&apos;s ranked run. <b style={{ color: "#fff" }}>Come back tomorrow</b> for a fresh draft — or Just Play below.</>
                  : <>One go a day. Today&apos;s questions, on the clock. Your result <b style={{ color: "#fff" }}>climbs the season board</b> — get closest to 8-0-0.</>}
              </div>
            </button>

            {/* One-day catch-up — only shows if you missed the previous edition. Counts. */}
            {catchupAvail && (
              <button onClick={() => startRanked(true)} className="text-left rounded-2xl p-4 active:scale-[0.99] transition-transform"
                style={{ background: "#0e1611", border: "1px dashed rgba(255,184,0,0.45)" }}>
                <div className="flex items-center gap-2.5 mb-1">
                  <span style={{ fontSize: 22 }}>🕑</span>
                  <span className="font-display tracking-wide" style={{ fontSize: 18, color: "#ffd27a" }}>CATCH UP</span>
                  <span className="font-body rounded-full px-2 py-0.5" style={{ fontSize: 10, color: "#1a1300", background: "#ffb800", letterSpacing: 0.5 }}>RANKED</span>
                </div>
                <div className="font-body" style={{ fontSize: 13, color: "#c4ccc6", lineHeight: 1.4 }}>
                  Missed yesterday? <b style={{ color: "#fff" }}>Play it once</b> to bank the points. Available until the next run is posted.
                </div>
              </button>
            )}

            {/* Just Play — unlimited, doesn't count towards the board. */}
            <button onClick={() => beginDraft(false)} className="text-left rounded-2xl p-4 active:scale-[0.99] transition-transform"
              style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.22)" }}>
              <div className="flex items-center gap-2.5 mb-1">
                <span style={{ fontSize: 22 }}>🎯</span>
                <span className="font-display tracking-wide" style={{ fontSize: 20, color: "#ffd27a" }}>JUST PLAY</span>
              </div>
              <div className="font-body" style={{ fontSize: 13, color: "#c4ccc6", lineHeight: 1.4 }}>
                Build and play as many World Cups as you like. <b style={{ color: "#fff" }}>Doesn&apos;t count towards the board</b> — pure practice.
              </div>
            </button>

            <Button variant="ghost" size="md" fullWidth href="/38-0/wc/board">
              🏅 World Cup season board →
            </Button>

            <InviteMastermind />
          </div>

          {/* How it works (Mastermind — the ranked daily loop) */}
          <div className="rounded-2xl p-4" style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.3)" }}>
            <div className="font-body mb-2.5" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 1 }}>HOW MASTERMIND WORKS</div>
            {[
              ["①", "Answer to draft", "Each pick is unlocked by a question on a 25s clock — right answers (and streaks) deal stronger players."],
              ["②", "Play the World Cup", "A group, then the knockouts — vs real nations, tougher each round."],
              ["③", "Group on the line", "4 pts go through; level on 3 → one sudden-death question to qualify; less and you're out."],
              ["④", "Go for 8-0-0 🏆", "Knockout losses end your run. Win them all and you're champions."],
            ].map(([n, title, desc]) => (
              <div key={n as string} className="flex gap-3 mb-2.5 last:mb-0">
                <span className="font-display flex-shrink-0" style={{ fontSize: 18, color: "#ffb800" }}>{n}</span>
                <div>
                  <div className="font-body" style={{ fontSize: 13.5, color: "#fff" }}>{title}</div>
                  <div className="font-body" style={{ fontSize: 12, color: "#8a948f", lineHeight: 1.35 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Nation picker (nation mode only) ──────────────────────────────────────
  if (mode === "nation" && (!nation || !team)) {
    return (
      <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-4 pt-safe">
          <div className="pt-4"><button onClick={() => setMode(null)} className="font-body text-sm" style={{ color: "#8a948f" }}>← Change mode</button></div>
          <h1 className="font-display tracking-wide mt-3" style={{ fontSize: 28, color: "#fff" }}>PICK YOUR NATION</h1>
          <p className="font-body mt-1 mb-4" style={{ fontSize: 13, color: "#8a948f" }}>
            Build an XI from their players only and play their real World Cup 2026 path.
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {nations.map((n) => (
              <button key={n.nation} onClick={() => chooseNation(n)}
                className="flex items-center gap-3 rounded-2xl px-3 py-3 text-left active:scale-[0.98] transition-transform"
                style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={n.crest} alt={n.nation} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain" }} />
                <div className="min-w-0">
                  <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{n.nation}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!team) return null;

  // ── Draft (both modes) ────────────────────────────────────────────────────
  const teamName = world ? WORLD_TEAM_NAME : nation!.nation;
  const teamCrest = world ? null : nation!.crest;
  const remaining = 11 - team.squad.length;
  const lines = lineRatings(team.squad);
  const slots = slotsFor(team.formation);
  const filledBySlot = new Map(team.squad.map((p) => [p.slot, p]));
  const available = selected ? slots.filter((s) => !filledBySlot.has(s.id) && canPlay(selected.position, s.pos)) : [];
  const scoutLabel = world ? "🌍 SCOUT THE WORLD" : `🎰 SCOUT ${teamName.toUpperCase()}`;

  return (
    <div className="min-h-[100dvh] pb-44" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-4">
          <button onClick={() => (world ? setMode(null) : setNation(null))} className="font-body text-sm" style={{ color: "#8a948f" }}>
            {world ? "← Change mode" : "← Change nation"}
          </button>
        </div>
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2.5">
            {teamCrest ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={teamCrest} alt={teamName} width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 36, lineHeight: 1 }}>🌍</span>
            )}
            <div>
              <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>YOUR {teamName.toUpperCase()}{world ? "" : " XI"}</div>
              <div className="font-display tracking-wide" style={{ fontSize: 22, color: "#fff" }}>{team.formation}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-body" style={{ fontSize: 11, color: "#8a948f", letterSpacing: 1 }}>OVERALL</div>
            <div className="font-display" style={{ fontSize: 38, lineHeight: 1, color: "#aeea00" }}>{team.squad.length ? team.strength : "—"}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 mb-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(team.squad.length / 11) * 100}%`, background: "#aeea00" }} />
          </div>
          <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>{team.squad.length}/11</span>
        </div>

        {askedCount > 0 && (
          <div className="flex items-center justify-between rounded-xl px-3 py-2 mb-3" style={{ background: "#12121e", border: `1px solid ${streak >= 2 ? "rgba(255,184,0,0.35)" : "rgba(255,255,255,0.07)"}` }}>
            <span className="font-body" style={{ fontSize: 12, color: "#8a948f" }}>
              Knowledge <b style={{ color: "#fff" }}>{correctCount}/{askedCount}</b> correct
            </span>
            <span className="font-display tracking-wide" style={{ fontSize: 13, color: streak >= 2 ? "#ffb800" : streak === 1 ? "#aeea00" : "#8a948f" }}>
              {streak >= 2 ? `🔥 STREAK ×${streak}` : streak === 1 ? "✓ ON A ROLL" : "STREAK RESET"}
            </span>
          </div>
        )}

        <Pitch formation={team.formation} squad={team.squad} compact />

        {team.squad.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-3">
            {([["ATT", lines.attack, "att"], ["MID", lines.midfield, "mid"], ["DEF", lines.defence, "def"], ["GK", lines.gk, "gk"]] as const).map(([label, val, cat]) => (
              <div key={label} className="rounded-xl px-2 py-2 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 20, color: val ? CATEGORY_COLOR[cat] : "#444" }}>{val || "—"}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8a948f", letterSpacing: 1 }}>{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0" style={{ background: "linear-gradient(0deg,#0a0a0f 78%,transparent)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 14px)" }}>
        <div className="max-w-lg mx-auto px-4 pt-3">
          {spinning && (
            <div className="mb-3 flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "#0e1611", border: "1px solid rgba(255,184,0,0.4)" }}>
              {teamCrest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={teamCrest} alt="" width={40} height={40} style={{ width: 40, height: 40, objectFit: "contain", opacity: 0.85 }} />
              ) : (
                <span style={{ fontSize: 34 }}>🌍</span>
              )}
              <div className="font-display tracking-wide truncate" style={{ fontSize: 22, color: "#ffb800" }}>{reel ?? "Scouting…"}</div>
            </div>
          )}

          {selected && (
            <div className="mb-3 rounded-2xl p-3" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.3)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-body" style={{ fontSize: 14, color: "#fff" }}>Place <b style={{ color: "#aeea00" }}>{selected.name}</b></span>
                <button onClick={() => setSelected(null)} className="font-body" style={{ fontSize: 13, color: "#8a948f" }}>Cancel</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {available.map((s) => (
                  <button key={s.id} onClick={() => placeAt(s)} className="rounded-lg px-3 py-2 font-display tracking-wide active:scale-95 transition-transform"
                    style={{ fontSize: 14, color: "#0a0a0f", background: CATEGORY_COLOR[posCategory(s.pos)] }}>{s.label}</button>
                ))}
                {available.length === 0 && <span className="font-body" style={{ fontSize: 12, color: "#ff8a3d" }}>No open slot fits — pick another player.</span>}
              </div>
            </div>
          )}

          {slate && !spinning && !selected && (
            <div className="mb-3 rounded-2xl overflow-hidden" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)", maxHeight: 320, overflowY: "auto" }}>
              {world && spunNation ? (
                <div className="flex items-center gap-2 px-3 py-2.5 sticky top-0" style={{ background: "#080d0a", borderBottom: "1px solid rgba(255,184,0,0.25)" }}>
                  {spunNation.crest && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={spunNation.crest} alt="" width={26} height={26} style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <span className="font-display tracking-wide" style={{ fontSize: 17, color: "#ffb800" }}>{spunNation.nation}</span>
                  {spunNation.era && <span className="font-display tracking-wide" style={{ fontSize: 13, color: "#cdb98a" }}>{spunNation.era}</span>}
                  <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>· pick a player</span>
                </div>
              ) : (
                <div className="px-3 py-2 font-body sticky top-0" style={{ fontSize: 11, color: "#8a948f", background: "#080d0a" }}>Pick a player → choose their slot</div>
              )}
              {slate.map((p) => {
                const c = CATEGORY_COLOR[posCategory(p.position)];
                const elig = slots.some((s) => !filledBySlot.has(s.id) && canPlay(p.position, s.pos));
                // Nation mode: every player shares the chosen nation → show the club badge.
                // World mode: the whole slate is one nation (shown in the header), so no per-row badge.
                const rightImg = world ? null : getTeamBadgeUrlSync(p.club);
                return (
                  <button key={p.id} onClick={() => elig && setSelected(p)} disabled={!elig}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: elig ? 1 : 0.4 }}>
                    <div className="flex items-center justify-center rounded-lg font-display flex-shrink-0" style={{ width: 38, height: 38, fontSize: 18, color: "#0a0a0f", background: c }}>{p.overall}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-body truncate" style={{ fontSize: 14, color: "#fff" }}>{p.name} <span style={{ color: "#8a948f", fontSize: 12 }}>{p.club} {p.season}</span></div>
                    </div>
                    {rightImg && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rightImg} alt="" width={22} height={22} style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
                    )}
                    <span className="rounded px-1.5 py-0.5 font-body flex-shrink-0" style={{ fontSize: 9, color: c, background: "rgba(255,255,255,0.06)" }}>{p.position}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error && <div className="mb-2 font-body text-center" style={{ fontSize: 13, color: "#ff8a3d" }}>{error}</div>}

          {remaining > 0 ? (
            !slate || spinning ? (
              <Button variant="primary" tone="lime" size="md" fullWidth onClick={startSpin} disabled={spinning || !!quiz}>
                {spinning ? "SCOUTING…" : scoutLabel}
              </Button>
            ) : (
              <div className="text-center font-body py-2" style={{ fontSize: 13, color: "#8a948f" }}>Draft a player to continue</div>
            )
          ) : (
            <>
              <Button variant="primary" tone="lime" size="md" fullWidth onClick={start} disabled={starting || h2hBusy}>
                {starting ? "STARTING…" : ranked ? "PLAY YOUR DRAFT →" : "ENTER THE WORLD CUP →"}
              </Button>
              {/* Practice runs can flip the finished XI into the H2H lane; the ranked daily
                  is a committed one-go, so it doesn't offer the detour. */}
              {!ranked && (
                <Button variant="ghost" size="md" fullWidth className="mt-2" onClick={playH2H} disabled={starting || h2hBusy}>
                  {h2hBusy ? "READYING…" : "⚔️ PLAY H2H INSTEAD"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {quiz && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }}>
          <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 pb-8" style={{ background: "#13131c", border: "1px solid rgba(255,184,0,0.3)" }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display tracking-wide" style={{ fontSize: 13, color: "#ffb800" }}>⚽ ANSWER TO SCOUT</span>
              <span className="font-body" style={{ fontSize: 11, color: "#8a948f" }}>
                {streak >= 1 ? `🔥 Streak ×${streak} — keep it going` : "Get it right for better players"}
              </span>
            </div>
            {answered === null && (
              <div className="mb-3">
                <div className="flex items-center justify-end mb-1">
                  <span className="font-display tabular-nums" style={{ fontSize: 12, color: timeLeft <= 5 ? "#ff4757" : "#ffb800" }}>⏱ {timeLeft}s</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(timeLeft / QUESTION_SECONDS) * 100}%`, background: timeLeft <= 5 ? "#ff4757" : "#ffb800", transition: "width 1s linear" }} />
                </div>
              </div>
            )}
            <p className="font-body mb-4" style={{ fontSize: 16, color: "#fff", lineHeight: 1.35 }}>{quiz.prompt}</p>
            <div className="flex flex-col gap-2">
              {quiz.options.map((opt, i) => {
                const locked = answered !== null;
                const isCorrect = i === quiz.correctIndex;
                const isPicked = i === answered;
                const bg = locked
                  ? isCorrect ? "rgba(0,255,135,0.16)" : isPicked ? "rgba(255,71,87,0.16)" : "rgba(255,255,255,0.04)"
                  : "rgba(255,255,255,0.05)";
                const border = locked
                  ? isCorrect ? "rgba(0,255,135,0.6)" : isPicked ? "rgba(255,71,87,0.6)" : "rgba(255,255,255,0.08)"
                  : "rgba(255,255,255,0.12)";
                return (
                  <button key={i} onClick={() => answerQuiz(i)} disabled={locked}
                    className="w-full text-left rounded-xl px-4 py-3 font-body active:scale-[0.99] transition-transform"
                    style={{ background: bg, border: `1px solid ${border}`, color: "#fff", fontSize: 15 }}>
                    {opt}
                    {locked && isCorrect && <span style={{ color: "#00ff87" }}> ✓</span>}
                    {locked && isPicked && !isCorrect && <span style={{ color: "#ff7a88" }}> ✗</span>}
                  </button>
                );
              })}
            </div>
            {feedback && (
              <p className="mt-3 text-center font-body" style={{ fontSize: 13, color: feedback.correct ? "#00ff87" : "#ff8a3d" }}>
                {feedback.correct
                  ? feedback.streak >= 2 ? `🔥 Correct — streak ×${feedback.streak}! Elite players unlocked.` : "✅ Correct — strong players unlocked."
                  : "❌ Not quite — a thinner pool this pick. Streak reset."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
