"use client";
/**
 * A list of managers with a Follow button each — the shared body of the
 * followers / following / discover surfaces. Fetches /api/follow/list, which
 * primes each row's follow state so there's no per-row status fetch.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { FollowButton } from "@/components/social/FollowButton";
import { ErrorState, Loading, Skel } from "@/components/fantasy/shared";

interface Row { userId: string; name: string; avatarUrl: string | null; iFollow: boolean }

export function FollowList({ query, emptyText }: { query: string; emptyText: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  // Kept apart from "rows came back empty" (a real, valid state this list
  // already has its own copy for via `emptyText`) — a failed fetch used to
  // land on rows=[] too, which made a dead request look identical to a
  // genuinely empty followers/following list.
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setErr(null);
    fetch(`/api/follow/list?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (live) setRows(d.rows ?? []); })
      .catch(() => { if (live) setErr("That didn't load."); });
    return () => { live = false; };
  }, [query, reload]);

  if (err) return <ErrorState message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (rows === null) {
    return (
      <Loading label="Loading">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skel h={54} r={12} /><Skel h={54} r={12} /><Skel h={54} r={12} />
        </div>
      </Loading>
    );
  }
  if (rows.length === 0) return <p style={{ fontSize: 13.5, color: "#8a948f", padding: "12px 2px", lineHeight: 1.5 }}>{emptyText}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map((r) => (
        <div key={r.userId} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 12,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
        }}>
          <Link href={`/profile/${r.userId}`} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0, textDecoration: "none", color: "#eef2f0" }}>
            <PlayerAvatar name={r.name} avatarUrl={r.avatarUrl} size={36} />
            <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          </Link>
          <FollowButton userId={r.userId} size="sm" initialFollowing={r.iFollow} />
        </div>
      ))}
    </div>
  );
}
