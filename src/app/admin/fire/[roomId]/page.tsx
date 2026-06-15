/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef } from "react";

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "a" | "b" | "c" | "d";
  difficulty: "easy" | "medium" | "hard";
  category: string | null;
  timing_hint: string | null;
}

interface LiveStats {
  total: number;
  a: number;
  b: number;
  c: number;
  d: number;
  correct: number;
}

const DIFF_COLOR = { easy: "#aeea00", medium: "#ffb800", hard: "#ff4757" };
const LETTERS = ["a", "b", "c", "d"] as const;
const LABELS = ["A", "B", "C", "D"];

const MOCK_QUESTIONS: Question[] = [
  {
    id: "q1", question_text: "How many World Cup goals has Kylian Mbappé scored for France?",
    option_a: "9 goals", option_b: "12 goals", option_c: "7 goals", option_d: "15 goals",
    correct_answer: "b", difficulty: "medium", category: "player_fact", timing_hint: "pre_match",
  },
  {
    id: "q2", question_text: "When did England last win the World Cup?",
    option_a: "1962", option_b: "1970", option_c: "1966", option_d: "1958",
    correct_answer: "c", difficulty: "easy", category: "tournament", timing_hint: "pre_match",
  },
  {
    id: "q3", question_text: "Which player holds the record for most goals in a single World Cup tournament?",
    option_a: "Ronaldo (Brazil)", option_b: "Just Fontaine", option_c: "Gerd Müller", option_d: "Eusébio",
    correct_answer: "b", difficulty: "hard", category: "tournament", timing_hint: "first_half",
  },
];

