"use client";
/** Transfers — sell one, sign one. Free while you hold credits; −4 pts after. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL,
  type ClientPoolPlayer, type FantasyState,
} from "@/components/fantasy/shared";

export default function TransfersPage() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [selling, setSelling] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api<FantasyState>("state").catch((e) => {
      if ((e as { status?: number }).status === 401) router.replace("/auth/sign-in?next=/fantasy");
      throw e;
    });
    if (!s.squad) { router.replace("/fantasy/build"); return; }
    setState(s);
  }, [router]);

  useEffect(() => {
    refresh();
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
  }, [refresh]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const squad = state?.squad;
  const out = selling !== null ? byId.get(selling) : null;

  const candidates = useMemo(() => {
    if (!squad || !out) return [];
    const owned = new Set(squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of squad.picks) if (p.id !== out.id)
      clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    const sellTenths = squad.picks.find((p) => p.id === out.id)?.buyTenths ?? 0;
    const maxTenths = squad.bankTenths + sellTenths;
    return pool.filter((p) =>
      p.pos === out.pos && !owned.has(p.id) &&
      Math.round(p.price * 10) <= maxTenths && (clubCount.get(p.clubId) ?? 0) < 3);
  }, [squad, out, pool]);

  const buy = async (inId: number) => {
    if (busy || selling === null) return;
    setBusy(true); setErr(null);
    try {
      await api("transfer", { out: selling, in: inId });
      setSelling(null);
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!state || !squad) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;
  const nextIsFree = squad.credits > 0;

  return (
    <main style={page}>
      <Header right={<>
        <Chip gold>{squad.credits} free</Chip>
        <Chip>{fmtM(squad.bankTenths)} bank</Chip>
      </>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Transfers</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        Your knowledge round earned {squad.credits} free move{squad.credits === 1 ? "" : "s"} this week.
        Anything beyond that costs 4 points — pay for it in knowledge, or pay for it in points.
      </p>

      {!state.openForEdits && <Card><span style={{ fontSize: 13.5, color: MUTED }}>Gameweek is locked.</span></Card>}

      {state.openForEdits && selling === null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {squad.picks.map((p) => {
            const pl = byId.get(p.id);
            return (
              <button key={p.id} onClick={() => setSelling(p.id)} style={{
                display: "flex", justifyContent: "space-between", padding: "11px 12px",
                borderRadius: 10, background: PANEL, color: INK, border: `1px solid ${LINE}`,
                cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>{pl && <Crest club={pl.club} />}<span>{pl?.name ?? p.id} <span style={{ color: MUTED, fontSize: 12, fontWeight: 400 }}>· {p.pos} · {pl?.club}</span></span></span>
                <span style={{ color: MUTED, fontSize: 13 }}>sells {fmtM(p.buyTenths)}</span>
              </button>
            );
          })}
        </div>
      )}

      {state.openForEdits && out && (
        <>
          <Card style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14 }}>Selling <b>{out.name}</b> ({out.pos})</span>
            <Btn small onClick={() => setSelling(null)}>Cancel</Btn>
          </Card>
          <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
            Sign one — this move is {nextIsFree
              ? <b style={{ color: GOLD }}>free (1 credit)</b>
              : <b style={{ color: "#E08A6B" }}>−4 points</b>}:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.slice(0, 40).map((p) => (
              <button key={p.id} disabled={busy} onClick={() => buy(p.id)} style={{
                display: "flex", justifyContent: "space-between", padding: "11px 12px",
                borderRadius: 10, background: PANEL, color: INK, border: `1px solid ${LINE}`,
                cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Crest club={p.club} /><span>{p.name} <span style={{ color: MUTED, fontSize: 12, fontWeight: 400 }}>· {p.club}</span></span></span>
                <span style={{ fontWeight: 700 }}>£{p.price.toFixed(1)}m</span>
              </button>
            ))}
            {!candidates.length && <p style={{ color: MUTED, fontSize: 13 }}>Nobody affordable in this position — sell someone pricier first.</p>}
          </div>
        </>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => router.push("/fantasy")}>Back to my squad</Btn>
      </div>
    </main>
  );
}
