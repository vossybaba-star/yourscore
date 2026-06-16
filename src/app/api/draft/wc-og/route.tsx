/**
 * /api/draft/wc-og — World Cup shareable scorecard (1200x630).
 *
 * Two layouts:
 *  • mode=mastermind — the DAILY ranked card: player name + outcome, with the hero stats
 *    RECORD / 🧠 QUIZ / RANK (the knowledge flex). Params: player, quiz ("9/11"),
 *    rec ("7-1-0"), rank ("3"), date ("16 Jun"), status, stage, world|crest|nation.
 *  • default (the open World Cup Run) — outcome + the full stage path on the right.
 *    Params: nation, crest, status, stage, path = "Label~Detail~R|..." (R = W|L|Q).
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

const STAGE_LABEL: Record<string, string> = {
  group: "Group Stage", ko: "Knockouts", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-Final", sf: "Semi-Final", final: "Final",
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const nation = q.get("nation") ?? "Your nation";
  const crest = q.get("crest");
  const world = q.get("world") === "1";
  const stage = q.get("stage") ?? "group";
  const status = q.get("status") ?? "active";
  const mastermind = q.get("mode") === "mastermind";
  const stageLabel = STAGE_LABEL[stage] ?? "Group Stage";

  const champion = status === "champion";
  const eliminated = status === "eliminated";
  const accent = champion ? "#ffd700" : eliminated ? "#ff4757" : "#aeea00";
  const headline = champion ? "CHAMPIONS" : eliminated ? "OUT" : stageLabel.toUpperCase();
  const who = world ? "a World XI" : nation;

  // ── Mastermind daily card ─────────────────────────────────────────────────
  if (mastermind) {
    const player = q.get("player") || "A manager";
    const quiz = q.get("quiz");                 // "9/11"
    const rec = q.get("rec") || "";             // "7-1-0"
    const rank = q.get("rank");                 // "3"
    const date = q.get("date") || "";           // "16 Jun"
    const sub = champion ? "Won the World Cup 🏆"
      : eliminated ? `Knocked out — ${stageLabel}`
      : `Reached the ${stageLabel}`;
    // Size the outcome word so it never overflows the 600px identity column into the stats.
    const hlSize = headline.length <= 4 ? 120 : headline.length <= 9 ? 82 : 54;

    const Stat = ({ label, value, hero }: { label: string; value: string; hero?: boolean }) => (
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "18px 26px", marginBottom: 14, borderRadius: 18,
        background: hero ? "rgba(255,215,0,0.10)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hero ? "rgba(255,215,0,0.55)" : "rgba(255,255,255,0.10)"}`,
      }}>
        <div style={{ display: "flex", fontSize: 22, letterSpacing: 2, color: hero ? "#ffd700" : "#8a948f", fontWeight: 700 }}>{label}</div>
        <div style={{ display: "flex", fontSize: 58, fontWeight: 900, color: "#fff", lineHeight: 1.05 }}>{value}</div>
      </div>
    );

    return new ImageResponse(
      (
        <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #12100a 100%)", padding: "52px 64px", fontFamily: "sans-serif", position: "relative" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
              <span style={{ color: "#fff" }}>YOUR</span>
              <span style={{ color: "#aeea00" }}>SCORE</span>
              <span style={{ color: "#8a948f", marginLeft: 14, fontWeight: 700 }}>· WORLD CUP</span>
              <span style={{ color: "#ffd700", marginLeft: 8, fontWeight: 800 }}>MASTERMIND</span>
            </div>
            <div style={{ display: "flex", fontSize: 26, color: "#8a948f", fontWeight: 700 }}>{date ? `${date.toUpperCase()} · ` : ""}DAILY</div>
          </div>

          <div style={{ display: "flex", marginTop: 30, flex: 1 }}>
            {/* Left: identity + outcome */}
            <div style={{ display: "flex", flexDirection: "column", width: 600, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {crest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crest} alt="" width={72} height={72} style={{ objectFit: "contain", marginRight: 18 }} />
                ) : (
                  <div style={{ display: "flex", fontSize: 64, marginRight: 18 }}>🧠</div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontSize: 44, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{player}</div>
                  <div style={{ display: "flex", fontSize: 24, color: "#8a948f", marginTop: 4 }}>{world ? "World XI" : nation}</div>
                </div>
              </div>
              <div style={{ display: "flex", width: 600, fontSize: hlSize, fontWeight: 900, color: accent, lineHeight: 1, marginTop: 22 }}>{headline}</div>
              <div style={{ display: "flex", fontSize: 30, color: "#c4ccc6", marginTop: 16 }}>{sub}</div>
            </div>

            {/* Right: hero stats */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 36, justifyContent: "center" }}>
              {rec ? <Stat label="RECORD" value={rec} /> : null}
              {quiz ? <Stat label="🧠 MASTERMIND QUIZ" value={quiz} hero /> : null}
              {rank ? <Stat label="WORLD RANK TODAY" value={`#${rank}`} /> : null}
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#c4ccc6" }}>
              <span style={{ color: "#fff", fontWeight: 800, marginRight: 10 }}>38-0</span>
              <span>for the fans that know football</span>
            </div>
            <div style={{ display: "flex", fontSize: 28, color: "#ffd700", fontWeight: 800 }}>yourscore.app/38-0/wc</div>
          </div>
          <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
        </div>
      ),
      { width: 1200, height: 630 }
    );
  }

  // ── Open World Cup Run card (the stage path) ──────────────────────────────
  const sub = champion ? `${who} won the World Cup 🏆`
    : eliminated ? `${who} — out at the ${stageLabel}`
    : `${who} reached the ${stageLabel}`;

  const rows = (q.get("path") ?? "").split("|").filter(Boolean).map((r) => {
    const [label, detail, res] = r.split("~");
    return { label, detail, res };
  });
  const resColor = (r: string) => (r === "L" ? "#ff4757" : r === "Q" ? "#ffd700" : "#aeea00");

  return new ImageResponse(
    (
      <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #0e1611 100%)", padding: "56px 64px", fontFamily: "sans-serif", position: "relative" }}>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ color: "#fff" }}>YOUR</span>
          <span style={{ color: "#aeea00" }}>SCORE</span>
          <span style={{ color: "#8a948f", marginLeft: 16, fontWeight: 600 }}>· WORLD CUP RUN</span>
        </div>

        <div style={{ display: "flex", marginTop: 36, flex: 1 }}>
          {/* Left: nation + outcome */}
          <div style={{ display: "flex", flexDirection: "column", width: 540, justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={crest} alt="" width={96} height={96} style={{ objectFit: "contain", marginRight: 22 }} />
              ) : world ? (
                <div style={{ display: "flex", fontSize: 84, marginRight: 22 }}>🌍</div>
              ) : null}
              <div style={{ display: "flex", fontSize: 52, fontWeight: 800, color: "#fff" }}>{nation}</div>
            </div>
            <div style={{ display: "flex", fontSize: champion ? 96 : 120, fontWeight: 900, color: accent, lineHeight: 1, marginTop: 18 }}>{headline}</div>
            <div style={{ display: "flex", fontSize: 30, color: "#c4ccc6", marginTop: 18 }}>{sub}</div>
          </div>

          {/* Right: the run scorecard */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 40, justifyContent: "center" }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "12px 0" }}>
                <div style={{ display: "flex", fontSize: 24, color: "#8a948f", width: 150 }}>{row.label}</div>
                <div style={{ display: "flex", flex: 1, fontSize: 30, fontWeight: 700, color: "#fff" }}>{row.detail}</div>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 800, color: resColor(row.res) }}>{row.res}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, color: "#c4ccc6" }}>Draft a World XI. Win the World Cup.</div>
          <div style={{ display: "flex", fontSize: 30, color: "#aeea00", fontWeight: 700 }}>yourscore.app/38-0/wc</div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: accent }} />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
