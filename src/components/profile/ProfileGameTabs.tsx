"use client";
/**
 * A player profile splits into two games so it's obvious what someone actually
 * plays and how they score at each (founder, 3 Aug): a FANTASY tab (their squads
 * and gameweek points) and a QUIZ tab (their battles, accuracy and quizzes). The
 * tabs are colour-coded to the game — teal for Fantasy, lime for Quiz — so a
 * button under one is never mistaken for the other.
 *
 * The panels are server-rendered and passed in as slots; this client shell only
 * owns which one is showing. A squad-share deep link (/profile/x#fantasy-xi)
 * opens straight on Fantasy.
 */
import { useEffect, useState, type ReactNode } from "react";

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const MUTED = "#8a948f";

type GameTab = "fantasy" | "quiz";

export function ProfileGameTabs({ fantasy, quiz, defaultTab }: {
  fantasy: ReactNode;
  quiz: ReactNode;
  defaultTab: GameTab;
}) {
  const [tab, setTab] = useState<GameTab>(defaultTab);

  useEffect(() => {
    try { if (window.location.hash === "#fantasy-xi") setTab("fantasy"); } catch { /* no hash */ }
  }, []);

  const tabs: { id: GameTab; label: string; accent: string }[] = [
    { id: "fantasy", label: "Fantasy", accent: TEAL },
    { id: "quiz", label: "Quiz", accent: LIME },
  ];

  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 6, padding: 4, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {tabs.map((t) => {
          const on = t.id === tab;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)}
              className="font-display"
              style={{
                flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 10,
                fontSize: 15, fontWeight: 700, letterSpacing: "0.01em", cursor: "pointer",
                background: on ? t.accent : "transparent",
                color: on ? "#062018" : MUTED,
                border: "1px solid transparent",
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 20 }}>
        {tab === "fantasy" ? fantasy : quiz}
      </div>
    </div>
  );
}
