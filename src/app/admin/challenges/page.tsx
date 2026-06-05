"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/utils";

// ── Parser (mirrors seed-challenges.mjs logic, runs in-browser) ───────────

interface ParsedQuestion {
  question_number: number;
  difficulty: string;
  category: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
}

interface ParsedChallenge {
  team: string;
  league: string;
  slug: string;
  title: string;
  questions: ParsedQuestion[];
}


function parseQuizText(text: string, league: string): ParsedChallenge[] {
  const lines = text.split("\n");
  const teams: ParsedChallenge[] = [];
  let currentTeam: string | null = null;
  let currentQuestions: ParsedQuestion[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Team header
    const teamMatch = line.match(/^(.+?)\s+[—–-]+\s+End of Season Quiz/);
    if (teamMatch) {
      if (currentTeam) teams.push({ team: currentTeam, league, slug: `${slugify(currentTeam)}-${league === "championship" ? "championship" : "pl"}-2526`, title: `${currentTeam} 2025/26`, questions: currentQuestions });
      currentTeam = teamMatch[1].trim();
      currentQuestions = [];
      i++;
      continue;
    }

    // Question header: Q1. [EASY] [season narrative]
    const qMatch = line.match(/^Q(\d+)\.\s+\[([^\]]+)\]\s+\[([^\]]+)\]/i);
    if (qMatch && currentTeam) {
      const num = parseInt(qMatch[1]);
      const rawDiff = qMatch[2].toLowerCase();
      const difficulty = ["easy", "medium", "hard"].includes(rawDiff) ? rawDiff : "medium";
      const category = qMatch[3].toLowerCase().replace(/\s+/g, "_");

      const questionLines: string[] = [];
      let optA = "", optB = "", optC = "", optD = "", correctAnswer = "";
      i++;

      while (i < lines.length && !lines[i].trim().match(/^A\)/)) {
        const l = lines[i].trim();
        if (l) questionLines.push(l);
        i++;
      }
      if (i < lines.length && lines[i].trim().match(/^A\)/)) { optA = lines[i].trim().replace(/^A\)\s*/, ""); i++; }
      if (i < lines.length && lines[i].trim().match(/^B\)/)) { optB = lines[i].trim().replace(/^B\)\s*/, ""); i++; }
      if (i < lines.length && lines[i].trim().match(/^C\)/)) { optC = lines[i].trim().replace(/^C\)\s*/, ""); i++; }
      if (i < lines.length && lines[i].trim().match(/^D\)/)) { optD = lines[i].trim().replace(/^D\)\s*/, ""); i++; }
      if (i < lines.length && lines[i].trim().match(/^Answer:/i)) {
        const m = lines[i].trim().match(/Answer:\s*([A-D])\)/i);
        correctAnswer = m ? m[1].toLowerCase() : "";
        i++;
      }

      currentQuestions.push({ question_number: num, difficulty, category, question_text: questionLines.join(" "), option_a: optA, option_b: optB, option_c: optC, option_d: optD, correct_answer: correctAnswer });
      continue;
    }

    i++;
  }

  if (currentTeam) teams.push({ team: currentTeam, league, slug: `${slugify(currentTeam)}-${league === "championship" ? "championship" : "pl"}-2526`, title: `${currentTeam} 2025/26`, questions: currentQuestions });
  return teams.filter(t => t.questions.length > 0);
}

// ── Existing challenges list ───────────────────────────────────────────────

