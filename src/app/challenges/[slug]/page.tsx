"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { smartBackTarget } from "@/lib/nav";
import { haptic } from "@/lib/haptics";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getTeamBadgeUrl } from "@/lib/teamImages";
import { coverUrl } from "@/lib/img";
import { getCompetitionBadgeUrl } from "@/lib/competitionImages";
import { AnswerButtons } from "@/components/game/AnswerButtons";
import { RankRewardCard } from "@/components/rank/RankRewardCard";
import { QuizNotifyPrompt } from "@/components/quiz/QuizNotifyPrompt";
import { StreakWindowTimer } from "@/components/quiz/StreakWindowTimer";
import HalftimePredictionPoll from "@/components/halftime/HalftimePredictionPoll";
import { useGameLoop } from "@/lib/useGameLoop";
import { Button } from "@/components/ui/Button";
import { BeatScoreRail } from "@/components/versus/BeatScoreRail";
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
  metadata?: {
    icon?: string;
    cover_image?: string;
    series?: string;
    daily?: boolean;
    date?: string;
    // Present only on halftime packs (release engine writes it) — the fixture
    // linkage that powers the end-of-pack prediction poll.
    halftime?: { fixture_id: number; home: string; away: string };
    // Present only on the pre-generated club topic packs (the /club/[slug] hub).
    // The category slug drives an honest label instead of "2025/26 Season Game".
    club_topic?: string;
  } | null;
}

// The four club topics carry a category slug; show its real name on the pack
// header. Anything without a club_topic keeps the generic season label.
const CLUB_TOPIC_LABEL: Record<string, string> = {
  "history-honours": "History & Honours",
  "legends": "Legends",
  "modern-era": "Modern Era",
  "rivalries-derbies": "Rivalries",
};

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

// Synthetic row id for the guest's own not-yet-saved score on the leaderboard.
const GUEST_ROW_ID = "__guest__";

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

