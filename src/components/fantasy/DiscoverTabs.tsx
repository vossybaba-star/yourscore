"use client";
/**
 * Social → Discover splits into two things you can look for (founder, 3 Aug):
 *   Leagues — public leagues to join, searchable by name (<DiscoverLeagues/>).
 *   Players — managers to follow, searchable by username (<DiscoverManagers/>).
 *
 * `initialSub` lets a "Find managers" entry point land straight on Players.
 */
import { useState } from "react";
import { MUTED, TEAL, tint } from "@/components/fantasy/shared";
import { DiscoverLeagues } from "@/components/fantasy/DiscoverLeagues";
import { DiscoverManagers } from "@/components/fantasy/DiscoverManagers";

type Sub = "leagues" | "players";
const SUBS: { id: Sub; label: string }[] = [
  { id: "leagues", label: "Leagues" },
  { id: "players", label: "Players" },
];

export function DiscoverTabs({ initialSub }: { initialSub?: Sub }) {
  const [sub, setSub] = useState<Sub>(initialSub ?? "leagues");

  return (
    <div>
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 3, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 14 }}>
        {SUBS.map((s) => {
          const on = s.id === sub;
          return (
            <button key={s.id} role="tab" aria-selected={on} onClick={() => setSub(s.id)} style={{
              flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: on ? tint(TEAL, "22") : "transparent", color: on ? TEAL : MUTED,
              border: `1px solid ${on ? tint(TEAL, "55") : "transparent"}`,
            }}>{s.label}</button>
          );
        })}
      </div>

      {sub === "leagues" ? <DiscoverLeagues /> : <DiscoverManagers intro={false} />}
    </div>
  );
}
