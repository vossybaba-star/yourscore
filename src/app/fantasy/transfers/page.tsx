"use client";
/** Transfers — your squad on a pitch (XI in formation + bench). Tap a player to
 *  replace him. Free while you hold credits; each move beyond costs −4 points,
 *  shown unmissably. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, fmtM, GOLD, Header, INK, LINE, MUTED, PITCH, page, PANEL,
  type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";

const POS_ROWS: Pos[] = ["GK", "DEF", "MID", "FWD"];

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
    if (!s.openForEdits) { router.replace("/fantasy"); return; }
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
  const hits = state?.entry?.hits ?? 0;
  const nextIsFree = (squad?.credits ?? 0) > 0;

  const candidates = useMemo(() => {
    if (!squad || !out) return [];
    const owned = new Set(squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of squad.picks) if (p.id !== out.id) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    const sellTenths = squad.picks.find((p) => p.id === out.id)?.buyTenths ?? 0;
    const maxTenths = squad.bankTenths + sellTenths;
    return pool.filter((p) => p.pos === out.pos && !owned.has(p.id) &&
      Math.round(p.price * 10) <= maxTenths && (clubCount.get(p.clubId) ?? 0) < 3);
  }, [squad, out, pool]);

  const buy = async (inId: number) => {
    if (busy || selling === null) return;
    setBusy(true); setErr(null);
    try { await api("transfer", { out: selling, in: inId }); setSelling(null); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!state || !squad) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;

  const rowsByPos = (ids: number[]) =>
    POS_ROWS.map((pos) => ({ pos, ids: ids.filter((id) => byId.get(id)?.pos === pos) }));

  const Tile = ({ id }: { id: number }) => {
    const p = byId.get(id);
    const active = selling === id;
    return (
      <button onClick={() => setSelling(active ? null : id)} style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 72,
        padding: "7px 8px", borderRadius: 10, cursor: "pointer",
        background: active ? "#233B2C" : PANEL, color: INK,
        border: `1px solid ${active ? GOLD : LINE}`,
      }}>
        {p && <Crest club={p.club} size={20} />}
        <span style={{ fontSize: 12, fontWeight: 600, textAlign: "center", lineHeight: 1.1 }}>{p?.name ?? id}</span>
        <span style={{ fontSize: 10.5, color: MUTED }}>£{p?.price.toFixed(1)}</span>
      </button>
    );
  };

  return (
    <main style={page}>
      <Header right={<>
        <Chip gold>{squad.credits} free</Chip>
        <Chip>{fmtM(squad.bankTenths)} bank</Chip>
      </>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Transfers</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px", lineHeight: 1.5 }}>
        Tap a player to swap him. You earned <b style={{ color: GOLD }}>{squad.credits} free move{squad.credits === 1 ? "" : "s"}</b> this
        week — after that, every transfer costs <b style={{ color: "#E08A6B" }}>4 points</b>.
      </p>

      {/* Running cost — unmissable */}
      {hits > 0 && (
        <div style={{ background: "#3A2320", border: "1px solid #B85C38", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#E08A6B" }}>
            This week so far: {hits} paid transfer{hits === 1 ? "" : "s"} · −{hits * 4} pts
          </span>
        </div>
      )}

      {selling === null && (
        <>
          {/* the pitch */}
          <div style={{ background: PITCH, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12, marginBottom: 12,
            display: "flex", flexDirection: "column", gap: 12 }}>
            {rowsByPos(squad.xi).map((row) => (
              <div key={row.pos} style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                {row.ids.map((id) => <Tile key={id} id={id} />)}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 4 }}>BENCH</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {squad.bench.map((id) => <Tile key={id} id={id} />)}
          </div>
        </>
      )}

      {out && (
        <>
          <Card style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
              <Crest club={out.club} /> Selling <b>{out.name}</b> ({out.pos})
            </span>
            <Btn small onClick={() => setSelling(null)}>Cancel</Btn>
          </Card>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            Sign a replacement — this move is {nextIsFree
              ? <b style={{ color: GOLD }}>free (uses 1 credit)</b>
              : <b style={{ color: "#E08A6B" }}>−4 points</b>}:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.slice(0, 40).map((p) => (
              <button key={p.id} disabled={busy} onClick={() => buy(p.id)} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px",
                borderRadius: 10, background: PANEL, color: INK, border: `1px solid ${LINE}`,
                cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Crest club={p.club} /><span>{p.name} <span style={{ color: MUTED, fontSize: 12, fontWeight: 400 }}>· {p.club}</span></span>
                </span>
                <span style={{ fontWeight: 700 }}>£{p.price.toFixed(1)}m</span>
              </button>
            ))}
            {!candidates.length && <p style={{ color: MUTED, fontSize: 13 }}>Nobody affordable in this position — sell someone pricier first.</p>}
          </div>
        </>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => router.push("/fantasy")}>Done — back to my team</Btn>
      </div>
    </main>
  );
}
