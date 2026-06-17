/**
 * /api/draft/wc-og — World Cup shareable scorecard (1200x630).
 *
 * Two layouts:
 *  • mode=mastermind — the DAILY ranked card ("knowledge flex"): the player's quiz score
 *    is the hero (a gold ring), beside their name, result, world rank and run record.
 *    SELF-CONTAINED: pass `run=<id>` and every field (name, quiz, rank, result, record,
 *    nation/crest) is resolved server-side from the run — so the card is always complete
 *    and never falls back to "A manager" or a half-empty rail. Explicit params
 *    (player/quiz/rec/rank/status/stage/nation/crest/date) still work as a fallback.
 *  • default (the open World Cup Run) — outcome + the full stage path on the right.
 *    Params: nation, crest, status, stage, path = "Label~Detail~R|..." (R = W|L|Q).
 */

import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "edge";

// The WC2026 ranked season window. Hardcoded here (rather than imported from wc.ts) so the
// edge bundle stays lean — wc.ts drags in the whole run engine + player pool.
const WC_SEASON_START = "2026-06-11";
const WC_SEASON_END = "2026-07-19";

const STAGE_LABEL: Record<string, string> = {
  group: "Group Stage", ko: "Knockouts", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-Final", sf: "Semi-Final", final: "Final",
};

// ── Server-side resolution from a run id ─────────────────────────────────────
// Everything the card shows, pulled straight from the run + season board (service role).
// Fails soft to null so the route falls back to explicit query params.
type ResolvedRun = {
  player: string; nation: string; world: boolean; status: string; stage: string;
  quizCorrect: number | null; quizTotal: number | null; rec: string;
  rank: number | null; total: number; runDate: string | null;
};

