"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { AnswerButtons } from "@/components/game/AnswerButtons";
import { RankRewardCard } from "@/components/rank/RankRewardCard";
import { QuizNotifyPrompt } from "@/components/quiz/QuizNotifyPrompt";
import { StreakWindowTimer } from "@/components/quiz/StreakWindowTimer";
import { useGameLoop } from "@/lib/useGameLoop";
import { Button } from "@/components/ui/Button";
import { trackGamePlay, trackGameComplete } from "@/lib/analytics/trackGame";
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

// Solo challenge question window — the reference duration for speed band calculation.
// Players can answer at any time; elapsed is capped at this value for scoring purposes.
const CHALLENGE_WINDOW_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────

interface QuizPack {
  id: string;
  name: string;
  type: string;
  parameter: string;
  question_count: number;
  description?: string | null;
  metadata?: { icon?: string; cover_image?: string; series?: string; daily?: boolean; date?: string } | null;
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
type Phase = "loading" | "intro" | "playing" | "results";

// ── Timer helpers ─────────────────────────────────────────────────────────

function timerColor(ms: number): string {
  if (ms < 5_000) return "#aeea00";
  if (ms < 10_000) return "#00d8c0";
  return "#ff4757";
}

function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

// ── Misc helpers ──────────────────────────────────────────────────────────


function scoreData(score: number, max: number) {
  const p = score / max;
  if (p >= 0.9) return { emoji: "🏆", label: "Elite Knowledge", color: "#00d8c0" };
  if (p >= 0.75) return { emoji: "⚡", label: "Sharp.", color: "#aeea00" };
  if (p >= 0.55) return { emoji: "⚽", label: "Decent.", color: "#4fc3f7" };
  if (p >= 0.35) return { emoji: "📚", label: "Keep watching.", color: "#aeea00" };
  return { emoji: "😬", label: "Back to basics.", color: "#ff4757" };
}

// ── ChallengeAFriendButton ────────────────────────────────────────────────

interface ChallengeAFriendButtonProps {
  packId: string;
  packName: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  maxScore: number;
  challengerId: string;
}

function ChallengeAFriendButton({
  packId,
  packName,
  score,
  correctCount,
  totalQuestions,
  maxScore,
  challengerId,
}: ChallengeAFriendButtonProps) {
  const [status, setStatus] = useState<"idle" | "creating" | "created">("idle");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const link = challengeId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/h2h/${challengeId}`
    : "";

  async function handleCreate() {
    if (status !== "idle") return;
    setStatus("creating");
    try {
      const supabase = createClient();

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", challengerId)
        .single();

      const challengerName = profile?.display_name ?? "Someone";

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from("h2h_challenges")
        .insert({
          quiz_pack_id: packId,
          quiz_pack_name: packName,
          challenger_id: challengerId,
          challenger_name: challengerName,
          challenger_score: score,
          challenger_correct: correctCount,
          total_questions: totalQuestions,
          max_score: maxScore,
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (error || !data) {
        setStatus("idle");
        return;
      }

      setChallengeId(data.id);
      setStatus("created");
    } catch {
      setStatus("idle");
    }
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const waText = encodeURIComponent(
    `I scored ${score.toLocaleString()} on "${packName}" — can you beat it? ${link}`
  );

  if (status === "idle") {
    return (
      <button
        onClick={handleCreate}
        className="w-full rounded-2xl py-4 font-display text-sm tracking-widest active:scale-[0.97] transition-transform text-green"
        style={{
          background: "transparent",
          border: "1.5px solid rgba(174,234,0,0.35)",
        }}
      >
        ⚔️ Challenge a friend
      </button>
    );
  }

  if (status === "creating") {
    return (
      <div className="w-full rounded-2xl py-4 flex items-center justify-center gap-3"
        style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.2)" }}>
        <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#aeea00", borderTopColor: "transparent" }} />
        <span className="font-body text-sm text-text-muted">Creating challenge…</span>
      </div>
    );
  }

  // created
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: "rgba(174,234,0,0.06)", border: "1px solid rgba(174,234,0,0.2)" }}>
      <div className="flex items-center gap-2">
        <span className="text-lg">⚔️</span>
        <div>
          <p className="font-display text-sm tracking-wide text-green">Challenge created!</p>
          <p className="font-body text-xs text-text-muted">Share the link with a friend</p>
        </div>
      </div>

      <div className="rounded-xl px-3 py-2.5 font-body text-xs break-all bg-bg border border-border"
        style={{ color: "#8a948f" }}>
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

      <a
        href="/challenges"
        className="block w-full text-center rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform border border-border"
        style={{
          background: "transparent",
          color: "#586058",
        }}
      >
        ← MORE CHALLENGES
      </a>
    </div>
  );
}

// ── PackLeaderboard ───────────────────────────────────────────────────────

interface LeaderEntry {
  user_id: string;
  score: number;
  correct_count: number;
  display_name: string | null;
}

// Shape of a quiz_attempts row joined with profiles, as read at the query boundary.
interface LeaderRow {
  user_id: string;
  score: number;
  correct_count: number;
  profiles: { display_name: string | null } | null;
}

function PackLeaderboard({ entries, userId, accent, loading, maxVisible = 10 }: {
  entries: LeaderEntry[];
  userId: string | null;
  accent: string;
  loading?: boolean;
  maxVisible?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const userRank = userId ? entries.findIndex(e => e.user_id === userId) + 1 : 0;
  const MEDALS = ["🥇", "🥈", "🥉"];
  const RANK_COLORS = ["#00d8c0", "#9aa39d", "#cd7f32"];

  const visible = showAll ? entries : entries.slice(0, maxVisible);
  const hasMore = !showAll && entries.length > maxVisible;
  const userOutsideVisible = userId && userRank > 0 && userRank > visible.length;

  function EntryRow({ entry, rank }: { entry: LeaderEntry; rank: number }) {
    const isUser = entry.user_id === userId;
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 transition-colors"
        style={{
          background: isUser ? `${accent}0f` : undefined,
          borderLeft: isUser ? `3px solid ${accent}` : "3px solid transparent",
        }}>
        <span className="font-display text-sm w-7 text-center flex-shrink-0"
          style={{ color: rank <= 3 ? RANK_COLORS[rank - 1] : "#586058" }}>
          {rank <= 3 ? MEDALS[rank - 1] : rank}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm truncate" style={{ color: isUser ? "#ffffff" : "#9aa39d" }}>
            {isUser
              ? `You${entry.display_name ? ` (${entry.display_name})` : ""}`
              : (entry.display_name ?? "Player")}
          </p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#586058" }}>
            {entry.correct_count} correct
          </p>
        </div>
        <span className="font-display text-sm flex-shrink-0"
          style={{ color: isUser ? accent : "#8a948f" }}>
          {entry.score.toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <p className="font-display text-xs tracking-widest" style={{ color: "#586058" }}>LEADERBOARD</p>
        {userRank > 0 && (
          <span className="font-display text-xs px-2 py-0.5 rounded-full"
            style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}30` }}>
            YOU #{userRank}
          </span>
        )}
      </div>
      {loading ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-xs" style={{ color: "#586058" }}>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-5 pb-5 text-center">
          <p className="font-body text-sm text-white mb-1">No scores yet</p>
          <p className="font-body text-xs" style={{ color: "#586058" }}>Be the first to set a score!</p>
        </div>
      ) : (
        <div className="pb-2">
          {visible.map((entry, idx) => (
            <EntryRow key={entry.user_id + idx} entry={entry} rank={idx + 1} />
          ))}
          {userOutsideVisible && entries[userRank - 1] && (
            <>
              <div className="px-5 py-1 text-center">
                <span className="font-body text-xs" style={{ color: "#586058" }}>···</span>
              </div>
              <EntryRow entry={entries[userRank - 1]} rank={userRank} />
            </>
          )}
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-3 font-body text-xs text-center transition-colors"
              style={{ color: accent, borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              View full leaderboard ({entries.length} scores) ↓
            </button>
          )}
          {showAll && entries.length > maxVisible && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full py-3 font-body text-xs text-center"
              style={{ color: "#586058", borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              Show less ↑
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ChallengePage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pid = searchParams.get("pid"); // custom pack direct-by-ID shortcut

  const [phase, setPhase] = useState<Phase>("loading");
  const [pack, setPack] = useState<QuizPack | null>(null);
  const [questions, setQuestions] = useState<RawQuestion[]>([]);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [priorAttempt, setPriorAttempt] = useState<{ score: number; max_score: number; correct_count: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [leaderLoading, setLeaderLoading] = useState(false);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [revealed, setRevealed] = useState(false);
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
  const [giveawayOpen, setGiveawayOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const giveawayShown = useRef(false);

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
      .limit(25)
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

    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      const sb = supabase;

      // Load pack content from the edge-cached route (/api/challenges/pack). It's
      // served from the nearest CDN region with no database hop — previously the
      // browser fetched EVERY published pack's full question set (110 packs) from
      // the eu-central-1 DB on every load, a transatlantic payload that tanked
      // Speed Insights for users far from the UK. Leaderboard/attempt below stay
      // client-side (user-specific, not cacheable).
      let match: (QuizPack & { questions: RawQuestion[] }) | undefined;
      try {
        const packQuery = pid
          ? `pid=${encodeURIComponent(pid)}`
          : `slug=${encodeURIComponent(slug)}`;
        const res = await fetch(`/api/challenges/pack?${packQuery}`);
        if (!res.ok) { router.replace("/challenges"); return; }
        const json = await res.json();
        match = json.pack as (QuizPack & { questions: RawQuestion[] }) | undefined;
      } catch {
        router.replace("/challenges"); return;
      }
      if (!match) { router.replace("/challenges"); return; }

      setPack(match);
      setQuestions(match.questions ?? []);

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

      if (uid) {
        const { data: attempt } = await sb
          .from("quiz_attempts")
          .select("score, max_score, correct_count")
          .eq("user_id", uid)
          .eq("pack_id", match.id)
          .single();
        if (attempt) setPriorAttempt(attempt);
      }

      // Fetch leaderboard
      setLeaderLoading(true);
      const { data: lbRows } = await sb
        .from("quiz_attempts")
        .select("user_id, score, correct_count, profiles(display_name)")
        .eq("pack_id", match.id)
        .order("score", { ascending: false })
        .limit(25);
      if (lbRows) {
        setLeaderboard((lbRows as unknown as LeaderRow[]).map((r) => ({
          user_id: r.user_id,
          score: r.score,
          correct_count: r.correct_count,
          display_name: r.profiles?.display_name ?? null,
        })));
      }
      setLeaderLoading(false);

      setPhase("intro");
    });
  }, [slug, pid, router]);

  const currentQ = questions[currentIdx];
  // Max score: sum of Lightning-speed points per question by difficulty
  const maxScore = questions.reduce((s, q) => s + maxPointsForDifficulty(q.difficulty ?? "medium"), 0);

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
  function giveawayTweetText(): string {
    if (isWc2026) return `I scored ${score.toLocaleString()} on the ${pack?.name ?? "YourScore Quiz"} @yourscore_app_ ⚽ Entering the daily £25 giveaway`;
    return `I scored ${score.toLocaleString()} on "${pack?.name ?? "YourScore Quiz"}" @yourscore_app_ 🧠 Entering the daily £25 giveaway`;
  }
  function giveawayTweetUrl(): string {
    const u = shortUrl ?? fallbackUrl;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(giveawayTweetText())}&url=${encodeURIComponent(u)}`;
  }
  function openShare() { setShareOpen(true); void ensureShortUrl(); }
  async function nativeShare() {
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

  // Auto-mint short URL + auto-open giveaway overlay when results first appear.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== "results") return;
    if (giveawayShown.current) return;
    giveawayShown.current = true;
    void ensureShortUrl();
    const t = setTimeout(() => setGiveawayOpen(true), 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Answer handler ─────────────────────────────────────────────────────
  async function handleAnswer(letter: Letter) {
    if (selected || revealed || advancing) return;

    stopTimer();
    const elapsed = Date.now() - questionStartRef.current;
    const isCorrect = letter === (currentQ.answer as Letter);
    const difficulty = currentQ.difficulty ?? "medium";

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

    setSelected(letter);
    setRevealed(true);
    setLastPoints(isCorrect ? pts : null);
    setLastSpeedLabel(isCorrect ? getSpeedLabel(elapsed, CHALLENGE_WINDOW_MS) : null);
    setLastStreakBonus(streakBonus + comebackBonus);
    if (isCorrect) setScore((s) => s + pts);

    const record: AnswerRecord = { idx: currentIdx, selected: letter, correct: isCorrect, points: pts, elapsed_ms: elapsed };
    const newLog = [...answerLog, record];
    setAnswerLog(newLog);

    setAdvancing(true);
    setTimeout(async () => {
      if (currentIdx + 1 >= questions.length) {
        const correctCount = newLog.filter((r) => r.correct).length;
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
        setScore(finalScore);
        trackGameComplete("quiz", { mode: "solo", score: finalScore });
        setPhase("results");
      } else {
        setCurrentIdx((i) => i + 1);
        setSelected(null);
        setRevealed(false);
        setLastPoints(null);
        setLastSpeedLabel(null);
        setLastStreakBonus(0);
      }
      setAdvancing(false);
    }, 1800);
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
          <Link
            href="/play"
            className="absolute top-12 left-5 flex items-center gap-1.5 font-body text-xs z-10"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Challenges
          </Link>

          <div className="flex flex-col items-center pt-24 pb-8 px-6">
            {pack.metadata?.cover_image ? (
              <div className="relative w-full mb-6"
                style={{ maxWidth: 440, aspectRatio: "3 / 2", borderRadius: 22, overflow: "hidden",
                  border: `1.5px solid ${accentBorder}`,
                  boxShadow: `0 12px 40px ${isRecords ? "rgba(174,234,0,0.3)" : "rgba(255,140,0,0.25)"}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pack.metadata.cover_image} alt={pack.name}
                  className="absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />
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
                {isRecords ? "All-Time Records" : "2025/26 Season Game"}
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

          <>
              {/* Pack description */}
              {pack.description && (
                <p className="font-body text-sm text-center px-2" style={{ color: "#9aa39d", lineHeight: 1.6 }}>
                  {pack.description}
                </p>
              )}

              {/* Speed scoring explainer */}
              <div className="rounded-2xl px-4 py-4 bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">⚡</span>
                  <p className="font-display text-sm text-white tracking-wide">Speed scoring</p>
                </div>
                <div className="flex items-center justify-between gap-2">
                  {[
                    { time: "Instant", pts: "1,000", color: "#aeea00" },
                    { time: "~5s", pts: "775", color: "#00d8c0" },
                    { time: "~10s", pts: "550", color: "#ff4757" },
                  ].map(({ time, pts, color }) => (
                    <div key={time} className="flex-1 rounded-xl py-2.5 px-2 text-center"
                      style={{ background: `${color}10`, border: `1px solid ${color}25` }}>
                      <p className="font-display text-sm" style={{ color }}>{pts}</p>
                      <p className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>{time}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,183,0,0.08)", border: "1px solid rgba(255,183,0,0.25)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
                  <path d="M12 2a7 7 0 0 1 3.93 12.8c-.37.26-.58.67-.58 1.1V17a1 1 0 0 1-1 1h-4.7a1 1 0 0 1-1-1v-1.1c0-.43-.21-.84-.58-1.1A7 7 0 0 1 12 2z" stroke="#ffb700" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M9.5 21h5" stroke="#ffb700" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="font-body text-sm font-semibold" style={{ color: "#ffb700" }}>
                  {priorAttempt
                    ? "You’re playing for practice — your leaderboard score is locked in."
                    : "Heads up: your first score counts on the leaderboard."}
                </p>
              </div>

              <Button
                variant="primary"
                tone="teal"
                size="lg"
                fullWidth
                onClick={() => { window.scrollTo(0, 0); trackGamePlay("quiz", { mode: "solo" }); setPhase("playing"); }}
                className="mt-1"
              >
                START · {questions.length} Qs
              </Button>

              {!userId && (
                <p className="font-body text-xs text-center" style={{ color: "#586058" }}>
                  Playing as guest —{" "}
                  <Link href={`/auth/sign-in?next=/challenges/${slug}`}
                    style={{ color: "#aeea00", textDecoration: "underline" }}>sign in first</Link>
                  {" "}to save your score
                </p>
              )}

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
    const tColor = timerColor(timerMs);

    return (
      <div className="min-h-screen flex flex-col bg-bg">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 pt-safe"
          style={{ background: "rgba(10,10,15,0.98)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full transition-all duration-700 ease-out"
              style={{ width: `${progressFilled}%`,
                background: isRecords ? "linear-gradient(90deg, #aeea00, #aeea00)" : "linear-gradient(90deg, #e65c00, #00d8c0)" }} />
          </div>

          <div className="px-5 py-3 flex items-center justify-between gap-3">
            {/* Quit */}
            <button
              onClick={() => {
                if (window.confirm("Quit? Your progress won't be saved.")) {
                  stopTimer();
                  setPhase("intro"); setCurrentIdx(0); setSelected(null);
                  setRevealed(false); setScore(0); setAnswerLog([]); setLastPoints(null); setTimerMs(0);
                }
              }}
              className="flex items-center gap-1.5 font-body text-xs flex-shrink-0"
              style={{ color: "#586058" }}
            >
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Quit
            </button>

            {/* Timer — counts up, colour-coded */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl flex-1 justify-center"
              style={{ background: `${tColor}10`, border: `1px solid ${tColor}28` }}>
              {/* Pulse dot */}
              <span style={{
                width: 7, height: 7, borderRadius: "50%", background: tColor, display: "inline-block",
                boxShadow: revealed ? "none" : `0 0 6px ${tColor}`,
                opacity: revealed ? 0.4 : 1,
              }} />
              <span className="font-display text-base tabular-nums" style={{ color: tColor, letterSpacing: "0.02em" }}>
                {timerDisplay(timerMs)}
              </span>
            </div>

            {/* Score */}
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{ background: `${accent}12`, border: `1px solid ${accent}25` }}>
              <span className="font-display text-sm" style={{ color: accent }}>{score.toLocaleString()}</span>
              <span className="font-body text-xs" style={{ color: "#5b645e" }}>pts</span>
            </div>
          </div>

          {/* Question counter */}
          <div className="px-5 pb-2.5 flex items-center gap-2">
            {badgeUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={badgeUrl} alt="" width={18} height={18} style={{ objectFit: "contain", opacity: 0.6 }} />
            )}
            <span className="font-body text-xs" style={{ color: "#586058" }}>
              Question <span className="text-white">{currentIdx + 1}</span> of {questions.length}
            </span>
            <span className="ml-auto font-display text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider"
              style={{ background: diffBg, color: diffColor, border: `1px solid ${diffColor}30` }}>
              {diff}
            </span>
          </div>
        </div>

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

          {/* Answer buttons */}
          <AnswerButtons
            options={currentQ.options}
            answer={currentQ.answer}
            selected={selected}
            revealed={revealed}
            accent={accent}
            onAnswer={handleAnswer}
          />

          {/* Reveal banner */}
          {revealed && (
            <div className="mt-4 rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{
                background: selected === (currentQ.answer as Letter) ? "rgba(174,234,0,0.08)" : "rgba(255,71,87,0.08)",
                border: `1px solid ${selected === (currentQ.answer as Letter) ? "rgba(174,234,0,0.22)" : "rgba(255,71,87,0.22)"}`,
              }}>
              <div>
                <span className="font-display text-lg tracking-wider"
                  style={{ color: selected === (currentQ.answer as Letter) ? "#aeea00" : "#ff4757" }}>
                  {selected === (currentQ.answer as Letter) ? "✓ CORRECT" : "✗ WRONG"}
                </span>
                {selected !== (currentQ.answer as Letter) && (
                  <p className="font-body text-xs mt-0.5 text-text-muted">
                    Answer: <span className="text-white">{currentQ.options[currentQ.answer as Letter]}</span>
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
  if (phase === "results" && pack) {
    const correctCount = answerLog.filter((r) => r.correct).length;
    const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
    const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const isRecords = pack.type === "records";
    const accent = isRecords ? "#aeea00" : "#00d8c0";
    const { emoji, label, color } = scoreData(score, maxScore);
    const avgTime = answerLog.length
      ? Math.round(answerLog.reduce((s, r) => s + r.elapsed_ms, 0) / answerLog.length)
      : 0;
    const fastestMs = answerLog.length ? Math.min(...answerLog.map(r => r.elapsed_ms)) : 0;

    const byDiff = (["easy", "medium", "hard"] as const).map((d) => {
      const dQs = questions.map((q, i) => ({ q, i })).filter(({ q }) => (q.difficulty?.toLowerCase() ?? "medium") === d);
      const correct = dQs.filter(({ i }) => answerLog.find((r) => r.idx === i)?.correct).length;
      return { d, correct, total: dQs.length };
    }).filter(({ total }) => total > 0);

    return (
      <div className="min-h-screen flex flex-col bg-bg" style={{ paddingBottom: 40 }}>
        {/* Hero */}
        <div className="relative flex flex-col items-center pt-16 pb-10 px-6"
          style={{ background: isRecords
            ? "linear-gradient(175deg, #0e1611 0%, #080d0a 60%, #0a0a0f 100%)"
            : "linear-gradient(175deg, #1f1200 0%, #12100a 60%, #0a0a0f 100%)" }}>
          {badgeUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={badgeUrl} alt={pack.name} width={52} height={52}
              style={{ objectFit: "contain", marginBottom: 16, opacity: 0.85,
                filter: `drop-shadow(0 4px 12px ${isRecords ? "rgba(174,234,0,0.4)" : "rgba(0,216,192,0.4)"})` }} />
          )}

          <div className="font-display text-7xl mb-1" style={{ color: accent }}>
            {score.toLocaleString()}
          </div>
          <p className="font-body text-sm mb-3 text-text-muted">
            out of {maxScore.toLocaleString()} pts
          </p>

          <div className="flex items-center gap-2 px-5 py-2.5 rounded-full"
            style={{ background: `${color}15`, border: `1px solid ${color}35` }}>
            <span className="text-xl">{emoji}</span>
            <span className="font-display text-base tracking-wide" style={{ color }}>{label}</span>
          </div>

          {perfectBonus > 0 && (
            <div className="flex items-center gap-2 mt-3 px-4 py-2 rounded-full"
              style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.25)" }}>
              <span className="text-base">🏆</span>
              <span className="font-body text-xs font-semibold text-green">
                Perfect round +{perfectBonus} pts
              </span>
            </div>
          )}

          <div className="flex items-center gap-6 mt-5">
            <div className="text-center">
              <div className="font-display text-2xl text-white">{correctCount}/{questions.length}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Correct</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl" style={{ color: accent }}>{pct}%</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Accuracy</div>
            </div>
            <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.08)" }} />
            <div className="text-center">
              <div className="font-display text-2xl text-green">{timerDisplay(fastestMs)}</div>
              <div className="font-body text-xs mt-0.5" style={{ color: "#8a948f" }}>Fastest</div>
            </div>
          </div>
        </div>

        <div className="px-5 flex flex-col gap-4 mt-2">
          {/* ── Giveaway CTA ── */}
          <button
            onClick={() => setGiveawayOpen(true)}
            className="w-full rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
            style={{ background: "linear-gradient(135deg, #1c1400, #221900)", border: "2px solid rgba(0,216,192,0.55)" }}
          >
            <div className="flex items-center gap-4 px-5 py-4">
              <div style={{ fontSize: 36, lineHeight: 1 }}>🏆</div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#00d8c0" }}>WIN £25 TODAY</div>
                <div className="font-body" style={{ fontSize: 13, color: "#a89060" }}>Share on 𝕏 to enter the daily giveaway →</div>
              </div>
            </div>
          </button>

          <button onClick={openShare} className="w-full rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#aeea00", color: "#062013", fontSize: 22 }}>
            📸 SHARE YOUR RESULT
          </button>

          {/* Timing stats */}
          <div className="rounded-2xl p-5 bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>YOUR TIMING</p>
            <div className="flex items-center justify-around">
              {[
                { label: "Avg time", value: timerDisplay(avgTime), color: "#9aa39d" },
                { label: "Fastest", value: timerDisplay(fastestMs), color: "#aeea00" },
                { label: "Points/Q", value: Math.round(score / Math.max(correctCount, 1)).toLocaleString(), color: accent },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <div className="font-display text-xl" style={{ color }}>{value}</div>
                  <div className="font-body text-xs mt-1" style={{ color: "#5b645e" }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Post-game reward moment — mounts once the attempt is saved so the
              rank RPC reads post-game state (practice runs show position only) */}
          {(saved || priorAttempt) && <RankRewardCard />}

          {/* In-context push opt-in — broadens token capture from the results
              screen. Native-only; self-gates on prior prompt / existing opt-in. */}
          {userId && (saved || priorAttempt) && (
            <QuizNotifyPrompt userId={userId} accent={accent} daily={Boolean(pack.metadata?.daily)} />
          )}

          {/* Leaderboard */}
          <PackLeaderboard entries={leaderboard} userId={userId} accent={accent} loading={leaderLoading} />

          {/* Difficulty breakdown */}
          <div className="rounded-2xl p-5 bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-display text-xs tracking-widest mb-4" style={{ color: "#586058" }}>BY DIFFICULTY</p>
            <div className="space-y-4">
              {byDiff.map(({ d, correct, total }) => (
                <div key={d} className="flex items-center gap-3">
                  <span className="font-body text-xs capitalize w-14 flex-shrink-0" style={{ color: DIFF_COLOR[d] }}>{d}</span>
                  <div className="flex-1 relative" style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}>
                    <div className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(correct / total) * 100}%`, background: DIFF_COLOR[d] }} />
                  </div>
                  <span className="font-display text-xs w-10 text-right text-text-muted">{correct}/{total}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sign-up / saved */}
          {userId ? (
            priorAttempt ? (
              <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
                style={{ background: "rgba(0,216,192,0.07)", border: "1px solid rgba(0,216,192,0.2)" }}>
                <span className="text-xl">🎯</span>
                <div>
                  <p className="font-display text-sm tracking-wide text-teal">Practice run</p>
                  <p className="font-body text-xs text-text-muted">
                    Your leaderboard score is still{" "}
                    <span className="text-white font-semibold">{priorAttempt.score.toLocaleString()}</span> pts
                  </p>
                </div>
              </div>
            ) : saved ? (
              <div className="rounded-2xl px-5 py-4 flex items-center gap-3"
                style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.2)" }}>
                <span className="text-xl">✓</span>
                <div>
                  <p className="font-display text-sm tracking-wide text-green">Score saved ✓</p>
                  <p className="font-body text-xs text-text-muted">You&apos;re on the leaderboard</p>
                </div>
              </div>
            ) : null
          ) : (
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(174,234,0,0.07)", border: "1px solid rgba(174,234,0,0.22)" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-2xl px-3 py-2 font-display text-xl"
                  style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>
                  {score.toLocaleString()}
                </div>
                <div>
                  <p className="font-body text-sm font-semibold text-white">Save your score</p>
                  <p className="font-body text-xs text-text-muted">See where you rank against everyone</p>
                </div>
              </div>
              <Button variant="primary" tone="teal" size="md" fullWidth href={`/auth/sign-in?next=/challenges/${slug}`}>
                SIGN UP &amp; SAVE SCORE
              </Button>
            </div>
          )}

          {userId && (
            <ChallengeAFriendButton
              packId={pack.id}
              packName={pack.name}
              score={score}
              correctCount={correctCount}
              totalQuestions={questions.length}
              maxScore={maxScore}
              challengerId={userId}
            />
          )}

          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={() => router.push("/challenges")}>
            MORE CHALLENGES →
          </Button>
        </div>

        {/* ── Share sheet ── */}
        {shareOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShareOpen(false)}>
            <div className="w-full max-w-lg rounded-t-3xl px-4 pt-3" style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />
              <button onClick={nativeShare} className="w-full mt-2 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#aeea00", color: "#062013", fontSize: 20 }}>
                🔗 Share link
              </button>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button onClick={shareX} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#fff", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>𝕏</button>
                <button onClick={() => { setShareOpen(false); void nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(225,48,108,0.12)", color: "#e1306c", fontSize: 15, border: "1px solid rgba(225,48,108,0.3)" }}>Instagram</button>
                <button onClick={() => { setShareOpen(false); void nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#c4ccc6", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>TikTok</button>
              </div>
              <button onClick={copyLink} className="w-full mt-2 flex items-center gap-3 px-4 py-3 rounded-2xl transition-all" style={{ background: copied ? "rgba(174,234,0,0.1)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.1)"}` }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="font-body text-sm font-semibold" style={{ color: copied ? "#aeea00" : "#9aa39d" }}>{copied ? "Copied!" : "Copy link"}</span>
              </button>
              <button onClick={() => setShareOpen(false)} className="w-full mt-2 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform" style={{ background: "transparent", color: "#8a948f", fontSize: 15 }}>Close</button>
            </div>
          </div>
        )}

        {/* ── Giveaway overlay ── */}
        {giveawayOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.9)" }} onClick={() => setGiveawayOpen(false)}>
            <div className="w-full max-w-lg px-4" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }} onClick={(e) => e.stopPropagation()}>
              <div className="rounded-3xl overflow-hidden" style={{ background: "#080d0a", border: "2px solid rgba(0,216,192,0.4)" }}>
                <div className="flex justify-center pt-3 pb-1">
                  <div className="rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.18)" }} />
                </div>
                <div className="px-6 pt-4 pb-7 text-center">
                  <div style={{ fontSize: 52, lineHeight: 1.1 }}>🏆</div>
                  <div className="font-body mt-3" style={{ fontSize: 11, color: "#00d8c0", letterSpacing: 3 }}>DAILY GIVEAWAY</div>
                  <div className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 80, color: "#fff" }}>£25</div>
                  <p className="font-body mt-3" style={{ fontSize: 15, color: "#c4ccc6", lineHeight: 1.6 }}>
                    Share your result on 𝕏 to enter.<br />
                    <span style={{ color: "#8a948f", fontSize: 13 }}>One winner drawn every 24 hours.</span>
                  </p>
                  <a href={giveawayTweetUrl()} target="_blank" rel="noopener noreferrer" onClick={() => setGiveawayOpen(false)}
                    className="flex items-center justify-center gap-3 w-full rounded-2xl py-4 mt-6 font-display tracking-wide active:scale-[0.98] transition-transform"
                    style={{ background: "#fff", color: "#000", fontSize: 20, textDecoration: "none", display: "flex" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="black">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    POST ON 𝕏 TO ENTER
                  </a>
                  <button onClick={() => setGiveawayOpen(false)} className="w-full mt-3 font-body" style={{ fontSize: 14, color: "#586058", background: "transparent", border: "none", cursor: "pointer" }}>
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
