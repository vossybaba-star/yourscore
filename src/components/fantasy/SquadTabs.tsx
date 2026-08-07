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
import { LeagueInviteNudge } from "@/components/fantasy/LeagueInviteNudge";
import { LIME, LINE, MUTED, PANEL_2, page, tint } from "@/components/fantasy/shared";
import { useUser } from "@/hooks/useUser";

type Sub = "team" | "plan";

/** A friendly default league name from whoever's signed in — first name if we
 *  have one, else a neutral fallback. Never an email or an id. */
function suggestLeagueName(user: ReturnType<typeof useUser>["user"]): string {
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; name?: string };
  const raw = (meta.full_name || meta.name || "").trim();
  const first = raw.split(/\s+/)[0];
  return first ? `${first}'s league` : "My Fantasy league";
}

export function SquadTabs() {
  const [tab, setTab] = useState<Sub>("team");
  const [visited, setVisited] = useState<Set<Sub>>(new Set<Sub>(["team"]));
  const [nudge, setNudge] = useState(false);
  const { user } = useUser();

  // Restore the sub-tab from the URL on mount (a deep link / refresh / back lands
  // right), and catch the one-shot ?created=1 the builder sets after a first
  // squad confirm — open the "bring your friends" nudge and strip the flag so a
  // refresh or back never re-fires it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sub") === "plan") {
      setTab("plan"); setVisited((v) => new Set<Sub>(v).add("plan"));
    }
    if (params.get("created") === "1") {
      setNudge(true);
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete("created");
        window.history.replaceState(null, "", u);
      } catch { /* no-op */ }
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

      <LeagueInviteNudge open={nudge} onClose={() => setNudge(false)} defaultName={suggestLeagueName(user)} />
    </main>
  );
}
