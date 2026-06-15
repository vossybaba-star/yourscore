/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback } from "react";

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: "a" | "b" | "c" | "d";
  explanation: string | null;
  difficulty: "easy" | "medium" | "hard";
  category: string | null;
  timing_hint: string | null;
  approved: boolean;
}

const DIFF_COLOR = { easy: "#aeea00", medium: "#ffb800", hard: "#ff4757" };
const LETTERS = ["a", "b", "c", "d"] as const;
const LABELS = ["A", "B", "C", "D"];

const MOCK_QUESTIONS: Question[] = [
  {
    id: "q1", question_text: "How many World Cup goals has Kylian Mbappé scored?",
    option_a: "9 goals", option_b: "12 goals", option_c: "7 goals", option_d: "15 goals",
    correct_answer: "b", explanation: "Mbappé has 12 World Cup goals.", difficulty: "medium",
    category: "player_fact", timing_hint: "pre_match", approved: true,
  },
  {
    id: "q2", question_text: "When did England last win the World Cup?",
    option_a: "1962", option_b: "1970", option_c: "1966", option_d: "1958",
    correct_answer: "c", explanation: "England won in 1966 on home soil.", difficulty: "easy",
    category: "tournament", timing_hint: "pre_match", approved: false,
  },
];

export default function AdminQuestions({ params }: { params: { matchId: string } }) {
  const [questions, setQuestions] = useState<Question[]>(MOCK_QUESTIONS);
  const [matchName, setMatchName] = useState<string>("");
  const [homeTeam, setHomeTeam] = useState("England");
  const [awayTeam, setAwayTeam] = useState("France");
  const [generating, setGenerating] = useState(false);
  const [genCount, setGenCount] = useState(10);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "approved" | "pending">("all");

  const fetchQuestions = useCallback(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    // TODO(live-match): this admin tool targets the removed match-question model
    // (questions.match_id / approved). Needs migrating to the question bank +
    // question_events. Cast until then so the rest of the app keeps type safety.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("questions")
      .select("*")
      .eq("match_id", params.matchId)
      .order("created_at", { ascending: false });
    if (data && data.length > 0) setQuestions(data as Question[]);
  }, [params.matchId]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase.from("matches").select("home_team, away_team").eq("id", params.matchId).single()
        .then(({ data }) => {
          if (data) {
            setHomeTeam(data.home_team);
            setAwayTeam(data.away_team);
            setMatchName(`${data.home_team} vs ${data.away_team}`);
          }
        });
    });
    fetchQuestions();
  }, [params.matchId, fetchQuestions]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: params.matchId, homeTeam, awayTeam, count: genCount }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchQuestions();
        // In mock mode, append locally
        if (!process.env.NEXT_PUBLIC_SUPABASE_URL && data.questions) {
          const newQs: Question[] = data.questions.map((q: any, i: number) => ({
            id: `gen-${Date.now()}-${i}`,
            ...q,
            approved: false,
          }));
          setQuestions((prev) => [...newQs, ...prev]);
        }
      }
    } finally {
      setGenerating(false);
    }
  }

  async function toggleApprove(q: Question) {
    const next = !q.approved;
    setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, approved: next } : x));
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    await fetch("/api/admin/approve-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: q.id, approved: next }),
    });
  }

  const filtered = questions.filter((q) =>
    filter === "all" ? true : filter === "approved" ? q.approved : !q.approved
  );

  const approvedCount = questions.filter((q) => q.approved).length;

  return (
    <main className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl text-white tracking-wide">QUESTIONS</h1>
          <p className="font-body text-sm text-text-muted mt-1">
            {matchName || `${homeTeam} vs ${awayTeam}`} · {approvedCount}/{questions.length} approved
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span className="font-body text-xs text-text-muted">Generate</span>
            <select
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
              className="bg-transparent font-body text-sm text-white outline-none"
            >
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="px-5 py-2.5 rounded-xl font-body text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-2"
            style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.2)" }}
          >
            {generating ? (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Generating…
              </>
            ) : "✨ Generate with AI"}
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(["all", "approved", "pending"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-4 py-2 rounded-xl font-body text-xs font-semibold capitalize transition-all"
            style={{
              background: filter === f ? "rgba(174,234,0,0.1)" : "rgba(255,255,255,0.03)",
              color: filter === f ? "#aeea00" : "#8a948f",
              border: `1px solid ${filter === f ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {f} {f === "all" ? `(${questions.length})` : f === "approved" ? `(${approvedCount})` : `(${questions.length - approvedCount})`}
          </button>
        ))}
      </div>

      {/* Questions list */}
      <div className="space-y-2">
        {filtered.map((q) => (
          <div
            key={q.id}
            className="rounded-2xl overflow-hidden transition-all"
            style={{ background: "#0e1611", border: `1px solid ${q.approved ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.07)"}` }}
          >
            {/* Row */}
            <button
              className="w-full flex items-center gap-4 px-5 py-4 text-left"
              onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-medium text-white truncate">{q.question_text}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="font-body text-xs px-2 py-0.5 rounded-full" style={{ background: `${DIFF_COLOR[q.difficulty]}18`, color: DIFF_COLOR[q.difficulty] }}>
                    {q.difficulty}
                  </span>
                  {q.category && (
                    <span className="font-body text-xs text-text-muted capitalize">{q.category.replace("_", " ")}</span>
                  )}
                  {q.timing_hint && (
                    <span className="font-body text-xs text-text-muted">· {q.timing_hint.replace("_", " ")}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleApprove(q); }}
                  className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all hover:opacity-80"
                  style={{
                    background: q.approved ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.05)",
                    color: q.approved ? "#aeea00" : "#8a948f",
                    border: `1px solid ${q.approved ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {q.approved ? "✓ Approved" : "Approve"}
                </button>
                <span className="font-body text-xs text-text-muted">{expandedId === q.id ? "▲" : "▼"}</span>
              </div>
            </button>

            {/* Expanded */}
            {expandedId === q.id && (
              <div className="px-5 pb-5 space-y-3 border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <div className="pt-3 grid grid-cols-2 gap-2">
                  {LETTERS.map((l, i) => (
                    <div
                      key={l}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                      style={{
                        background: q.correct_answer === l ? "rgba(174,234,0,0.08)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${q.correct_answer === l ? "rgba(174,234,0,0.2)" : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      <span
                        className="w-6 h-6 rounded-lg flex items-center justify-center font-display text-xs flex-shrink-0"
                        style={{
                          background: q.correct_answer === l ? "#aeea00" : "rgba(255,255,255,0.06)",
                          color: q.correct_answer === l ? "#0a0a0f" : "#8a948f",
                        }}
                      >
                        {LABELS[i]}
                      </span>
                      <span className="font-body text-xs text-white">{(q as any)[`option_${l}`]}</span>
                    </div>
                  ))}
                </div>
                {q.explanation && (
                  <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="font-body text-xs text-text-muted leading-relaxed">💡 {q.explanation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="rounded-2xl p-10 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-text-muted text-sm">No questions yet. Hit &ldquo;Generate with AI&rdquo; to create some.</p>
          </div>
        )}
      </div>
    </main>
  );
}
