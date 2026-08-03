"use client";
/**
 * Plan Ahead — the transfer planner, now framed as a monthly-competition cockpit
 * (founder, 2 Aug). You're playing to WIN THE MONTH, so the top of the page pulls
 * together the things that decide a month: the deadline, the moves and chips you
 * have to spend, and your squad's fixture run so you can see who to move. Below
 * that sits the planner itself.
 *
 * Rendered two ways: standalone at /fantasy/plan (its own chrome), and embedded as
 * the "Plan" subtab of the Squad tab (chrome stripped — the shell owns it). Same
 * house pattern as FantasyHub's `embedded`.
 *
 * TENTATIVE by design: a plan changes nothing, saves to this device only, and the
 * swap MATH is the real engine (applyTransfer/sellPrice/transferCost), so the
 * planned budget and cost match what the server will charge.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  applyTransfer, HIT_POINTS, RuleError,
  type PoolPlayer, type Squad,
} from "@/lib/fantasy/engine";
import {
  api, Btn, Card, Deadline, DoubtFlag, EMPTY_CONTEXT, ErrorState, FixtureRun, fmtM,
  GOLD, Header, INK, LIME, LINE, Loading, MUTED, page, PANEL, POS_COLOR, Skel, TEAL, tint,
  type ClientPoolPlayer, type FantasyContext, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { pitchName, type BoardPlayer } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { BottomNav } from "@/components/ui/BottomNav";

const PLAN_KEY = "ys-fantasy-plan";
const EMBEDDED_PAGE: CSSProperties = { padding: "4px 16px 8px", color: INK };
const CHIP_LABEL: Record<string, string> = { triple_captain: "Triple Captain", bench_boost: "Bench Boost", insight: "Insight" };

interface Move { out: number; in: number }

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
const ordinal = (n: number) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** The viewer's standing in the current month's global competition — the thing
 *  you're playing to win. Null until it loads; graceful pre-season (no scores). */
interface MonthStanding { label: string; rank: number | null; points: number; total: number; gap: number | null; }

