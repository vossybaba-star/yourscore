"use client";
/**
 * Create / Join league flows + the no-leagues empty state. The Leagues home used
 * to lead with a big inline create FORM as its hero (founder wanted the list of
 * your leagues first, admin second, 3 Aug). These move the create and join forms
 * into bottom sheets opened from buttons, so the page can lead with your leagues.
 */
import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { api, Btn, GOLD, INK, LIME, LINE, MUTED, PANEL, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { trackFantasyLeagueCreated } from "@/lib/analytics/trackGame";

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
  fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none",
};

/** Create a league — name + privacy, in a bottom sheet. */
export function CreateLeagueFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const created = await api<{ code: string }>("leagues", { name: name.trim(), isPublic });
      trackFantasyLeagueCreated({ isPublic });
      router.push(`/fantasy/leagues/${created.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Sheet onClose={onClose} labelledBy="create-league-title">
      <div id="create-league-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 3 }}>Start a league</div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>Invite your group, chat every gameweek, settle who really knows their football.</p>
      <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="League name" autoFocus style={{ ...inputStyle, marginBottom: 8 }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        {(["Private", "Public"] as const).map((label, i) => {
          const wantsPublic = i === 1;
          const active = wantsPublic === isPublic;
          return (
            <button key={label} onClick={() => setIsPublic(wantsPublic)} style={{
              flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
              border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
            }}>{label}</button>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: MUTED, margin: "0 0 12px", lineHeight: 1.4 }}>
        {isPublic ? "Public: anyone can find and join this league." : "Private: only people with your code can join."}
      </p>
      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 10px" }}>{err}</p>}
      <Btn gold disabled={!name.trim() || busy} onClick={create}>{busy ? "…" : "Create league"}</Btn>
    </Sheet>
  );
}

/** Join a league by code, in a bottom sheet. */
export function JoinLeagueFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const joined = await api<{ code: string }>("leagues/join", { code: code.trim() });
      router.push(`/fantasy/leagues/${joined.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Sheet onClose={onClose} labelledBy="join-league-title">
      <div id="join-league-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 3 }}>Join with a code</div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>Got a code from a friend? Drop it in and you&apos;re in their league.</p>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="CODE" autoFocus
        style={{ ...inputStyle, letterSpacing: "0.1em", marginBottom: 10 }} />
      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "0 0 10px" }}>{err}</p>}
      <Btn gold disabled={!code.trim() || busy} onClick={join}>{busy ? "…" : "Join league"}</Btn>
    </Sheet>
  );
}

/** No leagues yet — the strong empty state (spec §9). */
export function LeagueEmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div style={{ borderRadius: 16, padding: 20, background: `linear-gradient(150deg, ${tint(GOLD, "18")}, ${PANEL})`, border: `1px solid ${tint(GOLD, "3a")}` }}>
      <div className="font-display tracking-widest" style={{ fontSize: 12, letterSpacing: "0.1em", color: GOLD, marginBottom: 8 }}>FANTASY IS BETTER WITH RIVALS</div>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
        Create a league, invite your friends and chat through every gameweek.
      </p>
      <Btn gold onClick={onCreate}>Create league</Btn>
      <button onClick={onJoin} style={{
        width: "100%", marginTop: 8, padding: "11px 12px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
        background: "transparent", color: LIME, border: `1px solid ${tint(LIME, "55")}`,
      }}>Join with code</button>
    </div>
  );
}
