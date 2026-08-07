"use client";
/** Transfers — your squad on a pitch (XI in formation + bench). Tap a player to
 *  replace him. Free while you hold credits; each move beyond costs −4 points,
 *  shown unmissably. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sellPrice } from "@/lib/fantasy/engine";
import {
  api, Btn, Card, Chip, Deadline, DoubtFlag, EMPTY_CONTEXT, FixtureRun, fmtM, GOLD, Header,
  INK, LINE, Loading, MUTED, page, PANEL, PlayerDetailSheet, PosTag, Skel,
  type ClientPoolPlayer, type FantasyContext, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { pitchName, DEPARTED_NAME, DEPARTED_PITCH, type BoardPlayer } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

const POS_ROWS: Pos[] = ["GK", "DEF", "MID", "FWD"];

interface Form { gws: number[]; points: Record<number, number[]> }

export default function TransfersPage() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [form, setForm] = useState<Form>({ gws: [], points: {} });
  const [selling, setSelling] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [detailFor, setDetailFor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await api<FantasyState>("state").catch((e) => {
      if ((e as { status?: number }).status === 401) router.replace("/auth/sign-in?next=/fantasy");
      throw e;
    });
    if (!s.squad) { router.replace("/fantasy/build"); return; }
    // A closed gameweek used to bounce you silently back to the hub, so there was
    // no way to see what you'd done, what it cost, or who you sold — exactly the
    // things you want on Saturday afternoon. It renders read-only instead.
    setState(s);
  }, [router]);

  useEffect(() => {
    refresh();
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
    api<Form>("form").then(setForm).catch(() => {});
    // Fixtures + doubts, the two things a transfer decision needs and never had.
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (c) setCtx(c); })
      .catch(() => {});
  }, [refresh]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const squad = state?.squad;
  // The squad mapped onto the shared SquadBoard — the same pitch the hub and
  // builder draw. Tapping a shirt selects the player to sell (ringed).
  const boardPlayers: BoardPlayer[] = useMemo(() => (squad?.picks ?? []).map((pk) => {
    const p = byId.get(pk.id);
    return {
      id: pk.id, name: p?.name ?? DEPARTED_NAME, label: p ? pitchName(p.name) : DEPARTED_PITCH,
      pos: p?.pos ?? pk.pos, club: p?.club, avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined, price: p?.price,
    };
  }), [squad, byId]);
  // A departed player (left his club, so dropped from the refreshed pool) is
  // still in your squad and must stay sellable. When the pool no longer has him,
  // synthesize a stand-in from the stored pick — it keeps his position and what
  // you paid — so the sell panel and the replacement list still work. sellValue()
  // already falls back to buyTenths when the live price is gone.
  const out: ClientPoolPlayer | null = useMemo(() => {
    if (selling === null) return null;
    const inPool = byId.get(selling);
    if (inPool) return inPool;
    const pk = squad?.picks.find((x) => x.id === selling);
    return pk ? { id: pk.id, name: DEPARTED_NAME, club: "", clubId: pk.clubId, pos: pk.pos, price: pk.buyTenths / 10 } : null;
  }, [selling, byId, squad]);
  const hits = state?.entry?.hits ?? 0;
  const made = state?.entry?.transfers ?? 0;
  /** Past the deadline: everything reads, nothing writes. */
  const closed = !!state && !state.openForEdits;
  /** Wildcard week: every move is free, no limit, no points hit. */
  const wildcardActive = state?.chips?.playedThisGw === "wildcard";
  const nextIsFree = wildcardActive || (squad?.credits ?? 0) > 0;

  // Recent YourScore points — the evidence a transfer decision should rest on.
  const formOf = useCallback((id: number): number[] => form.points[id] ?? [], [form]);
  const formTotal = useCallback((id: number) => formOf(id).reduce((a, b) => a + b, 0), [formOf]);
  const hasForm = form.gws.length > 0;

  /** What a player in your squad actually fetches: FPL's rule, against this
   *  gameweek's price. Quoting `buyTenths` instead — what you paid — is wrong in
   *  both directions now that prices move: it hides half of a rise, and worse, it
   *  OVERSTATES a fallen player, so we'd offer a signing the server then refuses. */
  const sellValue = useCallback((id: number): number => {
    const paid = squad?.picks.find((p) => p.id === id)?.buyTenths ?? 0;
    const now = byId.get(id)?.price;
    return now === undefined ? paid : sellPrice(paid, Math.round(now * 10));
  }, [squad, byId]);

  /** Everyone you could legally sign for this player. Search matches name or
   *  club: the list is ordered by form, and before a gameweek has scored there IS
   *  no form, so it falls back to price-descending — which without a search box
   *  meant the only players you could reach were the most expensive ones you
   *  could afford. */
  const needle = q.trim().toLowerCase();
  const candidates = useMemo(() => {
    if (!squad || !out) return [];
    const owned = new Set(squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of squad.picks) if (p.id !== out.id) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    const maxTenths = squad.bankTenths + sellValue(out.id);
    return pool
      .filter((p) => p.pos === out.pos && !owned.has(p.id) &&
        Math.round(p.price * 10) <= maxTenths && (clubCount.get(p.clubId) ?? 0) < 3)
      .filter((p) => !needle ||
        p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle))
      // Best form first — price-descending buried the in-form bargains.
      .sort((a, b) => (formTotal(b.id) - formTotal(a.id)) || (b.price - a.price));
  }, [squad, out, pool, formTotal, sellValue, needle]);

  /** Prospective buys: in-form players you don't own and could actually fit —
   *  the "who should I even be looking at?" step that came before picking a
   *  player to sell. Affordable = your bank plus selling your cheapest player in
   *  that position, which is the realistic worst case for funding the move. */
  const prospects = useMemo(() => {
    if (!squad || !hasForm) return [];
    const owned = new Set(squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of squad.picks) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    // Most you could spend on a given position without breaking the squad shape.
    const headroom = new Map<Pos, number>();
    for (const pos of POS_ROWS) {
      const mine = squad.picks.filter((p) => p.pos === pos);
      if (!mine.length) continue;
      // Worst case is the LEAST your cheapest sale would raise, at sale value —
      // not at what you paid for him.
      const cheapest = Math.min(...mine.map((p) => sellValue(p.id)));
      headroom.set(pos, squad.bankTenths + cheapest);
    }
    return pool
      .filter((p) => !owned.has(p.id) &&
        formTotal(p.id) > 0 &&
        Math.round(p.price * 10) <= (headroom.get(p.pos) ?? 0) &&
        (clubCount.get(p.clubId) ?? 0) < 3)
      .sort((a, b) => (formTotal(b.id) - formTotal(a.id)) || (a.price - b.price))
      .slice(0, 6);
  }, [squad, pool, hasForm, formTotal, sellValue]);

  /** "6 · 2 · 8" — the form guide, oldest gameweek first. */
  const FormLine = ({ id }: { id: number }) => {
    const f = formOf(id);
    if (!f.length) return null;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {f.map((pts, i) => (
          <span key={i} style={{
            minWidth: 20, textAlign: "center", padding: "1px 4px", borderRadius: 4,
            fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            background: pts >= 8 ? GOLD : pts >= 4 ? "#2E4A38" : PANEL,
            color: pts >= 8 ? "#2A1F00" : pts >= 4 ? INK : MUTED,
            border: `1px solid ${pts >= 8 ? GOLD : LINE}`,
          }}>{pts}</span>
        ))}
      </span>
    );
  };

  /** Pick (or clear) the player being sold. Clears the search with it — a needle
   *  left over from the last swap would silently filter the new candidate list. */
  const choose = (id: number | null) => { setSelling(id); setQ(""); };

  const buy = async (inId: number) => {
    if (busy || selling === null) return;
    setBusy(true); setErr(null);
    try { await api("transfer", { out: selling, in: inId }); choose(null); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (!state || !squad) return (
    <main data-fantasy style={page}>
      <Header />
      <Loading label="Loading transfers">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={200} r={14} />
          <Skel w="40%" h={11} />
          <Skel h={54} r={10} /><Skel h={54} r={10} /><Skel h={54} r={10} />
        </div>
      </Loading>
    </main>
  );

  return (
    <main data-fantasy style={page}>
      <Header right={<>
        {wildcardActive
          ? <Chip gold>Wildcard active</Chip>
          : <Chip gold>{squad.credits} free</Chip>}
        <Chip>{fmtM(squad.bankTenths)} bank</Chip>
      </>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>
        {closed ? `Gameweek ${state.gw.gw} transfers` : "Transfers"}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px", lineHeight: 1.5 }}>
        {closed
          ? <>This gameweek is closed, so nothing here can change. It&apos;s the record of what you did:{" "}
            <b style={{ color: INK }}>{made} transfer{made === 1 ? "" : "s"}</b>
            {hits > 0
              ? <>, <b style={{ color: "#E08A6B" }}>{hits} paid</b> for −{hits * 4} points.</>
              : made > 0 ? ", all free." : "."}</>
          : wildcardActive
            ? <>Wildcard active. <b style={{ color: GOLD }}>Every transfer is free this week</b>, no limit and no points hit. Rebuild as much as you like.</>
            : <>Tap a player to swap him. You earned <b style={{ color: GOLD }}>{squad.credits} free move{squad.credits === 1 ? "" : "s"}</b> this
              week. After that, every transfer costs <b style={{ color: "#E08A6B" }}>4 points</b>.</>}
      </p>

      {state.gw.mode !== "replay" && <Deadline iso={state.gw.deadline} compact />}

      {closed && (
        <div style={{
          background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10,
          padding: "10px 12px", marginBottom: 12,
        }}>
          <span style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
            Your next free move lands when this gameweek finishes. Play the round to earn more.
          </span>
        </div>
      )}

      {/* Running cost — unmissable */}
      {hits > 0 && (
        <div style={{ background: "#3A2320", border: "1px solid #B85C38", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#E08A6B" }}>
            This week so far: {hits} paid transfer{hits === 1 ? "" : "s"} · −{hits * 4} pts
          </span>
        </div>
      )}

      {/* THE BOARD, always in view. Tap a shirt to sell that player (ringed) —
          the IN candidates then appear below: OUT on the pitch, IN in the list. */}
      <div style={{ marginBottom: 12 }}>
        <SquadBoard
          mode="transfer"
          players={boardPlayers}
          xi={squad.xi}
          bench={squad.bench}
          captain={squad.captain}
          vice={squad.vice}
          doubts={ctx.doubts}
          selectedId={selling}
          onSlot={closed ? undefined : (id) => choose(selling === id ? null : id)}
        />
      </div>

      {/* Who should you even be looking at? Ranked on what they've actually
          scored in OUR scoring, filtered to players you could fit. Only while
          nothing is selected and the gameweek is open. */}
      {selling === null && !closed && prospects.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 2 }}>
                WORTH A LOOK
              </div>
              <p style={{ fontSize: 12, color: MUTED, margin: "0 0 8px", lineHeight: 1.45 }}>
                In form, not in your squad, and affordable. Tap the player you&apos;d drop above to make the swap.
              </p>
              {/* The four numbers on each row were unlabelled, so "26 9 46 81"
                  read as four gameweeks when the last one is the total. */}
              <div style={{
                display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 11px 5px",
                fontSize: 10, letterSpacing: "0.08em", color: MUTED,
              }}>
                <span style={{ display: "flex", gap: 8 }}>
                  {form.gws.map((g) => (
                    <span key={g} style={{ width: 22, textAlign: "center" }}>GW{g}</span>
                  ))}
                </span>
                <span style={{ width: 26, textAlign: "right", color: GOLD }}>TOTAL</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {prospects.map((p) => (
                  <div key={p.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "9px 11px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`,
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={34} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                          <DoubtFlag reason={ctx.doubts[p.id]} />
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 11, color: MUTED }}>
                            <PosTag pos={p.pos} /> · {p.club} · £{p.price.toFixed(1)}m
                          </span>
                          <FixtureRun cells={ctx.fixtures[p.clubId]} max={2} />
                        </span>
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <FormLine id={p.id} />
                      <b style={{ fontSize: 13, color: GOLD, fontVariantNumeric: "tabular-nums" }}>
                        {formTotal(p.id)}
                      </b>
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10.5, color: MUTED, margin: "7px 0 0", lineHeight: 1.4 }}>
                Numbers are YourScore points from the last {form.gws.length === 1 ? "gameweek" : `${form.gws.length} gameweeks`}, not FPL&apos;s.
              </p>
            </div>
      )}

      {out && (
        <>
          <Card style={{ marginBottom: 10 }}>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <PlayerAvatar name={out.name} avatarUrl={out.avatarUrl ?? faceFor(out.name)} size={26} /> Selling <b>{out.name}</b> ({out.pos})
                <DoubtFlag reason={ctx.doubts[out.id]} />
                <FixtureRun cells={ctx.fixtures[out.clubId]} />
                <button onClick={() => setDetailFor(out.id)} aria-label={`${out.name} details`}
                  style={{ background: "none", border: "none", color: MUTED, fontSize: 14, cursor: "pointer", padding: "0 2px" }}>ⓘ</button>
              </span>
              <Btn small onClick={() => choose(null)}>Cancel</Btn>
            </span>
            {/* What he actually raises, and why it isn't his price — a rise is only
                half yours, so the number has to be shown or the budget looks wrong. */}
            {(() => {
              const paid = squad.picks.find((p) => p.id === out.id)?.buyTenths ?? 0;
              const gets = sellValue(out.id);
              const nowT = Math.round(out.price * 10);
              return (
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
                  Raises <b style={{ color: INK }}>{fmtM(gets)}</b> ·{" "}
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtM(squad.bankTenths)} bank → <b style={{ color: GOLD }}>{fmtM(squad.bankTenths + gets)}</b> to spend
                  </span>
                  {nowT > paid && (
                    <div style={{ marginTop: 2 }}>
                      He&apos;s risen to £{out.price.toFixed(1)}m since you paid {fmtM(paid)}, so you keep half the rise.
                    </div>
                  )}
                  {nowT < paid && (
                    <div style={{ marginTop: 2 }}>
                      He&apos;s dropped to £{out.price.toFixed(1)}m since you paid {fmtM(paid)}.
                    </div>
                  )}
                </div>
              );
            })()}
          </Card>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>
            Sign a replacement. This move is {wildcardActive
              ? <b style={{ color: GOLD }}>free (wildcard active)</b>
              : nextIsFree
                ? <b style={{ color: GOLD }}>free (uses 1 credit)</b>
                : <b style={{ color: "#E08A6B" }}>−4 points</b>}:
          </div>
          {hasForm && (
            <p style={{ fontSize: 11.5, color: MUTED, margin: "0 0 8px", lineHeight: 1.45 }}>
              Best form first. Numbers are YourScore points from the last{" "}
              {form.gws.length === 1 ? "gameweek" : `${form.gws.length} gameweeks`}
              {out && <>. {out.name} has scored <b style={{ color: INK }}>{formTotal(out.id)}</b></>}.
            </p>
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or club"
            aria-label="Search replacements"
            style={{
              width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
              fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`,
              outline: "none", marginBottom: 8,
            }}
          />
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>
            {candidates.length} you can afford{needle ? ` matching "${q.trim()}"` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.map((p) => {
              const better = hasForm && formTotal(p.id) > formTotal(out!.id);
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "stretch", gap: 0, borderRadius: 10,
                  background: PANEL, border: `1px solid ${better ? "#3C5C46" : LINE}`, overflow: "hidden",
                }}>
                  <button disabled={busy} onClick={() => buy(p.id)} style={{
                    flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "11px 12px", background: "transparent", color: INK, border: "none",
                    cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
                  }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={34} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span>{p.name}</span>
                          <DoubtFlag reason={ctx.doubts[p.id]} />
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <span style={{ color: MUTED, fontSize: 11.5, fontWeight: 400 }}>{p.club}</span>
                          <FixtureRun cells={ctx.fixtures[p.clubId]} />
                        </span>
                      </span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                      <FormLine id={p.id} />
                      <span style={{ fontWeight: 700, minWidth: 52, textAlign: "right" }}>£{p.price.toFixed(1)}m</span>
                    </span>
                  </button>
                  {/* Details, separate from the buy tap so a look never signs
                      anyone by accident. */}
                  <button onClick={() => setDetailFor(p.id)} aria-label={`${p.name} details`} style={{
                    flexShrink: 0, width: 40, background: "transparent", border: "none",
                    borderLeft: `1px solid ${LINE}`, color: MUTED, fontSize: 15, cursor: "pointer",
                  }}>ⓘ</button>
                </div>
              );
            })}
            {!candidates.length && (
              <p style={{ color: MUTED, fontSize: 13 }}>
                {needle
                  ? `Nobody matching "${q.trim()}" that you can afford in this position.`
                  : "Nobody affordable in this position. Sell someone pricier first."}
              </p>
            )}
          </div>
        </>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => router.push("/fantasy/squad")}>
          {closed ? "Back to my team" : "Done, back to my team"}
        </Btn>
      </div>

      {/* The player card — opened from the ⓘ on a candidate, or by tapping the
          player you're selling. Everything a pick turns on, without leaving the
          transfer you're in the middle of. */}
      {(() => {
        if (detailFor === null) return null;
        const p = byId.get(detailFor);
        if (!p) return null;
        const owned = squad.picks.some((x) => x.id === p.id);
        const canBuy = !owned && !closed && candidates.some((c) => c.id === p.id);
        return (
          <PlayerDetailSheet
            player={p}
            fixtures={ctx.fixtures[p.clubId]}
            doubt={ctx.doubts[p.id]}
            form={formOf(p.id)}
            formGws={form.gws}
            ownership={owned ? "owned" : canBuy ? "affordable" : "too-expensive"}
            action={canBuy ? { label: "Sign him", onClick: () => { const id = p.id; setDetailFor(null); buy(id); } } : undefined}
            onClose={() => setDetailFor(null)}
          />
        );
      })()}
    </main>
  );
}
