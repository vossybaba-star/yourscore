"use client";

// Results phase of the quiz, split out of page.tsx (2026-08-07 lazy-load pass).
// page.tsx pulls this in with next/dynamic({ ssr: false }) so its code doesn't
// block the initial parse of the intro/playing phases — the whole file used to
// be one 73KB client bundle and the intro couldn't paint until this parsed too.
// Mechanical extraction: same JSX, same behaviour, state lifted to props.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { RankRewardCard } from "@/components/rank/RankRewardCard";
import { QuizNotifyPrompt } from "@/components/quiz/QuizNotifyPrompt";
import HalftimePredictionPoll from "@/components/halftime/HalftimePredictionPoll";
import { FantasyPromoCard } from "@/components/fantasy/FantasyPromoCard";
import { FantasyResultInterstitial } from "@/components/fantasy/FantasyResultInterstitial";
import { BeatScoreRail } from "@/components/versus/BeatScoreRail";
import { trackShare } from "@/lib/analytics/trackGame";
import { DIFFICULTY_COLOR as DIFF_COLOR } from "@/lib/theme";
import { calculatePerfectRoundBonus } from "@/lib/scoring";
import { PackLeaderboard, GUEST_ROW_ID, type LeaderEntry } from "./PackLeaderboard";
import type { QuizPack, RawQuestion, AnswerRecord } from "./types";

// ── Timer helper (results-only after the playing header moved to GameHeader) ─

function timerDisplay(ms: number): string {
  return (ms / 1000).toFixed(2) + "s";
}

// ── Score-band copy (results-only) ────────────────────────────────────────

function scoreData(score: number, max: number) {
  const p = score / max;
  if (p >= 0.9) return { emoji: "🏆", label: "Elite Knowledge", color: "#00d8c0" };
  if (p >= 0.75) return { emoji: "⚡", label: "Sharp.", color: "#aeea00" };
  if (p >= 0.55) return { emoji: "⚽", label: "Decent.", color: "#4fc3f7" };
  if (p >= 0.35) return { emoji: "📚", label: "Keep watching.", color: "#aeea00" };
  return { emoji: "😬", label: "Back to basics.", color: "#ff4757" };
}

// ── ChallengeAFriendButton ────────────────────────────────────────────────
// Results-only, moved here wholesale from page.tsx.

interface ChallengeAFriendButtonProps {
  packId: string;
  packName: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  maxScore: number;
  invitedUserId?: string | null; // a specific friend (from ?challenge=) — else open link
  invitedName?: string | null;
}

