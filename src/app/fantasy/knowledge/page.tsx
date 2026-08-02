"use client";
/** Top Marks — the quiz league. EVERY manager sits on one table and climbs on
 *  right answers alone (whatever their team did on the pitch), split into this
 *  gameweek's round and the whole season. Public: guests can browse it before
 *  they've ever built a squad. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import {
  Card, GOLD, Header, INK, LINE, MUTED, page, PANEL, tint,
} from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";

type Cut = "week" | "season";
interface Row {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; correct: number; rounds: number; accuracy: number; isMe: boolean;
}
interface Board { cut: Cut; label: string; gw: number; totalPlayers: number; rows: Row[] }

const nameOf = (r: Row) => r.displayName ?? (r.username ? `@${r.username}` : "Player");

/** A target — hitting the right answers. Faint gold line-art bleeding off the
 *  hero tile, the house motif (matches the pitch art on the hub). */
const MarksArt = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true"
    style={{ position: "absolute", right: -14, bottom: -22, width: 152, height: 152, opacity: 0.13, pointerEvents: "none" }}>
    <circle cx="50" cy="50" r="34" fill="none" stroke={GOLD} strokeWidth="3" />
    <circle cx="50" cy="50" r="22" fill="none" stroke={GOLD} strokeWidth="3" />
    <circle cx="50" cy="50" r="10" fill={GOLD} />
  </svg>
);

export default function KnowledgePage() {
  const router = useRouter();
  const [cut, setCut] = useState<Cut>("week");
  const [board, setBoard] = useState<Board | null>(null);
  const [gw, setGw] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (c: Cut) => {
    setErr(null);
    try {
      const res = await fetch(`/api/fantasy/knowledge?cut=${c}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b: Board = await res.json();
      setBoard(b);
      if (b.gw) setGw(b.gw);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(cut); }, [cut, load]);

  const weekLabel = gw ? `GW${gw}` : "This week";

  return (
    <>
    <main data-fantasy style={page}>
      <Header exit={{ label: "My team", onClick: () => router.push("/fantasy") }} />

      {/* What this is — a tile with a heading, a clear explanation, and a graphic. */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 16, padding: 18, marginBottom: 14,
        background: `linear-gradient(140deg, ${tint(GOLD, "22")}, ${tint(GOLD, "04")})`,
        border: `1px solid ${tint(GOLD, "44")}`,
      }}>
        <MarksArt />
        <div style={{ position: "relative" }}>
          <div className="font-display" style={{ fontSize: 10.5, letterSpacing: "0.16em", color: GOLD, marginBottom: 7 }}>
            THE QUIZ LEAGUE
          </div>
          <h1 className="font-display text-white" style={{ fontSize: 30, lineHeight: 0.95, margin: 0, letterSpacing: "-0.01em" }}>
            {KNOWLEDGE_NAME}
          </h1>
          <p className="font-body" style={{ fontSize: 13.5, color: MUTED, margin: "11px 0 0", lineHeight: 1.55, maxWidth: "86%" }}>
            Every gameweek you answer eleven questions in your round. Right answers rank you here against
            every manager, whatever your team does on the pitch. Play more rounds, climb the table.
          </p>
        </div>
      </div>

      {/* This gameweek's round, or the whole season. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([["week", weekLabel], ["season", "Season"]] as [Cut, string][]).map(([c, lbl]) => (
          <button key={c} onClick={() => setCut(c)} style={{
            flex: 1, padding: "9px 4px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: cut === c ? GOLD : PANEL, color: cut === c ? "#2A1F00" : INK,
            border: `1px solid ${cut === c ? GOLD : LINE}`,
          }}>{lbl}</button>
        ))}
      </div>

      {err && <Card style={{ marginBottom: 10 }}><p style={{ color: "#E08A6B", fontSize: 13, margin: 0 }}>{err}</p></Card>}
      {!board && !err && <p style={{ color: MUTED, fontSize: 13 }}>Loading…</p>}

      {board && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>
              {cut === "week" ? `${weekLabel} · RIGHT ANSWERS` : "SEASON · RIGHT ANSWERS"}
            </span>
            {board.totalPlayers > 0 && (
              <span style={{ fontSize: 11, color: MUTED }}>{board.totalPlayers.toLocaleString()} playing</span>
            )}
          </div>
          {!board.rows.length && (
            <Card><p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
              No one&apos;s on the board yet. It fills the moment the first round is played.
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
                  {r.rounds > 0 ? `${r.rounds} round${r.rounds === 1 ? "" : "s"} · ${r.accuracy}%` : "yet to play"}
                </span>
                <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 30, textAlign: "right" }}>{r.correct}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
      <BottomNav />
    </>
  );
}