interface Challenge {
  id: string;
  slug: string;
  title: string;
  team_name: string;
  league: string;
  question_count: number;
  is_active: boolean;
  created_at: string;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminChallengesPage() {
  const [rawText, setRawText] = useState("");
  const [league, setLeague] = useState<"premier-league" | "championship">("premier-league");
  const [preview, setPreview] = useState<ParsedChallenge[] | null>(null);
  const [parseError, setParseError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const supabase = createClient();

  function loadChallenges() {
    setLoadingList(true);
    supabase
      .from("challenges")
      .select("id, slug, title, team_name, league, question_count, is_active, created_at")
      .order("league")
      .order("team_name")
      .then(({ data }) => {
        setChallenges((data ?? []) as Challenge[]);
        setLoadingList(false);
      });
  }

  useEffect(() => { loadChallenges(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleParse() {
    setParseError("");
    setPreview(null);
    setUploadResult(null);
    if (!rawText.trim()) { setParseError("Paste quiz text first."); return; }
    const parsed = parseQuizText(rawText, league);
    if (!parsed.length) { setParseError("No teams detected. Check the format matches the template."); return; }
    const incomplete = parsed.filter(t => t.questions.length < 10);
    if (incomplete.length) {
      setParseError(`Warning: ${incomplete.map(t => `${t.team} (${t.questions.length} Qs)`).join(", ")} have fewer than 10 questions. Check formatting.`);
    }
    setPreview(parsed);
  }

  async function handleUpload() {
    if (!preview?.length) return;
    setUploading(true);
    setUploadResult(null);
    let ok = 0, failed = 0;

    const sb = supabase;
    for (const challenge of preview) {
      const { data: row, error: cErr } = await sb
        .from("challenges")
        .upsert({ slug: challenge.slug, title: challenge.title, team_name: challenge.team, league: challenge.league, season: "2025-26", question_count: challenge.questions.length, is_active: true }, { onConflict: "slug" })
        .select("id")
        .single();

      if (cErr || !row) { failed++; continue; }

      await sb.from("challenge_questions").delete().eq("challenge_id", row.id);

      const { error: qErr } = await sb.from("challenge_questions").insert(
        challenge.questions.map((q: ParsedQuestion) => ({ ...q, challenge_id: row.id }))
      );

      if (qErr) { failed++; } else { ok++; }
    }

    setUploadResult(`Done: ${ok} uploaded${failed ? `, ${failed} failed` : ""}.`);
    setUploading(false);
    setPreview(null);
    setRawText("");
    loadChallenges();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("challenges").delete().eq("id", id);
    setDeletingId(null);
    loadChallenges();
  }

  async function handleToggle(id: string, current: boolean) {
    await supabase.from("challenges").update({ is_active: !current }).eq("id", id);
    loadChallenges();
  }

  const totalQs = challenges.reduce((s, c) => s + c.question_count, 0);

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl text-white tracking-wide">CHALLENGES</h1>
        <p className="font-body text-sm mt-1" style={{ color: "#8888aa" }}>
          {challenges.length} quizzes · {totalQs} questions
        </p>
      </div>

      {/* Upload section */}
      <div
        className="rounded-2xl p-6 mb-8"
        style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <h2 className="font-display text-lg text-white mb-4">Upload Quiz</h2>

        {/* League picker */}
        <div className="flex gap-2 mb-4">
          {(["premier-league", "championship"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLeague(l)}
              className="px-4 py-2 rounded-xl font-body text-sm transition-all"
              style={{
                background: league === l ? "rgba(255,184,0,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${league === l ? "rgba(255,184,0,0.4)" : "rgba(255,255,255,0.08)"}`,
                color: league === l ? "#ffb800" : "#8888aa",
              }}
            >
              {l === "premier-league" ? "Premier League" : "Championship"}
            </button>
          ))}
        </div>

        {/* Format hint */}
        <div
          className="rounded-xl px-4 py-3 mb-4 font-body text-xs leading-relaxed"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#8888aa" }}
        >
          <p className="text-white font-semibold mb-1">Expected format:</p>
          <p>Arsenal — End of Season Quiz 2025/26</p>
          <p>==...</p>
          <p>Q1. [EASY] [season narrative]</p>
          <p>Question text here</p>
          <p>A) Option one &nbsp; B) Option two &nbsp; C) Option three &nbsp; D) Option four</p>
          <p>Answer: A) Option one</p>
          <p className="mt-1">Multiple teams per file OK. Each team separated by a new header.</p>
        </div>

        {/* Text area */}
        <textarea
          value={rawText}
          onChange={(e) => { setRawText(e.target.value); setPreview(null); setParseError(""); setUploadResult(null); }}
          placeholder="Paste your quiz text here…"
          rows={10}
          className="w-full rounded-xl px-4 py-3 font-body text-sm resize-y"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#ffffff",
            outline: "none",
          }}
        />

        {parseError && (
          <p className="mt-2 font-body text-xs" style={{ color: "#ffb800" }}>{parseError}</p>
        )}

        {uploadResult && (
          <p className="mt-2 font-body text-xs" style={{ color: "#00ff87" }}>{uploadResult}</p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleParse}
            disabled={!rawText.trim()}
            className="px-5 py-2.5 rounded-xl font-body text-sm font-semibold transition-all disabled:opacity-40"
            style={{ background: "rgba(255,184,0,0.12)", border: "1px solid rgba(255,184,0,0.3)", color: "#ffb800" }}
          >
            Parse & Preview
          </button>
          {preview && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-5 py-2.5 rounded-xl font-body text-sm font-semibold transition-all disabled:opacity-60"
              style={{ background: "#00ff87", color: "#0a0a0f" }}
            >
              {uploading ? "Uploading…" : `Upload ${preview.length} challenge${preview.length !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>

        {/* Preview */}
        {preview && (
          <div className="mt-5 space-y-2">
            <p className="font-display text-sm text-white">{preview.length} teams detected:</p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {preview.map((c) => {
                const easyCount = c.questions.filter(q => q.difficulty === "easy").length;
                const medCount = c.questions.filter(q => q.difficulty === "medium").length;
                const hardCount = c.questions.filter(q => q.difficulty === "hard").length;
                return (
                  <div
                    key={c.slug}
                    className="flex items-center justify-between rounded-xl px-3 py-2"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <span className="font-body text-sm text-white">{c.team}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-body text-xs" style={{ color: "#00ff87" }}>{easyCount}E</span>
                      <span className="font-body text-xs" style={{ color: "#ffb800" }}>{medCount}M</span>
                      <span className="font-body text-xs" style={{ color: "#ff4757" }}>{hardCount}H</span>
                      <span className="font-body text-xs font-semibold text-white">{c.questions.length}Q</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Existing challenges */}
      <div>
        <h2 className="font-display text-lg text-white mb-4">Existing Challenges</h2>

        {loadingList ? (
          <p className="font-body text-sm" style={{ color: "#8888aa" }}>Loading…</p>
        ) : challenges.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="font-body text-sm" style={{ color: "#8888aa" }}>No challenges yet. Upload your first quiz above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {challenges.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-4 rounded-xl px-4 py-3"
                style={{
                  background: "#12121e",
                  border: `1px solid ${c.is_active ? "rgba(0,255,135,0.1)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white truncate">{c.team_name}</p>
                  <p className="font-body text-xs mt-0.5" style={{ color: "#8888aa" }}>
                    {c.league === "premier-league" ? "PL" : "Championship"} · {c.question_count}Q · {c.slug}
                  </p>
                </div>

                <span
                  className="font-body text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    background: c.is_active ? "rgba(0,255,135,0.1)" : "rgba(255,255,255,0.05)",
                    color: c.is_active ? "#00ff87" : "#8888aa",
                    border: `1px solid ${c.is_active ? "rgba(0,255,135,0.2)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {c.is_active ? "Active" : "Hidden"}
                </span>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleToggle(c.id, c.is_active)}
                    className="font-body text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#aaaacc" }}
                  >
                    {c.is_active ? "Hide" : "Show"}
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={deletingId === c.id}
                    className="font-body text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                    style={{ background: "rgba(255,71,87,0.08)", border: "1px solid rgba(255,71,87,0.2)", color: "#ff4757" }}
                  >
                    {deletingId === c.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
