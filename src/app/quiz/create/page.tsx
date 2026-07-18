"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";
import { Button } from "@/components/ui/Button";

// ── Constants ──────────────────────────────────────────────────────────────────

const CLUBS = [
  "Arsenal", "Aston Villa", "Birmingham City", "Blackburn Rovers", "Blackpool",
  "Bolton Wanderers", "Bournemouth", "Brentford", "Brighton", "Burnley",
  "Cardiff City", "Charlton Athletic", "Chelsea", "Crystal Palace", "Derby County",
  "Everton", "Fulham", "Hull City", "Ipswich Town", "Leeds United",
  "Leicester City", "Liverpool", "Luton Town", "Manchester City", "Manchester United",
  "Middlesbrough", "Newcastle United", "Norwich City", "Nottingham Forest", "Portsmouth",
  "QPR", "Reading", "Sheffield United", "Southampton", "Stoke City",
  "Sunderland", "Swansea City", "Tottenham Hotspur", "Watford", "West Bromwich Albion",
  "West Ham United", "Wigan Athletic", "Wolverhampton Wanderers",
];

const NATIONAL_TEAMS = [
  { name: "Argentina",    flag: "🇦🇷" },
  { name: "France",       flag: "🇫🇷" },
  { name: "Germany",      flag: "🇩🇪" },
  { name: "Brazil",       flag: "🇧🇷" },
  { name: "Spain",        flag: "🇪🇸" },
  { name: "England",      flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { name: "Portugal",     flag: "🇵🇹" },
  { name: "Netherlands",  flag: "🇳🇱" },
  { name: "Italy",        flag: "🇮🇹" },
  { name: "Croatia",      flag: "🇭🇷" },
  { name: "Belgium",      flag: "🇧🇪" },
  { name: "Morocco",      flag: "🇲🇦" },
  { name: "Uruguay",      flag: "🇺🇾" },
  { name: "Japan",        flag: "🇯🇵" },
  { name: "Colombia",     flag: "🇨🇴" },
  { name: "Mexico",       flag: "🇲🇽" },
  { name: "Switzerland",  flag: "🇨🇭" },
  { name: "USA",          flag: "🇺🇸" },
  { name: "Senegal",      flag: "🇸🇳" },
  { name: "South Korea",  flag: "🇰🇷" },
  { name: "Australia",    flag: "🇦🇺" },
  { name: "Denmark",      flag: "🇩🇰" },
  { name: "Poland",       flag: "🇵🇱" },
  { name: "Ghana",        flag: "🇬🇭" },
  { name: "Nigeria",      flag: "🇳🇬" },
];

const RECORD_TOPICS: { label: string; emoji: string; comingSoon?: boolean }[] = [
  { label: "Premier League Records",          emoji: "🏆" },
  { label: "Champions League Records",        emoji: "⭐" },
  { label: "World Cup Records",               emoji: "🌍",  comingSoon: true },
  { label: "Euro Championship Records",       emoji: "🇪🇺", comingSoon: true },
  { label: "Transfer Market Records",         emoji: "💰",  comingSoon: true },
  { label: "Legendary Club Seasons",          emoji: "📖",  comingSoon: true },
  { label: "Iconic Managers",                 emoji: "🎩",  comingSoon: true },
  { label: "Golden Boot & Individual Awards", emoji: "👟",  comingSoon: true },
  { label: "FA Cup Records",                  emoji: "🏅",  comingSoon: true },
];

const ERA_OPTIONS = [
  { value: "",          label: "All Time",       short: "All" },
  { value: "early-pl",  label: "Classic 90s–00s", short: "90s" },
  { value: "2010s",     label: "2010s",           short: "10s" },
  { value: "2020s",     label: "Modern 2020s",    short: "20s" },
  { value: "2024-25",   label: "This Season",     short: "Now" },
];

// Three tiers only. "Expert" and "Master" used to be offered here, but they're the residue of
// the old free-authored cohort — never fact-checked, and the source of questions like "How many
// PL goals did Haaland score for Man City in 2010-11?" (he was ten). The generator no longer
// serves them, so offering them would just 400. Nothing new is written at those levels either.
const DIFF_OPTIONS = [
  { value: "",       label: "Mixed",  dot: "#9aa39d" },
  { value: "easy",   label: "Easy",   dot: "#4ade80" },
  { value: "medium", label: "Medium", dot: "#00d8c0" },
  { value: "hard",   label: "Hard",   dot: "#f87171" },
];

// ── Step definitions ───────────────────────────────────────────────────────────

type FocusType = "club" | "national" | "records";

const CATEGORIES: { key: FocusType; label: string; icon: string; color: string; rgba: string; desc: string; comingSoon?: boolean }[] = [
  { key: "club",     label: "Club",          icon: "⚽", color: "#00d8c0", rgba: "0,216,192",   desc: "Pick a Premier League side" },
  { key: "national", label: "National Team", icon: "🌍", color: "#00c9ff", rgba: "0,201,255",   desc: "International football" },
  { key: "records",  label: "Records",       icon: "🏆", color: "#aeea00", rgba: "174,234,0", desc: "PL history, UCL, World Cup" },
];

// ── Quiz Builder ───────────────────────────────────────────────────────────────

export default function CreateQuizPage() {
  const router = useRouter();

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [focusType, setFocusType] = useState<FocusType | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [era, setEra] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [clubSearch, setClubSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Availability pre-check — how many verified questions exist for the pick.
  // null = unknown/not-yet-fetched; number = known count. Drives the readiness
  // hint and blocks generation when there aren't enough (server needs ≥5).
  const [availability, setAvailability] = useState<number | null>(null);
  const [availLoading, setAvailLoading] = useState(false);

  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);

  // Fetch availability whenever the entity or era changes (records topics use
  // the label as the entity, same as the generator). Debounced lightly so era
  // toggles don't spam the endpoint.
  useEffect(() => {
    if (!selectedEntity) { setAvailability(null); return; }
    let cancelled = false;
    setAvailLoading(true);
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ entity: selectedEntity });
        if (era) qs.set("era", era);
        const res = await fetch(`/api/quiz/availability?${qs.toString()}`);
        const json = await res.json();
        if (!cancelled) setAvailability(res.ok ? (json.count ?? 0) : null);
      } catch {
        if (!cancelled) setAvailability(null);
      } finally {
        if (!cancelled) setAvailLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [selectedEntity, era]);

  // Reset on category change
  useEffect(() => {
    setSelectedEntity(null);
    setClubSearch("");
    setEra("");
    setDifficulty("");
  }, [focusType]);

  // Auto-scroll to next step
  useEffect(() => {
    if (step === 2) {
      setTimeout(() => step2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
    if (step === 3) {
      setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }, [step]);

  const filteredClubs = CLUBS.filter((c) =>
    c.toLowerCase().includes(clubSearch.toLowerCase())
  );

  function handleCategorySelect(key: FocusType) {
    setFocusType(key);
    setStep(2);
  }

  function handleEntitySelect(name: string) {
    setSelectedEntity(name === selectedEntity ? null : name);
    if (step < 3) setStep(3);
  }

  async function handleGenerate() {
    if (!selectedEntity || !focusType || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const { data: { user } } = await createClient().auth.getUser();
      if (!user) {
        // Don't dead-end with an error — send them to sign in and back here.
        router.push("/auth/sign-in?next=/quiz/create");
        return;
      }

      const res = await fetch("/api/quiz/generate-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          entity: selectedEntity,
          entityType: focusType,
          era: era || undefined,
          difficulty: difficulty || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to generate quiz");
      // Redirect to the quiz ready page
      router.push(`/quiz/ready?packId=${json.packId}&slug=${encodeURIComponent(json.slug)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setGenerating(false);
    }
  }

  const activeCategory = CATEGORIES.find((c) => c.key === focusType);
  // Block generation when we know there aren't enough questions (server needs ≥5).
  // While availability is unknown (null) we don't block — the server is the
  // final authority and will return a clear message if it's genuinely short.
  const notEnough = availability !== null && availability < 5;
  const canGenerate = !!selectedEntity && !!focusType && !generating && !notEnough;

  return (
    <div className="bg-bg min-h-screen" style={{ paddingBottom: 120 }}>
      <style>{`
        @keyframes stepIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .step-in { animation: stepIn 0.3s ease-out both; }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .generating-shimmer {
          background: linear-gradient(90deg, #aeea00 0%, #00cc6a 40%, #aeea00 60%, #00cc6a 100%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: "rgba(10,10,15,0.97)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ maxWidth: 512, margin: "0 auto", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link href="/play" style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              textDecoration: "none",
            }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <div style={{ flex: 1 }}>
              <h1 style={{
                fontFamily: "var(--font-display, sans-serif)", fontSize: 20, fontWeight: 700,
                letterSpacing: "-0.01em", margin: 0, lineHeight: 1.1, color: "#ffffff",
              }}>
                Build a Quiz
              </h1>
            </div>

            {/* Step pill */}
            <div style={{
              padding: "4px 10px", borderRadius: 999,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 700,
              color: "#8a948f", letterSpacing: "0.04em",
            }}>
              {step === 1 ? "Pick category" : step === 2 ? "Pick team" : "Fine-tune"}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 10, height: 2, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: step === 1 ? "33%" : step === 2 ? "66%" : "100%",
              background: activeCategory ? `rgba(${activeCategory.rgba}, 0.8)` : "rgba(174,234,0,0.5)",
              transition: "width 0.4s ease, background 0.3s ease",
            }} />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 512, margin: "0 auto", padding: "24px 16px 0" }}>

        {/* ── STEP 1: Category ──────────────────────────────────────────── */}
        <div>
          <p style={{
            fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 700,
            letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a948f",
            marginBottom: 12,
          }}>
            {step === 1 ? "What kind of quiz?" : "Category"}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {CATEGORIES.map(({ key, label, icon, color, rgba, desc, comingSoon }) => {
              const active = focusType === key;
              return (
                <button
                  key={key}
                  onClick={() => !comingSoon && handleCategorySelect(key)}
                  disabled={comingSoon}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 8,
                    padding: "16px 8px",
                    borderRadius: 16, cursor: comingSoon ? "default" : "pointer",
                    transition: "all 0.18s ease",
                    opacity: comingSoon ? 0.45 : 1,
                    background: active ? `rgba(${rgba},0.14)` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${active ? `rgba(${rgba},0.5)` : "rgba(255,255,255,0.08)"}`,
                    boxShadow: active ? `0 0 20px rgba(${rgba},0.15)` : "none",
                    transform: active ? "scale(1.02)" : "scale(1)",
                  }}
                >
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{icon}</span>
                  <div>
                    <p style={{
                      fontFamily: "var(--font-display, sans-serif)", fontSize: 12, fontWeight: 700,
                      color: active ? color : "#ffffff", textAlign: "center", margin: 0,
                    }}>{label}</p>
                    <p style={{
                      fontFamily: "var(--font-body, sans-serif)", fontSize: 10,
                      color: comingSoon ? "#586058" : active ? `rgba(${rgba},0.7)` : "#5b645e",
                      textAlign: "center", marginTop: 2, lineHeight: 1.3,
                    }}>{desc}</p>
                  </div>
                  {active && (
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: color, boxShadow: `0 0 6px ${color}`,
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── STEP 2: Team / Topic ──────────────────────────────────────── */}
        {focusType && (
          <div
            ref={step2Ref}
            className="step-in"
            style={{ marginTop: 28 }}
          >
            <p style={{
              fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a948f",
              marginBottom: 12,
            }}>
              {focusType === "club" ? "Pick a club" : focusType === "national" ? "Pick a nation" : "Pick a topic"}
            </p>

            {focusType === "club" && (
              <>
                <input
                  type="text"
                  placeholder="Search clubs..."
                  value={clubSearch}
                  onChange={(e) => setClubSearch(e.target.value)}
                  className="text-white"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "10px 14px", borderRadius: 12, marginBottom: 10,
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    fontFamily: "var(--font-body, sans-serif)", fontSize: 14, outline: "none",
                    transition: "border-color 0.15s ease",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(0,216,192,0.4)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                  {filteredClubs.map((club) => {
                    const isSelected = selectedEntity === club;
                    const badge = getTeamBadgeUrlSync(club);
                    return (
                      <button
                        key={club}
                        onClick={() => handleEntitySelect(club)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center",
                          justifyContent: "center", gap: 5,
                          padding: "10px 4px", borderRadius: 12, height: 76,
                          cursor: "pointer", transition: "all 0.15s ease",
                          background: isSelected ? "rgba(0,216,192,0.12)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${isSelected ? "rgba(0,216,192,0.55)" : "rgba(255,255,255,0.07)"}`,
                          boxShadow: isSelected ? "0 0 14px rgba(0,216,192,0.18)" : "none",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {badge && <img src={badge} alt={club} width={34} height={34}
                          style={{ objectFit: "contain", filter: isSelected ? "drop-shadow(0 1px 6px rgba(0,216,192,0.4))" : "none" }} />}
                        <span style={{
                          fontFamily: "var(--font-body, sans-serif)", fontSize: 9,
                          color: isSelected ? "#00d8c0" : "#9aa39d", fontWeight: 600,
                          textAlign: "center", lineHeight: 1.2,
                          overflow: "hidden", display: "-webkit-box",
                          WebkitLineClamp: 2, WebkitBoxOrient: "vertical", width: "100%",
                        }}>
                          {club}
                        </span>
                      </button>
                    );
                  })}
                  {filteredClubs.length === 0 && (
                    <p style={{ gridColumn: "span 4", textAlign: "center", padding: "24px 0", color: "#586058", fontFamily: "var(--font-body, sans-serif)", fontSize: 13 }}>
                      No clubs found
                    </p>
                  )}
                </div>
              </>
            )}

            {focusType === "national" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {NATIONAL_TEAMS.map(({ name }) => {
                  const isSelected = selectedEntity === name;
                  const badge = getTeamBadgeUrlSync(name);
                  return (
                    <button
                      key={name}
                      onClick={() => handleEntitySelect(name)}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: 5,
                        padding: "12px 4px", borderRadius: 12, height: 76,
                        cursor: "pointer", transition: "all 0.15s ease",
                        background: isSelected ? "rgba(0,201,255,0.12)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isSelected ? "rgba(0,201,255,0.55)" : "rgba(255,255,255,0.07)"}`,
                        boxShadow: isSelected ? "0 0 14px rgba(0,201,255,0.18)" : "none",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {badge && <img src={badge} alt={name} width={34} height={34}
                        style={{ objectFit: "contain", filter: isSelected ? "drop-shadow(0 1px 6px rgba(0,201,255,0.4))" : "none" }} />}
                      <span style={{
                        fontFamily: "var(--font-body, sans-serif)", fontSize: 9, fontWeight: 600,
                        color: isSelected ? "#00c9ff" : "#9aa39d",
                        textAlign: "center", lineHeight: 1.2,
                      }}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {focusType === "records" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {RECORD_TOPICS.map(({ label, emoji, comingSoon }) => {
                  const isSelected = selectedEntity === label;
                  return (
                    <button
                      key={label}
                      onClick={() => !comingSoon && handleEntitySelect(label)}
                      disabled={comingSoon}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "14px 12px", borderRadius: 14,
                        cursor: comingSoon ? "default" : "pointer",
                        transition: "all 0.15s ease",
                        opacity: comingSoon ? 0.4 : 1,
                        background: isSelected ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${isSelected ? "rgba(174,234,0,0.55)" : "rgba(255,255,255,0.07)"}`,
                        boxShadow: isSelected ? "0 0 14px rgba(174,234,0,0.18)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 22, flexShrink: 0, filter: isSelected ? "drop-shadow(0 1px 6px rgba(174,234,0,0.5))" : "none" }}>{emoji}</span>
                      <span style={{
                        fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 600,
                        color: isSelected ? "#aeea00" : comingSoon ? "#586058" : "#9aa39d",
                        lineHeight: 1.3, textAlign: "left",
                      }}>{label}{comingSoon ? " (soon)" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Settings ──────────────────────────────────────────── */}
        {selectedEntity && (
          <div ref={step3Ref} className="step-in" style={{ marginTop: 28 }}>

            {/* Selected entity banner */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 12, marginBottom: 20,
              background: activeCategory ? `rgba(${activeCategory.rgba},0.08)` : "rgba(174,234,0,0.08)",
              border: `1px solid ${activeCategory ? `rgba(${activeCategory.rgba},0.25)` : "rgba(174,234,0,0.2)"}`,
            }}>
              {(focusType === "club" || focusType === "national") && selectedEntity && getTeamBadgeUrlSync(selectedEntity) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getTeamBadgeUrlSync(selectedEntity)!} alt={selectedEntity} width={22} height={22}
                  style={{ objectFit: "contain", flexShrink: 0 }} />
              ) : (
                <span style={{ fontSize: 16 }}>
                  {focusType === "records"
                    ? (RECORD_TOPICS.find(r => r.label === selectedEntity)?.emoji ?? "🏆")
                    : "⚽"}
                </span>
              )}
              <p style={{
                fontFamily: "var(--font-body, sans-serif)", fontSize: 13, fontWeight: 700,
                color: "#ffffff", margin: 0, flex: 1,
              }}>{selectedEntity}</p>
              <button
                onClick={() => { setSelectedEntity(null); setStep(2); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#586058", fontSize: 16 }}
              >×</button>
            </div>

            {/* Era */}
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a948f", marginBottom: 8 }}>Era</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ERA_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setEra(opt.value)}
                    style={{
                      padding: "6px 13px", borderRadius: 999,
                      fontFamily: "var(--font-body, sans-serif)", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", transition: "all 0.15s ease",
                      background: era === opt.value ? "rgba(174,234,0,0.14)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${era === opt.value ? "rgba(174,234,0,0.45)" : "rgba(255,255,255,0.08)"}`,
                      color: era === opt.value ? "#aeea00" : "#8a948f",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a948f", marginBottom: 8 }}>Difficulty</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {DIFF_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDifficulty(opt.value)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 13px", borderRadius: 999,
                      fontFamily: "var(--font-body, sans-serif)", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", transition: "all 0.15s ease",
                      background: difficulty === opt.value ? "rgba(174,234,0,0.14)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${difficulty === opt.value ? "rgba(174,234,0,0.45)" : "rgba(255,255,255,0.08)"}`,
                      color: difficulty === opt.value ? "#aeea00" : "#8a948f",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: opt.dot, flexShrink: 0 }} />
                    {opt.label}
                  </button>
                ))}
              </div>
              {difficulty === "" && (
                <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 11, color: "#3a423d", marginTop: 6 }}>
                  ✓ Mixed balances all difficulty levels
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div style={{
                marginBottom: 14, padding: "12px 14px", borderRadius: 12,
                background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)",
              }}>
                <p style={{ fontFamily: "var(--font-body, sans-serif)", fontSize: 13, margin: 0, color: "#ff4757" }}>
                  {error}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Floating Generate CTA ───────────────────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
        padding: "12px 16px 28px",
        background: "linear-gradient(to top, rgba(10,10,15,1) 65%, rgba(10,10,15,0))",
        pointerEvents: "none",
      }}>
        <div style={{ maxWidth: 512, margin: "0 auto", pointerEvents: "all" }}>
          {!selectedEntity ? (
            <p style={{
              textAlign: "center", fontFamily: "var(--font-body, sans-serif)",
              fontSize: 12, color: "#3a423d", marginBottom: 8,
            }}>
              {!focusType ? "Choose a category to start" : "Pick a team or topic"}
            </p>
          ) : (
            // Readiness hint: confirm a quiz can be built before they tap Generate.
            <p style={{
              textAlign: "center", fontFamily: "var(--font-body, sans-serif)",
              fontSize: 12, marginBottom: 8,
              color: availLoading ? "#3a423d" : notEnough ? "#f87171" : availability === null ? "#3a423d" : "#aeea00",
            }}>
              {availLoading
                ? "Checking"
                : notEnough
                ? "Not enough questions here yet - try another era or topic"
                : ""}
            </p>
          )}
          <Button
            variant="primary"
            tone="teal"
            size="lg"
            fullWidth
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {generating
              ? "Building your quiz…"
              : !selectedEntity
              ? "Select a team or topic first"
              : notEnough
              ? "Not enough questions yet"
              : `Generate ${selectedEntity} Quiz →`}
          </Button>
        </div>
      </div>
    </div>
  );
}
