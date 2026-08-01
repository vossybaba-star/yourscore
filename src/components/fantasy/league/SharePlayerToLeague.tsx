"use client";
/** "Share to a league" — the share-from-source flow (no separate share screen).
 *  From a player's profile: pick one of your leagues, add an optional line, and
 *  the player lands as a card in that league's chat. */
import { useState } from "react";
import { Btn, Card, INK, LINE, MUTED, PANEL, Sheet, TEAL } from "@/components/fantasy/shared";

interface MyLeague { id: string; name: string; code: string; memberCount: number }

export function SharePlayerToLeague({ playerId }: { playerId: number }) {
  const [open, setOpen] = useState(false);
  const [leagues, setLeagues] = useState<MyLeague[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const openSheet = async () => {
    setOpen(true); setErr(null); setDone(null);
    if (leagues) return;
    try {
      const r = await fetch("/api/fantasy/leagues");
      const j = await r.json().catch(() => ({}));
      setLeagues(r.ok ? (j.leagues ?? []) : []);
    } catch { setLeagues([]); }
  };

  const share = async (code: string, name: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/fantasy/leagues/${code}/share`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, note: note.trim() || undefined }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setDone(name);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <Btn onClick={openSheet}>Share to a league</Btn>
      {open && (
        <Sheet onClose={() => setOpen(false)} labelledBy="share-league-title">
          <div id="share-league-title" style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 4 }}>Share to a league</div>
          {done ? (
            <>
              <p style={{ fontSize: 13.5, color: MUTED, margin: "6px 0 14px" }}>Sent to <b style={{ color: TEAL }}>{done}</b>. It&apos;s in the chat now.</p>
              <Btn onClick={() => setOpen(false)}>Done</Btn>
            </>
          ) : (
            <>
              <input value={note} maxLength={200} placeholder="Add a line (optional)…" onChange={(e) => setNote(e.target.value)}
                style={{ width: "100%", boxSizing: "border-box", fontSize: 13.5, padding: "10px 12px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none", margin: "8px 0 12px" }} />
              {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 8px" }}>{err}</p>}
              {leagues === null ? (
                <p style={{ fontSize: 13, color: MUTED }}>Loading your leagues…</p>
              ) : leagues.length === 0 ? (
                <Card><p style={{ fontSize: 13, color: MUTED, margin: 0 }}>You&apos;re not in any leagues yet. Create one from the Leagues tab.</p></Card>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {leagues.map((l) => (
                    <button key={l.id} disabled={busy} onClick={() => share(l.code, l.name)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, cursor: "pointer", textAlign: "left",
                      padding: "11px 12px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: INK,
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{l.name}</span>
                      <span style={{ fontSize: 12, color: TEAL, fontWeight: 700 }}>Share →</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
