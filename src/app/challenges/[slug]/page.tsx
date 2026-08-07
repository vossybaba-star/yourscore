"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { smartBackTarget } from "@/lib/nav";
import { haptic } from "@/lib/haptics";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { coverUrl } from "@/lib/img";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { AnswerButtons } from "@/components/game/AnswerButtons";
import { StreakWindowTimer } from "@/components/quiz/StreakWindowTimer";
import { GameHeader } from "@/components/games/GameHeader";
import { useGameLoop } from "@/lib/useGameLoop";
import { Button } from "@/components/ui/Button";
import { trackGamePlay, trackGameComplete, trackShare } from "@/lib/analytics/trackGame";
import { getAcq } from "@/lib/analytics/acq";
import {
  DIFFICULTY_COLOR as DIFF_COLOR,
  DIFFICULTY_BG as DIFF_BG,
  RECORDS_EMOJI,
} from "@/lib/theme";
import {
  scoreAnswer,
  calculatePerfectRoundBonus,
  maxPointsForDifficulty,
  getSpeedLabel,
} from "@/lib/scoring";
import dynamic from "next/dynamic";
import { PackLeaderboard, type LeaderEntry } from "./PackLeaderboard";
import type { QuizPack, RawQuestion, AnswerRecord, Letter } from "./types";

const ResultsView = dynamic(() => import("./ResultsView"), { ssr: false, loading: () => null });

// Solo challenge question window — the reference duration for speed band calculation.
// Players can answer at any time; elapsed is capped at this value for scoring purposes.
const CHALLENGE_WINDOW_MS = 30_000;

// The four club topics carry a category slug; show its real name on the pack
// header. Anything without a club_topic keeps the generic season label.
const CLUB_TOPIC_LABEL: Record<string, string> = {
  "history-honours": "History & Honours",
  "legends": "Legends",
  "modern-era": "Modern Era",
  "rivalries-derbies": "Rivalries",
};

type Phase = "loading" | "intro" | "playing" | "results";

