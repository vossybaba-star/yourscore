"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { AnswerButtons } from "@/components/game/AnswerButtons";
import { useGameLoop } from "@/lib/useGameLoop";
import {
  scoreAnswer,
  H2H_QUESTION_WINDOW_MS,
} from "@/lib/scoring";
import {
  DIFFICULTY_COLOR as DIFF_COLOR,
  DIFFICULTY_BG as DIFF_BG,
} from "@/lib/theme";
import { trackChallengeCompletedViewed, trackChallengeShared } from "@/lib/analytics/trackSocial";

// ── Types ─────────────────────────────────────────────────────────────────

interface H2HChallenge {
  id: string;
  quiz_pack_id: string;
  quiz_pack_name: string;
  challenger_id: string;
  challenger_name: string;
  challenger_score: number;
  challenger_correct: number;
  total_questions: number;
  max_score: number;
  opponent_id: string | null;
  opponent_score: number | null;
  opponent_correct: number | null;
  challenger_answers: { letter: Letter | null; correct: boolean }[] | null;
  opponent_answers: { letter: Letter | null; correct: boolean }[] | null;
  created_at: string;
  expires_at: string;
  /** Phase 3B — 'scorecard' (default, the whole page above this comment was
   *  written for) or 'duel' (Quiz Duel: neither side had played at creation —
   *  see the new duel_* states below). */
  mode?: string;
  /** Phase 3B, duel only — the sender is known at creation even though they
   *  haven't played yet (challenger_score/correct/answers ARE null pre-play
   *  for a duel — do not read them as 0/empty). */
  invited_user_id?: string | null;
}

interface RawQuestion {
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: string;
  difficulty: string;
  category: string;
}

interface AnswerRecord {
  idx: number;
  selected: Letter;
  correct: boolean;
  points: number;
  elapsed_ms: number;
}

type Letter = "A" | "B" | "C" | "D";

type PageState =
  | "loading"
  | "not_found"
  | "own_challenge"
  | "results"
  | "ready_to_play"
  | "sign_in_needed"
  | "playing"
  // Phase 3B — Quiz Duel only; everything above is the scorecard flow,
  // untouched. "results" above IS reused for a completed duel (see the load
  // effect) — the score comparison UI doesn't care which mode built the row.
  | "duel_not_participant"
  | "duel_intro"
  | "duel_waiting";

function timerColor(ms: number): string {
  if (ms < 5_000) return "#aeea00";
  if (ms < 10_000) return "#ffb800";
  return "#ff4757";
}

function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

// One player's pick for a question in the reveal — green if right, red if wrong.
function PickChip({ name, pick }: { name: string; pick?: { letter: string | null; correct: boolean } }) {
  const ok = !!pick?.correct;
  return (
    <div className="flex-1 rounded-lg px-2.5 py-1.5 min-w-0" style={{ background: ok ? "rgba(174,234,0,0.09)" : "rgba(255,107,120,0.09)", border: `1px solid ${ok ? "rgba(174,234,0,0.28)" : "rgba(255,107,120,0.28)"}` }}>
      <p className="font-body text-[10px] truncate" style={{ color: "#8a948f" }}>{name}</p>
      <p className="font-body text-xs font-semibold" style={{ color: ok ? "#aeea00" : "#ff6b78" }}>{pick?.letter ?? "—"} {ok ? "✓" : "✗"}</p>
    </div>
  );
}


// ── Share card helper ──────────────────────────────────────────────────────

function ShareCard({ challenge }: { challenge: H2HChallenge }) {
  const [copied, setCopied] = useState(false);

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/h2h/${challenge.id}`
      : `/h2h/${challenge.id}`;

  const waText = encodeURIComponent(
    `I scored ${challenge.challenger_score.toLocaleString()} on "${challenge.quiz_pack_name}" — can you beat it? ${link}`
  );

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
      <div className="rounded-xl px-3 py-2.5 font-body text-xs break-all"
        style={{ background: "#0a0a0f", border: "1px solid rgba(255,255,255,0.08)", color: "#8a948f" }}>
        {link}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform"
          style={{
            background: copied ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.07)",
            border: copied ? "1px solid rgba(174,234,0,0.4)" : "1px solid rgba(255,255,255,0.1)",
            color: copied ? "#aeea00" : "#9aa39d",
          }}
        >
          {copied ? "✓ COPIED" : "COPY LINK"}
        </button>
        <a
          href={`https://wa.me/?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest text-center active:scale-[0.97] transition-transform"
          style={{
            background: "rgba(37,211,102,0.12)",
            border: "1px solid rgba(37,211,102,0.3)",
            color: "#25d366",
          }}
        >
          WHATSAPP
        </a>
      </div>
    </div>
  );
}

// ── Avatar initial ─────────────────────────────────────────────────────────

