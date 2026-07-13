"use client";
/** Squad builder — pick your 15 once (2 GK / 5 DEF / 5 MID / 3 FWD, £100m, max 3/club). */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL, PITCH,
  POS_ORDER, QUOTA, type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";

const BUDGET = 1000;

export default function BuildPage() {
  const router = useRouter();
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [tab, setTab] = useState<Pos>("GK");
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false); // rebuilding an existing squad

  useEffect(() => {
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
    // Pre-load an existing squad so a pre-season rebuild EDITS it (never a blank slate).
    api<FantasyState>("state").then((s) => {
      if (!s.squad) return;
      if (!s.canRebuild) { router.replace("/fantasy"); return; } // season started → transfers only
      setEditing(true);
      setPicked(s.squad.picks.map((p) => p.id));
    }).catch(() => {});
  }, [router]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const picks = picked.map((id) => byId.get(id)!).filter(Boolean);
  const spent = Math.round(picks.reduce((s, p) => s + p.price * 10, 0));
  const bank = BUDGET - spent;
  const posCount = (pos: Pos) => picks.filter((p) => p.pos === pos).length;
  const clubCount = (clubId: number) => picks.filter((p) => p.clubId === clubId).length;
  const complete = POS_ORDER.every((pos) => posCount(pos) === QUOTA[pos]);

  // Why a player can't be added (null = addable). Drives an explicit message
  // rather than a silently-greyed row — the founder hit the club cap blind.
  const blockReason = (p: ClientPoolPlayer): string | null => {
    if (posCount(p.pos) >= QUOTA[p.pos]) return `You've got all ${QUOTA[p.pos]} ${p.pos} — remove one first.`;
    if (clubCount(p.clubId) >= 3) return `Max 3 players from ${p.club} — you already have 3.`;
    if (spent + Math.round(p.price * 10) > BUDGET) return `Not enough budget — ${fmtM(bank)} left.`;
    return null;
  };
  const clubFull = (clubId: number) => clubCount(clubId) >= 3;

  const toggle = (p: ClientPoolPlayer) => {
    if (picked.includes(p.id)) { setPicked(picked.filter((x) => x !== p.id)); setNotice(null); return; }
    const reason = blockReason(p);
    if (reason) { setNotice(reason); return; }
    setNotice(null); setPicked([...picked, p.id]);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api("squad", { pickIds: picked });
      router.push("/fantasy");
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  return (
    <main style={page}>
      <Header right={<Chip gold>{fmtM(bank)} left</Chip>} />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>
        {editing ? "Rebuild your squad" : "Build your squad"}
      </h1>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
        {editing
          ? "Change as many players as you like — you can rebuild freely until the season starts. Once your first gameweek locks, you'll change your team with transfers instead."
          : "Fifteen players — two keepers, five defenders, five midfielders, three forwards. Max three from any club. Same £100.0m as everyone. This is your team all season: your knowledge round earns the transfers that improve it."}
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {POS_ORDER.map((pos) => (
          <button key={pos} onClick={() => setTab(pos)} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontWeight: 700, fontSize: 13,
            background: tab === pos ? GOLD : PANEL, color: tab === pos ? "#2A1F00" : INK,
            border: `1px solid ${tab === pos ? GOLD : LINE}`, cursor: "pointer",
          }}>
            {pos} {posCount(pos)}/{QUOTA[pos]}
          </button>
        ))}
      </div>

      {picks.length > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {picks.map((p) => (
              <button key={p.id} onClick={() => toggle(p)} style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 12, padding: "5px 9px", borderRadius: 8, cursor: "pointer",
                background: "transparent", color: INK, border: `1px solid ${LINE}`,
              }}>
                <Crest club={p.club} size={14} /> {p.name} · £{p.price.toFixed(1)} ✕
              </button>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {pool.filter((p) => p.pos === tab).slice(0, 60).map((p) => {
          const inSquad = picked.includes(p.id);
          const blocked = !inSquad && blockReason(p) !== null;
          const capped = !inSquad && clubFull(p.clubId);
          return (
            // Kept tappable even when blocked so the tap can EXPLAIN why (club cap etc.)
            <button key={p.id} onClick={() => toggle(p)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                background: inSquad ? "#233B2C" : PANEL, color: INK,
                border: `1px solid ${inSquad ? GOLD : LINE}`, opacity: blocked ? 0.5 : 1,
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600 }}>
                <Crest club={p.club} />
                <span>{p.name}<span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}> · {p.club}</span></span>
                {capped && <span style={{ fontSize: 10.5, color: "#C9884A", border: "1px solid #C9884A", borderRadius: 6, padding: "1px 5px" }}>3/3</span>}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: inSquad ? GOLD : INK }}>
                £{p.price.toFixed(1)}m
              </span>
            </button>
          );
        })}
      </div>

      {/* Sticky footer — Confirm is always reachable, no scroll to the bottom of a 60-row list. */}
      <div style={{
        position: "sticky", bottom: 0, marginTop: 4,
        background: `linear-gradient(to top, ${PITCH} 72%, transparent)`,
        paddingTop: 16, paddingBottom: 8,
      }}>
        {notice && <p style={{ color: "#C9884A", fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>{notice}</p>}
        {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 8px" }}>{err}</p>}
        <Btn gold disabled={!complete || busy} onClick={submit}>
          {complete ? (busy ? "Saving…" : editing ? "Save my squad" : "Confirm my squad") : `Pick ${15 - picks.length} more`}
        </Btn>
        <p style={{ fontSize: 11.5, color: MUTED, margin: "7px 0 0", lineHeight: 1.4, textAlign: "center" }}>
          We&apos;ll pick your starting XI, captain and bench order — change any of it next.
        </p>
      </div>
    </main>
  );
}