function ChallengeAFriendButton({
  packId,
  packName,
  score,
  correctCount,
  totalQuestions,
  maxScore,
  invitedUserId,
  invitedName,
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
      // Server-side create: owns challenger lookup + targeting (invited_user_id)
      // + notifications. invitedUserId null = open link challenge.
      const res = await fetch("/api/h2h/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizPackId: packId,
          quizPackName: packName,
          score,
          correct: correctCount,
          totalQuestions,
          maxScore,
          invitedUserId: invitedUserId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.id) { setStatus("idle"); return; }
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

  // Native share sheet — works inside the iOS WKWebView (Web Share API), so the
  // app gets the real iMessage/WhatsApp sheet with no Capacitor plugin. Falls
  // back to copy when unavailable (most desktop browsers).
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  async function handleShare() {
    if (!link) return;
    trackShare("challenge-friend");
    try {
      await navigator.share({ text: `I scored ${score.toLocaleString()} on "${packName}" — can you beat it?`, url: link });
    } catch {
      void handleCopy();
    }
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
          <p className="font-display text-sm tracking-wide text-green">
            {invitedUserId ? `Sent to ${invitedName ?? "your friend"}!` : "Challenge created!"}
          </p>
          <p className="font-body text-xs text-text-muted">
            {invitedUserId ? "They'll see it in their Your Turns inbox" : "Share the link with a friend"}
          </p>
        </div>
      </div>

      <div className="rounded-xl px-3 py-2.5 font-body text-xs break-all bg-bg border border-border"
        style={{ color: "#8a948f" }}>
        {link}
      </div>

      {canShare && (
        <button
          onClick={handleShare}
          className="w-full rounded-xl py-3 font-display text-xs tracking-widest active:scale-[0.97] transition-transform"
          style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.4)", color: "#00d8c0" }}
        >
          SHARE
        </button>
      )}

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

// ── ResultsView ───────────────────────────────────────────────────────────

interface ResultsViewProps {
  pack: QuizPack;
  questions: RawQuestion[];
  answerLog: AnswerRecord[];
  score: number;
  maxScore: number;
  userId: string | null;
  priorAttempt: { score: number; max_score: number; correct_count: number } | null;
  saved: boolean;
  groupId: string | null;
  invitedUserId: string | null;
  invitedName: string | null;
  badgeUrl: string | null;
  leaderboard: LeaderEntry[];
  leaderLoading: boolean;
  signInHref: string;
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  copied: boolean;
  openShare: () => void;
  nativeShare: () => void;
  shareX: () => void;
  copyLink: () => void;
}

export default function ResultsView({
  pack,
  questions,
  answerLog,
  score,
  maxScore,
  userId,
  priorAttempt,
  saved,
  groupId,
  invitedUserId,
  invitedName,
  badgeUrl,
  leaderboard,
  leaderLoading,
  signInHref,
  shareOpen,
  setShareOpen,
  copied,
  openShare,
  nativeShare,
  shareX,
  copyLink,
}: ResultsViewProps) {
  const router = useRouter();

  const correctCount = answerLog.filter((r) => r.correct).length;
  const perfectBonus = calculatePerfectRoundBonus(correctCount, questions.length);
  // Accuracy is questions right, NOT score/maxScore. Score carries speed bonuses, so the
  // points ratio sat next to "7/15 Correct" reading 41% and the two numbers disagreed.
  // This matches the leaderboard's Accuracy sort (correct_count) and the profile's
  // lifetime accuracy, so one word means one thing everywhere.
  const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
  const isRecords = pack.type === "records";
  const accent = isRecords ? "#aeea00" : "#00d8c0";
  const { emoji, label, color } = scoreData(score, maxScore);
  const avgTime = answerLog.length
    ? Math.round(answerLog.reduce((s, r) => s + r.elapsed_ms, 0) / answerLog.length)
    : 0;
  const fastestMs = answerLog.length ? Math.min(...answerLog.map(r => r.elapsed_ms)) : 0;

  // Guest: splice this run into the board as a highlighted "You" row at its true
  // position (ties rank below existing equal scores), so they SEE the spot they'd
  // claim by signing up. If they'd fall below a full fetched page (25 rows), the
  // exact rank is unknown — shown as "N+".
  const guestIdx = !userId
    ? (() => { const i = leaderboard.findIndex((e) => score > e.score); return i === -1 ? leaderboard.length : i; })()
    : -1;
  const guestRank = guestIdx + 1;
  const guestApprox = !userId && guestIdx === leaderboard.length && leaderboard.length >= 25;
  const lbEntries = !userId
    ? [
        ...leaderboard.slice(0, guestIdx),
        { user_id: GUEST_ROW_ID, score, correct_count: correctCount, display_name: null },
        ...leaderboard.slice(guestIdx),
      ]
    : leaderboard;

  // Rendered high in the column, straight under PLAY ANOTHER: a guest's prompt to keep
  // the score they just earned, or a signed-in player's confirmation that it stuck.
  // A function, not a value: it reads guestRank/guestApprox, computed above.
  const renderSaveScore = () => userId ? (
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
          <p className="font-body text-sm font-semibold text-white">
            You&apos;d be #{guestRank}{guestApprox ? "+" : ""} on the leaderboard
          </p>
          <p className="font-body text-xs text-text-muted">Sign up to lock in your spot. This score is saved the moment you&apos;re in.</p>
        </div>
      </div>
      <Button variant="primary" tone="teal" size="md" fullWidth href={signInHref}>
        SIGN UP &amp; SAVE SCORE
      </Button>
    </div>
  );

  const byDiff = (["easy", "medium", "hard"] as const).map((d) => {
    const dQs = questions.map((q, i) => ({ q, i })).filter(({ q }) => (q.difficulty?.toLowerCase() ?? "medium") === d);
    const correct = dQs.filter(({ i }) => answerLog.find((r) => r.idx === i)?.correct).length;
    return { d, correct, total: dQs.length };
  }).filter(({ total }) => total > 0);

  return (
    <div className="min-h-screen flex flex-col bg-bg" style={{ paddingBottom: 40 }}>
      {/* A stored prior attempt can land here without playing this session —
          only a genuine just-finished result pops the interstitial. */}
      {answerLog.length > 0 && (
        <FantasyResultInterstitial surface="quiz" userId={userId} scoreLine={`${score.toLocaleString()} pts`} />
      )}

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
        {/* Pre-match prediction poll — appended to a Gameday pack attempt
            (§0.6). The halftime (second-half) poll never renders here — it
            stands alone on the matchweek page for every player, whether or
            not they played the quiz. Signed-in only.

            FIX P2-d: this used to gate on `Date.now() < kickoff_at`, so the
            poll — and a fan's own pick made minutes earlier — vanished the
            instant kickoff passed while they were still looking at their
            results screen. The mount is unconditional on kickoff now; the
            component's own self-hide contract (already correct — see its
            header) reads the fixture's server truth instead: it renders
            nothing only when the window is closed AND this player never
            picked AND nothing has settled. A player who finished before
            kickoff keeps seeing their pick, then the graded result once it
            settles; a player who finishes after kickoff with no pick on
            record sees nothing, exactly as §0.6 specifies. */}
        {userId && pack.metadata?.gameday && (
          <HalftimePredictionPoll fixtureId={pack.metadata.gameday.fixture_id} phase="prematch" accent={accent} />
        )}

        {/* The next loop is the primary action, not sharing. Two dominant share CTAs used
            to sit here and the only route to another game was the last thing on the page,
            four screens down. Play again leads; share is one secondary underneath (the
            share sheet already offers link / X / image, so the standalone X card is gone). */}
        <Button variant="primary" tone="teal" size="lg" fullWidth onClick={() => router.push("/play")}>
          PLAY ANOTHER
        </Button>

        {/* Save-your-score sits directly under the payoff, above the leaderboard it refers
            to. It used to sit below the timing card, the rank card, the leaderboard and the
            difficulty breakdown, which is where the conversion moment went to die. */}
        {renderSaveScore()}

        <Button variant="ghost" tone="teal" size="md" fullWidth onClick={openShare}>
          SHARE YOUR RESULT
        </Button>

        <FantasyPromoCard surface="quiz" />

        {/* Front door to the pack's standalone thread page — while the
            result's fresh, this is the only route to that page besides a
            push/inbox deep link. */}
        <Button variant="ghost" tone="teal" size="md" fullWidth href={`/play/pack/${pack.id}`}>
          💬 TALK ABOUT THIS QUIZ
        </Button>

        {/* Timing + difficulty — merged into one collapsed card ("Your round in
            detail") so the results column isn't two near-identical stat cards
            back to back. */}
        <details className="rounded-2xl bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <summary className="flex items-center gap-2 px-5 py-4 cursor-pointer list-none">
            <span className="text-base">📊</span>
            <p className="font-display text-sm text-white tracking-wide">Your round in detail</p>
            <span className="ml-auto font-body text-xs" style={{ color: "#586058" }}>Timing &amp; difficulty</span>
          </summary>
          <div className="px-5 pb-5 flex flex-col gap-5">
            <div>
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

            <div>
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
          </div>
        </details>

        {/* Post-game reward moment — mounts once the attempt is saved so the
            rank RPC reads post-game state (practice runs show position only) */}
        {(saved || priorAttempt) && <RankRewardCard />}

        {/* In-context push opt-in — broadens token capture from the results
            screen. Native-only; self-gates on prior prompt / existing opt-in. */}
        {userId && (saved || priorAttempt) && (
          <QuizNotifyPrompt userId={userId} accent={accent} daily={Boolean(pack.metadata?.daily)} />
        )}

        {/* Leaderboard — guests see their own run as a highlighted "You" row */}
        <PackLeaderboard entries={lbEntries} userId={userId ?? GUEST_ROW_ID} accent={accent} loading={leaderLoading} approxRank={guestApprox} />

        {/* The versus bridge — the result screen is the motivation peak.
            Recommend quizzes OTHER players have scored on (never this one —
            they've just seen its answers, which would rig the match); the
            rail falls back to a plain find-an-opponent button when empty. */}
        {userId && !groupId && <BeatScoreRail />}

        {userId && groupId ? (
          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={() => router.push(`/g/${groupId}`)}>
            SEE THE LEADERBOARD →
          </Button>
        ) : userId ? (
          <ChallengeAFriendButton
            packId={pack.id}
            packName={pack.name}
            score={score}
            correctCount={correctCount}
            totalQuestions={questions.length}
            maxScore={maxScore}
            invitedUserId={invitedUserId}
            invitedName={invitedName}
          />
        ) : null}

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
    </div>
  );
}
