"use client";

import { useState } from "react";

/**
 * Splits the profile's stats into Games and Fantasy.
 *
 * Some players are here for 38-0 and the quizzes, some for Fantasy, some for
 * both — one flat list mixed them together. The card and rank above this stay
 * shared (they're your single YourScore identity); only the stats underneath
 * swap.
 *
 * `hasFantasy` is decided on the server by fantasyAllowed() — the same gate that
 * hides the rest of fantasy — so the tab bar only appears for people fantasy is
 * open to (env-on, or the allowlist). Everyone else just sees the Games stats,
 * no empty tab.
 */
export function ProfileTabs({
  hasFantasy,
  games,
  fantasy,
}: {
  hasFantasy: boolean;
  games: React.ReactNode;
  fantasy: React.ReactNode;
}) {
  const [tab, setTab] = useState<"games" | "fantasy">("games");

  if (!hasFantasy) return <>{games}</>;

  return (
    <div>
      <div
        className="flex gap-1 p-1 rounded-2xl mb-5"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {(["games", "fantasy"] as const).map((t) => {
          const active = tab === t;
          const accent = t === "fantasy" ? "#00d8c0" : "#aeea00";
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 rounded-xl py-2 font-body text-sm font-semibold transition-all"
              style={{
                background: active ? `${accent}1a` : "transparent",
                color: active ? accent : "#8a948f",
                border: active ? `1px solid ${accent}40` : "1px solid transparent",
              }}
            >
              {t === "games" ? "Games" : "Fantasy"}
            </button>
          );
        })}
      </div>

      <div className="space-y-5">{tab === "games" ? games : fantasy}</div>
    </div>
  );
}
