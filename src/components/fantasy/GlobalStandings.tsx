"use client";
/**
 * Global standings on the league tab — where you fall among EVERY fantasy player,
 * not just your private leagues. The monthly comp is the hero (default view);
 * Season and This week are toggles. Your own row pins to the bottom when you rank
 * past the visible top.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, GOLD, INK, LINE, MUTED, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import type { GlobalStandings as Standings, StandingsScope, StandingRow } from "@/lib/fantasy/standings";

const SCOPES: { key: StandingsScope; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "season", label: "Season" },
  { key: "gw", label: "This week" },
];

function Row({ r }: { r: StandingRow }) {
  return (
    <Link href={`/profile/${r.userId}`} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 10,
      textDecoration: "none", color: INK,
      background: r.isMe ? tint(TEAL, "18") : PANEL,
      border: `1px solid ${r.isMe ? tint(TEAL, "66") : LINE}`,
    }}>
      <span style={{ width: 26, textAlign: "center", fontWeight: 800, fontSize: 13.5, color: r.rank <= 3 ? GOLD : MUTED, flexShrink: 0 }}>
        {r.rank}
      </span>
      <PlayerAvatar name={r.name} avatarUrl={r.avatarUrl} size={30} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r.name}{r.isMe && <span style={{ color: TEAL, fontWeight: 700 }}> · you</span>}
      </span>
      <span style={{ fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{r.points.toLocaleString()}</span>
    </Link>
  );
}

export function GlobalStandings() {
  const [scope, setScope] = useState<StandingsScope>("month");
  const [data, setData] = useState<Standings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/fantasy/standings?scope=${scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [scope]);

  const youBelowTop = data?.you && !data.rows.some((r) => r.isMe);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>GLOBAL STANDINGS</div>
        {data && data.totalPlayers > 0 && (
          <div style={{ fontSize: 11, color: MUTED }}>{data.totalPlayers.toLocaleString()} playing</div>
        )}
      </div>

      {/* Scope toggle — This month leads, the monthly comp being the point. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {SCOPES.map((s) => {
          const active = scope === s.key;
          return (
            <button key={s.key} onClick={() => setScope(s.key)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
              border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
            }}>{s.label}</button>
          );
        })}
      </div>

      <Card>
        {data && (
          <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginBottom: 8 }}>
            {data.title}
            {data.scope === "month" && <span style={{ color: MUTED, fontWeight: 500 }}> · this month&apos;s table</span>}
          </div>
        )}

        {loading && <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>Loading…</p>}

        {!loading && data && data.rows.length === 0 && (
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0", lineHeight: 1.5 }}>
            No scores yet. The table fills once the first gameweek is played.
          </p>
        )}

        {!loading && data && data.rows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.rows.map((r) => <Row key={r.userId} r={r} />)}
            {youBelowTop && data.you && (
              <>
                <div style={{ textAlign: "center", color: MUTED, fontSize: 16, lineHeight: 1, margin: "1px 0" }}>⋯</div>
                <Row r={data.you} />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