export function PlanAhead({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [moves, setMoves] = useState<Move[]>([]);
  const [picking, setPicking] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [monthStanding, setMonthStanding] = useState<MonthStanding | null>(null);

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
    // The month competition standing — what winning August actually looks like.
    fetch("/api/fantasy/standings?scope=month")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { title?: string; you?: { rank: number; points: number; played: number; isMe: boolean } | null; rows?: { points: number }[]; totalPlayers?: number } | null) => {
        if (!d) return;
        const you = d.you ?? null;
        const leader = d.rows?.[0] ?? null;
        const ranked = !!you && you.played > 0;
        setMonthStanding({
          label: d.title ?? "This month",
          rank: ranked ? you!.rank : null,
          points: you?.points ?? 0,
          total: d.totalPlayers ?? 0,
          gap: ranked && leader && you!.rank !== 1 ? leader.points - you!.points : (ranked && you!.rank === 1 ? 0 : null),
        });
      }).catch(() => {});
    try {
      const saved = JSON.parse(localStorage.getItem(PLAN_KEY) ?? "[]") as Move[];
      if (Array.isArray(saved)) setMoves(saved.filter((m) => m && Number.isInteger(m.out) && Number.isInteger(m.in)));
    } catch { /* corrupt plan — start empty */ }
    setRestored(true);
  }, [load]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(moves)); } catch { /* private mode */ }
  }, [moves, restored]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const enginePool = useMemo<PoolPlayer[]>(
    () => pool.map((p) => ({ id: p.id, smId: null, name: p.name, club: p.club, clubId: p.clubId, pos: p.pos as PoolPlayer["pos"], priceTenths: Math.round(p.price * 10) })),
    [pool],
  );

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

  // Chrome wrapper — full page standalone, bare div when embedded in the Squad shell.
  const Chrome = ({ children }: { children: ReactNode }) => embedded
    ? <div style={EMBEDDED_PAGE}>{children}</div>
    : (
      <main data-fantasy style={page}>
        <Header exit={{ label: "Squad", onClick: () => router.push("/fantasy/squad") }} />
        {children}
        <BottomNav />
      </main>
    );

  if (needsAuth) return (
    <Chrome>
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Sign in to plan ahead</div>
        <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/plan")}>Sign in</Btn>
      </Card>
    </Chrome>
  );
  if (err) return (
    <Chrome><ErrorState message={err} onRetry={() => { setErr(null); load(); }} /></Chrome>
  );
  if (!state?.squad || !planned) return (
    <Chrome>
      <Loading label="Loading the planner">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={60} r={12} /><Skel h={200} r={14} /><Skel h={54} r={10} />
        </div>
      </Loading>
    </Chrome>
  );

  const credits = state.squad.credits;
  const squad = state.squad;
  const nameOf = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const paidMoves = Math.max(0, planned.applied.length - credits);
  const hitCost = paidMoves * HIT_POINTS;

  const outToIn = new Map(planned.applied.map((m) => [m.out, m.in]));
  const plannedId = (id: number): number => {
    let cur = id;
    const seen = new Set<number>();
    while (outToIn.has(cur) && !seen.has(cur)) { seen.add(cur); cur = outToIn.get(cur)!; }
    return cur;
  };
  const plannedXi = squad.xi.map(plannedId);
  const plannedBench = squad.bench.map(plannedId);
  const boardPlayers: BoardPlayer[] = planned.squad.picks.map((pk) => {
    const p = byId.get(pk.id);
    return {
      id: pk.id, name: p?.name ?? `#${pk.id}`, label: pitchName(p?.name ?? `#${pk.id}`),
      pos: p?.pos ?? pk.pos, club: p?.club, avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined, price: p?.price,
    };
  });

  // ── The month cockpit: what you've got to work with, and your squad's run ────
  const chipsHeld = (state.chips?.available ?? []).map((k) => CHIP_LABEL[k] ?? k);
  const cd = countdown(state.gw.deadline);
  // The current XI's fixture run, so a planner sees at a glance who has a kind or
  // brutal August. Resolved from the same context the swap list uses.
  const xiRun = squad.xi
    .map((id) => byId.get(id))
    .filter((p): p is ClientPoolPlayer => !!p)
    .map((p) => ({ p, cells: ctx.fixtures[p.clubId] }));

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
    <Chrome>
      <h1 style={{ fontSize: embedded ? 20 : 24, margin: "0 0 4px", fontWeight: 700 }}>Plan ahead</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        You&apos;re playing to win the month. Line up moves against the fixtures and see how your squad
        would look. Nothing here is committed — it&apos;s a note to yourself, saved on this device.
      </p>

      {state.gw.mode !== "replay" && <Deadline iso={state.gw.deadline} compact />}

      {/* AUGUST STANDING — the thing you're planning to win. Fills once scores land. */}
      <div style={{
        marginTop: 12, borderRadius: 14, padding: "13px 15px",
        background: `linear-gradient(150deg, ${tint(GOLD, "1c")}, ${PANEL} 72%)`, border: `1px solid ${tint(GOLD, "3a")}`,
      }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, letterSpacing: "0.12em", color: GOLD, marginBottom: 6 }}>
          {(monthStanding?.label ?? "This month").toUpperCase()} · YOUR RANK
        </div>
        {monthStanding?.rank != null ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="font-display" style={{ fontSize: 30, lineHeight: 1, color: INK }}>{ordinal(monthStanding.rank)}</span>
            {monthStanding.total > 0 && <span style={{ fontSize: 13, color: MUTED }}>of {monthStanding.total.toLocaleString()}</span>}
            <span style={{ fontSize: 13, color: MUTED }}>· <b style={{ color: INK, fontWeight: 700 }}>{monthStanding.points}</b> pts</span>
            {monthStanding.gap != null && (
              <span style={{ fontSize: 13, color: monthStanding.gap === 0 ? LIME : MUTED }}>
                · {monthStanding.gap === 0 ? "level with top" : `${monthStanding.gap} behind top`}
              </span>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            The {(monthStanding?.label ?? "monthly").replace(/\s+\d{4}$/, "")} table fills once Gameweek {state.gw.gw} is scored. Plan now, climb it from the first whistle.
          </p>
        )}
      </div>

      {/* MONTH COCKPIT — deadline, what you have to spend, chips in hand. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: "12px 0" }}>
        {([
          { label: "Deadline", value: cd ? `in ${cd}` : "closed", accent: TEAL },
          { label: "Free moves", value: String(credits), accent: LIME },
          { label: "Chips left", value: String(chipsHeld.length), accent: GOLD },
        ] as const).map((t) => (
          <div key={t.label} className="rounded-xl" style={{ background: `linear-gradient(150deg, ${tint(t.accent, "12")}, ${PANEL} 70%)`, border: `1px solid ${tint(t.accent, "33")}`, padding: "10px 10px" }}>
            <div className="font-display" style={{ fontSize: 18, lineHeight: 1, color: t.accent }}>{t.value}</div>
            <div className="font-body" style={{ fontSize: 10, color: MUTED, marginTop: 4, letterSpacing: "0.03em" }}>{t.label}</div>
          </div>
        ))}
      </div>
      {chipsHeld.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "-4px 0 12px" }}>
          {chipsHeld.map((c) => (
            <span key={c} style={{ fontSize: 11.5, fontWeight: 700, color: GOLD, padding: "4px 10px", borderRadius: 999, background: tint(GOLD, "14"), border: `1px solid ${tint(GOLD, "44")}` }}>{c}</span>
          ))}
        </div>
      )}

      {/* YOUR SQUAD'S RUN — the fixtures factor, per player, so you see who to move. */}
      {xiRun.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", color: TEAL }}>YOUR SQUAD&apos;S FIXTURES</span>
            <button onClick={() => router.push("/fantasy/news?tab=fixtures")} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              All fixtures →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {xiRun.map(({ p, cells }) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ color: POS_COLOR[p.pos as Pos] ?? MUTED, fontWeight: 700, width: 30, flexShrink: 0 }}>{p.pos}</span>
                <span style={{ color: INK, fontWeight: 600, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <FixtureRun cells={cells} max={4} />
              </div>
            ))}
          </div>
        </Card>
      )}

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

      {picking === null ? (
        <div id="plan-board" style={{ marginBottom: 12 }}>
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
        <div style={{ flex: 1 }}>
          <Btn gold onClick={() => document.getElementById("plan-board")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Plan a transfer</Btn>
        </div>
        {!embedded && <div style={{ flex: 1 }}><Btn onClick={() => router.push("/fantasy/squad")}>Back to my team</Btn></div>}
      </div>
    </Chrome>
  );
}
