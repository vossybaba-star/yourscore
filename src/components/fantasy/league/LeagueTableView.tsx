"use client";
/** The Table screen — Season and This-month, with a title-race summary above the
 *  full table. Tapping a member opens their completed round (after the deadline). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Card, GOLD, INK, LINE, MUTED, PANEL, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { LeagueTableRows } from "./LeagueTableRows";
import type { LeagueDetail, LeagueRow } from "./types";
import { nameOf } from "./types";

interface Run {
  gw: number; name: string; correct: number; total: number;
  questions: { prompt: string; picked: string | null; answer: string; right: boolean }[];
}

export function LeagueTableView({ detail, code }: { detail: LeagueDetail; code: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"season" | "month">("season");
  const [run, setRun] = useState<Run | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const { season, month, lastMonth, league } = detail;
  const rows = tab === "season" ? season : month.rows;
  const scored = rows.some((r) => r.played > 0);
  const leader = rows[0] ?? null;
  const you = rows.find((r) => r.isMe) ?? null;
  const gap = you && leader && !you.isMe ? leader.points - you.points : null;

  const peek = async (r: LeagueRow) => {
    if (!league.isMember) return;
    setRunNote(null); setRun(null);
    try {
      const res = await fetch(`/api/fantasy/leagues/${code}/run?user=${r.userId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) router.push(`/auth/sign-in?next=/fantasy/leagues/${code}`);
        else setRunNote(j.error ?? "Not available yet.");
        return;
      }
      setRun(j as Run);
    } catch (e) { setRunNote((e as Error).message); }
  };

  return (
    <div>
      {/* Season / This month */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["season", "month"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: tab === t ? tint(TEAL, "22") : PANEL, color: tab === t ? TEAL : MUTED,
            border: `1px solid ${tab === t ? tint(TEAL, "66") : LINE}`,
          }}>{t === "season" ? "Season" : "This month"}</button>
        ))}
      </div>

      {/* Summary card */}
      {tab === "season" ? (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>TITLE RACE</div>
          {scored && leader ? (
            <>
              <div style={{ fontSize: 14, color: INK }}>
                <b style={{ color: GOLD }}>{nameOf(leader)}</b> leads on <b>{leader.points}</b> pts.
              </div>
              {you && gap !== null && (
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                  You&apos;re {ordinal(you.rank)}{gap === 0 ? ", level with the leader." : `, ${gap} pts behind.`}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>No scores yet. The season table builds gameweek by gameweek.</div>
          )}
        </Card>
      ) : (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: GOLD, marginBottom: 6 }}>{month.label.toUpperCase()} COMPETITION</div>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            Every gameweek in {month.label} feeds one table. It resets next month.
          </p>
          {lastMonth && (
            <p style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 0" }}>
              {lastMonth.label} winner: <b style={{ color: GOLD }}>{nameOf(lastMonth.winner)}</b> · {lastMonth.winner.points} pts
            </p>
          )}
        </Card>
      )}

      <LeagueTableRows rows={rows} onPeek={league.isMember ? peek : undefined}
        emptyLabel={tab === "month" ? "No scores this month yet." : "No members yet."} />

      {runNote && <p style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 0" }}>{runNote}</p>}

      {run && (
        <Sheet onClose={() => setRun(null)} labelledBy="run-sheet-title">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10 }}>
            <span id="run-sheet-title" style={{ fontSize: 14.5, fontWeight: 700 }}>
              {run.name} got {run.correct}/{run.total} in Gameweek {run.gw}
            </span>
            <Btn small onClick={() => setRun(null)}>Close</Btn>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {run.questions.map((q, i) => (
              <div key={i} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px" }}>
                <div style={{ fontSize: 12.5, color: MUTED, whiteSpace: "pre-line", lineHeight: 1.4 }}>{q.prompt}</div>
                <div style={{ fontSize: 13, marginTop: 5, fontWeight: 600, color: q.right ? "#7BC98B" : "#E08A6B" }}>
                  {q.right ? "✓" : "✗"} {q.picked ?? "ran out of time"}
                  {!q.right && <span style={{ color: MUTED, fontWeight: 400 }}> · it was {q.answer}</span>}
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