export default function FirePanel({ params }: { params: { roomId: string } }) {
  const [questions, setQuestions] = useState<Question[]>(MOCK_QUESTIONS);
  const [roomName, setRoomName] = useState<string>("Loading…");
  const [selectedQ, setSelectedQ] = useState<Question | null>(null);
  const [duration, setDuration] = useState(45);
  const [firing, setFiring] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [closesAt, setClosesAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [stats, setStats] = useState<LiveStats>({ total: 0, a: 0, b: 0, c: 0, d: 0, correct: 0 });
  const [firedIds, setFiredIds] = useState<Set<string>>(new Set());
  const supabaseRef = useRef<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setRoomName("The Mates' Lobby");
      return;
    }
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabaseRef.current = supabase;

      supabase.from("rooms").select("name, match_id").eq("id", params.roomId).single()
        .then(({ data }) => {
          if (data) {
            setRoomName(data.name);
            if (data.match_id) {
              // TODO(live-match): defunct match-question model (questions.match_id/approved);
              // migrate to the question bank + question_events.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (supabase as any).from("questions").select("*").eq("match_id", data.match_id).eq("approved", true)
                .then(({ data: qs }: { data: Question[] | null }) => { if (qs && qs.length > 0) setQuestions(qs as Question[]); });
            }
          }
        });
    });
  }, [params.roomId]);

  // Countdown timer for active question
  useEffect(() => {
    if (!closesAt) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const left = Math.max(0, closesAt.getTime() - Date.now());
      setTimeLeft(Math.ceil(left / 1000));
      if (left <= 0) {
        clearInterval(timerRef.current!);
        setActiveEventId(null);
        setClosesAt(null);
      }
    }, 200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [closesAt]);

  // Poll answers for live stats
  useEffect(() => {
    if (!activeEventId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const iv = setInterval(async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data } = await supabase
        .from("answers")
        .select("selected_answer, is_correct")
        .eq("question_event_id", activeEventId);
      if (data) {
        const s: LiveStats = { total: data.length, a: 0, b: 0, c: 0, d: 0, correct: 0 };
        for (const row of data) {
          s[row.selected_answer as "a" | "b" | "c" | "d"]++;
          if (row.is_correct) s.correct++;
        }
        setStats(s);
      }
    }, 1500);
    return () => clearInterval(iv);
  }, [activeEventId]);

  async function fire() {
    if (!selectedQ || firing) return;
    setFiring(true);
    try {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
        // Mock fire
        const eventId = `evt-${Date.now()}`;
        const closes = new Date(Date.now() + duration * 1000);
        setActiveEventId(eventId);
        setClosesAt(closes);
        setTimeLeft(duration);
        setStats({ total: 0, a: 0, b: 0, c: 0, d: 0, correct: 0 });
        setFiredIds((prev) => { const s = new Set(prev); s.add(selectedQ.id); return s; });
        // Simulate answers trickling in
        let count = 0;
        const sim = setInterval(() => {
          count++;
          setStats((s) => {
            const pick = LETTERS[Math.floor(Math.random() * 4)];
            return { ...s, total: s.total + 1, [pick]: s[pick] + 1, correct: pick === selectedQ.correct_answer ? s.correct + 1 : s.correct };
          });
          if (count >= 8) clearInterval(sim);
        }, 800);
        return;
      }
      const res = await fetch("/api/admin/fire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: selectedQ.id, roomId: params.roomId, durationSeconds: duration }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveEventId(data.eventId);
        setClosesAt(new Date(data.closesAt));
        setTimeLeft(duration);
        setStats({ total: 0, a: 0, b: 0, c: 0, d: 0, correct: 0 });
        setFiredIds((prev) => { const s = new Set(prev); s.add(selectedQ.id); return s; });
      }
    } finally {
      setFiring(false);
    }
  }

  const progressColor = timeLeft > 10 ? "#aeea00" : timeLeft > 5 ? "#ffb800" : "#ff4757";
  const totalResponses = stats.total || 1;

  return (
    <main className="p-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-4xl text-white tracking-wide">FIRE PANEL</h1>
        <p className="font-body text-sm text-text-muted mt-1">{roomName} · {params.roomId.slice(0, 8)}…</p>
      </div>

      <div className="grid grid-cols-[1fr,380px] gap-5">
        {/* Left: question picker */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">
            Approved questions ({questions.length})
          </p>
          <div className="space-y-2">
            {questions.map((q) => {
              const fired = firedIds.has(q.id);
              const selected = selectedQ?.id === q.id;
              return (
                <button
                  key={q.id}
                  disabled={fired || !!activeEventId}
                  onClick={() => setSelectedQ(selected ? null : q)}
                  className="w-full text-left px-4 py-4 rounded-2xl transition-all disabled:opacity-40"
                  style={{
                    background: selected ? "rgba(174,234,0,0.06)" : "#0e1611",
                    border: `1px solid ${selected ? "rgba(174,234,0,0.25)" : "rgba(255,255,255,0.07)"}`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{
                        background: selected ? "#aeea00" : fired ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.06)",
                        border: selected ? "none" : "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      {selected && <span style={{ color: "#0a0a0f", fontSize: 11 }}>✓</span>}
                      {fired && <span style={{ color: "#586058", fontSize: 11 }}>✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white leading-snug">{q.question_text}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className="font-body text-xs px-2 py-0.5 rounded-full"
                          style={{ background: `${DIFF_COLOR[q.difficulty]}18`, color: DIFF_COLOR[q.difficulty] }}
                        >
                          {q.difficulty}
                        </span>
                        {q.category && <span className="font-body text-xs text-text-muted capitalize">{q.category.replace("_", " ")}</span>}
                        {fired && <span className="font-body text-xs text-text-muted">· fired</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: fire controls + live stats */}
        <div className="space-y-4">
          {/* Fire button */}
          <div className="rounded-2xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-4">Fire question</p>

            {selectedQ ? (
              <div className="mb-4 rounded-xl p-3" style={{ background: "rgba(174,234,0,0.04)", border: "1px solid rgba(174,234,0,0.12)" }}>
                <p className="font-body text-xs text-text-muted mb-1">Selected</p>
                <p className="font-body text-sm text-white leading-snug line-clamp-2">{selectedQ.question_text}</p>
              </div>
            ) : (
              <div className="mb-4 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p className="font-body text-sm text-text-muted">← Select a question</p>
              </div>
            )}

            <div className="flex items-center gap-3 mb-4">
              <p className="font-body text-xs text-text-muted">Duration</p>
              <div className="flex gap-1.5">
                {[30, 45, 60].map((s) => (
                  <button
                    key={s}
                    onClick={() => setDuration(s)}
                    className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
                    style={{
                      background: duration === s ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.04)",
                      color: duration === s ? "#aeea00" : "#8a948f",
                      border: `1px solid ${duration === s ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.07)"}`,
                    }}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={fire}
              disabled={!selectedQ || firing || !!activeEventId}
              className="w-full py-4 rounded-xl font-display text-xl tracking-widest transition-all disabled:opacity-40"
              style={{
                background: selectedQ && !activeEventId ? "rgba(255,71,87,0.15)" : "rgba(255,255,255,0.04)",
                color: selectedQ && !activeEventId ? "#ff4757" : "#586058",
                border: `1px solid ${selectedQ && !activeEventId ? "rgba(255,71,87,0.3)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              {firing ? "FIRING…" : activeEventId ? "LIVE" : "🔥 FIRE"}
            </button>
          </div>

          {/* Live stats */}
          {(activeEventId || stats.total > 0) && (
            <div className="rounded-2xl p-5" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.1)" }}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-body text-xs text-text-muted uppercase tracking-widest">Live responses</p>
                <div className="flex items-center gap-3">
                  {activeEventId && (
                    <span className="font-body text-xs text-text-muted flex items-center gap-1">
                      <span className="font-display text-xl" style={{ color: progressColor }}>{timeLeft}</span>
                      <span>s left</span>
                    </span>
                  )}
                  <span className="font-body text-xs text-text-muted flex items-center gap-1">
                    <span className="font-display text-xl" style={{ color: "#aeea00" }}>{stats.total}</span>
                    <span>answers</span>
                  </span>
                </div>
              </div>

              {/* Answer bars */}
              <div className="space-y-2">
                {LETTERS.map((l, i) => {
                  const count = stats[l];
                  const pct = Math.round((count / totalResponses) * 100);
                  const isCorrect = selectedQ?.correct_answer === l;
                  const barColor = isCorrect ? "#aeea00" : "#8a948f";
                  return (
                    <div key={l}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 rounded-md flex items-center justify-center font-display text-xs"
                            style={{ background: isCorrect ? "#aeea00" : "rgba(255,255,255,0.08)", color: isCorrect ? "#0a0a0f" : "#8a948f" }}
                          >
                            {LABELS[i]}
                          </span>
                          <span className="font-body text-xs text-text-muted">{selectedQ ? (selectedQ as any)[`option_${l}`] : `Option ${LABELS[i]}`}</span>
                        </div>
                        <span className="font-body text-xs text-text-muted">{count} ({stats.total > 0 ? pct : 0}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${stats.total > 0 ? pct : 0}%`, background: barColor }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {stats.total > 0 && (
                <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <p className="font-body text-xs text-text-muted">Correct</p>
                  <p className="font-display text-xl" style={{ color: "#aeea00" }}>
                    {stats.correct}/{stats.total} ({Math.round((stats.correct / stats.total) * 100)}%)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