async function resolveRun(runId: string): Promise<ResolvedRun | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const { data: r } = await db
      .from("draft_wc_runs")
      .select("nation,mode,status,stage,quiz_correct,quiz_total,user_id,run_date")
      .eq("id", runId)
      .maybeSingle();
    if (!r) return null;

    // This run's record (W-D-L), excluding the qualification play-off gate.
    const { data: ms } = await db
      .from("draft_wc_matches").select("won,stage").eq("run_id", runId);
    let w = 0, d = 0, l = 0;
    for (const m of (ms ?? []) as { won: boolean | null; stage: string }[]) {
      if (m.stage === "playoff") continue;
      if (m.won === true) w++; else if (m.won === false) l++; else d++;
    }

    // Season board → world rank + the player's public name + field size (for the percentile).
    let rank: number | null = null, total = 0, player = "";
    try {
      const { data: lb } = await db.rpc("get_wc_daily_leaderboard", {
        p_start: WC_SEASON_START, p_end: WC_SEASON_END, p_limit: 100000,
      });
      const rows = (lb ?? []) as { user_id: string; display_name: string; rank: number }[];
      total = rows.length;
      const me = rows.find((x) => x.user_id === r.user_id);
      if (me) { rank = me.rank; player = me.display_name; }
    } catch { /* board not ready — name falls back to profiles below */ }

    if (!player) {
      const { data: p } = await db
        .from("profiles").select("display_name").eq("id", r.user_id).maybeSingle();
      player = (p?.display_name as string | undefined)?.trim() || "A manager";
    }

    return {
      player, nation: String(r.nation), world: r.mode === "world",
      status: String(r.status), stage: String(r.stage),
      quizCorrect: r.quiz_correct ?? null, quizTotal: r.quiz_total ?? null,
      rec: `${w}-${d}-${l}`, rank, total, runDate: (r.run_date as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const M = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const [, mo, day] = iso.split("-").map(Number);
  if (!mo || !day) return "";
  return `${day} ${M[mo - 1]}`;
}

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

  // ── Mastermind daily card — Direction B "knowledge flex" ──────────────────
  if (mastermind) {
    // Self-contained when a run id is supplied; otherwise fall back to explicit params.
    const resolved = q.has("run") ? await resolveRun(q.get("run")!) : null;

    const player = resolved?.player || q.get("player") || "A manager";
    const mNation = resolved ? resolved.nation : nation;
    const mWorld = resolved ? resolved.world : world;
    const mStatus = resolved ? resolved.status : status;
    const mStage = resolved ? resolved.stage : stage;
    const rec = resolved ? resolved.rec : (q.get("rec") || "");
    const date = resolved ? dateLabel(resolved.runDate) : (q.get("date") || "").toUpperCase();

    const mStageLabel = STAGE_LABEL[mStage] ?? "Group Stage";
    const mChampion = mStatus === "champion";
    const mEliminated = mStatus === "eliminated";
    const mAccent = mChampion ? "#ffd700" : mEliminated ? "#ff4757" : "#aeea00";
    const mHeadline = mChampion ? "CHAMPIONS" : mEliminated ? "OUT" : mStageLabel.toUpperCase();
    const sub = mChampion ? "Won the World Cup 🏆"
      : mEliminated ? `Out at the ${mStageLabel}`
      : `Reached the ${mStageLabel}`;

    // Quiz score → ring fraction. From resolved numbers, or parse an "N/M" param.
    let correct: number | null = resolved?.quizCorrect ?? null;
    let totalQ: number | null = resolved?.quizTotal ?? null;
    if (correct == null || totalQ == null) {
      const m = (q.get("quiz") || "").match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) { correct = Number(m[1]); totalQ = Number(m[2]); }
    }
    const hasQuiz = correct != null && totalQ != null && totalQ > 0;
    const frac = hasQuiz ? Math.max(0, Math.min(1, correct! / totalQ!)) : 0;

    // World rank + percentile ("top N% of football brains") when the field is big enough.
    const rank = resolved?.rank ?? (q.get("rank") ? Number(q.get("rank")) : null);
    const fieldTotal = resolved?.total ?? 0;
    const pct = rank && fieldTotal >= 12 ? Math.max(1, Math.ceil((rank / fieldTotal) * 100)) : null;

    // Ring geometry.
    const R = 124, SW = 22, C = 2 * Math.PI * R, dash = frac * C;
    const ringColor = mChampion ? "#ffd700" : frac >= 0.75 ? "#aeea00" : frac >= 0.5 ? "#ffd700" : "#ff8a3d";

    const Tile = ({ label, value, sub: tsub, gold }: { label: string; value: string; sub?: string; gold?: boolean }) => (
      <div style={{
        display: "flex", flexDirection: "column", flex: 1, padding: "18px 22px", borderRadius: 16,
        background: gold ? "rgba(255,215,0,0.10)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${gold ? "rgba(255,215,0,0.5)" : "rgba(255,255,255,0.10)"}`,
      }}>
        <div style={{ display: "flex", fontSize: 19, letterSpacing: 2, color: gold ? "#ffd700" : "#8a948f", fontWeight: 700 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span style={{ display: "flex", fontSize: 50, fontWeight: 900, color: "#fff", lineHeight: 1.05 }}>{value}</span>
          {tsub ? <span style={{ display: "flex", fontSize: 20, color: "#9fb0a4", marginLeft: 10, fontWeight: 700 }}>{tsub}</span> : null}
        </div>
      </div>
    );

    return new ImageResponse(
      (
        <div style={{ width: "1200px", height: "630px", display: "flex", flexDirection: "column", background: "linear-gradient(135deg, #0a0a0f 0%, #14110a 100%)", padding: "46px 60px", fontFamily: "sans-serif", position: "relative" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>
              <span style={{ color: "#fff" }}>YOUR</span>
              <span style={{ color: "#aeea00" }}>SCORE</span>
              <span style={{ color: "#8a948f", marginLeft: 14, fontWeight: 700 }}>· WORLD CUP</span>
              <span style={{ color: "#ffd700", marginLeft: 8, fontWeight: 800 }}>MASTERMIND</span>
            </div>
            <div style={{ display: "flex", fontSize: 24, color: "#8a948f", fontWeight: 700 }}>{date ? `${date} · ` : ""}DAILY</div>
          </div>

          <div style={{ display: "flex", alignItems: "center", marginTop: 18, flex: 1 }}>
            {/* Left: the quiz-score ring (the hero) */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 360 }}>
              <div style={{ display: "flex", position: "relative", width: 300, height: 300, alignItems: "center", justifyContent: "center" }}>
                <svg width="300" height="300" viewBox="0 0 300 300" style={{ position: "absolute", top: 0, left: 0 }}>
                  <circle cx="150" cy="150" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={SW} />
                  {hasQuiz ? (
                    <circle cx="150" cy="150" r={R} fill="none" stroke={ringColor} strokeWidth={SW}
                      strokeDasharray={`${dash} ${C}`} strokeLinecap="round" transform="rotate(-90 150 150)" />
                  ) : null}
                </svg>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  {hasQuiz ? (
                    <div style={{ display: "flex", alignItems: "baseline" }}>
                      <span style={{ display: "flex", fontSize: 116, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{correct}</span>
                      <span style={{ display: "flex", fontSize: 50, fontWeight: 800, color: "#8a948f" }}>/{totalQ}</span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", fontSize: 96, lineHeight: 1 }}>🧠</div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 1, color: "#c4ccc6", marginTop: 6 }}>MASTERMIND QUIZ</div>
              {pct ? (
                <div style={{ display: "flex", marginTop: 10, padding: "7px 18px", borderRadius: 999, background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.45)", fontSize: 20, fontWeight: 800, color: "#ffd700" }}>
                  TOP {pct}% OF FOOTBALL BRAINS
                </div>
              ) : null}
            </div>

            {/* Right: identity + result + the rank/record rail */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 48, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {crest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crest} alt="" width={52} height={52} style={{ objectFit: "contain", marginRight: 14 }} />
                ) : (
                  <div style={{ display: "flex", fontSize: 44, marginRight: 14 }}>{mWorld ? "🌍" : "🧠"}</div>
                )}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontSize: 40, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{player}</div>
                  <div style={{ display: "flex", fontSize: 22, color: "#8a948f", marginTop: 4 }}>{mWorld ? "World XI" : mNation}</div>
                </div>
              </div>

              <div style={{ display: "flex", fontSize: mHeadline.length <= 4 ? 92 : mHeadline.length <= 9 ? 68 : 50, fontWeight: 900, color: mAccent, lineHeight: 1, marginTop: 20 }}>{mHeadline}</div>
              <div style={{ display: "flex", fontSize: 26, color: "#c4ccc6", marginTop: 8 }}>{sub}</div>

              <div style={{ display: "flex", gap: 16, marginTop: 26 }}>
                <Tile label="WORLD RANK" value={rank ? `#${rank}` : "—"} gold />
                <Tile label="RUN RECORD" value={rec || "—"} sub={rec ? "W-D-L" : undefined} />
              </div>
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#c4ccc6" }}>
              <span style={{ color: "#fff", fontWeight: 800, marginRight: 10 }}>38-0</span>
              <span>for the fans that know football</span>
            </div>
            <div style={{ display: "flex", fontSize: 26, color: "#ffd700", fontWeight: 800 }}>yourscore.app/38-0/wc</div>
          </div>
          <div style={{ position: "absolute", left: 0, bottom: 0, width: "1200px", height: 10, background: mAccent }} />
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
