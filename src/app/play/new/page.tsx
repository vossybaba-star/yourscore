/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, Suspense } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/Spinner";

interface QuizPack {
  id: string; name: string; type: string; parameter: string; question_count: number;
}

type RoomMode = "h2h" | "group" | "open";
type QuestionSource = "pack" | "filter";
type Difficulty = "easy" | "medium" | "hard" | "mixed";

const MODES: { key: RoomMode; label: string; desc: string; icon: string; max: string }[] = [
  { key: "h2h",   label: "1v1",     desc: "Just you vs one opponent",    icon: "⚔️",  max: "2 players" },
  { key: "group", label: "Private", desc: "Invite your crew, up to 8",   icon: "👥",  max: "Up to 8" },
  { key: "open",  label: "Public",  desc: "Anyone with the link can join", icon: "🌍",  max: "Up to 20" },
];

const COUNTS = [5, 10, 20];

const DIFFICULTIES: { key: Difficulty; label: string; color: string }[] = [
  { key: "easy",   label: "Easy",   color: "#4ade80" },
  { key: "medium", label: "Medium", color: "#ffb800" },
  { key: "hard",   label: "Hard",   color: "#f87171" },
  { key: "mixed",  label: "Mixed",  color: "#a78bfa" },
];

const POPULAR_ENTITIES = [
  "Arsenal", "Manchester City", "Liverpool", "Manchester United",
  "Chelsea", "Real Madrid", "Barcelona", "Bayern Munich",
  "Premier League", "Champions League", "World Cup", "La Liga",
];

function NewGameContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPackId = searchParams.get("packId");
  const { user, loading: userLoading } = useUser();
  const [step, setStep] = useState(1);

  // Step 1
  const [mode, setMode] = useState<RoomMode>("group");

  // Step 2
  const [source, setSource] = useState<QuestionSource>("pack");
  const [packs, setPacks] = useState<QuizPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [selectedPack, setSelectedPack] = useState<QuizPack | null>(null);
  const [entity, setEntity] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("mixed");

  // Step 3
  const [questionCount, setQuestionCount] = useState(10);
  const [roomName, setRoomName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Redirect guests
  useEffect(() => {
    if (!userLoading && !user) router.push("/auth/sign-in");
  }, [user, userLoading, router]);

  // If packId in URL (coming from quiz builder), pre-fetch and pre-select it
  useEffect(() => {
    if (!preselectedPackId) return;
    setSource("pack");
    setPacksLoading(true);
    createClient()
      .from("quiz_packs")
      .select("id, name, type, parameter, question_count")
      .eq("id", preselectedPackId)
      .single()
      .then(({ data }) => {
        if (data) {
          setSelectedPack(data as QuizPack);
          setPacks([data as QuizPack]); // seed list so step 2 renders it immediately
          setStep(2); // skip straight to pack confirmation
        }
        setPacksLoading(false);
      });
  }, [preselectedPackId]);

  // Load all packs when pack source selected (skip if already seeded by preselect)
  useEffect(() => {
    if (source !== "pack" || packs.length > 0) return;
    setPacksLoading(true);
    createClient()
      .from("quiz_packs").select("id, name, type, parameter, question_count")
      .eq("status", "published").eq("rotation_active", true).order("name")
      .then(({ data }) => {
        setPacks((data ?? []) as QuizPack[]);
        setPacksLoading(false);
      });
  }, [source, packs.length]);

  async function handleCreate() {
    if (!user) return;
    if (source === "pack" && !selectedPack) { setCreateError("Pick a quiz pack"); return; }
    if (source === "filter" && !entity.trim()) { setCreateError("Enter a topic or team"); return; }

    setCreating(true);
    setCreateError("");

    try {
      const res = await fetch("/api/room/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_mode: mode,
          question_count: questionCount,
          pack_id: source === "pack" ? selectedPack?.id : null,
          category_filter: source === "filter" ? entity.trim() : null,
          difficulty_filter: source === "filter" ? difficulty : "mixed",
          name: roomName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCreateError(data.error ?? "Failed to create"); setCreating(false); return; }
      router.push(`/play/${data.room.id}`);
    } catch {
      setCreateError("Network error");
      setCreating(false);
    }
  }

  const canAdvanceStep2 = source === "pack" ? !!selectedPack : entity.trim().length >= 2;

  if (userLoading) return <main className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={28} /></main>;

  return (
    <main className="min-h-dvh bg-bg pb-10">
      <GridBackground opacity={0.02} />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <button onClick={() => step > 1 ? setStep(s => s - 1) : router.push("/play")}
          className="flex items-center gap-2 font-body text-sm transition-opacity hover:opacity-70 text-text-muted">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {step > 1 ? "Back" : "Cancel"}
        </button>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map(s => (
            <div key={s} className="rounded-full transition-all"
              style={{ width: s === step ? 20 : 6, height: 6, background: s === step ? "#ffb800" : s < step ? "rgba(255,184,0,0.4)" : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>
        <span className="font-body text-xs" style={{ color: "#555577" }}>Step {step} of 3</span>
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-2 space-y-5">

        {/* ── STEP 1: Mode ────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div>
              <h2 className="font-display text-3xl text-white tracking-wide mb-1">Game mode</h2>
              <p className="font-body text-sm text-text-muted">Who are you playing with?</p>
            </div>

            <div className="space-y-3">
              {MODES.map(m => (
                <button key={m.key} onClick={() => setMode(m.key)}
                  className="w-full rounded-2xl px-5 py-4 flex items-center gap-4 transition-all active:scale-[0.99]"
                  style={{
                    background: mode === m.key ? "rgba(255,184,0,0.08)" : "#12121e",
                    border: `1px solid ${mode === m.key ? "rgba(255,184,0,0.45)" : "rgba(255,255,255,0.08)"}`,
                    boxShadow: mode === m.key ? "0 0 24px rgba(255,184,0,0.08)" : "none",
                  }}>
                  <span className="text-3xl flex-shrink-0">{m.icon}</span>
                  <div className="flex-1 text-left">
                    <p className="font-body text-base font-bold text-white">{m.label}</p>
                    <p className="font-body text-sm text-text-muted">{m.desc}</p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className="font-body text-xs px-2 py-1 rounded-full"
                      style={{ background: "rgba(255,255,255,0.06)", color: "#555577" }}>
                      {m.max}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={() => setStep(2)}
              className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all hover:opacity-90 bg-amber"
              style={{ color: "#0a0a0f" }}>
              Next →
            </button>
          </>
        )}

        {/* ── STEP 2: Questions ────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <div>
              <h2 className="font-display text-3xl text-white tracking-wide mb-1">Questions</h2>
              <p className="font-body text-sm text-text-muted">Pick a pack or choose a topic</p>
            </div>

            {/* Source toggle */}
            <div className="flex gap-1 p-1 rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {([["pack", "Quiz Pack"], ["filter", "Custom Topic"]] as [QuestionSource, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setSource(key)}
                  className="flex-1 py-2.5 rounded-xl font-body text-sm font-semibold transition-all"
                  style={source === key ? { background: "#ffb800", color: "#0a0a0f" } : { background: "transparent", color: "#8888aa" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Pack picker */}
            {source === "pack" && (
              <div>
                {packsLoading ? (
                  <div className="flex items-center justify-center py-10"><Spinner size={24} /></div>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1" style={{ scrollbarWidth: "none" }}>
                    {packs.map(pack => (
                      <button key={pack.id} onClick={() => setSelectedPack(pack)}
                        className="w-full rounded-2xl px-4 py-3 flex items-center gap-3 transition-all"
                        style={{
                          background: selectedPack?.id === pack.id ? "rgba(255,184,0,0.08)" : "#12121e",
                          border: `1px solid ${selectedPack?.id === pack.id ? "rgba(255,184,0,0.45)" : "rgba(255,255,255,0.07)"}`,
                        }}>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.18)" }}>
                          <span className="font-display text-sm text-amber">{pack.name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-body text-sm font-semibold text-white truncate">{pack.name}</p>
                          <p className="font-body text-xs" style={{ color: "#555577" }}>{pack.question_count} questions</p>
                        </div>
                        {selectedPack?.id === pack.id && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8l4 4 6-7" stroke="#ffb800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Filter picker */}
            {source === "filter" && (
              <div className="space-y-4">
                <div>
                  <p className="font-body text-xs font-semibold uppercase tracking-wider mb-2 text-text-muted">Team or Topic</p>
                  <input type="text" value={entity} onChange={e => setEntity(e.target.value)}
                    placeholder="e.g. Arsenal, World Cup, Premier League…"
                    className="w-full rounded-2xl px-4 py-3 font-body text-base text-white outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", caretColor: "#ffb800" }} />
                  <div className="flex flex-wrap gap-2 mt-2">
                    {POPULAR_ENTITIES.map(e => (
                      <button key={e} onClick={() => setEntity(e)}
                        className="px-3 py-1 rounded-full font-body text-xs transition-all"
                        style={{ background: entity === e ? "rgba(255,184,0,0.15)" : "rgba(255,255,255,0.05)", color: entity === e ? "#ffb800" : "#8888aa", border: `1px solid ${entity === e ? "rgba(255,184,0,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="font-body text-xs font-semibold uppercase tracking-wider mb-2 text-text-muted">Difficulty</p>
                  <div className="flex gap-2">
                    {DIFFICULTIES.map(d => (
                      <button key={d.key} onClick={() => setDifficulty(d.key)}
                        className="flex-1 py-2 rounded-xl font-body text-sm font-semibold transition-all"
                        style={{
                          background: difficulty === d.key ? `${d.color}20` : "rgba(255,255,255,0.04)",
                          border: `1px solid ${difficulty === d.key ? `${d.color}55` : "rgba(255,255,255,0.08)"}`,
                          color: difficulty === d.key ? d.color : "#8888aa",
                        }}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button onClick={() => setStep(3)} disabled={!canAdvanceStep2}
              className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
              style={{ background: canAdvanceStep2 ? "#ffb800" : "rgba(255,184,0,0.15)", color: canAdvanceStep2 ? "#0a0a0f" : "#555577" }}>
              Next →
            </button>
          </>
        )}

        {/* ── STEP 3: Settings + Create ─────────────────────────────────── */}
        {step === 3 && (
          <>
            <div>
              <h2 className="font-display text-3xl text-white tracking-wide mb-1">Settings</h2>
              <p className="font-body text-sm text-text-muted">Almost ready</p>
            </div>

            {/* Summary card */}
            <div className="rounded-2xl px-5 py-4 space-y-2 bg-surface border border-border">
              <div className="flex items-center justify-between">
                <span className="font-body text-xs uppercase tracking-wider" style={{ color: "#555577" }}>Mode</span>
                <span className="font-body text-sm font-semibold text-white">
                  {MODES.find(m => m.key === mode)?.icon} {MODES.find(m => m.key === mode)?.label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-body text-xs uppercase tracking-wider" style={{ color: "#555577" }}>Questions</span>
                <span className="font-body text-sm font-semibold text-white">
                  {source === "pack" ? selectedPack?.name : entity} {source === "filter" && `· ${difficulty}`}
                </span>
              </div>
            </div>

            {/* Question count */}
            <div>
              <p className="font-body text-xs font-semibold uppercase tracking-wider mb-2 text-text-muted">How many questions?</p>
              <div className="flex gap-3">
                {COUNTS.map(c => (
                  <button key={c} onClick={() => setQuestionCount(c)}
                    className="flex-1 py-3 rounded-2xl font-display text-2xl transition-all"
                    style={{
                      background: questionCount === c ? "rgba(255,184,0,0.12)" : "#12121e",
                      border: `1px solid ${questionCount === c ? "rgba(255,184,0,0.5)" : "rgba(255,255,255,0.08)"}`,
                      color: questionCount === c ? "#ffb800" : "#555577",
                    }}>
                    {c}
                    <span className="block font-body text-xs mt-0.5" style={{ color: questionCount === c ? "#ffb800" : "#444466" }}>
                      {c === 5 ? "~2 min" : c === 10 ? "~4 min" : "~8 min"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Lobby name */}
            <div>
              <p className="font-body text-xs font-semibold uppercase tracking-wider mb-2 text-text-muted">Lobby name (optional)</p>
              <input type="text" value={roomName} onChange={e => setRoomName(e.target.value.slice(0, 40))}
                placeholder="e.g. The Mates · Friday Night"
                className="w-full rounded-2xl px-4 py-3 font-body text-base text-white outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", caretColor: "#ffb800" }} />
            </div>

            {createError && (
              <p className="font-body text-sm text-center" style={{ color: "#f87171" }}>{createError}</p>
            )}

            <button onClick={handleCreate} disabled={creating}
              className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
              style={{ background: creating ? "rgba(255,184,0,0.15)" : "#ffb800", color: creating ? "#555577" : "#0a0a0f" }}>
              {creating ? "Creating…" : "Create Game 🎮"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function NewGamePage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={28} /></main>}>
      <NewGameContent />
    </Suspense>
  );
}
