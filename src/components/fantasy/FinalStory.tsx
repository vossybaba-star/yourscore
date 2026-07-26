"use client";

import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Btn, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint, type ClientPoolPlayer } from "@/components/fantasy/shared";
import { bestWorst } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";

interface Row { id: number; points: number; captain: boolean; subbedIn: boolean }

/**
 * The Final story — the settled gameweek as an editorial, shareable cover.
 * Gold-led (the week is won, not provisional), portrait-first (we have head-shots
 * and crests, never action photography). Every figure is a REAL calculated result
 * off the point breakdown: the star man, the captain's return, the biggest regret.
 * No fabricated "best move" — only what the scoring actually says.
 */
export function FinalStory({
  gw, points, breakdown, xi, pool, nameOf, movesEarned, busy, onShare,
}: {
  gw: number;
  points: number;
  breakdown: Row[];
  xi: number[];
  pool: Map<number, ClientPoolPlayer>;
  nameOf: (id: number) => string;
  movesEarned: number;
  busy: boolean;
  onShare: () => void;
}) {
  const xiSet = new Set(xi);
  const starters = breakdown.filter((b) => xiSet.has(b.id));
  const { best, worst } = bestWorst(starters);
  const captain = breakdown.find((b) => b.captain) ?? null;

  const Face = ({ id, size = 46 }: { id: number; size?: number }) => {
    const p = pool.get(id);
    return <PlayerAvatar name={p?.name ?? nameOf(id)} avatarUrl={p ? faceFor(p.name) : undefined} size={size} />;
  };

  const Stat = ({ label, id, pts, accent }: { label: string; id: number; pts: number; accent: string }) => (
    <div style={{
      flex: "1 1 0", minWidth: 0, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14,
      padding: "12px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, textAlign: "center",
    }}>
      <span className="font-display" style={{ fontSize: 9.5, letterSpacing: "0.1em", color: accent }}>{label}</span>
      <Face id={id} />
      <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {nameOf(id)}
      </span>
      <span className="font-display" style={{ fontSize: 18, color: accent, fontVariantNumeric: "tabular-nums" }}>{pts}</span>
    </div>
  );

  return (
    <div className="rounded-2xl relative overflow-hidden" style={{
      background: `linear-gradient(150deg, ${tint(GOLD, "18")}, ${tint(GOLD, "04")})`,
      border: `1px solid ${tint(GOLD, "44")}`, padding: "16px 15px", marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span className="font-display tracking-widest" style={{ fontSize: 10.5, color: GOLD }}>
          GAMEWEEK {gw} · YOUR STORY
        </span>
        <span className="font-body" style={{ fontSize: 11.5, color: MUTED }}>
          {movesEarned > 0
            ? <>Earned <b style={{ color: GOLD, fontWeight: 700 }}>{movesEarned}</b> move{movesEarned === 1 ? "" : "s"}</>
            : "No moves earned"}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 14px" }}>
        <span className="font-display" style={{ fontSize: 46, lineHeight: 0.9, letterSpacing: "-0.02em", color: GOLD }}>{points}</span>
        <span className="font-display" style={{ fontSize: 18, color: GOLD, opacity: 0.85 }}>pts</span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {best && <Stat label="STAR MAN" id={best.id} pts={best.points} accent={GOLD} />}
        {captain && <Stat label="CAPTAIN" id={captain.id} pts={captain.points} accent={TEAL} />}
        {worst && worst.id !== best?.id && <Stat label="BIGGEST REGRET" id={worst.id} pts={worst.points} accent="#E08A6B" />}
      </div>

      <div style={{ marginTop: 14 }}>
        <Btn gold disabled={busy} onClick={onShare}>{busy ? "…" : "Share your story"}</Btn>
      </div>
    </div>
  );
}