// ── Guest result (save-your-score round trip) ─────────────────────────────
// A guest's finished run, held locally so "SIGN UP & SAVE SCORE" actually saves it:
// when they land back on this page signed in, the answers are submitted to
// /api/quiz/solo-complete (server re-grades — the local copy is never trusted).
// Mirrors the 38-0 pendingEnter pattern (wc/page.tsx).
const GUEST_RESULT_KEY = "quiz:guest-result:v1";
const GUEST_RESULT_TTL_MS = 48 * 60 * 60 * 1000;
type GuestResult = { packId: string; answers: { letter: Letter; elapsedMs: number }[]; ts: number };
function saveGuestResult(r: GuestResult) { try { localStorage.setItem(GUEST_RESULT_KEY, JSON.stringify(r)); } catch { /* ignore */ } }
function loadGuestResult(): GuestResult | null {
  try {
    const raw = localStorage.getItem(GUEST_RESULT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as GuestResult;
    if (!r?.packId || !Array.isArray(r.answers) || Date.now() - (r.ts ?? 0) > GUEST_RESULT_TTL_MS) { clearGuestResult(); return null; }
    return r;
  } catch { return null; }
}
function clearGuestResult() { try { localStorage.removeItem(GUEST_RESULT_KEY); } catch { /* ignore */ } }

// ── Guest best score, per pack (the "beat it" memory) ─────────────────────
// Separate from GUEST_RESULT above (that is a single-slot save-on-signup buffer).
// This is a durable per-pack best a guest keeps across replays, so revisiting a
// pack shows "you scored X here, beat it" instead of pretending it's their first
// time. Signed-in players get the equivalent from the server (priorAttempt); this
// is the guest's version, held locally because a guest has no server row.
const GUEST_BEST_KEY = "quiz:guest-best:v1";
type GuestBest = { score: number; correct: number; total: number; ts: number };
function loadGuestBests(): Record<string, GuestBest> {
  try {
    const raw = localStorage.getItem(GUEST_BEST_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v as Record<string, GuestBest> : {};
  } catch { return {}; }
}
function loadGuestBest(packId: string): GuestBest | null {
  return loadGuestBests()[packId] ?? null;
}
// Keep the higher score. A worse replay never overwrites a better best.
function recordGuestBest(packId: string, next: GuestBest) {
  try {
    const all = loadGuestBests();
    const prev = all[packId];
    if (!prev || next.score > prev.score) {
      all[packId] = next;
      localStorage.setItem(GUEST_BEST_KEY, JSON.stringify(all));
    }
  } catch { /* ignore */ }
}

// Shape of a quiz_attempts row joined with profiles, as read at the query boundary.
interface LeaderRow {
  user_id: string;
  score: number;
  correct_count: number;
  profiles: { display_name: string | null } | null;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ChallengePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pid = searchParams.get("pid"); // custom pack direct-by-ID shortcut
  const invitedUserId = searchParams.get("challenge"); // targeted async challenge
  const groupId = searchParams.get("group"); // playing into a group challenge board

  const [phase, setPhase] = useState<Phase>("loading");
  const [pack, setPack] = useState<QuizPack | null>(null);
  const [questions, setQuestions] = useState<RawQuestion[]>([]);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const [invitedName, setInvitedName] = useState<string | null>(null);

  // Resolve the invited friend's name for the "challenge sent to X" copy.
  useEffect(() => {
    if (!invitedUserId) return;
    createClient().from("profiles").select("display_name").eq("id", invitedUserId).single()
      .then(({ data }) => setInvitedName(data?.display_name ?? null));
  }, [invitedUserId]);

  const [userId, setUserId] = useState<string | null>(null);
  const [priorAttempt, setPriorAttempt] = useState<{ score: number; max_score: number; correct_count: number } | null>(null);
  // Guest's own previous best on this pack (localStorage), shown on the intro as a "beat it".
  const [guestBest, setGuestBest] = useState<GuestBest | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [leaderLoading, setLeaderLoading] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Correct letter for the CURRENT question only, filled in by /api/quiz/answer's
  // response. Never sourced from the pack — the pack never carries it.
  const [revealedAnswer, setRevealedAnswer] = useState<Letter | null>(null);
  const [answerLog, setAnswerLog] = useState<AnswerRecord[]>([]);
  const [score, setScore] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastSpeedLabel, setLastSpeedLabel] = useState<string | null>(null);
  const [lastStreakBonus, setLastStreakBonus] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [saved, setSaved] = useState(false);

  // ── Share state ──────────────────────────────────────────────────────────
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shortUrlMinted = useRef(false);

  // Streak tracking for bonuses
  const [correctStreak, setCorrectStreak] = useState(0);
  const [wrongStreak, setWrongStreak] = useState(0);

  // ── Timer ──────────────────────────────────────────────────────────────
  // Count-up question timer shared with the H2H loop (see useGameLoop).
  const { timerMs, setTimerMs, questionStartRef, stopTimer } = useGameLoop(
    phase === "playing",
    currentIdx,
  );

  // Re-fetch leaderboard after score saved so the user sees their position
  useEffect(() => {
    if (!saved || !pack) return;
    const sb = createClient();
    setLeaderLoading(true);
    sb.from("quiz_attempts")
      .select("user_id, score, correct_count, profiles(display_name)")
      .eq("pack_id", pack.id)
      .order("score", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (data) {
          const rows = data as unknown as LeaderRow[];
          setLeaderboard(rows.map((r) => ({
            user_id: r.user_id,
            score: r.score,
            correct_count: r.correct_count,
            display_name: r.profiles?.display_name ?? null,
          })));
        }
        setLeaderLoading(false);
      });
  }, [saved, pack]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load pack + auth ───────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    const supabase = createClient();

    (async () => {
      // Load pack content from the edge-cached route (/api/challenges/pack). It's
      // served from the nearest CDN region with no database hop — previously the
      // browser fetched EVERY published pack's full question set (110 packs) from
      // the eu-central-1 DB on every load, a transatlantic payload that tanked
      // Speed Insights for users far from the UK. Leaderboard/attempt below stay
      // client-side (user-specific, not cacheable).
      //
      // The pack fetch starts IMMEDIATELY — it needs no auth. The uid comes from
      // getSession() (localStorage, no GoTrue roundtrip): it only scopes reads
      // that RLS enforces anyway. Previously this was a serial 4-hop chain
      // (auth → pack → attempt → leaderboard) — the measured ~1s picker→quiz lag.
      const packQuery = pid
        ? `pid=${encodeURIComponent(pid)}`
        : `slug=${encodeURIComponent(slug)}`;
      const packPromise: Promise<(QuizPack & { questions: RawQuestion[] }) | undefined> =
        fetch(`/api/challenges/pack?${packQuery}`)
          .then((res) => (res.ok ? res.json() : undefined))
          .then((json) => json?.pack as (QuizPack & { questions: RawQuestion[] }) | undefined)
          .catch(() => undefined);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      const sb = supabase;

      const match = await packPromise;
      if (!match) { router.replace("/challenges"); return; }

      setPack(match);
      setQuestions(match.questions ?? []);

      // Guest returning to a pack they've played before: surface their best so the
      // intro reads "beat it" rather than pretending this is a first visit. Signed-in
      // players get the server-backed priorAttempt instead, so skip it for them.
      if (!uid) setGuestBest(loadGuestBest(match.id));

      if (match.type === "club" || match.type === "national") {
        // Custom packs store the entity name in `parameter` (e.g. "Arsenal", "France").
        // Pre-built club packs have no parameter so fall back to the pack name itself.
        getTeamBadgeUrl(match.parameter || match.name).then((u: string | null) => { if (u) setBadgeUrl(u); });
      } else if (match.type === "end_of_season" && match.parameter) {
        // End-of-season packs (e.g. "Arsenal Are Champions") store the team name in `parameter`
        getTeamBadgeUrl(match.parameter).then((u: string | null) => {
          if (u) { setBadgeUrl(u); return; }
          getCompetitionBadgeUrl(match.name).then((cu: string | null) => { if (cu) setBadgeUrl(cu); });
        });
      } else {
        getCompetitionBadgeUrl(match.name).then((u: string | null) => { if (u) setBadgeUrl(u); });
      }

      // Show the playable intro NOW — the pack + questions above are everything
      // you need to start. The reads below (guest-score claim, prior attempt,
      // top-100 leaderboard) are browser→Supabase round-trips (~1s) that used to
      // be awaited BEFORE this line, so the game sat spinning for ~1s after it was
      // ready to play (measured: pack ready ~740ms, intro blocked until ~2000ms by
      // the leaderboard read). They're progressive: the intro renders immediately
      // and they fill in behind its own `leaderLoading` spinner. setPhase before
      // the awaits is the whole fix — the tail no longer gates the UI.
      setLeaderLoading(true);
      setPhase("intro");

      // A guest score waiting to be claimed? (They played signed-out, tapped
      // SIGN UP & SAVE SCORE, and are back with an account.) Submit it for
      // server-side grading BEFORE the attempt/leaderboard reads below, so the
      // page loads with their score already saved and on the board. (If it races
      // the leaderboard read, the `saved`→refetch effect corrects the board.)
      if (uid) {
        const pending = loadGuestResult();
        if (pending && pending.packId === match.id) {
          try {
            const res = await fetch("/api/quiz/solo-complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ packId: pending.packId, answers: pending.answers, acq: getAcq() }),
            });
            if (res.ok) {
              clearGuestResult();
              const result = await res.json();
              if (result.saved) setSaved(true);
            } else if (res.status !== 429) {
              clearGuestResult(); // unrecoverable (pack gone etc.) — don't retry forever
            }
          } catch { /* network blip — keep the pending result for the next visit */ }
        }
      }

      // Prior attempt + leaderboard are independent — one parallel wave, not two hops.
      const [attemptRes, lbRes] = await Promise.all([
        uid
          ? sb
              .from("quiz_attempts")
              .select("score, max_score, correct_count")
              .eq("user_id", uid)
              .eq("pack_id", match.id)
              .single()
          : Promise.resolve({ data: null }),
        sb
          .from("quiz_attempts")
          .select("user_id, score, correct_count, profiles(display_name)")
          .eq("pack_id", match.id)
          .order("score", { ascending: false })
          .limit(100),
      ]);
      if (attemptRes.data) setPriorAttempt(attemptRes.data);
      const lbRows = lbRes.data;
      if (lbRows) {
        setLeaderboard((lbRows as unknown as LeaderRow[]).map((r) => ({
          user_id: r.user_id,
          score: r.score,
          correct_count: r.correct_count,
          display_name: r.profiles?.display_name ?? null,
        })));
      }
      setLeaderLoading(false);
    })();
  }, [slug, pid, router]);

  const currentQ = questions[currentIdx];
  // Max score: sum of Lightning-speed points per question by difficulty
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q.difficulty ?? "medium"), 0);

  // Where sign-in sends the player back to. It MUST carry ?pid= when we have one: pack names
  // are not unique (there are two published packs called "Brighton", the live 2025/26 one and
  // a 2024/25 archive), and slug-only resolution scans published packs and is order-unstable
  // on a duplicate name. A guest who played the right pack, tapped SIGN UP & SAVE SCORE and
  // came back to the WRONG one would fail the `pending.packId === match.id` check, so their
  // run would be silently dropped and they would be staring at a leaderboard they never played.
  const returnPath = `/challenges/${slug}${pid ? `?pid=${encodeURIComponent(pid)}` : ""}`;
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(returnPath)}`;

  // ── Share helpers ─────────────────────────────────────────────────────────

  const fallbackUrl = typeof window !== "undefined"
    ? `${location.origin}/challenges/${slug}`
    : `https://yourscore.app/challenges/${slug}`;

  async function ensureShortUrl(): Promise<string> {
    if (shortUrl) return shortUrl;
    try {
      // Carry the result so the share card is a QUIZ scorecard (score + correct/total),
      // not the generic quiz promo or a 38-0 card.
      const correctCount = answerLog.filter((r) => r.correct).length;
      const res = await fetch("/api/draft/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: {
          challengeSlug: slug,
          qscore: String(score),
          qcorrect: String(correctCount),
          qtotal: String(answerLog.length),
        } }),
      });
      if (res.ok) {
        const { id } = await res.json();
        if (id) { const u = `${window.location.origin}/s/${id}`; setShortUrl(u); return u; }
      }
    } catch { /* keep fallback */ }
    return fallbackUrl;
  }

  const isWc2026 = pack?.metadata?.series === "wc2026";

  function quizBlurb(): string {
    if (isWc2026) return `I scored ${score.toLocaleString()} on the ${pack?.name ?? "YourScore Quiz"} @yourscore_app_ ⚽`;
    return `I scored ${score.toLocaleString()} on "${pack?.name ?? "YourScore Quiz"}" @yourscore_app_ 🧠`;
  }
  function openShare() { setShareOpen(true); void ensureShortUrl(); }
  async function nativeShare() {
    trackShare("challenge");
    const url = await ensureShortUrl();
    try {
      if (navigator.share) await navigator.share({ title: pack?.name ?? "YourScore Quiz", text: quizBlurb(), url });
      else { await navigator.clipboard.writeText(`${quizBlurb()} ${url}`); }
    } catch { /* user cancelled */ }
  }
  function shareX() {
    const u = shortUrl ?? fallbackUrl;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(quizBlurb())}&url=${encodeURIComponent(u)}`, "_blank", "noopener");
  }
  async function copyLink() {
    const url = await ensureShortUrl();
    try { await navigator.clipboard.writeText(`${quizBlurb()} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ }
  }

  // Auto-mint the short URL when results first appear so sharing is instant.
  useEffect(() => {
    if (phase !== "results") return;
    if (shortUrlMinted.current) return;
    shortUrlMinted.current = true;
    void ensureShortUrl();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Answer handler ─────────────────────────────────────────────────────
  async function handleAnswer(letter: Letter) {
    if (selected || revealed || advancing) return;

    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    const difficulty = currentQ.difficulty ?? "medium";
    const qIdx = currentIdx;

    // Show the tap immediately — the pack never told us the answer, so this is
    // a selection, not a verdict. Correct/incorrect styling waits for the
    // grading round trip below.
    setSelected(letter);

    let graded: { correct: boolean; answer: Letter } | null = null;
    if (pack) {
      try {
        const res = await fetch("/api/quiz/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packId: pack.id, idx: qIdx, letter }),
        });
        if (res.ok) {
          const json = await res.json();
          if (typeof json.correct === "boolean" && ["A", "B", "C", "D"].includes(json.answer)) {
            graded = { correct: json.correct, answer: json.answer as Letter };
          }
        }
      } catch {
        /* network blip — handled by the ungraded branch below */
      }
    }

    if (!graded) {
      // Grading failed. Never guess correctness client-side: record the pick
      // as ungraded (no points, no reveal colours) and keep the run moving.
      // /api/quiz/solo-complete re-grades every answer authoritatively at the
      // end, so a dropped request here costs UX polish, not score integrity.
      const record: AnswerRecord = { idx: qIdx, selected: letter, correct: false, points: 0, elapsed_ms: elapsed };
      const newLog = [...answerLog, record];
      setAnswerLog(newLog);
      setLastPoints(null);
      setLastSpeedLabel(null);
      setLastStreakBonus(0);
      setAdvancing(true);
      setTimeout(() => void advance(newLog), 900);
      return;
    }

    const isCorrect = graded.correct;
    const { points: pts, streakBonus, comebackBonus, nextCorrectStreak, nextWrongStreak } =
      scoreAnswer({
        isCorrect,
        elapsedMs: elapsed,
        difficulty,
        correctStreak,
        wrongStreak,
        windowMs: CHALLENGE_WINDOW_MS,
      });

    // Update streaks
    setCorrectStreak(nextCorrectStreak);
    setWrongStreak(nextWrongStreak);

    void haptic(isCorrect ? "correct" : "wrong"); // native-only buzz on reveal
    setRevealedAnswer(graded.answer);
    setRevealed(true);
    setLastPoints(isCorrect ? pts : null);
    setLastSpeedLabel(isCorrect ? getSpeedLabel(elapsed, CHALLENGE_WINDOW_MS) : null);
    setLastStreakBonus(streakBonus + comebackBonus);
    if (isCorrect) setScore((s) => s + pts);

    const record: AnswerRecord = { idx: qIdx, selected: letter, correct: isCorrect, points: pts, elapsed_ms: elapsed };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    setTimeout(() => void advance(newLog), 1800);

    // Continuation shared by the graded and ungraded paths: finish the round
    // or move to the next question. Pulled out so a failed grading call can
    // still advance the run instead of leaving it stuck.
    async function advance(newLog: AnswerRecord[]) {
      if (qIdx + 1 >= questions.length) {
        const correctCount = newLog.filter((r) => r.correct).length;
        if (correctCount === questions.length) void haptic("win"); // perfect round
        const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
        // Optimistic local total for instant display; the SAVED score is graded
        // server-side and overrides this if the request succeeds.
        let finalScore = newLog.reduce((s, r) => s + r.points, 0) + perfectBonus;
        if (userId && pack && !priorAttempt) {
          // Server-authoritative grade + save. The client can no longer write its
          // own quiz_attempts row (insert RLS policy dropped in migration 12).
          try {
            const res = await fetch("/api/quiz/solo-complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                packId: pack.id,
                answers: newLog.map((r) => ({ letter: r.selected, elapsedMs: r.elapsed_ms })),
                acq: getAcq(),
              }),
            });
            if (res.ok) {
              const result = await res.json();
              if (typeof result.score === "number") finalScore = result.score;
              if (result.saved) {
                setSaved(true);
                // Fire-and-forget: lifecycle email on the user's first attempt.
                const accuracy = Math.round((correctCount / questions.length) * 100);
                const bestStreak = newLog.reduce(
                  (acc, r) => {
                    const cur = r.correct ? acc.cur + 1 : 0;
                    return { cur, max: Math.max(acc.max, cur) };
                  },
                  { cur: 0, max: 0 },
                ).max;
                void fetch("/api/email/lifecycle", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    event: "first_challenge",
                    data: {
                      club: pack.name ?? "Football",
                      score: finalScore,
                      accuracy,
                      streak: bestStreak,
                    },
                  }),
                }).catch(() => {});
              }
            }
          } catch {
            /* network error — keep the optimistic local score on screen */
          }
        }
        // Guest: hold the finished run locally so signing up can claim it —
        // "SIGN UP & SAVE SCORE" then genuinely saves this exact run.
        if (!userId && pack) {
          saveGuestResult({
            packId: pack.id,
            answers: newLog.map((r) => ({ letter: r.selected, elapsedMs: r.elapsed_ms })),
            ts: Date.now(),
          });
          // Durable per-pack best (kept only if it beats the previous), so a return
          // visit shows "beat it". Independent of the save-on-signup buffer above.
          recordGuestBest(pack.id, { score: finalScore, correct: correctCount, total: questions.length, ts: Date.now() });
        }
        // Playing into a group board → record server-graded score for the board.
        if (groupId && userId) {
          void fetch("/api/challenge/play", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: groupId,
              answers: newLog.map((r) => ({ letter: r.selected, elapsedMs: r.elapsed_ms })),
            }),
          }).catch(() => {});
        }
        setScore(finalScore);
        trackGameComplete("quiz", { mode: groupId ? "group" : "solo", score: finalScore });
        setPhase("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setRevealed(false);
        setRevealedAnswer(null);
        setLastPoints(null);
        setLastSpeedLabel(null);
        setLastStreakBonus(0);
      }
      setAdvancing(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "#00d8c0", borderTopColor: "transparent" }} />
          <p className="font-display text-xs tracking-widest text-text-muted">LOADING…</p>
        </div>
      </div>
    );
  }

  // ── Intro ─────────────────────────────────────────────────────────────────
  if (phase === "intro" && pack) {
    const isRecords = pack.type === "records";
    const accent = isRecords ? "#aeea00" : "#00d8c0";
    const accentDim = isRecords ? "rgba(174,234,0,0.15)" : "rgba(0,216,192,0.15)";
    const accentBorder = isRecords ? "rgba(174,234,0,0.35)" : "rgba(0,216,192,0.35)";
    const gradientHero = isRecords
      ? "linear-gradient(175deg, #0e1611 0%, #0e1611 50%, #0a0a0f 100%)"
      : "linear-gradient(175deg, #1f1400 0%, #17100a 50%, #0a0a0f 100%)";

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <div className="relative" style={{ background: gradientHero }}>
          {/* Retrace: arriving from home's featured card goes back home, not /play */}
          <button
            type="button"
            onClick={() => router.push(smartBackTarget("/play"))}
            className="absolute left-5 flex items-center gap-1.5 font-body text-xs z-10"
            // Clear of the iPhone status bar / Dynamic Island: the old top-12
            // (48px) sat under the clock on notched phones.
            style={{ color: "rgba(255,255,255,0.5)", top: "calc(env(safe-area-inset-top, 0px) + 20px)" }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>

          <div className="flex flex-col items-center pt-20 pb-6 px-6">
            {pack.metadata?.cover_image ? (
              // The cover is a designed card (logo + title baked in) — show it
              // WHOLE: the image sets its own height, no fixed-aspect crop.
              // Sized so the PLAY button lands on the first screen (320px keeps
              // the whole cover visible AND the CTA above the fold at 390x844).
              <div className="relative w-full mb-5"
                style={{ maxWidth: 320, borderRadius: 22, overflow: "hidden",
                  border: `1.5px solid ${accentBorder}`,
                  boxShadow: `0 12px 40px ${isRecords ? "rgba(174,234,0,0.3)" : "rgba(255,140,0,0.25)"}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverUrl(pack.metadata.cover_image, 440) ?? pack.metadata.cover_image} alt={pack.name}
                  className="block w-full h-auto" />
              </div>
            ) : (
              <div className="relative flex items-center justify-center mb-5"
                style={{ width: 110, height: 110, borderRadius: 28, background: accentDim, border: `1.5px solid ${accentBorder}` }}>
                <div style={{ position: "absolute", inset: -8, borderRadius: 36,
                  background: isRecords ? "rgba(174,234,0,0.12)" : "rgba(0,216,192,0.12)", filter: "blur(12px)" }} />
                {badgeUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={badgeUrl} alt={pack.name} width={80} height={80}
                    style={{ objectFit: "contain", position: "relative", zIndex: 1,
                      filter: `drop-shadow(0 4px 16px ${isRecords ? "rgba(174,234,0,0.5)" : "rgba(0,216,192,0.5)"})` }} />
                ) : (
                  <span className="text-5xl relative z-1">{RECORDS_EMOJI[pack.name] ?? (isRecords ? "📊" : pack.name[0])}</span>
                )}
              </div>
            )}

            <h1 className="font-display text-2xl text-white text-center leading-tight mb-1">{pack.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-body text-xs px-3 py-1 rounded-full"
                style={{ background: accentDim, color: accent, border: `1px solid ${accentBorder}` }}>
                {isRecords ? "All-Time Records" : (pack.metadata?.club_topic ? (CLUB_TOPIC_LABEL[pack.metadata.club_topic] ?? "Club Quiz") : "2025/26 Season Game")}
              </span>
              <span className="font-body text-xs px-3 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "#9aa39d" }}>
                {questions.length} questions
              </span>
            </div>

            {/* Daily streak window countdown — only shows on a daily series quiz
                while the on-time (24h) window is open. */}
            {pack.metadata?.daily && pack.metadata?.date && (
              <div className="mt-3">
                <StreakWindowTimer date={pack.metadata.date} accent={accent} />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 px-5 py-6 flex flex-col gap-4">
          {priorAttempt && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.2)" }}>
              <span className="text-lg">🏆</span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-xs tracking-widest mb-0.5 text-green">YOUR LEADERBOARD SCORE</p>
                <p className="font-body text-xs text-text-muted">
                  <span className="font-display text-base text-white">{priorAttempt.score.toLocaleString()}</span>
                  {" "}pts · {priorAttempt.correct_count}/{questions.length} correct
                </p>
              </div>
            </div>
          )}

          {/* Guest's own previous best on this pack. Signed-in players see priorAttempt
              instead, so this only shows for a returning guest. It is the "beat it" nudge
              that stops a replay pretending to be a first visit. */}
          {!priorAttempt && guestBest && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.2)" }}>
              <span className="text-lg">🎯</span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-xs tracking-widest mb-0.5 text-teal">YOUR BEST · BEAT IT</p>
                <p className="font-body text-xs text-text-muted">
                  <span className="font-display text-base text-white">{guestBest.score.toLocaleString()}</span>
                  {" "}pts · {guestBest.correct}/{guestBest.total} correct
                </p>
              </div>
            </div>
          )}

          <>
              {/* Signed-in only. A guest's score never reaches the leaderboard, so telling them
                  "your first score counts" contradicted the "sign in first to save your score"
                  line 40px below it (ux-walk, 23 Jul). For guests that line says it all.
                  Gated on !leaderLoading: the intro now renders before the prior-attempt read
                  resolves, so until it does we don't yet know first-play vs practice — showing
                  this banner early would flash "your first score counts" at a returning player
                  who is actually in practice mode. It pops in (correct) the moment we know. */}
              {userId && !leaderLoading && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.25)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
                    <path d="M12 2a7 7 0 0 1 3.93 12.8c-.37.26-.58.67-.58 1.1V17a1 1 0 0 1-1 1h-4.7a1 1 0 0 1-1-1v-1.1c0-.43-.21-.84-.58-1.1A7 7 0 0 1 12 2z" stroke="#ffb700" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9.5 21h5" stroke="#ffb700" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <p className="font-body text-sm font-semibold" style={{ color: "#ffb700" }}>
                    {priorAttempt
                      ? "You’re playing for practice. Your leaderboard score is locked in."
                      : "Heads up: your first score counts on the leaderboard."}
                  </p>
                </div>
              )}

              {/* PLAY leads (2026-08-07 simplification): the button sits directly
                  under the hero, above description, scoring detail and the
                  leaderboard — one screen, one obvious action. */}
              <Button
                variant="primary"
                tone="teal"
                size="lg"
                fullWidth
                onClick={() => { window.scrollTo(0, 0); trackGamePlay("quiz", { mode: groupId ? "group" : "solo" }); setPhase("playing"); }}
                className="mt-1"
              >
                PLAY · {questions.length} Qs
              </Button>

              {!userId && (
                <p className="font-body text-xs text-center" style={{ color: "#586058" }}>
                  Playing as guest.{" "}
                  <Link href={signInHref}
                    style={{ color: "#aeea00", textDecoration: "underline" }}>Sign in first</Link>
                  {" "}to save your score
                </p>
              )}

              {/* Pack description */}
              {pack.description && (
                <p className="font-body text-sm text-center px-2" style={{ color: "#9aa39d", lineHeight: 1.6 }}>
                  {pack.description}
                </p>
              )}

              {/* Speed scoring — collapsed by default. Gameplay teaches the
                  mechanic; the detail is here for whoever wants it. */}
              <details className="rounded-2xl bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none">
                  <span className="text-base">⚡</span>
                  <p className="font-display text-sm text-white tracking-wide">How scoring works</p>
                  <span className="ml-auto font-body text-xs" style={{ color: "#586058" }}>Fast answers score more</span>
                </summary>
                <div className="flex items-center justify-between gap-2 px-4 pb-4">
                  {/* Real engine shape (scoring.ts): points = base × speed multiplier;
                      Lightning ×2 inside the first 20% of the 30s window. */}
                  {[
                    { time: "under 6s", pts: "×2", color: "#aeea00" },
                    { time: "under 12s", pts: "×1.5", color: "#00d8c0" },
                    { time: "slower", pts: "×1 ↓", color: "#ff4757" },
                  ].map(({ time, pts, color }) => (
                    <div key={time} className="flex-1 rounded-xl py-2.5 px-2 text-center"
                      style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
                      <p className="font-display text-sm" style={{ color }}>{pts}</p>
                      <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{time}</p>
                    </div>
                  ))}
                </div>
              </details>

              <PackLeaderboard entries={leaderboard} userId={userId} accent={accent} loading={leaderLoading} maxVisible={10} />
          </>
        </div>
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  if (phase === "playing" && currentQ) {
    const progressFilled = ((currentIdx + (revealed ? 1 : 0)) / questions.length) * 100;
    const diff = currentQ.difficulty?.toLowerCase() ?? "medium";
    const diffColor = DIFF_COLOR[diff] ?? "#00d8c0";
    const diffBg = DIFF_BG[diff] ?? "rgba(0,216,192,0.12)";
    const isRecords = pack?.type === "records";
    const accent = isRecords ? "#aeea00" : "#00d8c0";

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <GameHeader
          accent={accent}
          progressPct={progressFilled}
          progressGradient={isRecords ? "linear-gradient(90deg, #aeea00, #aeea00)" : "linear-gradient(90deg, #e65c00, #00d8c0)"}
          onQuit={() => {
            if (window.confirm("Quit? Your progress won't be saved.")) {
              stopTimer();
              setPhase("intro"); setCurrentIdx(0); setSelected(null);
              setRevealed(false); setScore(0); setAnswerLog([]); setLastPoints(null); setTimerMs(0);
            }
          }}
          timerMs={timerMs}
          timerFrozen={revealed}
          score={score}
          current={currentIdx + 1}
          total={questions.length}
          difficulty={diff}
          difficultyColor={diffColor}
          difficultyBg={diffBg}
        />

        {/* Question body */}
        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col">
          {currentQ.category && (
            <span className="font-body text-xs px-2.5 py-1 rounded-full capitalize mb-4 self-start"
              style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f" }}>
              {currentQ.category.replace(/_/g, " ")}
            </span>
          )}

          {/* Question card */}
          <div className="rounded-2xl p-5 mb-5"
            style={{ background: "linear-gradient(145deg, #0e1611 0%, #15211a 100%)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 100 }}>
            <p className="font-body text-base font-semibold text-white leading-relaxed">{currentQ.question}</p>
          </div>

          {/* `key` forces a remount on every question. Without it the buttons keep their DOM
              nodes across the change and `transition-all` animates the NEW option text out of
              the OLD question's reveal colours: for a few hundred ms the new question shows a
              wrong option glowing green as the correct answer. Remounting starts each question
              from the neutral state with nothing to transition from. */}
          <AnswerButtons
            key={currentIdx}
            options={currentQ.options}
            // Only meaningful once `revealed` is true; the pack never carries
            // an answer, so this is "" (matches no letter) until the grading
            // response for THIS question lands.
            answer={revealedAnswer ?? ""}
            selected={selected}
            revealed={revealed}
            accent={accent}
            onAnswer={handleAnswer}
          />

          {/* Reveal banner */}
          {revealed && revealedAnswer && (
            <div className="mt-4 rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{
                background: selected === revealedAnswer ? "rgba(174,234,0,0.08)" : "rgba(255,71,87,0.08)",
                border: `1px solid ${selected === revealedAnswer ? "rgba(174,234,0,0.22)" : "rgba(255,71,87,0.22)"}`,
              }}>
              <div>
                <span className="font-display text-lg tracking-wider"
                  style={{ color: selected === revealedAnswer ? "#aeea00" : "#ff4757" }}>
                  {selected === revealedAnswer ? "✓ CORRECT" : "✗ WRONG"}
                </span>
                {selected !== revealedAnswer && (
                  <p className="font-body text-xs mt-0.5 text-text-muted">
                    Answer: <span className="text-white">{currentQ.options[revealedAnswer]}</span>
                  </p>
                )}
              </div>
              {lastPoints !== null && (
                <div className="text-right">
                  <div className="font-display text-2xl text-teal">+{lastPoints.toLocaleString()}</div>
                  {lastSpeedLabel && (
                    <div className="font-body text-xs mt-0.5 text-text-muted">{lastSpeedLabel}</div>
                  )}
                  {lastStreakBonus > 0 && (
                    <div className="font-body text-xs" style={{ color: "#aeea00" }}>+{lastStreakBonus} bonus</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────────────────────
  // Lazy-loaded (next/dynamic, ssr:false) — its own component tree (rank card,
  // notify prompt, leaderboard, prediction poll, fantasy promo, versus rail)
  // no longer has to parse before the intro/playing phases can paint.
  if (phase === "results" && pack) {
    return (
      <ResultsView
        pack={pack}
        questions={questions}
        answerLog={answerLog}
        score={score}
        maxScore={maxScore}
        userId={userId}
        priorAttempt={priorAttempt}
        saved={saved}
        groupId={groupId}
        invitedUserId={invitedUserId}
        invitedName={invitedName}
        badgeUrl={badgeUrl}
        leaderboard={leaderboard}
        leaderLoading={leaderLoading}
        signInHref={signInHref}
        shareOpen={shareOpen}
        setShareOpen={setShareOpen}
        copied={copied}
        openShare={openShare}
        nativeShare={nativeShare}
        shareX={shareX}
        copyLink={copyLink}
      />
    );
  }

  return null;
}
