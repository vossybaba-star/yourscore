"use client";
/**
 * The Squad tab's inner navigation (founder, 2 Aug): "My Team" (the hub) and
 * "Plan" (the monthly-competition planner) as seamless sub-tabs, so planning lives
 * WITH your team instead of down a separate link. Same shell idea as the Scout
 * tab — one chrome (the FantasyHeader), a pill row, and the two bodies rendered
 * embedded (chrome stripped) with the inactive one hidden and kept mounted once
 * visited, so switching is instant.
 */
import { useEffect, useState } from "react";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { FantasyHub } from "@/components/fantasy/FantasyHub";
import { PlanAhead } from "@/components/fantasy/PlanAhead";
import { LIME, LINE, MUTED, PANEL_2, page, tint } from "@/components/fantasy/shared";

type Sub = "team" | "plan";

export function SquadTabs() {
  const [tab, setTab] = useState<Sub>("team");
  const [visited, setVisited] = useState<Set<Sub>>(new Set<Sub>(["team"]));

  // Restore the sub-tab from the URL on mount (a deep link / refresh / back lands right).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sub") === "plan") {
      setTab("plan"); setVisited((v) => new Set<Sub>(v).add("plan"));
    }
  }, []);

  const go = (t: Sub) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
    try {
      const u = new URL(window.location.href);
      if (t === "team") u.searchParams.delete("sub"); else u.searchParams.set("sub", t);
      window.history.replaceState(null, "", u);
    } catch { /* no-op */ }
  };

  // The embedded bodies bring their own 16px horizontal padding, so the shell
  // pads only top/bottom (safe areas + nav clearance); the header + pill row get
  // their own 16px so they line up with the bodies below.
  const shell = { ...page, padding: "calc(16px + env(safe-area-inset-top)) 0 calc(88px + env(safe-area-inset-bottom))" };
  return (
    <main data-fantasy style={shell}>
      <div style={{ padding: "0 16px" }}>
        <FantasyHeader />
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 12, background: PANEL_2, border: `1px solid ${LINE}`, margin: "4px 0 14px" }}>
          {([["team", "My Team"], ["plan", "Plan"]] as [Sub, string][]).map(([k, label]) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => go(k)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                background: on ? tint(LIME, "22") : "transparent", color: on ? LIME : MUTED,
                border: `1px solid ${on ? tint(LIME, "55") : "transparent"}`,
              }}>{label}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: tab === "team" ? "block" : "none" }}>
        {visited.has("team") ? <FantasyHub embedded /> : null}
      </div>
      <div style={{ display: tab === "plan" ? "block" : "none" }}>
        {visited.has("plan") ? <PlanAhead embedded /> : null}
      </div>
    </main>
  );
}