function PackLeaderboard({ entries, userId, accent, loading, maxVisible = 10, approxRank }: {
  entries: LeaderEntry[];
  userId: string | null;
  accent: string;
  loading?: boolean;
  maxVisible?: number;
  /** The user's row sits below a full fetched page, so its true rank is "N or lower". */
  approxRank?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<"speed" | "accuracy">("speed");
  const MEDALS = ["🥇", "🥈", "🥉"];
  const RANK_COLORS = ["#00d8c0", "#9aa39d", "#cd7f32"];

  // Speed ranks by points (the default board); Accuracy ranks by most correct,
  // points breaking ties. Both derived from the same rows so switching is instant.
  const ranked = useMemo(() => {
    const copy = [...entries];
    copy.sort(mode === "accuracy"
      ? (a, b) => (b.correct_count - a.correct_count) || (b.score - a.score)
      : (a, b) => (b.score - a.score) || (b.correct_count - a.correct_count));
    return copy;
  }, [entries, mode]);
  const userRank = userId ? ranked.findIndex(e => e.user_id === userId) + 1 : 0;

  const visible = showAll ? ranked : ranked.slice(0, maxVisible);
  const hasMore = !showAll && ranked.length > maxVisible;
  const userOutsideVisible = userId && userRank > 0 && userRank > visible.length;

  function EntryRow({ entry, rank }: { entry: LeaderEntry; rank: number }) {
    const isUser = entry.user_id === userId;
    const rankLabel = isUser && approxRank ? `${rank}+` : rank;
    return (
      <div
        className="flex items-center gap-3 px-5 py-3 transition-colors"
        style={{
          background: isUser ? `${accent}0f` : undefined,
          borderLeft: isUser ? `3px solid ${accent}` : "3px solid transparent",
        }}>
        <span className="font-display text-sm w-7 text-center flex-shrink-0"
          style={{ color: rank <= 3 ? RANK_COLORS[rank - 1] : "#586058" }}>
          {rank <= 3 ? MEDALS[rank - 1] : rankLabel}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm truncate" style={{ color: isUser ? "#ffffff" : "#9aa39d" }}>
            {isUser
              ? `You${entry.display_name ? ` (${entry.display_name})` : ""}`
              : (entry.display_name ?? "Player")}
          </p>
          <p className="font-body text-xs mt-0.5" style={{ color: "#586058" }}>
            {mode === "accuracy" ? `${entry.score.toLocaleString()} pts` : `${entry.correct_count} correct`}
          </p>
        </div>
        <span className="font-display text-sm flex-shrink-0"
          style={{ color: isUser ? accent : "#8a948f" }}>
          {mode === "accuracy" ? entry.correct_count : entry.score.toLocaleString()}
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
            YOU #{userRank}{approxRank ? "+" : ""}
          </span>
        )}
      </div>
      {/* Rank by Speed (points) or Accuracy (most correct). */}
      {entries.length > 0 && (
        <div className="px-5 pb-3 flex gap-1.5">
          {(["speed", "accuracy"] as const).map((m) => {
            const on = mode === m;
            return (
              <button key={m} onClick={() => { setMode(m); setShowAll(false); }}
                className="flex-1 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
                style={on
                  ? { background: accent, color: "#0a0a0f" }
                  : { background: "rgba(255,255,255,0.04)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.08)" }}>
                {m === "speed" ? "Speed" : "Accuracy"}
              </button>
            );
          })}
        </div>
      )}
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
          {userOutsideVisible && ranked[userRank - 1] && (
            <>
              <div className="px-5 py-1 text-center">
                <span className="font-body text-xs" style={{ color: "#586058" }}>···</span>
              </div>
              <EntryRow entry={ranked[userRank - 1]} rank={userRank} />
            </>
          )}
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-3 font-body text-xs text-center transition-colors"
              style={{ color: accent, borderTop: "1px solid rgba(255,255,255,0.05)" }}
            >
              View full leaderboard ({ranked.length} scores) ↓
            </button>
          )}
          {showAll && ranked.length > maxVisible && (
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

      // A guest score waiting to be claimed? (They played signed-out, tapped
      // SIGN UP & SAVE SCORE, and are back with an account.) Submit it for
      // server-side grading BEFORE the attempt/leaderboard reads below, so the
      // page loads with their score already saved and on the board.
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
      setLeaderLoading(true);
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

      setPhase("intro");
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

    void haptic(isCorrect ? "correct" : "wrong"); // native-only buzz on reveal
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
          {/* Retrace: arriving from home's featured card goes back home, not /play */}
          <button
            type="button"
            onClick={() => router.push(smartBackTarget("/play"))}
            className="absolute top-12 left-5 flex items-center gap-1.5 font-body text-xs z-10"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>

          <div className="flex flex-col items-center pt-24 pb-8 px-6">
            {pack.metadata?.cover_image ? (
              // The cover is a designed card (logo + title baked in) — show it
              // WHOLE: the image sets its own height, no fixed-aspect crop.
              <div className="relative w-full mb-6"
                style={{ maxWidth: 440, borderRadius: 22, overflow: "hidden",
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
                onClick={() => { window.scrollTo(0, 0); trackGamePlay("quiz", { mode: groupId ? "group" : "solo" }); setPhase("playing"); }}
                className="mt-1"
              >
                START · {questions.length} Qs
              </Button>

              {!userId && (
                <p className="font-body text-xs text-center" style={{ color: "#586058" }}>
                  Playing as guest —{" "}
                  <Link href={signInHref}
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

          {/* `key` forces a remount on every question. Without it the buttons keep their DOM
              nodes across the change and `transition-all` animates the NEW option text out of
              the OLD question's reveal colours: for a few hundred ms the new question shows a
              wrong option glowing green as the correct answer. Remounting starts each question
              from the neutral state with nothing to transition from. */}
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

    // Rendered high in the column, straight under PLAY ANOTHER: a guest's prompt to keep
    // the score they just earned, or a signed-in player's confirmation that it stuck.
    // A function, not a value: it reads guestRank/guestApprox, which are computed below.
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
          {/* Halftime prediction poll — the second-half call. Sits first, above
              sharing: it is time-sensitive (the match is live now) and it is the
              hook that brings the player back for full time. Signed-in only. */}
          {userId && pack.metadata?.halftime && (
            <HalftimePredictionPoll packId={pack.id} accent={accent} />
          )}

          {/* The next loop is the primary action, not sharing. Two dominant share CTAs used
              to sit here and the only route to another game was the last thing on the page,
              four screens down. Play again leads; share is one secondary underneath (the
              share sheet already offers link / X / image, so the standalone X card is gone). */}
          <Button variant="primary" tone="teal" size="lg" fullWidth onClick={() => router.push("/play")}>
            PLAY ANOTHER →
          </Button>

          {/* Save-your-score sits directly under the payoff, above the leaderboard it refers
              to. It used to sit below the timing card, the rank card, the leaderboard and the
              difficulty breakdown, which is where the conversion moment went to die. */}
          {renderSaveScore()}

          <Button variant="ghost" tone="teal" size="md" fullWidth onClick={openShare}>
            📸 SHARE YOUR RESULT
          </Button>

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

          {/* Leaderboard — guests see their own run as a highlighted "You" row */}
          <PackLeaderboard entries={lbEntries} userId={userId ?? GUEST_ROW_ID} accent={accent} loading={leaderLoading} approxRank={guestApprox} />

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

  return null;
}
