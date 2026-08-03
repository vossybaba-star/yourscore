"use client";
/**
 * A compact squad card for the feed — the fix for the oversized board dominating
 * every post (founder, 3 Aug). Instead of the full tactical pitch, one row of the
 * XI's faces (captain ringed gold) plus a couple of FACTUAL hooks derived from the
 * squad itself: the formation, the captain, and a triple-up if a club is stacked.
 * Tapping opens the manager's full squad. Kept deliberately short so a whole post
 * plus a peek of the next fits a phone screen.
 */
import Link from "next/link";
import { GOLD, LINE, MUTED, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { BoardPlayer } from "@/lib/fantasy/board";

interface Board { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number; vice?: number }

const surname = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : full;
};

function Hook({ children, accent = MUTED }: { children: React.ReactNode; accent?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      padding: "3px 8px", borderRadius: 999, color: accent,
      background: tint(accent === MUTED ? "#8a948f" : accent, "16"),
      border: `1px solid ${tint(accent === MUTED ? "#8a948f" : accent, "38")}`,
    }}>{children}</span>
  );
}

export function CompactSquadPreview({ board, actorId }: { board: Board; actorId: string }) {
  const byId = new Map(board.players.map((p) => [p.id, p]));
  const order: Record<string, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
  const xi = board.xi.map((id) => byId.get(id)).filter((p): p is BoardPlayer => !!p)
    .sort((a, b) => (order[a.pos] ?? 9) - (order[b.pos] ?? 9));
  if (!xi.length) return null;

  // Formation from the outfield split (defenders-mids-forwards), keeper implied.
  const count = (pos: string) => xi.filter((p) => p.pos === pos).length;
  const formation = `${count("DEF")}-${count("MID")}-${count("FWD")}`;

  const captain = board.captain != null ? byId.get(board.captain) : null;

  // A stacked club is a real, derivable talking point ("Triple Liverpool").
  const clubTally = new Map<string, number>();
  xi.forEach((p) => { if (p.club) clubTally.set(p.club, (clubTally.get(p.club) ?? 0) + 1); });
  let bestClub: string | null = null;
  let bestN = 0;
  clubTally.forEach((n, club) => { if (n > bestN) { bestN = n; bestClub = club; } });
  const stackWord = bestN >= 3 ? (bestN === 3 ? "Triple" : bestN === 4 ? "Quad" : `${bestN}x`) : null;

  return (
    <Link href={`/profile/${actorId}#fantasy-xi`} style={{ display: "block", textDecoration: "none", marginTop: 11 }}>
      <div style={{ borderRadius: 12, background: PANEL_2, border: `1px solid ${LINE}`, padding: "11px 12px" }}>
        {/* One row of the eleven faces — the captain ringed gold with a C. */}
        <div style={{ display: "flex", gap: 3, marginBottom: 9 }}>
          {xi.map((p) => {
            const isCap = board.captain === p.id;
            return (
              <div key={p.id} style={{ position: "relative", flex: "1 1 0", minWidth: 0, display: "flex", justifyContent: "center" }}>
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={26} ring={isCap ? GOLD : undefined} />
                {isCap && (
                  <span aria-hidden style={{
                    position: "absolute", top: -4, right: "50%", marginRight: -15, width: 13, height: 13, borderRadius: 999,
                    background: GOLD, color: "#3a2600", fontSize: 8, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>C</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Hook accent={TEAL}>{formation}</Hook>
          {captain && <Hook accent={GOLD}>{surname(captain.name)} (C)</Hook>}
          {stackWord && bestClub && <Hook>{stackWord} {bestClub}</Hook>}
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: TEAL, whiteSpace: "nowrap" }}>
            See squad <span aria-hidden>›</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
