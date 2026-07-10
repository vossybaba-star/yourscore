"use client";
/** Squad builder — pick your 15 once (2 GK / 5 DEF / 5 MID / 3 FWD, £100m, max 3/club). */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL,
  POS_ORDER, QUOTA, type ClientPoolPlayer, type Pos,
} from "@/components/fantasy/shared";

const BUDGET = 1000;

export default function BuildPage() {
  const router = useRouter();
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [tab, setTab] = useState<Pos>("GK");
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
  }, []);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const picks = picked.map((id) => byId.get(id)!).filter(Boolean);
  const spent = Math.round(picks.reduce((s, p) => s + p.price * 10, 0));
  const bank = BUDGET - spent;
  const posCount = (pos: Pos) => picks.filter((p) => p.pos === pos).length;
  const clubCount = (clubId: number) => picks.filter((p) => p.clubId === clubId).length;
  const complete = POS_ORDER.every((pos) => posCount(pos) === QUOTA[pos]);

  const canAdd = (p: ClientPoolPlayer) =>
    !picked.includes(p.id) && posCount(p.pos) < QUOTA[p.pos] &&
    clubCount(p.clubId) < 3 && spent + Math.round(p.price * 10) <= BUDGET;

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
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>Build your squad</h1>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
        Fifteen players — two keepers, five defenders, five midfielders, three forwards.
        Max three from any club. Same £100.0m as everyone. This is your team all season:
        from next week, your knowledge round earns the transfers that improve it.
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
              <button key={p.id} onClick={() => setPicked(picked.filter((x) => x !== p.id))} style={{
                fontSize: 12, padding: "5px 9px", borderRadius: 8, cursor: "pointer",
                background: "transparent", color: INK, border: `1px solid ${LINE}`,
              }}>
                {p.name} · {p.pos} · £{p.price.toFixed(1)} ✕
              </button>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {pool.filter((p) => p.pos === tab).slice(0, 60).map((p) => {
          const inSquad = picked.includes(p.id);
          const addable = canAdd(p);
          return (
            <button key={p.id} disabled={!inSquad && !addable}
              onClick={() => setPicked(inSquad ? picked.filter((x) => x !== p.id) : [...picked, p.id])}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                background: inSquad ? "#233B2C" : PANEL, color: INK,
                border: `1px solid ${inSquad ? GOLD : LINE}`, opacity: !inSquad && !addable ? 0.4 : 1,
              }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {p.name}
                <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}> · {p.club}</span>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: inSquad ? GOLD : INK }}>
                £{p.price.toFixed(1)}m
              </span>
            </button>
          );
        })}
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}
      <Btn gold disabled={!complete || busy} onClick={submit}>
        {complete ? (busy ? "Signing…" : "Confirm squad — auto-pick my XI") : `Pick ${15 - picks.length} more`}
      </Btn>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 8, lineHeight: 1.45 }}>
        We&apos;ll set a sensible starting XI, captain and bench order — change any of it whenever you like.
      </p>
    </main>
  );
}