function Avatar({ name, color, size = 48 }: { name: string; color: string; size?: number }) {
  return (
    <div
      className="flex items-center justify-center font-display text-lg font-bold rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: `${color}20`,
        border: `2px solid ${color}40`,
        color,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function H2HPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [pageState, setPageState] = useState<PageState>("loading");
  const [challenge, setChallenge] = useState<H2HChallenge | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [opponentName, setOpponentName] = useState<string>("You");

  // Quiz engine state
  const [questions, setQuestions] = useState<RawQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [score, setScore] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [advancing, setAdvancing] = useState(false);

  // Phase 3B — the viewer's OWN duel score, once they've played and are
  // waiting on the other side (h2h_challenges itself stays null pre-
  // completion for a duel, so this comes from h2h_duel_attempts instead).
  const [duelOwnScore, setDuelOwnScore] = useState<{ score: number; correct: number } | null>(null);

  // Phase 3E — the league-mate challenge (if any) this h2h belongs to, for
  // the results action row's "Back to the league" link. Null for a plain
  // Versus h2h (no member_challenges row at all) OR when the viewer isn't
  // one of the two participants — either way, no action beyond Share. See
  // challengeByH2h's own doc (challenges.ts) for the participant gating.
  const [leagueLink, setLeagueLink] = useState<{ leagueCode: string; gameType: string } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Timer — count-up question timer shared with the solo loop (see useGameLoop).
  const { timerMs, setTimerMs, questionStartRef, stopTimer } = useGameLoop(
    pageState === "playing",
    currentIdx,
  );

  // ── Initial load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;

    const supabase = createClient();

    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      const uid: string | null = userData.user?.id ?? null;
      setUserId(uid);

      if (uid) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("id", uid)
          .single();
        setOpponentName(profile?.display_name ?? "You");
      }

      const { data: chRow } = await supabase
        .from("h2h_challenges")
        .select("*")
        .eq("id", id)
        .single();

      if (!chRow) {
        setPageState("not_found");
        return;
      }

      const ch = chRow as unknown as H2HChallenge;

      // Check expiry
      if (new Date(ch.expires_at) < new Date()) {
        setPageState("not_found");
        return;
      }

      setChallenge(ch);

      // ── Quiz Duel (Phase 3B) — a separate branch from the scorecard flow
      // below. Completed (opponent_score !== null, set only once BOTH sides'
      // h2h_duel_attempts rows are copied across — see /api/h2h/play) reuses
      // the SAME "results" state/render as scorecard: a finished duel is just
      // a challenger/opponent score comparison, same UI, no duplication.
      if (ch.mode === "duel") {
        if (ch.opponent_score !== null) {
          setPageState("results");
          if (ch.challenger_answers && ch.opponent_answers) {
            const { data: pack } = await supabase
              .from("quiz_packs").select("questions").eq("id", ch.quiz_pack_id).single();
            if (pack?.questions) setQuestions(pack.questions as unknown as RawQuestion[]);
          }
          return;
        }
        const isParticipant = !!uid && (uid === ch.challenger_id || uid === ch.invited_user_id);
        if (!isParticipant) {
          // Not completed AND not a participant — nothing to show. h2h_challenges
          // is public-read, but a duel's scores stay null until both sides
          // finish, so there's genuinely nothing to leak here either way.
          setPageState("duel_not_participant");
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: ownAttempt } = await (supabase as any)
          .from("h2h_duel_attempts")
          .select("score, correct_count")
          .eq("h2h_id", id)
          .eq("user_id", uid)
          .maybeSingle();
        if (ownAttempt) {
          setDuelOwnScore({ score: ownAttempt.score, correct: ownAttempt.correct_count });
          setPageState("duel_waiting");
        } else {
          setPageState("duel_intro");
        }
        return;
      }

      // ── Scorecard (quiz_battle / gameday_quiz) — unchanged from before Phase 3B.
      if (ch.opponent_score !== null) {
        setPageState("results");
        // Pull the pack's questions so the reveal can show both players' picks —
        // only when we actually have per-question data for both sides.
        if (ch.challenger_answers && ch.opponent_answers) {
          const { data: pack } = await supabase
            .from("quiz_packs").select("questions").eq("id", ch.quiz_pack_id).single();
          if (pack?.questions) setQuestions(pack.questions as unknown as RawQuestion[]);
        }
      } else if (uid === ch.challenger_id) {
        setPageState("own_challenge");
      } else if (!uid) {
        setPageState("sign_in_needed");
      } else {
        setPageState("ready_to_play");
      }
    }

    load();
  }, [id]);

  // ── League link + completed-view tracking (Phase 3E) ────────────────────
  // Fires once per results view, for a participant only. gameType prefers
  // the member_challenges row's own (once leagueLink resolves) and falls
  // back to a guess off the h2h row's mode — good enough for a plain Versus
  // h2h, which never had a "challenge game" concept to begin with.
  useEffect(() => {
    if (pageState !== "results" || !challenge) { setLeagueLink(null); return; }
    const isParticipant = !!userId && (userId === challenge.challenger_id || userId === challenge.opponent_id);
    if (!isParticipant) { setLeagueLink(null); return; }
    trackChallengeCompletedViewed(challenge.mode === "duel" ? "quiz_duel" : "quiz_battle");

    let live = true;
    fetch(`/api/fantasy/challenges?h2h=${challenge.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => { if (live) setLeagueLink(j && j.leagueCode ? { leagueCode: j.leagueCode, gameType: j.gameType } : null); })
      .catch(() => { if (live) setLeagueLink(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, challenge?.id, userId]);

  // ── Fetch questions when transitioning to playing ──────────────────────
  async function startPlaying() {
    if (!challenge) return;
    const supabase = createClient();
    const { data: pack } = await supabase
      .from("quiz_packs")
      .select("questions")
      .eq("id", challenge.quiz_pack_id)
      .single();

    if (!pack?.questions) return;

    setQuestions(pack.questions as unknown as RawQuestion[]);
    setCurrentIdx(0);
    setSelected(null);
    setRevealed(false);
    setAnswerLog([]);
    setScore(0);
    setLastPoints(null);
    setPageState("playing");
  }

  // ── Share (Phase 3E) ─────────────────────────────────────────────────────
  // Same pattern the rest of the app already uses for a share button
  // (ShareStatsButton, the league invite sheet): navigator.share first, a
  // clipboard-copy fallback when it's unavailable or the sheet's dismissed.
  // No new share card infrastructure — this is the same public /h2h/[id]
  // link ShareCard (above) already builds, just reachable from the results
  // action row too.
  async function handleShare() {
    if (!challenge) return;
    trackChallengeShared(leagueLink?.gameType ?? (challenge.mode === "duel" ? "quiz_duel" : "quiz_battle"));
    const link = typeof window !== "undefined" ? `${window.location.origin}/h2h/${challenge.id}` : `/h2h/${challenge.id}`;
    const text = `${challenge.quiz_pack_name} on YourScore`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try { await navigator.share({ text, url: link }); return; }
      catch { /* cancelled or unavailable — fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch { /* clipboard unavailable — nothing more to do */ }
  }

  // ── Answer handler ─────────────────────────────────────────────────────
  async function handleAnswer(letter: Letter) {
    if (!challenge || selected || revealed || advancing) return;
    const currentQ = questions[currentIdx];
    if (!currentQ) return;

    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    const isCorrect = letter === (currentQ.answer as Letter);

    // Score with the shared engine so this live preview matches what
    // /api/h2h/play computes server-side (base × difficulty × speed + bonuses).
    // Derive streaks from prior answers for streak/comeback bonus parity.
    let priorCorrectStreak = 0;
    let priorWrongStreak = 0;
    for (const r of answerLog) {
      if (r.correct) { priorCorrectStreak++; priorWrongStreak = 0; }
      else { priorWrongStreak++; priorCorrectStreak = 0; }
    }
    const { points: pts } = scoreAnswer({
      isCorrect,
      elapsedMs: elapsed,
      difficulty: currentQ.difficulty ?? "medium",
      correctStreak: priorCorrectStreak,
      wrongStreak: priorWrongStreak,
      windowMs: H2H_QUESTION_WINDOW_MS,
    });

    setSelected(letter);
    setRevealed(true);
    setLastPoints(isCorrect ? pts : null);
    if (pts > 0) setScore((s) => s + pts);

    const record: AnswerRecord = {
      idx: currentIdx,
      selected: letter,
      correct: isCorrect,
      points: pts,
      elapsed_ms: elapsed,
    };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    setTimeout(async () => {
      if (currentIdx + 1 >= questions.length) {
        // Local tally for immediate display; the server re-grades authoritatively.
        let finalScore = newLog.reduce((s, r) => s + r.points, 0);
        let correctCount = newLog.filter((r) => r.correct).length;

        if (userId) {
          // Server grades the answers against the pack and writes the score.
          // The client can no longer set opponent_score/a duel attempt directly.
          const res = await fetch("/api/h2h/play", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: challenge.id,
              answers: newLog.map((r) => ({
                letter: r.selected,
                elapsedMs: r.elapsed_ms,
              })),
            }),
          });

          if (res.ok) {
            const data = await res.json();

            // ── Quiz Duel (Phase 3B) — a different response shape (yourScore/
            // yourCorrect/done) and two possible next states, neither of which
            // is the scorecard branch below.
            if (challenge.mode === "duel") {
              if (data.done === "complete") {
                // Both sides have now played — /api/h2h/play just copied both
                // scores onto the public row. Refetch it rather than guess its
                // shape client-side, then reuse the existing results render.
                const supabase = createClient();
                const { data: freshRow } = await supabase
                  .from("h2h_challenges").select("*").eq("id", challenge.id).single();
                if (freshRow) setChallenge(freshRow as unknown as H2HChallenge);
                setScore(data.yourScore);
                setPageState("results");
              } else {
                setDuelOwnScore({ score: data.yourScore, correct: data.yourCorrect });
                setScore(data.yourScore);
                setPageState("duel_waiting");
              }
              setAdvancing(false);
              return;
            }

            finalScore = data.opponentScore;
            correctCount = data.opponentCorrect;
            setChallenge((prev) =>
              prev
                ? {
                    ...prev,
                    opponent_id: userId,
                    opponent_score: finalScore,
                    opponent_correct: correctCount,
                  }
                : prev
            );
          }
        }

        setScore(finalScore);
        setPageState("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setRevealed(false);
        setLastPoints(null);
      }
      setAdvancing(false);
    }, 1800);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Renders
  // ──────────────────────────────────────────────────────────────────────

  const gridBg = {
    background: `
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px),
      #0a0a0f
    `,
    backgroundSize: "40px 40px",
    minHeight: "100vh",
  };

  // ── Loading ────────────────────────────────────────────────────────────
  if (pageState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a0f" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#ffb800", borderTopColor: "transparent" }}
          />
          <p className="font-display text-xs tracking-widest" style={{ color: "#8a948f" }}>
            LOADING…
          </p>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────
  if (pageState === "not_found") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={gridBg}>
        <p className="font-display text-2xl text-white text-center">Challenge expired or not found</p>
        <p className="font-body text-sm text-center" style={{ color: "#8a948f" }}>
          This challenge link is no longer valid.
        </p>
        <Link
          href="/challenges"
          className="rounded-2xl px-6 py-3 font-display text-sm tracking-widest"
          style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.1)", color: "#9aa39d" }}
        >
          ← Browse Challenges
        </Link>
      </div>
    );
  }

  // ── Own challenge (no opponent yet) ───────────────────────────────────
  if (pageState === "own_challenge" && challenge) {
    return (
      <div className="min-h-screen flex flex-col px-5 py-12 gap-6" style={gridBg}>
        <div>
          <p className="font-display text-xs tracking-widest mb-1" style={{ color: "#aeea00" }}>
            YOUR CHALLENGE IS LIVE
          </p>
          <h1 className="font-display text-3xl text-white leading-tight">
            {challenge.quiz_pack_name}
          </h1>
        </div>

        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <Avatar name={challenge.challenger_name} color="#aeea00" size={52} />
          <div>
            <p className="font-display text-3xl text-white">
              {challenge.challenger_score.toLocaleString()}
            </p>
            <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>
              {challenge.challenger_correct}/{challenge.total_questions} correct
            </p>
          </div>
        </div>

        <div>
          <p className="font-body text-xs mb-3" style={{ color: "#586058" }}>
            Share this link so someone can try to beat your score:
          </p>
          <ShareCard challenge={challenge} />
        </div>

        <Button href="/challenges" variant="ghost" size="md" fullWidth>
          Play on Challenges →
        </Button>
      </div>
    );
  }

  // ── Duel: not a participant (Phase 3B) ────────────────────────────────
  // A duel's scores stay null pre-completion regardless (h2h_challenges is
  // public-read, but there's nothing on it to see yet) — once it completes,
  // a non-participant falls through to the shared "results" state below,
  // same public share behaviour scorecard already has.
  if (pageState === "duel_not_participant") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4" style={gridBg}>
        <p className="font-display text-2xl text-white text-center">This one&apos;s a private duel</p>
        <p className="font-body text-sm text-center" style={{ color: "#8a948f" }}>
          Only the two players can see this challenge until it&apos;s done.
        </p>
        <Link
          href="/"
          className="rounded-2xl px-6 py-3 font-display text-sm tracking-widest"
          style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.1)", color: "#9aa39d" }}
        >
          ← Home
        </Link>
      </div>
    );
  }

  // ── Duel: intro, hasn't played yet (Phase 3B) ─────────────────────────
  if (pageState === "duel_intro" && challenge) {
    return (
      <div className="min-h-screen flex flex-col" style={gridBg}>
        <div className="px-5 pt-6 pb-8"
          style={{ background: "linear-gradient(175deg, #1a0e00 0%, #0d0b00 60%, transparent 100%)" }}>
          <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#ffb800" }}>
            QUIZ DUEL
          </p>
          <h1 className="font-display text-4xl text-white leading-tight mb-3">
            {challenge.quiz_pack_name}
          </h1>
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>
            You both play it fresh. Best score wins.
          </p>
        </div>

        <div className="px-5 flex flex-col gap-4 pb-10">
          <div className="rounded-2xl px-5 py-4 flex items-center justify-around"
            style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            {[
              { val: `${challenge.total_questions}`, label: "Questions" },
              { val: "Fresh", label: "Neither's played" },
              { val: "1×", label: "One attempt" },
            ].map(({ val, label }) => (
              <div key={label} className="text-center">
                <div className="font-display text-xl text-white">{val}</div>
                <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{label}</div>
              </div>
            ))}
          </div>

          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={startPlaying}>
            PLAY →
          </Button>

          <p className="font-body text-xs text-center" style={{ color: "#3a423d" }}>
            Expires {new Date(challenge.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </p>
        </div>
      </div>
    );
  }

  // ── Duel: played, waiting on the other side (Phase 3B) ────────────────
  // Never renders the other side's score or whether they've even started —
  // only that the viewer is done and their own result.
  if (pageState === "duel_waiting" && challenge) {
    return (
      <div className="min-h-screen flex flex-col px-5 py-12 gap-6" style={gridBg}>
        <div>
          <p className="font-display text-xs tracking-widest mb-1" style={{ color: "#aeea00" }}>
            YOU&apos;RE DONE
          </p>
          <h1 className="font-display text-3xl text-white leading-tight">
            {challenge.quiz_pack_name}
          </h1>
        </div>

        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <Avatar name={opponentName} color="#aeea00" size={52} />
          <div>
            <p className="font-display text-3xl text-white">
              {(duelOwnScore?.score ?? score).toLocaleString()}
            </p>
            <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>
              {duelOwnScore?.correct ?? 0}/{challenge.total_questions} correct
            </p>
          </div>
        </div>

        <p className="font-body text-sm" style={{ color: "#8a948f" }}>
          Waiting for the other side to play. You&apos;ll get a nudge the moment the result&apos;s in.
        </p>

        <Button href="/challenges" variant="ghost" size="md" fullWidth>
          Back to Challenges →
        </Button>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────
  if (pageState === "results" && challenge) {
    const opponentScore = challenge.opponent_score ?? score;
    const opponentCorrect =
      challenge.opponent_correct ?? answerLog.filter((r) => r.correct).length;
    const challengerScore = challenge.challenger_score;

    const diff = Math.abs(opponentScore - challengerScore);

    // Determine result from current user's perspective
    let resultLabel = "";
    let resultColor = "";
    let resultGlow = "";
    let resultSub = "";

    if (userId && userId !== challenge.challenger_id) {
      // user is the opponent
      if (opponentScore > challengerScore) {
        resultLabel = "YOU WIN";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.25)";
        resultSub = `You won by ${diff.toLocaleString()} points`;
      } else if (opponentScore < challengerScore) {
        resultLabel = "SO CLOSE";
        resultColor = "#8a948f";
        resultGlow = "none";
        resultSub = `Beaten by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.2)";
        resultSub = "Exact same score!";
      }
    } else if (userId && userId === challenge.challenger_id) {
      // user is the challenger looking at results
      if (challengerScore > opponentScore) {
        resultLabel = "YOU WIN";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.25)";
        resultSub = `You won by ${diff.toLocaleString()} points`;
      } else if (challengerScore < opponentScore) {
        resultLabel = "NICE TRY";
        resultColor = "#8a948f";
        resultGlow = "none";
        resultSub = `Beaten by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.2)";
        resultSub = "Exact same score!";
      }
    } else {
      // viewer not involved
      if (challengerScore > opponentScore) {
        resultLabel = `${challenge.challenger_name} WINS`;
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.2)";
        resultSub = `Won by ${diff.toLocaleString()} points`;
      } else if (challengerScore < opponentScore) {
        resultLabel = "CHALLENGER BEATEN";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.2)";
        resultSub = `Lost by ${diff.toLocaleString()} points`;
      } else {
        resultLabel = "IT'S A TIE";
        resultColor = "#aeea00";
        resultGlow = "0 0 60px rgba(174,234,0,0.2)";
        resultSub = "Exact same score!";
      }
    }

    const opponentDisplayName =
      userId && userId !== challenge.challenger_id ? opponentName : "Opponent";

    return (
      <div className="min-h-screen flex flex-col pb-12" style={gridBg}>
        {/* Result banner */}
        <div
          className="flex flex-col items-center pt-16 pb-10 px-6"
          style={{
            background: "linear-gradient(175deg, #0e1611 0%, #0a0a0f 100%)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            boxShadow: resultGlow,
          }}
        >
          <p
            className="font-display text-xs tracking-widest mb-3"
            style={{ color: "#586058" }}
          >
            {challenge.quiz_pack_name}
          </p>
          <div
            className="font-display text-5xl mb-2"
            style={{ color: resultColor }}
          >
            {resultLabel}
          </div>
          <p className="font-body text-sm" style={{ color: "#8a948f" }}>
            {resultSub}
          </p>
        </div>

        <div className="px-5 mt-6 flex flex-col gap-4">
          {/* Score comparison */}
          <div
            className="rounded-2xl p-5"
            style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p
              className="font-display text-xs tracking-widest mb-5"
              style={{ color: "#586058" }}
            >
              1V1
            </p>
            <div className="flex items-start gap-4">
              {/* Challenger */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <Avatar name={challenge.challenger_name} color="#ffb800" size={44} />
                <p
                  className="font-body text-xs text-center"
                  style={{ color: "#8a948f" }}
                >
                  {challenge.challenger_name}
                </p>
                <p
                  className="font-display text-3xl"
                  style={{ color: "#ffb800" }}
                >
                  {challengerScore.toLocaleString()}
                </p>
                <p className="font-body text-xs" style={{ color: "#5b645e" }}>
                  {challenge.challenger_correct}/{challenge.total_questions} correct
                </p>
              </div>

              {/* VS divider */}
              <div className="flex flex-col items-center justify-center pt-8 gap-1">
                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
                <span
                  className="font-display text-xs"
                  style={{ color: "#3a423d" }}
                >
                  VS
                </span>
                <div
                  style={{
                    width: 1,
                    height: 20,
                    background: "rgba(255,255,255,0.08)",
                  }}
                />
              </div>

              {/* Opponent */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <Avatar name={opponentDisplayName} color="#aeea00" size={44} />
                <p
                  className="font-body text-xs text-center"
                  style={{ color: "#8a948f" }}
                >
                  {opponentDisplayName}
                </p>
                <p
                  className="font-display text-3xl"
                  style={{ color: "#aeea00" }}
                >
                  {opponentScore.toLocaleString()}
                </p>
                <p className="font-body text-xs" style={{ color: "#5b645e" }}>
                  {opponentCorrect}/{challenge.total_questions} correct
                </p>
              </div>
            </div>
          </div>

          {/* Question-by-question reveal — only when both players' per-question data exists */}
          {challenge.challenger_answers && challenge.opponent_answers && questions.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>QUESTION BY QUESTION</p>
              <div className="flex flex-col gap-3.5">
                {questions.map((q, i) => {
                  const correctLetter = String(q.answer).toUpperCase() as Letter;
                  return (
                    <div key={i} className="pb-3.5" style={{ borderBottom: i < questions.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                      <p className="font-body text-sm text-white mb-1 leading-snug">{i + 1}. {q.question}</p>
                      <p className="font-body text-xs mb-2.5" style={{ color: "#8a948f" }}>Answer: <span style={{ color: "#aeea00" }}>{correctLetter}. {q.options?.[correctLetter] ?? ""}</span></p>
                      <div className="flex gap-2">
                        <PickChip name={challenge.challenger_name} pick={challenge.challenger_answers?.[i]} />
                        <PickChip name={opponentDisplayName} pick={challenge.opponent_answers?.[i]} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Phase 3E — Share (any h2h) plus Back to the league, when this one
              came from a league-mate challenge and the viewer took part
              (leagueLink is null otherwise — see the effect above, and
              challengeByH2h's own doc in challenges.ts for the participant
              gating, enforced server side). A prep-sheet Rematch belongs on
              the chat card and the member sheet instead, NOT here — this
              page has no league context to open one against (which league,
              which opponent slot), so it's deliberately left out rather than
              half built. The pre-existing "Rematch →" button below is a
              DIFFERENT, older flow (plain Versus, /versus/challenge) and is
              untouched. */}
          <div className="flex gap-2">
            <button
              onClick={handleShare}
              className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform"
              style={{
                background: shareCopied ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.07)",
                border: shareCopied ? "1px solid rgba(174,234,0,0.4)" : "1px solid rgba(255,255,255,0.1)",
                color: shareCopied ? "#aeea00" : "#9aa39d",
              }}
            >
              {shareCopied ? "LINK COPIED" : "SHARE"}
            </button>
            {leagueLink && (
              <Link
                href={`/fantasy/leagues/${leagueLink.leagueCode}`}
                className="flex-1 rounded-xl py-3 font-display text-xs tracking-widest text-center active:scale-[0.97] transition-transform"
                style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.25)", color: "#ffb800" }}
              >
                BACK TO THE LEAGUE
              </Link>
            )}
          </div>

          {(() => {
            const otherId = userId === challenge.challenger_id ? challenge.opponent_id : challenge.challenger_id;
            return otherId ? (
              <Button href={`/versus/challenge?to=${otherId}`} variant="primary" tone="teal" size="lg" fullWidth>
                Rematch →
              </Button>
            ) : null;
          })()}

          <Button href="/versus" variant="ghost" size="lg" fullWidth>
            Back to Versus →
          </Button>
        </div>
      </div>
    );
  }

  // ── Sign in needed ─────────────────────────────────────────────────────
  if (pageState === "sign_in_needed" && challenge) {
    // Real max for this pack (stored at creation) — total_questions×1000 overstated
    // the ceiling ~2-5x, making decent runs read as 12%.
    const scoreBarPct = Math.round((challenge.challenger_score / Math.max(1, challenge.max_score || challenge.total_questions * 600)) * 100);

    return (
      <div className="min-h-screen flex flex-col" style={gridBg}>
        {/* Top bar — brand */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="font-display text-lg tracking-wider text-white">
            YOUR<span style={{ color: "#ffb800" }}>SCORE</span>
          </span>
          <span className="font-body text-xs px-3 py-1 rounded-full"
            style={{ background: "rgba(255,184,0,0.1)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.2)" }}>
            ⚡ Football Knowledge
          </span>
        </div>

        {/* Challenge hero */}
        <div className="px-5 pt-6 pb-8"
          style={{ background: "linear-gradient(175deg, #1a0e00 0%, #0d0b00 60%, transparent 100%)" }}>
          <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#aeea00" }}>
            YOU&apos;VE BEEN CHALLENGED
          </p>
          <h1 className="font-display text-4xl text-white leading-tight mb-5">
            {challenge.quiz_pack_name}
          </h1>

          {/* Challenger card */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.18)" }}>
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={challenge.challenger_name} color="#ffb800" size={52} />
              <div>
                <p className="font-body text-xs mb-0.5" style={{ color: "#8a948f" }}>
                  {challenge.challenger_name} played this quiz and scored
                </p>
                <p className="font-display text-4xl text-white leading-none">
                  {challenge.challenger_score.toLocaleString()}
                </p>
                <p className="font-body text-xs mt-1.5" style={{ color: "#8a948f" }}>
                  {challenge.challenger_correct} / {challenge.total_questions} correct
                </p>
              </div>
            </div>

            {/* Score bar */}
            <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                width: `${scoreBarPct}%`, height: "100%", borderRadius: 99,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
                transition: "width 0.8s ease",
              }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="font-body text-xs" style={{ color: "#586058" }}>0</span>
              <span className="font-body text-xs" style={{ color: "#ffb800" }}>
                {scoreBarPct}% of max score
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 pb-10">
          {/* What you're getting into */}
          <div className="rounded-2xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>HOW IT WORKS</p>
            <div className="flex flex-col gap-3">
              {[
                { icon: "❓", title: `${challenge.total_questions} questions`, sub: `All about ${challenge.quiz_pack_name}` },
                { icon: "⚡", title: "Speed scoring", sub: "Answer fast — points decay the longer you wait" },
                { icon: "🏆", title: "One attempt", sub: "Your score is final. Can you beat theirs?" },
              ].map(({ icon, title, sub }) => (
                <div key={title} className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                  <div>
                    <p className="font-display text-sm text-white tracking-wide">{title}</p>
                    <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sign-in CTA */}
          <div className="rounded-2xl p-5"
            style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.22)" }}>
            <p className="font-display text-base text-white tracking-wide mb-1">
              Sign in to accept
            </p>
            <p className="font-body text-xs mb-4" style={{ color: "#8a948f" }}>
              Free forever — takes 10 seconds
            </p>
            <SignInWithGoogle redirectTo={`/h2h/${id}`} />
            {/* Apple/email users (most iPhone recipients) need a path too — the
                full sign-in page carries every provider and returns here. */}
            <a
              href={`/auth/sign-in?next=${encodeURIComponent(`/h2h/${id}`)}`}
              className="block text-center font-body text-xs mt-3 underline underline-offset-2"
              style={{ color: "#8a948f" }}
            >
              Or continue with Apple / email
            </a>
          </div>

          {/* Social proof nudge */}
          <p className="font-body text-xs text-center" style={{ color: "#3a423d" }}>
            Join thousands of fans testing their football knowledge
          </p>
        </div>
      </div>
    );
  }

  // ── Ready to play ──────────────────────────────────────────────────────
  if (pageState === "ready_to_play" && challenge) {
    // Real max for this pack (stored at creation) — total_questions×1000 overstated
    // the ceiling ~2-5x, making decent runs read as 12%.
    const scoreBarPct = Math.round((challenge.challenger_score / Math.max(1, challenge.max_score || challenge.total_questions * 600)) * 100);

    return (
      <div className="min-h-screen flex flex-col" style={gridBg}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="font-display text-lg tracking-wider text-white">
            YOUR<span style={{ color: "#ffb800" }}>SCORE</span>
          </span>
          <span className="font-body text-xs px-3 py-1 rounded-full"
            style={{ background: "rgba(255,184,0,0.1)", color: "#ffb800", border: "1px solid rgba(255,184,0,0.2)" }}>
            ⚡ Football Knowledge
          </span>
        </div>

        {/* Challenge hero */}
        <div className="px-5 pt-6 pb-8"
          style={{ background: "linear-gradient(175deg, #1a0e00 0%, #0d0b00 60%, transparent 100%)" }}>
          <p className="font-display text-xs tracking-widest mb-3" style={{ color: "#ffb800" }}>
            YOU&apos;VE BEEN CHALLENGED
          </p>
          <h1 className="font-display text-4xl text-white leading-tight mb-5">
            {challenge.quiz_pack_name}
          </h1>

          {/* Challenger card */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(255,184,0,0.06)", border: "1px solid rgba(255,184,0,0.18)" }}>
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={challenge.challenger_name} color="#ffb800" size={52} />
              <div>
                <p className="font-body text-xs mb-0.5" style={{ color: "#8a948f" }}>
                  {challenge.challenger_name} scored
                </p>
                <p className="font-display text-4xl text-white leading-none">
                  {challenge.challenger_score.toLocaleString()}
                </p>
                <p className="font-body text-xs mt-1.5" style={{ color: "#8a948f" }}>
                  {challenge.challenger_correct} / {challenge.total_questions} correct · {challenge.total_questions}Q
                </p>
              </div>
            </div>

            {/* Score bar */}
            <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{
                width: `${scoreBarPct}%`, height: "100%", borderRadius: 99,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
              }} />
            </div>
            <p className="font-body text-xs mt-1.5 text-right" style={{ color: "#ffb800" }}>
              {scoreBarPct}% of max — can you beat it?
            </p>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 pb-10">
          {/* Quick rules */}
          <div className="rounded-2xl px-5 py-4 flex items-center justify-around"
            style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            {[
              { val: `${challenge.total_questions}`, label: "Questions" },
              { val: "⚡", label: "Speed pts" },
              { val: "1×", label: "One attempt" },
            ].map(({ val, label }) => (
              <div key={label} className="text-center">
                <div className="font-display text-xl text-white">{val}</div>
                <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{label}</div>
              </div>
            ))}
          </div>

          <Button
            variant="primary"
            tone="teal"
            size="lg"
            fullWidth
            onClick={startPlaying}
          >
            ACCEPT CHALLENGE →
          </Button>

          <p className="font-body text-xs text-center" style={{ color: "#3a423d" }}>
            Answer fast — points decay with every second
          </p>
        </div>
      </div>
    );
  }

  // ── Playing ────────────────────────────────────────────────────────────
  if (pageState === "playing" && questions.length > 0) {
    const currentQ = questions[currentIdx];
    if (!currentQ) return null;

    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty?.toLowerCase() ?? "medium";
    const diffColor = DIFF_COLOR[diff] ?? "#ffb800";
    const diffBg = DIFF_BG[diff] ?? "rgba(255,184,0,0.12)";
    const tColor = timerColor(timerMs);
    const accent = "#ffb800";

    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0f" }}>
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10"
          style={{
            background: "rgba(10,10,15,0.98)",
            backdropFilter: "blur(20px)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full transition-all duration-700 ease-out"
              style={{
                width: `${progressFilled}%`,
                background: "linear-gradient(90deg, #e65c00, #ffb800)",
              }}
            />
          </div>

          <div className="px-5 py-3 flex items-center justify-between gap-3">
            {/* Quit */}
            <button
              onClick={() => {
                if (window.confirm("Quit? Your progress won't be saved.")) {
                  stopTimer();
                  setPageState("ready_to_play");
                  setCurrentIdx(0);
                  setSelected(null);
                  setRevealed(false);
                  setScore(0);
                  setAnswerLog([]);
                  setLastPoints(null);
                  setTimerMs(0);
                }
              }}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#586058" }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 18 18"
                fill="none"
              >
                <path
                  d="M11 4L6 9l5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Quit
            </button>

            {/* Timer */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
              style={{
                background: `${tColor}10`,
                border: `1px solid ${tColor}28`,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: tColor,
                  display: "inline-block",
                  boxShadow: revealed ? "none" : `0 0 6px ${tColor}`,
                  opacity: revealed ? 0.4 : 1,
                }}
              />
              <span
                className="font-display text-base tabular-nums"
                style={{ color: tColor, letterSpacing: "0.02em" }}
              >
                {timerDisplay(timerMs)}
              </span>
            </div>

            {/* Score */}
            <div
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{
                background: `${accent}12`,
                border: `1px solid ${accent}25`,
              }}
            >
              <span
                className="font-display text-sm"
                style={{ color: accent }}
              >
                {score.toLocaleString()}
              </span>
              <span className="font-body text-xs" style={{ color: "#5b645e" }}>
                pts
              </span>
            </div>
          </div>

          {/* Question counter */}
          <div className="px-5 pb-2.5 flex items-center gap-2">
            <span className="font-body text-xs" style={{ color: "#586058" }}>
              Question{" "}
              <span className="text-white">{currentIdx + 1}</span> of{" "}
              {questions.length}
            </span>
            <span
              className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
              style={{
                background: diffBg,
                color: diffColor,
                border: `1px solid ${diffColor}30`,
              }}
            >
              {diff}
            </span>
          </div>
        </div>

        {/* Question body */}
        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col">
          {currentQ.category && (
            <span
              className="font-body text-xs px-2.5 py-1 rounded-full capitalize mb-4 self-start"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "#8a948f",
              }}
            >
              {currentQ.category.replace(/_/g, " ")}
            </span>
          )}

          {/* Question card */}
          <div
            className="rounded-2xl p-5 mb-5"
            style={{
              background:
                "linear-gradient(145deg, #0e1611 0%, #15211a 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
              minHeight: 100,
            }}
          >
            <p className="font-body text-base font-semibold text-white leading-relaxed">
              {currentQ.question}
            </p>
          </div>

          {/* `key` per question: without it `transition-all` animates the new question's
              options out of the previous one's reveal colours, flashing a wrong option green. */}
          <AnswerButtons
            key={currentIdx}
            options={currentQ.options}
            answer={currentQ.answer}
            selected={selected}
            revealed={revealed}
            accent={accent}
            onAnswer={handleAnswer}
          />

          {/* Reveal banner */}
          {revealed && (
            <div
              className="mt-4 rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{
                background:
                  selected === (currentQ.answer as Letter)
                    ? "rgba(174,234,0,0.08)"
                    : "rgba(255,71,87,0.08)",
                border: `1px solid ${
                  selected === (currentQ.answer as Letter)
                    ? "rgba(174,234,0,0.22)"
                    : "rgba(255,71,87,0.22)"
                }`,
              }}
            >
              <div>
                <span
                  className="font-display text-lg tracking-wider"
                  style={{
                    color:
                      selected === (currentQ.answer as Letter)
                        ? "#aeea00"
                        : "#ff4757",
                  }}
                >
                  {selected === (currentQ.answer as Letter)
                    ? "✓ CORRECT"
                    : "✗ WRONG"}
                </span>
                {selected !== (currentQ.answer as Letter) && (
                  <p
                    className="font-body text-xs mt-0.5"
                    style={{ color: "#8a948f" }}
                  >
                    Answer:{" "}
                    <span style={{ color: "#ffffff" }}>
                      {currentQ.options[currentQ.answer as Letter]}
                    </span>
                  </p>
                )}
              </div>
              {lastPoints !== null && (
                <div className="text-right">
                  <div
                    className="font-display text-2xl"
                    style={{ color: "#ffb800" }}
                  >
                    +{lastPoints.toLocaleString()}
                  </div>
                  <div
                    className="font-body text-xs"
                    style={{ color: "#8a948f" }}
                  >
                    {timerDisplay(timerMs)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
