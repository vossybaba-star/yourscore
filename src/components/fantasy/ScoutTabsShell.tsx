"use client";
/**
 * The Scout tab's inner navigation, made SEAMLESS (founder, 2 Aug). The five
 * sections (Briefing / Picks / Players / Shortlist / Your Squad) used to be five
 * routes, so switching felt like loading a new page. Now they're one client shell
 * over server/client content slots: the active slot shows, the rest are hidden
 * (display:none) and kept mounted once visited, so switching is instant — a slide,
 * not a page load. The cover above stays put.
 *
 * Signed out, the tabs are still there and the cover still shows, but the content
 * is behind a sign-up wall — you can see the Scout exists, not read it.
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Btn, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";

export type ScoutTabKey = "briefing" | "picks" | "players" | "shortlist" | "squad";
const TABS: { key: ScoutTabKey; label: string }[] = [
  { key: "briefing", label: "Briefing" },
  { key: "picks", label: "Picks" },
  { key: "players", label: "Players" },
  { key: "shortlist", label: "Shortlist" },
  { key: "squad", label: "Your Squad" },
];

export function ScoutTabsShell({ initial = "briefing", signedIn, slots }: {
  initial?: ScoutTabKey;
  signedIn: boolean;
  /** Server/client-rendered content per tab. Empty for a signed-out visitor. */
  slots?: Partial<Record<ScoutTabKey, ReactNode>>;
}) {
  const router = useRouter();
  const [active, setActive] = useState<ScoutTabKey>(initial);
  const [visited, setVisited] = useState<Set<ScoutTabKey>>(new Set([initial]));
  const go = (k: ScoutTabKey) => {
    setActive(k);
    setVisited((v) => (v.has(k) ? v : new Set(v).add(k)));
    // Keep the URL honest without a navigation, so a refresh/back lands right.
    try { window.history.replaceState(null, "", `/fantasy/news?tab=${k}`); } catch { /* no-op */ }
  };

  return (
    <div>
      {/* Section pills — a slim scroll row, active in teal. */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "2px 0 8px", scrollbarWidth: "none", marginBottom: 6 }}>
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <button key={t.key} onClick={() => go(t.key)} style={{
              flex: "0 0 auto", padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
              background: on ? TEAL : PANEL, color: on ? "#062018" : MUTED,
              border: `1px solid ${on ? TEAL : LINE}`,
            }}>{t.label}</button>
          );
        })}
      </div>

      {signedIn ? (
        TABS.map((t) => (
          <div key={t.key} style={{ display: t.key === active ? "block" : "none" }}>
            {(t.key === active || visited.has(t.key)) ? (slots?.[t.key] ?? null) : null}
          </div>
        ))
      ) : (
        <div style={{ marginTop: 6, borderRadius: 16, padding: 18, background: `linear-gradient(150deg, ${tint(TEAL, "16")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "44")}` }}>
          <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: TEAL }}>THE SCOUT</div>
          <div className="font-display" style={{ fontSize: 22, color: INK, lineHeight: 1.1, margin: "8px 0 4px" }}>
            {active === "briefing" ? "This week's team news and tips"
              : active === "picks" ? "The Scout's four picks"
              : active === "players" ? "Every player, ranked and compared"
              : active === "shortlist" ? "Your saved players"
              : "Injuries and doubts in your squad"}
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
            Create a free account to read the Scout: picks, player data, team news and your own shortlist. It only takes a moment.
          </p>
          <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/news")}>Create your free account</Btn>
          <p style={{ fontSize: 12, color: MUTED, margin: "10px 0 0", textAlign: "center" }}>
            Already play? <span onClick={() => router.push("/auth/sign-in?next=/fantasy/news")} style={{ color: TEAL, fontWeight: 700, cursor: "pointer" }}>Sign in</span>
          </p>
        </div>
      )}
    </div>
  );
}
