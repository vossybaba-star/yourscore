"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type FantasyState } from "@/components/fantasy/shared";
import type { Difficulty, NewsClubRun } from "@/lib/fantasy/news";

// Shared fantasy tokens (mirrored — shared.tsx is "use client", newsUi pulls in
// the supabase loader; a client grid wants neither).
const INK = "#eef2f0";
const MUTED = "#8a948f";
const GOLD = "#ffc233";
const TEAL = "#00d8c0";
const LINE = "rgba(255,255,255,0.07)";
const PANEL = "#0e1611";

// Difficulty → cell fill + a readable label (the label decodes the colour, so
// the grid never relies on colour alone: legend up top, and every cell titled).
const DIFF: Record<Difficulty, { bg: string; label: string }> = {
  kind: { bg: "#1D5A3A", label: "kind" },
  medium: { bg: "#5a5326", label: "ok" },
  tough: { bg: "#6B2A2A", label: "tough" },
};

/**
 * The fixture ticker, squad-first. The full 20-row matrix buried the five to ten
 * clubs a manager actually owns; this defaults to YOUR clubs and keeps the rest
 * behind an "All clubs" toggle. Owned clubs stay marked in either view. The
 * server renders every club (for SEO); the client narrows to your squad once it
 * knows it.
 */
export function FixturesGrid({
  gws, runs, deadlineLine,
}: {
  gws: number[];
  runs: NewsClubRun[];
  deadlineLine: string | null;
}) {
  const [mine, setMine] = useState<Set<number> | null>(null); // owned clubIds
  const [mode, setMode] = useState<"mine" | "all">("all");

  useEffect(() => {
    api<FantasyState>("state")
      .then((s) => {
        const ids = new Set((s.squad?.picks ?? []).map((p) => p.clubId));
        if (ids.size) { setMine(ids); setMode("mine"); }
      })
      .catch(() => {}); // signed out / not allowlisted → stay on All clubs
  }, []);

  const hasMine = !!mine && mine.size > 0;
  const shown = useMemo(
    () => (mode === "mine" && mine ? runs.filter((r) => mine.has(r.clubId)) : runs),
    [mode, mine, runs],
  );

  const Chip = ({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) => (
    <button onClick={onClick} style={{
      flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 13, fontWeight: on ? 700 : 500, cursor: "pointer",
      background: on ? TEAL : PANEL, color: on ? "#0a0a0f" : MUTED, border: `1px solid ${on ? TEAL : LINE}`,
    }}>{label}</button>
  );

  return (
    <section style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
      {hasMine && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <Chip label="My clubs" on={mode === "mine"} onClick={() => setMode("mine")} />
          <Chip label="All clubs" on={mode === "all"} onClick={() => setMode("all")} />
        </div>
      )}

      <div style={{ color: INK, fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Next {gws.length} gameweeks</div>
      <div style={{ color: MUTED, fontSize: 11, marginBottom: 8 }}>CAPS = home · lower = away.</div>

      {/* Legend — decodes the difficulty colours in words. */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {(["kind", "medium", "tough"] as Difficulty[]).map((d) => (
          <span key={d} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: MUTED }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: DIFF[d].bg }} />
            {DIFF[d].label}
          </span>
        ))}
      </div>

      {shown.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
          None of your clubs are in the next {gws.length} gameweeks yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div style={{
            display: "grid", gridTemplateColumns: `52px repeat(${gws.length}, minmax(44px, 1fr))`,
            gap: 4, minWidth: 52 + gws.length * 48,
          }}>
            <div />
            {gws.map((g) => <div key={g} style={{ color: MUTED, fontSize: 10, textAlign: "center" }}>GW{g}</div>)}

            {shown.map((r) => {
              const owned = !!mine?.has(r.clubId);
              return (
                <Fragment key={r.clubId}>
                  <div style={{
                    color: owned ? TEAL : INK, fontSize: 12, fontWeight: owned ? 800 : 600, alignSelf: "center",
                    borderLeft: owned ? `2px solid ${TEAL}` : "2px solid transparent", paddingLeft: 6,
                  }}>{r.short}</div>
                  {gws.map((g) => {
                    const cells = r.cells.filter((c) => c.gw === g);
                    if (cells.length === 0) return <div key={g} style={{ color: MUTED, fontSize: 11, textAlign: "center", padding: "5px 0" }}>·</div>;
                    const isDouble = cells.length > 1;
                    return (
                      <div key={g}
                        title={cells.map((c) => `${c.home ? "vs" : "away to"} ${c.opponent}, ${DIFF[c.difficulty].label}`).join(" · ")}
                        style={{ display: "flex", flexDirection: "column", gap: 2, border: isDouble ? `1px solid ${GOLD}88` : undefined, borderRadius: 6, padding: isDouble ? 1 : 0 }}>
                        {cells.map((cell, i) => (
                          <div key={i} style={{
                            background: DIFF[cell.difficulty].bg, color: INK, fontSize: isDouble ? 9.5 : 11,
                            textAlign: "center", padding: "5px 0", borderRadius: 5,
                            textTransform: cell.home ? "uppercase" : "lowercase",
                          }}>{cell.oppShort}</div>
                        ))}
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {deadlineLine && <div style={{ color: MUTED, fontSize: 11, marginTop: 10 }}>{deadlineLine}</div>}
    </section>
  );
}
