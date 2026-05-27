"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { getTeamBadgeUrl } from "@/lib/teamImages";

// ── Constants ─────────────────────────────────────────────────────────────────

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

const RECORD_TOPICS = [
  "Premier League Records", "Champions League Records", "World Cup Records",
  "Euro Championship Records", "Transfer Market Records", "Legendary Club Seasons",
  "Iconic Managers", "Penalty Shootout Lore", "Golden Boot & Individual Awards",
  "The Derbies — By Numbers", "FA Cup Records", "League Cup Records",
  "English Football Firsts", "Greatest Premier League Players", "Stadium & Ground History",
];

const ERA_OPTIONS = [
  { value: "", label: "All Time" },
  { value: "early-pl", label: "Classic (90s–00s)" },
  { value: "2010s", label: "2010s" },
  { value: "2020s", label: "Modern (2020s)" },
  { value: "2024-25", label: "This Season" },
];

const DIFF_OPTIONS = [
  { value: "", label: "Mixed" },
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const TOPIC_EMOJI: Record<string, string> = {
  "Premier League Records": "🏆",
  "Champions League Records": "⭐",
  "World Cup Records": "🌍",
  "Euro Championship Records": "🇪🇺",
  "Transfer Market Records": "💰",
  "Legendary Club Seasons": "📖",
  "Iconic Managers": "🎩",
  "Penalty Shootout Lore": "⚽",
  "Golden Boot & Individual Awards": "👟",
  "The Derbies — By Numbers": "🔥",
  "FA Cup Records": "🏅",
  "League Cup Records": "🥈",
  "English Football Firsts": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Greatest Premier League Players": "⚡",
  "Stadium & Ground History": "🏟️",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CreateQuizPage() {
  const router = useRouter();

  const [focusType, setFocusType] = useState<"club" | "records">("club");
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [clubSearch, setClubSearch] = useState("");
  const [era, setEra] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [badgeUrls, setBadgeUrls] = useState<Record<string, string>>({});

  // Pre-load all club badge URLs
  useEffect(() => {
    const load = async () => {
      const map: Record<string, string> = {};
      await Promise.all(
        CLUBS.map(async (club) => {
          const url = await getTeamBadgeUrl(club);
          if (url) map[club] = url;
        })
      );
      setBadgeUrls(map);
    };
    load();
  }, []);

  // Reset selection when tab changes
  useEffect(() => {
    setSelectedEntity(null);
    setClubSearch("");
  }, [focusType]);

  const filteredClubs = CLUBS.filter((c) =>
    c.toLowerCase().includes(clubSearch.toLowerCase())
  );

  async function handleGenerate() {
    if (!selectedEntity || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (!user) {
        setError("Sign in to create a quiz");
        setGenerating(false);
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
      router.push(`/challenges/${json.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setGenerating(false);
    }
  }

  const canGenerate = !!selectedEntity && !generating;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        paddingBottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* ── Sticky Header ──────────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(10,10,15,0.97)",
          backdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div
          style={{
            maxWidth: 512,
            margin: "0 auto",
            padding: "48px 20px 16px",
          }}
        >
          {/* Title row */}
          <div style={{ marginBottom: 16 }}>
            <h1
              style={{
                fontFamily: "var(--font-display, sans-serif)",
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#00ff87",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              BUILD A QUIZ
            </h1>
            <p
              style={{
                fontFamily: "var(--font-body, sans-serif)",
                fontSize: 13,
                color: "#8888aa",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              Pick your focus and we&apos;ll generate a fresh quiz
            </p>
          </div>

          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setFocusType("club")}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 9999,
                fontFamily: "var(--font-display, sans-serif)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.05em",
                cursor: "pointer",
                transition: "all 0.15s ease",
                background:
                  focusType === "club"
                    ? "rgba(255,184,0,0.15)"
                    : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  focusType === "club"
                    ? "rgba(255,184,0,0.5)"
                    : "rgba(255,255,255,0.08)"
                }`,
                color: focusType === "club" ? "#ffb800" : "#8888aa",
                boxShadow:
                  focusType === "club"
                    ? "0 0 16px rgba(255,184,0,0.12)"
                    : "none",
              }}
            >
              ⚽ CLUBS
            </button>
            <button
              onClick={() => setFocusType("records")}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 9999,
                fontFamily: "var(--font-display, sans-serif)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.05em",
                cursor: "pointer",
                transition: "all 0.15s ease",
                background:
                  focusType === "records"
                    ? "rgba(167,139,250,0.15)"
                    : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  focusType === "records"
                    ? "rgba(167,139,250,0.5)"
                    : "rgba(255,255,255,0.08)"
                }`,
                color: focusType === "records" ? "#a78bfa" : "#8888aa",
                boxShadow:
                  focusType === "records"
                    ? "0 0 16px rgba(167,139,250,0.12)"
                    : "none",
              }}
            >
              🏆 RECORDS
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div style={{ maxWidth: 512, margin: "0 auto", padding: "20px 16px 0" }}>

        {/* ── Section 1: Pick entity ─────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          {focusType === "club" ? (
            <>
              {/* Search */}
              <input
                type="text"
                placeholder="Search clubs..."
                value={clubSearch}
                onChange={(e) => setClubSearch(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#ffffff",
                  fontFamily: "var(--font-body, sans-serif)",
                  fontSize: 14,
                  outline: "none",
                  marginBottom: 12,
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(0,255,135,0.4)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                }}
              />

              {/* Club grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {filteredClubs.map((club) => {
                  const isSelected = selectedEntity === club;
                  const badge = badgeUrls[club];
                  return (
                    <button
                      key={club}
                      onClick={() =>
                        setSelectedEntity(isSelected ? null : club)
                      }
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: "10px 6px",
                        borderRadius: 12,
                        height: 80,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        background: isSelected
                          ? "rgba(0,255,135,0.1)"
                          : "rgba(255,255,255,0.03)",
                        border: `1px solid ${
                          isSelected
                            ? "rgba(0,255,135,0.6)"
                            : "rgba(255,255,255,0.07)"
                        }`,
                        boxShadow: isSelected
                          ? "0 0 12px rgba(0,255,135,0.15)"
                          : "none",
                      }}
                      onMouseDown={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform =
                          "scale(0.96)";
                      }}
                      onMouseUp={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform =
                          "scale(1)";
                      }}
                      onTouchStart={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform =
                          "scale(0.96)";
                      }}
                      onTouchEnd={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform =
                          "scale(1)";
                      }}
                    >
                      {badge ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={badge}
                          alt={club}
                          width={40}
                          height={40}
                          style={{
                            objectFit: "contain",
                            filter: isSelected
                              ? "drop-shadow(0 2px 8px rgba(0,255,135,0.35))"
                              : "none",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: "rgba(255,255,255,0.07)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: "var(--font-display, sans-serif)",
                            fontSize: 16,
                            color: "#8888aa",
                          }}
                        >
                          {club[0]}
                        </div>
                      )}
                      <span
                        style={{
                          fontFamily: "var(--font-body, sans-serif)",
                          fontSize: 10,
                          color: isSelected ? "#00ff87" : "#aaaacc",
                          fontWeight: 600,
                          textAlign: "center",
                          lineHeight: 1.2,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          width: "100%",
                        }}
                      >
                        {club}
                      </span>
                    </button>
                  );
                })}

                {filteredClubs.length === 0 && (
                  <div
                    style={{
                      gridColumn: "span 3",
                      textAlign: "center",
                      padding: "32px 0",
                      color: "#8888aa",
                      fontFamily: "var(--font-body, sans-serif)",
                      fontSize: 14,
                    }}
                  >
                    No clubs found
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Records grid */
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 8,
              }}
            >
              {RECORD_TOPICS.map((topic) => {
                const isSelected = selectedEntity === topic;
                const emoji = TOPIC_EMOJI[topic] ?? "📊";
                return (
                  <button
                    key={topic}
                    onClick={() =>
                      setSelectedEntity(isSelected ? null : topic)
                    }
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "14px 10px",
                      borderRadius: 14,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                      background: isSelected
                        ? "rgba(167,139,250,0.12)"
                        : "rgba(255,255,255,0.03)",
                      border: `1px solid ${
                        isSelected
                          ? "rgba(167,139,250,0.6)"
                          : "rgba(255,255,255,0.07)"
                      }`,
                      boxShadow: isSelected
                        ? "0 0 14px rgba(167,139,250,0.18)"
                        : "none",
                    }}
                    onMouseDown={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "scale(0.96)";
                    }}
                    onMouseUp={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "scale(1)";
                    }}
                    onTouchStart={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "scale(0.96)";
                    }}
                    onTouchEnd={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.transform =
                        "scale(1)";
                    }}
                  >
                    <span
                      style={{
                        fontSize: 28,
                        filter: isSelected
                          ? "drop-shadow(0 2px 8px rgba(167,139,250,0.5))"
                          : "none",
                      }}
                    >
                      {emoji}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-body, sans-serif)",
                        fontSize: 11,
                        fontWeight: 600,
                        color: isSelected ? "#a78bfa" : "#aaaacc",
                        textAlign: "center",
                        lineHeight: 1.3,
                      }}
                    >
                      {topic}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Section 2: Era ─────────────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <p
            style={{
              fontFamily: "var(--font-body, sans-serif)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#8888aa",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            ERA
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ERA_OPTIONS.map((opt) => {
              const isActive = era === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setEra(opt.value)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 9999,
                    fontFamily: "var(--font-body, sans-serif)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    background: isActive
                      ? "rgba(0,255,135,0.15)"
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${
                      isActive
                        ? "rgba(0,255,135,0.5)"
                        : "rgba(255,255,255,0.08)"
                    }`,
                    color: isActive ? "#00ff87" : "#8888aa",
                    boxShadow: isActive
                      ? "0 0 10px rgba(0,255,135,0.12)"
                      : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Section 3: Difficulty ──────────────────────────────────── */}
        <div style={{ marginBottom: 32 }}>
          <p
            style={{
              fontFamily: "var(--font-body, sans-serif)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#8888aa",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            DIFFICULTY
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {DIFF_OPTIONS.map((opt) => {
              const isActive = difficulty === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setDifficulty(opt.value)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 9999,
                    fontFamily: "var(--font-body, sans-serif)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    background: isActive
                      ? "rgba(0,255,135,0.15)"
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${
                      isActive
                        ? "rgba(0,255,135,0.5)"
                        : "rgba(255,255,255,0.08)"
                    }`,
                    color: isActive ? "#00ff87" : "#8888aa",
                    boxShadow: isActive
                      ? "0 0 10px rgba(0,255,135,0.12)"
                      : "none",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {difficulty === "" && (
            <p
              style={{
                fontFamily: "var(--font-body, sans-serif)",
                fontSize: 11,
                color: "#555577",
                marginTop: 6,
              }}
            >
              ✓ Recommended — balances easy, medium &amp; hard questions
            </p>
          )}
        </div>

        {/* ── Error message ──────────────────────────────────────────── */}
        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(255,71,87,0.1)",
              border: "1px solid rgba(255,71,87,0.3)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body, sans-serif)",
                fontSize: 13,
                color: "#ff4757",
                margin: 0,
              }}
            >
              {error}
            </p>
          </div>
        )}
      </div>

      {/* ── Sticky Generate Button ──────────────────────────────────── */}
      <div
        style={{
          position: "fixed",
          bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
          left: 0,
          right: 0,
          zIndex: 19,
          padding: "12px 16px",
          background:
            "linear-gradient(to top, rgba(10,10,15,1) 60%, rgba(10,10,15,0))",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            maxWidth: 512,
            margin: "0 auto",
            pointerEvents: "all",
          }}
        >
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 16,
              fontFamily: "var(--font-display, sans-serif)",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.08em",
              cursor: canGenerate ? "pointer" : "not-allowed",
              transition: "all 0.15s ease",
              border: "none",
              background: canGenerate
                ? "linear-gradient(135deg, #00ff87, #00cc6a)"
                : "rgba(255,255,255,0.07)",
              color: canGenerate ? "#000000" : "#444466",
              boxShadow: canGenerate
                ? "0 4px 24px rgba(0,255,135,0.3)"
                : "none",
              opacity: generating ? 0.8 : 1,
              animation: generating ? "pulse 1.4s ease-in-out infinite" : "none",
            }}
            onMouseDown={(e) => {
              if (canGenerate)
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(0.97)";
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1)";
            }}
            onTouchStart={(e) => {
              if (canGenerate)
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(0.97)";
            }}
            onTouchEnd={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(1)";
            }}
          >
            {generating ? "GENERATING..." : selectedEntity ? `BUILD "${selectedEntity.toUpperCase()}" QUIZ →` : "SELECT A TEAM OR TOPIC FIRST"}
          </button>
        </div>
      </div>

      {/* Pulse keyframe for generating state */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 1; }
        }
      `}</style>

      <BottomNav />
    </div>
  );
}
