"use client";
/** The knowledge board — the quiz's OWN competition. Accuracy climbs here
 *  whatever your team did at the weekend, and this is where quiz prestige
 *  lives (the fantasy tables stay about football decisions). Public: guests
 *  can browse it before they've ever built a squad. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import {
  Btn, Card, GOLD, Header, INK, LINE, MUTED, page, PANEL,
} from "@/components/fantasy/shared";

type Cut = "week" | "month" | "season";
interface Row {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; correct: number; rounds: number; accuracy: number; isMe: boolean;
}
interface Board { cut: Cut; label: string; rows: Row[] }

const nameOf = (r: Row) => r.displayName ?? (r.username ? `@${r.username}` : "Player");

export default function KnowledgePage() {
  const router = useRouter();
  const [cut, setCut] = useState<Cut>("week");
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (c: Cut) => {
    setErr(null);
    try {
      const res = await fetch(`/api/fantasy/knowledge?cut=${c}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBoard(await res.json());
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(cut); }, [cut, load]);

  return (
    <main style={page}>
      <Header right={<Btn small onClick={() => router.push("/fantasy")}>← My team</Btn>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>{KNOWLEDGE_NAME}</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        Right answers, counted for their own sake. A brilliant round scores here even when
        your team has a bad weekend.
      </p>

      {/* Cut tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["week", "month", "season"] as Cut[]).map((c) => (
          <button key={c} onClick={() => setCut(c)} style={{
            flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700,
            cursor: "pointer", textTransform: "capitalize",
            background: cut === c ? GOLD : PANEL, color: cut === c ? "#2A1F00" : INK,
            border: `1px solid ${cut === c ? GOLD : LINE}`,
          }}>{c === "week" ? "This week" : c === "month" ? "This month" : "Season"}</button>
        ))}
      </div>

      {err && <Card style={{ marginBottom: 10 }}><p style={{ color: "#E08A6B", fontSize: 13, margin: 0 }}>{err}</p></Card>}
      {!board && !err && <p style={{ color: MUTED, fontSize: 13 }}>Loading…</p>}

      {board && (
        <>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>
            {board.label.toUpperCase()}
          </div>
          {!board.rows.length && (
            <Card><p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
              No rounds played yet {cut === "week" ? "this gameweek" : cut === "month" ? "this month" : "this season"} —
              the board fills in as rounds are completed.
            </p></Card>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {board.rows.map((r) => (
              <div key={r.userId} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                background: PANEL, borderRadius: 12,
                border: `1px solid ${r.isMe ? GOLD : LINE}`,
              }}>
                <span style={{ width: 22, textAlign: "right", fontWeight: 700, color: r.rank <= 3 ? GOLD : MUTED }}>{r.rank}</span>
                <PlayerAvatar seed={r.userId} name={nameOf(r)} avatarUrl={r.avatarUrl} size={30} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {nameOf(r)}{r.isMe && <span style={{ color: GOLD }}> (you)</span>}
                </span>
                <span style={{ fontSize: 11.5, color: MUTED, whiteSpace: "nowrap" }}>
                  {r.rounds} round{r.rounds === 1 ? "" : "s"} · {r.accuracy}%
                </span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 30, textAlign: "right" }}>{r.correct}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
