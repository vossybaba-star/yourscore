"use client";
/** The league's full member list (Phase 1B) — reachable from the Table
 *  header and the Hub. Fetches the Phase 1A /members roster and merges in
 *  rank/points from whichever table rows the caller already has loaded, so
 *  this never fires its own second table query. Search + a position/A-Z
 *  sort; tap opens the shared MemberActionSheet. No online status (product
 *  brief: unreliable, not worth showing). */
import { useEffect, useMemo, useState } from "react";
import { ErrorState, GOLD, INK, LINE, Loading, MUTED, PANEL, PANEL_2, Sheet, Skel, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { MemberActionSheet, nameOfMember, type MemberActionMember } from "@/components/fantasy/MemberActionSheet";
import type { LeagueRow } from "./types";

type Sort = "position" | "az";

export function LeagueMembersView({ code, rows, viewerId, onClose }: {
  code: string;
  /** Whatever table rows the caller already loaded (season table is the
   *  richest source — rank + points for everyone who's played). */
  rows: LeagueRow[];
  viewerId: string | null;
  onClose: () => void;
}) {
  const [roster, setRoster] = useState<MemberActionMember[] | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [rosterErr, setRosterErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const havePoints = rows.some((r) => r.played > 0);
  const [sort, setSort] = useState<Sort>(havePoints ? "position" : "az");
  const [selected, setSelected] = useState<MemberActionMember | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setRosterErr(null);
    fetch(`/api/fantasy/leagues/${code}/members`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (live) { setRoster(d.members ?? []); setOwnerId(d.ownerId ?? null); } })
      // A failed fetch used to land on setRoster([]) — identical to an
      // empty-but-real league, so "No members match" was showing for a dead
      // request too. Keep roster null and surface the failure instead.
      .catch((e) => { if (live) setRosterErr((e as Error).message || "Couldn't load members."); });
    return () => { live = false; };
  }, [code, reload]);

  // /members deliberately excludes the caller AND anyone without a username
  // (it exists to feed @mention autocomplete — see lib/fantasy/chat.ts). The
  // member LIST has to show everyone, so any table row missing from the
  // roster (you, or a handle-less member) is added back in from the table.
  // The sheet's Mention chip already hides itself for a null username.
  const full = useMemo<MemberActionMember[] | null>(() => {
    if (!roster) return null;
    const byId = new Map(rows.map((r) => [r.userId, r]));
    const list: MemberActionMember[] = roster.map((m) => {
      const r = byId.get(m.userId);
      return { ...m, rank: r?.rank, points: r?.played ? r.points : undefined };
    });
    const seen = new Set(list.map((m) => m.userId));
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      list.push({
        userId: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl,
        rank: r.rank, points: r.played ? r.points : undefined,
      });
    }
    return list;
  }, [roster, rows]);

  const filtered = useMemo(() => {
    if (!full) return null;
    const query = q.trim().toLowerCase();
    const list = (query
      ? full.filter((m) => nameOfMember(m).toLowerCase().includes(query) || (m.username ?? "").toLowerCase().includes(query))
      : full.slice()
    );
    if (sort === "az") list.sort((a, b) => nameOfMember(a).localeCompare(nameOfMember(b)));
    else list.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
    return list;
  }, [full, q, sort]);

  return (
    <Sheet onClose={onClose} labelledBy="members-title">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span id="members-title" className="font-display" style={{ fontSize: 18, color: INK }}>Members</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 44, padding: "0 4px" }}>Close</button>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" aria-label="Search members" style={{
        width: "100%", boxSizing: "border-box", fontSize: 13.5, padding: "10px 13px", borderRadius: 10,
        background: PANEL_2, border: `1px solid ${LINE}`, color: INK, outline: "none", marginBottom: 10,
      }} />

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {([["position", "League position"], ["az", "A to Z"]] as [Sort, string][]).map(([s, label]) => (
          <button key={s} onClick={() => setSort(s)} style={{
            padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            background: sort === s ? tint(TEAL, "22") : PANEL, color: sort === s ? TEAL : MUTED,
            border: `1px solid ${sort === s ? tint(TEAL, "66") : LINE}`,
          }}>{label}</button>
        ))}
      </div>

      {rosterErr ? (
        <ErrorState message={rosterErr} onRetry={() => setReload((n) => n + 1)} />
      ) : !filtered ? (
        <Loading label="Loading members">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Skel h={44} r={10} /><Skel h={44} r={10} /><Skel h={44} r={10} />
          </div>
        </Loading>
      ) : filtered.length === 0 ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0 }}>No members match.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "58vh", overflowY: "auto" }}>
          {filtered.map((m) => (
            <button key={m.userId} onClick={() => setSelected(m)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 10, textAlign: "left", cursor: "pointer",
              minHeight: 44, background: PANEL, border: `1px solid ${LINE}`,
            }}>
              <PlayerAvatar seed={m.userId} name={nameOfMember(m)} avatarUrl={m.avatarUrl} size={30} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nameOfMember(m)}{m.userId === viewerId ? <span style={{ color: TEAL, fontWeight: 700 }}> · you</span> : ""}
              </span>
              {ownerId === m.userId && (
                <span style={{
                  fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", color: GOLD, flexShrink: 0,
                  background: tint(GOLD, "1c"), border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 999, padding: "2px 7px",
                }}>OWNER</span>
              )}
              {m.points !== undefined && (
                <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED, flexShrink: 0 }}>{m.points} pts</span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <MemberActionSheet
          member={selected}
          context="league"
          leagueCode={code}
          isLeagueOwner={ownerId === viewerId}
          viewerId={viewerId}
          onClose={() => setSelected(null)}
        />
      )}
    </Sheet>
  );
}
