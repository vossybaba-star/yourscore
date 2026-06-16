"use client";

/**
 * /l/[slug]/event/[eventId] — one Club League event: the quiz night.
 *
 * Members see the event board (+ their result). While the window is live and
 * they haven't played, they can start the quiz inline. Unlike solo challenges,
 * the correct answers NEVER reach the client (events can carry prizes) — the
 * API strips them, per-question feedback is a neutral "locked in", and the
 * final score arrives from server grading (/api/club/events/[id]/attempt).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { AnswerButtons } from "@/components/game/AnswerButtons";
import { BottomNav } from "@/components/ui/BottomNav";
import { Spinner } from "@/components/ui/Spinner";
import { BackPill } from "@/components/ui/BackPill";
import type { Letter } from "@/lib/theme";

const WINDOW_MS = 30_000; // per-question; keep in sync with the attempt API

interface EventQuestion {
  question: string;
  options: Record<string, string>;
  difficulty?: string;
  category?: string;
}

interface BoardEntry {
  position: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  correctCount: number;
}

interface EventPayload {
  event: {
    id: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    prizeText: string | null;
    window: "cancelled" | "upcoming" | "live" | "ended";
    questionCount: number;
  };
  league: { slug: string; name: string; brand_color: string | null; logo_url: string | null };
  board: BoardEntry[];
  myAttempt: { score: number; maxScore: number; correctCount: number } | null;
  canPlay: boolean;
  questions?: EventQuestion[];
}

type Phase = "idle" | "playing" | "submitting" | "done";

export default function ClubEventPage() {
  const params = useParams<{ slug: string; eventId: string }>();
  const { user, loading: userLoading } = useUser();

  const [data, setData] = useState<EventPayload | null>(null);
  const [errCode, setErrCode] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<Phase>("idle");
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [timeLeft, setTimeLeft] = useState(WINDOW_MS);
  const [result, setResult] = useState<{ score: number; maxScore: number; correctCount: number } | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // "T" = timed out (graded incorrect server-side).
  const answersRef = useRef<{ letter: Letter | "T"; elapsedMs: number }[]>([]);
  const qStartRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/club/events/${params.eventId}`);
      if (!r.ok) {
        setErrCode(r.status);
        setLoading(false);
        return;
      }
      setData((await r.json()) as EventPayload);
    } catch {
      setErrCode(0);
    }
    setLoading(false);
  }, [params.eventId]);

  useEffect(() => {
    if (!userLoading) load();
  }, [load, userLoading]);

  const questions = data?.questions ?? [];

  const submit = useCallback(
    async (answers: { letter: Letter | "T"; elapsedMs: number }[]) => {
      setPhase("submitting");
      try {
        const r = await fetch(`/api/club/events/${params.eventId}/attempt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answers }),
        });
        const d = await r.json();
        if (!r.ok) {
          setSubmitErr(d.error ?? "Could not save your score");
          setPhase("done");
          return;
        }
        setResult({ score: d.score, maxScore: d.maxScore, correctCount: d.correctCount });
        setPhase("done");
        load(); // refresh the board with my row on it
      } catch {
        setSubmitErr("Network error — your answers were not saved");
        setPhase("done");
      }
    },
    [params.eventId, load]
  );

  const advance = useCallback(
    (letter: Letter | null, elapsedMs: number) => {
      answersRef.current.push(
        letter ? { letter, elapsedMs } : { letter: "T", elapsedMs: WINDOW_MS }
      );
      if (timerRef.current) clearInterval(timerRef.current);

      const next = answersRef.current.length;
      if (next >= questions.length) {
        submit(answersRef.current);
        return;
      }
      setTimeout(() => {
        setIdx(next);
        setSelected(null);
        setTimeLeft(WINDOW_MS);
        qStartRef.current = Date.now();
        startTimer();
      }, 350);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions.length, submit]
  );

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  function startTimer() {
    timerRef.current = setInterval(() => {
      const left = WINDOW_MS - (Date.now() - qStartRef.current);
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        advanceRef.current(null, WINDOW_MS);
      }
    }, 100);
  }

  function startQuiz() {
    answersRef.current = [];
    setIdx(0);
    setSelected(null);
    setResult(null);
    setSubmitErr(null);
    setPhase("playing");
    setTimeLeft(WINDOW_MS);
    qStartRef.current = Date.now();
    startTimer();
  }

  function handleAnswer(letter: Letter) {
    if (selected) return;
    setSelected(letter);
    advance(letter, Date.now() - qStartRef.current);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading || userLoading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={28} />
      </main>
    );
  }

  if (errCode !== null || !data) {
    const msg =
      errCode === 401 ? "Sign in to see this event." :
      errCode === 403 ? "Join the club to see this event." :
      "This event doesn't exist or is no longer available.";
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-8 text-center">
        <p className="font-display text-4xl mb-3">🎯</p>
        <p className="font-body text-sm mb-6" style={{ color: "#8a948f" }}>{msg}</p>
        <Link href={`/l/${params.slug}`} className="rounded-xl px-5 py-3 font-body font-bold text-sm" style={{ background: "#aeea00", color: "#0a0a0f" }}>
          {errCode === 401 || errCode === 403 ? "Go to the club page" : "Back"}
        </Link>
      </main>
    );
  }

  const brand = data.league.brand_color || "#aeea00";
  const ev = data.event;

  // ── Playing ──
  if (phase === "playing" && questions.length > 0) {
    const q = questions[idx];
    const pct = (timeLeft / WINDOW_MS) * 100;
    return (
      <main className="min-h-dvh bg-bg flex flex-col max-w-lg mx-auto">
        <div className="px-5 pt-6 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="font-body text-xs" style={{ color: "#8a948f" }}>
              {idx + 1} / {questions.length} · {ev.title}
            </span>
            <span className="font-display text-base tabular-nums" style={{ color: timeLeft < 6000 ? "#ff4757" : "#fff" }}>
              {Math.ceil(timeLeft / 1000)}s
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: timeLeft < 6000 ? "#ff4757" : brand, transition: "width 0.1s linear" }} />
          </div>
        </div>
        <div className="flex-1 px-5 pb-10 pt-4 flex flex-col">
          <div className="rounded-2xl p-5 mb-5"
            style={{ background: "linear-gradient(145deg, #0e1611 0%, #15211a 100%)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 100 }}>
            <p className="font-body text-base font-semibold text-white leading-relaxed">{q.question}</p>
          </div>
          <AnswerButtons
            options={q.options}
            answer="" /* answers stay server-side for event integrity */
            selected={selected}
            revealed={false}
            accent={brand}
            onAnswer={handleAnswer}
          />
          {selected && (
            <p className="font-body text-xs text-center mt-4" style={{ color: "#586058" }}>
              Locked in — results at the end.
            </p>
          )}
        </div>
      </main>
    );
  }

  if (phase === "submitting") {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center gap-4">
        <Spinner size={28} />
        <p className="font-body text-sm" style={{ color: "#8a948f" }}>Grading your answers…</p>
      </main>
    );
  }

  // ── Idle / Done: event header + board ──
  const my = result ?? data.myAttempt;
  const chipColor = ev.window === "live" ? "#aeea00" : ev.window === "upcoming" ? "#60a5fa" : "#8a948f";

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-6 space-y-4">
        <BackPill href={`/l/${params.slug}`} label={data.league.name} tone="neutral" />

        <div className="rounded-2xl p-5" style={{ background: "#0e1611", border: `1px solid ${brand}33` }}>
          <span className="font-body text-xs font-bold px-2 py-0.5 rounded-md" style={{ color: chipColor, background: `${chipColor}1f` }}>
            {ev.window.toUpperCase()}
          </span>
          <h1 className="font-display text-2xl text-white tracking-wide mt-2 mb-1">{ev.title}</h1>
          {ev.description && <p className="font-body text-sm mb-2" style={{ color: "#9aa39d" }}>{ev.description}</p>}
          <p className="font-body text-xs" style={{ color: "#586058" }}>
            {new Date(ev.startsAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {" — "}
            {new Date(ev.endsAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {" · "}{ev.questionCount} questions
          </p>
          {ev.prizeText && (
            <div className="rounded-xl px-3 py-2 mt-3" style={{ background: "rgba(255,215,0,0.07)", border: "1px solid rgba(255,215,0,0.18)" }}>
              <p className="font-body text-xs" style={{ color: "#ffd700" }}>🏆 {ev.prizeText}</p>
            </div>
          )}
        </div>

        {submitErr && (
          <div className="rounded-xl px-4 py-2 font-body text-center" style={{ fontSize: 13, color: "#ff4757", background: "rgba(255,71,87,0.1)" }}>{submitErr}</div>
        )}

        {/* My result */}
        {my && (
          <div className="rounded-2xl p-5 text-center" style={{ background: `${brand}10`, border: `1px solid ${brand}44` }}>
            <p className="font-body text-xs uppercase tracking-widest mb-1" style={{ color: brand }}>Your score</p>
            <p className="font-display text-5xl text-white leading-none mb-1">{my.score.toLocaleString()}</p>
            <p className="font-body text-xs" style={{ color: "#8a948f" }}>{my.correctCount} correct · max {my.maxScore.toLocaleString()}</p>
          </div>
        )}

        {/* Play CTA */}
        {data.canPlay && !my && phase === "idle" && (
          <button
            onClick={startQuiz}
            className="w-full py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-transform"
            style={{ background: brand, color: "#0a0a0f" }}
          >
            START THE QUIZ →
          </button>
        )}
        {ev.window === "upcoming" && (
          <p className="font-body text-xs text-center" style={{ color: "#586058" }}>The quiz opens when the event starts.</p>
        )}

        {/* Board */}
        <div>
          <p className="font-body text-xs uppercase tracking-widest mb-2" style={{ color: "#586058" }}>Event board</p>
          {data.board.length === 0 ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm" style={{ color: "#8a948f" }}>No scores yet{ev.window === "live" ? " — be the first!" : "."}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.board.map((b) => {
                const isMe = b.userId === user?.id;
                return (
                  <div
                    key={b.userId}
                    className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{
                      background: isMe ? `${brand}14` : "#0e1611",
                      border: `1px solid ${isMe ? `${brand}44` : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <div className="w-8 text-center flex-shrink-0">
                      {b.position <= 3 ? (
                        <span className="text-base">{["🥇", "🥈", "🥉"][b.position - 1]}</span>
                      ) : (
                        <span className="font-display text-sm" style={{ color: "#8a948f" }}>#{b.position}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">
                        {b.displayName}
                        {isMe && <span className="font-normal ml-1.5" style={{ fontSize: "0.7rem", color: brand }}>you</span>}
                      </p>
                      <p className="font-body text-xs" style={{ color: "#586058" }}>{b.correctCount} correct</p>
                    </div>
                    <p className="font-display text-lg flex-shrink-0" style={{ color: b.position === 1 ? "#ffd700" : "#9aa39d" }}>
                      {b.score.toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
