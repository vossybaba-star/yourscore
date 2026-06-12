"use client";

/**
 * Draft XI — solo season scorecard. Same collectible-card chrome as the
 * head-to-head <ScorecardView> (via the shared <ScorecardShell>), but the body is
 * a 38-game season: the W–D–L record as the hero, league finish vs projection,
 * season metrics, awards, and top contributors. Sections render only when their
 * data is present, so the full in-app result and the leaner shared-link card share
 * one design with different detail.
 */

import { ScorecardShell, SectionLabel, Foil, FOIL, SC_WIN, SC_DRAW, SC_LOSS } from "@/components/draft/Scorecard";

export type SeasonAward = { label: string; name: string; detail: string };
export type SeasonContributor = { name: string; goals: number; assists: number };

export type SeasonData = {
  context?: string;
  invincible: boolean;
  wins: number; draws: number; losses: number;
  points: number; position: number;
  projectedPosition?: number; verdict?: string;
  gf?: number; ga?: number; strength?: number;
  awards?: SeasonAward[];
  contributors?: SeasonContributor[];
};

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function SeasonScorecard({ data }: { data: SeasonData }) {
  const top4 = data.position <= 4;
  const fk: "win" | "draw" | "loss" = data.invincible ? "draw" : top4 ? "win" : data.position <= 12 ? "draw" : "loss";
  const accent = data.invincible ? "#ffd700" : data.position === 1 ? SC_WIN : top4 ? "#22d3ee" : data.position <= 12 ? SC_DRAW : SC_LOSS;
  const headline = data.invincible ? "INVINCIBLE" : `FINISHED ${ordinal(data.position).toUpperCase()}`;
  const verdictColor = data.verdict === "OVERPERFORMED" ? SC_WIN : data.verdict === "UNDERPERFORMED" ? SC_LOSS : "#8a8aa6";

  const record: [string, number, string, "win" | "draw" | "loss"][] = [
    ["Won", data.wins, SC_WIN, "win"],
    ["Drawn", data.draws, SC_DRAW, "draw"],
    ["Lost", data.losses, SC_LOSS, "loss"],
  ];

  const gd = data.gf != null && data.ga != null ? data.gf - data.ga : null;

  return (
    <ScorecardShell fk={fk} accent={accent} eyebrow="Full season" headline={headline} context={data.context ?? "Season"}>
      {/* INVINCIBLE — the moment. A gold congratulations banner above the record;
          only a perfect 38-0 season ever sees it. */}
      {data.invincible && (
        <div
          className="relative overflow-hidden rounded-2xl px-4 py-4 text-center"
          style={{
            marginBottom: 20,
            background: "linear-gradient(135deg, rgba(255,215,0,0.16), rgba(255,184,0,0.04))",
            border: "1px solid rgba(255,215,0,0.5)",
            boxShadow: "0 0 40px rgba(255,215,0,0.18), inset 0 0 24px rgba(255,215,0,0.06)",
          }}
        >
          {/* slow gold sheen sweep */}
          <div
            className="pointer-events-none absolute inset-0 sc-invincible-sheen"
            style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.22) 50%, transparent 65%)" }}
          />
          <div style={{ fontSize: 30, lineHeight: 1 }}>🏆</div>
          <Foil gradient="linear-gradient(90deg,#fff6cf,#ffd700,#f0a000,#ffd700,#fff6cf)" sheen
            className="font-display mt-2" style={{ fontSize: 30, letterSpacing: "0.08em", lineHeight: 1 }}>
            INVINCIBLE
          </Foil>
          <div className="mt-2 font-display" style={{ fontSize: 16, color: "#ffe98a", letterSpacing: "0.02em" }}>
            38 played · 38 won · 0 lost
          </div>
          <div className="mt-1 font-body" style={{ fontSize: 12.5, color: "#cdbb7a", lineHeight: 1.45 }}>
            The perfect season. One of the rarest things in 38-0 — congratulations.
          </div>
        </div>
      )}

      {/* record — the hero */}
      <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 22 }}>
        {record.map(([label, v, col, key]) => (
          <div key={label} className="rounded-2xl py-4 text-center" style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${col}33` }}>
            <Foil gradient={FOIL[key]} sheen className="font-display tabular-nums" style={{ fontSize: 56, lineHeight: 0.85 }}>{v}</Foil>
            <div className="mt-1.5 font-mono uppercase" style={{ fontSize: 9.5, letterSpacing: "0.18em", color: "#6a6a86" }}>{label}</div>
          </div>
        ))}
      </div>
      <div className="text-center font-mono uppercase" style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8a8aa6", marginBottom: 30 }}>
        {data.points} pts{data.strength != null ? ` · STR ${data.strength}` : ""}
      </div>

      {/* league finish */}
      {(data.projectedPosition != null || data.verdict) && (
        <>
          <SectionLabel>League finish</SectionLabel>
          <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 30 }}>
            <Cell label="Finished" value={ordinal(data.position)} color={accent} />
            <Cell label="Projected" value={data.projectedPosition != null ? ordinal(data.projectedPosition) : "—"} color="#8a8aa6" />
            <Cell label="Verdict" value={data.verdict ?? "—"} color={verdictColor} small />
          </div>
        </>
      )}

      {/* season metrics */}
      {(data.gf != null || data.ga != null) && (
        <>
          <SectionLabel>Season metrics</SectionLabel>
          <div className="grid grid-cols-3 gap-3" style={{ marginBottom: 30 }}>
            <Cell label="Goals for" value={String(data.gf ?? "—")} color={SC_WIN} />
            <Cell label="Goals against" value={String(data.ga ?? "—")} color={SC_LOSS} />
            <Cell label="Goal diff" value={gd == null ? "—" : gd > 0 ? `+${gd}` : String(gd)} color={gd != null && gd >= 0 ? SC_WIN : SC_LOSS} />
          </div>
        </>
      )}

      {/* awards */}
      {data.awards && data.awards.length > 0 && (
        <>
          <SectionLabel>Season awards</SectionLabel>
          <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 30 }}>
            {data.awards.map((a) => (
              <div key={a.label} className="rounded-2xl p-3.5" style={{ background: "linear-gradient(135deg,rgba(255,184,0,0.07),rgba(255,184,0,0.015))", border: "1px solid rgba(255,184,0,0.18)" }}>
                <div className="font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.14em", color: SC_DRAW }}>{a.label}</div>
                <div className="mt-1 truncate font-display" style={{ fontSize: 18, color: "#fff", letterSpacing: "0.02em" }}>{a.name}</div>
                <div className="font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.08em", color: "#8a8aa6" }}>{a.detail}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* top contributors */}
      {data.contributors && data.contributors.length > 0 && (
        <>
          <SectionLabel>Top contributors</SectionLabel>
          <div className="overflow-hidden rounded-2xl" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 30 }}>
            <div className="flex px-4 py-2 font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.14em", color: "#6a6a86" }}>
              <span className="flex-1">Player</span>
              <span style={{ width: 36, textAlign: "right" }}>G</span>
              <span style={{ width: 36, textAlign: "right" }}>A</span>
            </div>
            {data.contributors.map((p) => (
              <div key={p.name} className="flex items-center px-4 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <span className="flex-1 truncate font-body" style={{ fontSize: 13, color: "#eee" }}>{p.name}</span>
                <span className="font-mono tabular-nums" style={{ width: 36, textAlign: "right", fontSize: 13, color: SC_WIN }}>{p.goals}</span>
                <span className="font-mono tabular-nums" style={{ width: 36, textAlign: "right", fontSize: 13, color: "#22d3ee" }}>{p.assists}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </ScorecardShell>
  );
}

function Cell({ label, value, color, small }: { label: string; value: string; color: string; small?: boolean }) {
  return (
    <div className="grid place-items-center rounded-2xl py-3 text-center" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="font-display" style={{ fontSize: small ? 14 : 28, color, letterSpacing: small ? "0.04em" : "0" }}>{value}</div>
      <div className="mt-0.5 font-mono uppercase" style={{ fontSize: 8.5, letterSpacing: "0.12em", color: "#6a6a86" }}>{label}</div>
    </div>
  );
}
