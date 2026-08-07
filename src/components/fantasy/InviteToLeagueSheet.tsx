"use client";
/**
 * A bottom sheet to invite ONE manager to one of your leagues (founder, 3 Aug —
 * "invite other users to their leagues, especially from the feed"). Lists the
 * leagues you're in; picking one sends the manager a notification linking to the
 * league, where a non-member already sees "JOIN THIS LEAGUE". Reusable: dropped
 * onto feed cards today, profiles next.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { INK, LINE, MUTED, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";

interface MyLeague { id: string; name: string; code: string; memberCount: number }

export function InviteToLeagueSheet({ inviteeId, inviteeName, onClose }: {
  inviteeId: string; inviteeName: string; onClose: () => void;
}) {
  const router = useRouter();
  const [leagues, setLeagues] = useState<MyLeague[] | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/fantasy/leagues")
      .then((r) => (r.ok ? r.json() : { leagues: [] }))
      .then((d) => { if (live) setLeagues(d.leagues ?? []); })
      .catch(() => { if (live) setLeagues([]); });
    return () => { live = false; };
  }, []);

  const invite = useCallback(async (l: MyLeague) => {
    if (busyCode || doneCode) return;
    setBusyCode(l.code); setErr(null);
    try {
      const res = await fetch(`/api/fantasy/leagues/${l.code}/invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteeId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't send that invite"); setBusyCode(null); return; }
      setDoneCode(l.code); setBusyCode(null);
      window.setTimeout(onClose, 1100);
    } catch { setErr("Couldn't send that invite"); setBusyCode(null); }
  }, [busyCode, doneCode, inviteeId, onClose]);

  return (
    <Sheet onClose={onClose} labelledBy="invite-league-title" variant="panel" border={LINE} maxHeight="70vh"
      padding="16px 16px calc(20px + env(safe-area-inset-bottom))">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div id="invite-league-title" className="font-display" style={{ fontSize: 17, color: INK }}>Invite {inviteeName}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: MUTED, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close</button>
      </div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>Pick one of your leagues to invite them to.</p>

      {leagues === null ? (
        <p style={{ fontSize: 13, color: MUTED, padding: "10px 2px" }}>Loading your leagues…</p>
      ) : leagues.length === 0 ? (
        <div style={{ textAlign: "center", padding: "10px 6px 4px" }}>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "0 0 12px" }}>You&apos;re not in any leagues yet. Create one and you can invite people straight in.</p>
          <button onClick={() => { onClose(); router.push("/fantasy/leagues"); }} style={{
            padding: "10px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            background: TEAL, color: "#04231f", border: "none",
          }}>Go to leagues</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leagues.map((l) => {
            const done = doneCode === l.code;
            const busy = busyCode === l.code;
            return (
              <button key={l.code} onClick={() => invite(l)} disabled={!!busyCode || !!doneCode} style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: (busyCode || doneCode) ? "default" : "pointer",
                padding: "11px 13px", borderRadius: 12, background: done ? tint(TEAL, "18") : PANEL_2,
                border: `1px solid ${done ? tint(TEAL, "55") : LINE}`, opacity: (busyCode && !busy) || (doneCode && !done) ? 0.5 : 1,
              }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK }}>{l.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 1 }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"}</span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL, whiteSpace: "nowrap" }}>
                  {done ? "Invited ✓" : busy ? "…" : "Invite →"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "10px 2px 0" }}>{err}</p>}
    </Sheet>
  );
}
