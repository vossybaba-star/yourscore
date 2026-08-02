"use client";
/**
 * /fantasy/plan — the transfer planner.
 *
 * The audit's gap: you could make this week's transfer, but you couldn't look
 * ahead — line up a run of moves against a fixture swing, see what your squad
 * and budget would look like after them, sleep on it, come back. This is that
 * scratchpad.
 *
 * TENTATIVE by design. A plan changes nothing: it never calls the transfer API,
 * and it saves to this device only (a plan is a note to yourself, not a
 * commitment, and a future gameweek isn't open to commit into yet anyway). When
 * a gameweek opens you go and make the moves for real on the transfer screen.
 *
 * The swap MATH is the real engine, not a lookalike. applyTransfer, sellPrice
 * and transferCost are pure, so importing them here means the planned budget and
 * the planned cost are computed exactly as the server will charge — a planner
 * that lied about the price would be worse than none.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyTransfer, HIT_POINTS, RuleError,
  type PoolPlayer, type Squad,
} from "@/lib/fantasy/engine";
import {
  api, Btn, Card, Deadline, DoubtFlag, EMPTY_CONTEXT, ErrorState, FixtureRun, fmtM,
  GOLD, Header, INK, LINE, Loading, MUTED, page, PANEL, Skel, TEAL,
  type ClientPoolPlayer, type FantasyContext, type FantasyState,
} from "@/components/fantasy/shared";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { pitchName, type BoardPlayer } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { BottomNav } from "@/components/ui/BottomNav";

const PLAN_KEY = "ys-fantasy-plan";

interface Move { out: number; in: number }

export default function PlanPage() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [moves, setMoves] = useState<Move[]>([]);
  const [picking, setPicking] = useState<number | null>(null); // the planned player being swapped out
  const [q, setQ] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<FantasyState>("state");
      if (!s.squad) { router.replace("/fantasy/build"); return; }
      setState(s);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, [router]);

  useEffect(() => {
    load();
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) => setPool(p.players.sort((a, b) => b.price - a.price)));
    fetch("/api/fantasy/context").then((r) => (r.ok ? r.json() : null)).then((c: FantasyContext | null) => { if (c) setCtx(c); }).catch(() => {});
    try {
      const saved = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "[]") as Move[];
      if (Array.isArray(saved)) setMoves(saved.filter((m) => m && Number.isInteger(m.out) && Number.isInteger(m.in)));
    } catch { /* corrupt plan — start empty */ }
    setRestored(true);
  }, [load]);

  // Persist the plan as it changes — this is the whole "save" mechanism.
  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(moves)); } catch { /* private mode */ }
  }, [moves, restored]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);

  /** The pool in engine shape, so applyTransfer can do the real money math. */
  const enginePool = useMemo<PoolPlayer[]>(
    () => pool.map((p) => ({ id: p.id, smId: null, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos as PoolPlayer["pos"], priceTenths: Math.round(p.price * 10) })),
    [pool],
  );

  /** Apply the staged moves to the real squad, in order, with the real engine.
   *  A move that no longer validates (player left the pool, club cap now breached
   *  by an earlier planned move) is dropped rather than exploding the whole plan —
   *  and reported, so it's never silent. */
  const planned = useMemo(() => {
    if (!state?.squad || !enginePool.length) return null;
    let squad: Squad = { picks: state.squad.picks, bankTenths: state.squad.bankTenths };
    const applied: Move[] = [];
    const dropped: Move[] = [];
    for (const m of moves) {
      try { squad = applyTransfer(squad, m.out, m.in, enginePool); applied.push(m); }
      catch (e) { if (e instanceof RuleError) dropped.push(m); else throw e; }
    }
    return { squad, applied, dropped };
  }, [state, enginePool, moves]);

  if (needsAuth) return (
    <main data-fantasy style={page}>
      <Header exit={{ label: "Squad", onClick: () => router.push("/fantasy/squad") }} />
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Sign in to plan ahead</div>
        <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/plan")}>Sign in</Btn>
      </Card>
      <BottomNav />
    </main>
  );
  if (err) return (
    <main data-fantasy style={page}><Header exit={{ label: "Squad", onClick: () => router.push("/fantasy/squad") }} />
      <ErrorState message={err} onRetry={() => { setErr(null); load(); }} /><BottomNav /></main>
  );
  if (!state?.squad || !planned) return (
    <main data-fantasy style={page}>
      <Header />
      <Loading label="Loading the planner">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={60} r={12} /><Skel h={200} r={14} /><Skel h={54} r={10} />
        </div>
      </Loading>
      <BottomNav />
    </main>
  );

  const credits = state.squad.credits;
  const squad = state.squad;
  const nameOf = (id: number) => byId.get(id)?.name ?? `#${id}`;

  // Cost of the plan: each move is free while credits last, then −4 each.
  const paidMoves = Math.max(0, planned.applied.length - credits);
  const hitCost = paidMoves * HIT_POINTS;

  // The planned XI still follows the original XI slots, swapping in the new ids.
  const outToIn = new Map(planned.applied.map((m) => [m.out, m.in]));
  const plannedId = (id: number): number => {
    let cur = id;
    // Follow a chain if a slot was swapped more than once.
    const seen = new Set<number>();
    while (outToIn.has(cur) && !seen.has(cur)) { seen.add(cur); cur = outToIn.get(cur)!; }
    return cur;
  };
  const plannedXi = squad.xi.map(plannedId);
  const plannedBench = squad.bench.map(plannedId);
  // The projected squad on the shared board — same pitch as everywhere else.
  const boardPlayers: BoardPlayer[] = planned.squad.picks.map((pk) => {
    const p = byId.get(pk.id);
    return {
      id: pk.id, name: p?.name ?? `#${pk.id}`, label: pitchName(p?.name ?? `#${pk.id}`),
      pos: p?.pos ?? pk.pos, club: p?.club, avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined, price: p?.price,
    };
  });

  // Candidates to swap in for the player being picked: same position, not already
  // in the planned squad, affordable against the planned bank + this player's value.
  const needle = q.trim().toLowerCase();
  const candidates = (() => {
    if (picking === null) return [];
    const outP = byId.get(picking);
    if (!outP) return [];
    const ownedNow = new Set(planned.squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of planned.squad.picks) if (p.id !== picking) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    const budget = planned.squad.bankTenths + Math.round(outP.price * 10);
    return pool
      .filter((p) => p.pos === outP.pos && !ownedNow.has(p.id) &&
        Math.round(p.price * 10) <= budget && (clubCount.get(p.clubId) ?? 0) < 3)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle))
      .sort((a, b) => b.price - a.price)
      .slice(0, 40);
  })();

  const addMove = (inId: number) => {
    if (picking === null) return;
    setMoves((m) => [...m, { out: picking, in: inId }]);
    setPicking(null); setQ("");
  };
  const undoLast = () => setMoves((m) => m.slice(0, -1));
  const clearPlan = () => setMoves([]);

  return (
    <main data-fantasy style={page}>
      <Header exit={{ label: "Squad", onClick: () => router.push("/fantasy/squad") }} />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>Plan ahead</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        Line up moves against the fixtures and see how your squad would look. Nothing here is
        committed — it&apos;s a note to yourself, saved on this device. Make the moves for real on the
        transfer screen when the gameweek opens.
      </p>

      {state.gw.mode !== "replay" && <Deadline iso={state.gw.deadline} compact />}

      {/* The running tally of the plan. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        {([
          { label: "Moves planned", value: String(planned.applied.length), accent: planned.applied.length > 0, bad: false },
          { label: "In the bank", value: fmtM(planned.squad.bankTenths), accent: false, bad: false },
          { label: "Points cost", value: hitCost ? `−${hitCost}` : "0", accent: false, bad: hitCost > 0 },
        ] as const).map((t) => (
          <div key={t.label} className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: "11px 10px" }}>
            <div className="font-display" style={{ fontSize: 22, lineHeight: 1, color: t.bad ? "#E08A6B" : t.accent ? GOLD : INK }}>{t.value}</div>
            <div className="font-body" style={{ fontSize: 10, color: MUTED, marginTop: 4, letterSpacing: "0.03em" }}>{t.label}</div>
          </div>
        ))}
      </div>
      {planned.applied.length > credits && (
        <p style={{ fontSize: 11.5, color: "#E08A6B", margin: "-4px 0 12px", lineHeight: 1.45 }}>
          {credits} free this gameweek, so {paidMoves} of these would cost 4 points each if you made
          them all in one week. Spread across gameweeks, more of them come free.
        </p>
      )}

      {/* The projected squad on the shared board. Tap a player to swap him in the
          plan; the replacement list opens below. */}
      {picking === null ? (
        <div style={{ marginBottom: 12 }}>
          <SquadBoard
            mode="plan"
            players={boardPlayers}
            xi={plannedXi}
            bench={plannedBench}
            captain={plannedId(squad.captain)}
            vice={plannedId(squad.vice)}
            doubts={ctx.doubts}
            selectedId={picking}
            onSlot={(id) => { setPicking(picking === id ? null : id); setQ(""); }}
          />
        </div>
      ) : (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
              <PlayerAvatar name={byId.get(picking)!.name} avatarUrl={byId.get(picking)!.avatarUrl ?? faceFor(byId.get(picking)!.name)} size={26} /> Swap out <b>{nameOf(picking)}</b>
            </span>
            <Btn small onClick={() => { setPicking(null); setQ(""); }}>Cancel</Btn>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or club" aria-label="Search replacements"
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none", marginBottom: 8 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.map((p) => (
              <button key={p.id} onClick={() => addMove(p.id)} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px",
                borderRadius: 10, background: PANEL, color: INK, border: `1px solid ${LINE}`, cursor: "pointer", textAlign: "left",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 14, fontWeight: 600 }}>
                      {p.name}<DoubtFlag reason={ctx.doubts[p.id]} />
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 11.5, color: MUTED }}>{p.club}</span>
                      <FixtureRun cells={ctx.fixtures[p.clubId]} />
                    </span>
                  </span>
                </span>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>£{p.price.toFixed(1)}m</span>
              </button>
            ))}
            {!candidates.length && <p style={{ color: MUTED, fontSize: 13 }}>Nobody affordable in this position for the plan.</p>}
          </div>
        </Card>
      )}

      {/* The plan itself — each staged move, in order, with fixture context. */}
      {planned.applied.length > 0 && picking === null && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", color: TEAL }}>YOUR PLAN</span>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn small onClick={undoLast}>Undo last</Btn>
              <Btn small onClick={clearPlan}>Clear</Btn>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {planned.applied.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ color: "#E08A6B", minWidth: 0, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(m.out)}</span>
                <span style={{ color: MUTED, flexShrink: 0 }}>→</span>
                <span style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: INK, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nameOf(m.in)}</span>
                  <FixtureRun cells={ctx.fixtures[byId.get(m.in)?.clubId ?? -1]} max={3} />
                </span>
              </div>
            ))}
          </div>
          {planned.dropped.length > 0 && (
            <p style={{ fontSize: 11.5, color: "#E08A6B", margin: "10px 0 0", lineHeight: 1.45 }}>
              {planned.dropped.length} earlier {planned.dropped.length === 1 ? "move no longer works" : "moves no longer work"} and {planned.dropped.length === 1 ? "was" : "were"} dropped — a price or club-limit change since you planned {planned.dropped.length === 1 ? "it" : "them"}.
            </p>
          )}
          <p style={{ fontSize: 11, color: MUTED, margin: "10px 0 0", lineHeight: 1.45 }}>
            First move free{credits > 1 ? `, ${credits} free this gameweek` : ""}. This is a plan — go to
            Transfers to make any of it real.
          </p>
        </Card>
      )}

      {planned.applied.length === 0 && picking === null && (
        <Card style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            Tap any player above to plan a swap. Line up as many as you like, check the fixtures behind
            each one, and it all saves here for when you&apos;re ready.
          </p>
        </Card>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1 }}><Btn gold onClick={() => router.push("/fantasy/transfers")}>Make a transfer</Btn></div>
        <div style={{ flex: 1 }}><Btn onClick={() => router.push("/fantasy/squad")}>Back to my team</Btn></div>
      </div>
      <BottomNav />
    </main>
  );
}
