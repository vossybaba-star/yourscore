"use client";
/** Transfers — your squad on a pitch (XI in formation + bench). Tap a player to
 *  replace him. Free while you hold credits; each move beyond costs −4 points,
 *  shown unmissably. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HIT_POINTS, sellPrice } from "@/lib/fantasy/engine";
import { PlayerProfile } from "@/components/fantasy/PlayerProfile";
import {
  api, Btn, Card, Chip, Crest, fmtM, GOLD, Header, INK, LINE, MUTED, PITCH, page, PANEL,
  type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";

const POS_ROWS: Pos[] = ["GK", "DEF", "MID", "FWD"];

interface Form { gws: number[]; points: Record<number, number[]> }

/** POST /api/fantasy/plan — the planner's answer for the players the manager
 *  marked. `perPlayer` carries a verdict on EACH marked player independently of
 *  whether the plan sold him, which is what lets the screen say "keep him" and
 *  "someone better exists but the money went further elsewhere" as two different
 *  sentences instead of one silence.
 *
 *  Every number here is PAST TENSE — what a player has already averaged. There
 *  is no forecast in this response and none may be added to it. */
interface PlanResponse {
  moves: { outId: number; inId: number; paid: "free" | "credit" | "hit"; gain: number; outAvg: number; inAvg: number }[];
  perPlayer: { outId: number; bestInId: number | null; gain: number; inPlan: boolean; outAvg: number; inAvg: number | null }[];
  ignored: number[];
  totalGain: number;
  /** The plan's one-off cost in points, paid ONCE (hits plus the cash value
   *  forgone on any credit spent). Stated as a one-time fact, never as a rate;
   *  zero on a wildcard or an all-free week, when the cost line is dropped. */
  oneOffCost: number;
  hitsTaken: number;
  hold: boolean;
  /** "no-history-yet" is the cold start (gameweeks 1-5, before anything has been
   *  scored). The screen must SAY so rather than render a confident-looking plan
   *  built on nothing. */
  basis: "season-to-date-average" | "no-history-yet";
  credits: number;
  wildcardActive: boolean;
  transfersBooked: number;
  availabilityLive: boolean;
}

/** GET /api/fantasy/wildcard-value — what a wildcard would buy TODAY.
 *  Deliberately a value, not a recommendation: chip timing is a forecast and
 *  none of it has been tested, so we price the chip and let the manager call it. */
interface WildcardValueResponse {
  gw: number;
  moves: { outId: number; inId: number; gain: number; outAvg: number; inAvg: number }[];
  totalGain: number;
  currentXiAvg: number;
  improvedXiAvg: number;
  previousGain: number | null;
  previousGw: number | null;
  held: number;
  expiresAtGw: number | null;
  gameweeksLeft: number | null;
  basis: "season-to-date-average" | "no-history-yet";
}

export default function TransfersPage() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [form, setForm] = useState<Form>({ gws: [], points: {} });
  const [selling, setSelling] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── the planner: the manager marks who they're CONSIDERING dropping ────────
  // That division of labour is deliberate. A season backtest measured the search
  // losing to a plain greedy in every configuration, and the part it loses on is
  // choosing WHO to drop — the part the manager already has an opinion about,
  // because they watched the game. What it keeps is the arithmetic: selling one
  // to fund another, every legal replacement rather than the ones you thought
  // of, and what each move actually costs.
  const [planMode, setPlanMode] = useState(false);
  const [marked, setMarked] = useState<number[]>([]);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  const [wc, setWc] = useState<WildcardValueResponse | null>(null);
  const [profileId, setProfileId] = useState<number | null>(null);

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
    api<Form>("form").then(setForm).catch(() => {});
    // A missing wildcard price is a missing card, never a broken screen.
    api<WildcardValueResponse>("wildcard-value").then(setWc).catch(() => {});
  }, [refresh]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const squad = state?.squad;
  const out = selling !== null ? byId.get(selling) : null;
  const hits = state?.entry?.hits ?? 0;
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

  const candidates = useMemo(() => {
    if (!squad || !out) return [];
    const owned = new Set(squad.picks.map((p) => p.id));
    const clubCount = new Map<number, number>();
    for (const p of squad.picks) if (p.id !== out.id) clubCount.set(p.clubId, (clubCount.get(p.clubId) ?? 0) + 1);
    const maxTenths = squad.bankTenths + sellValue(out.id);
    return pool
      .filter((p) => p.pos === out.pos && !owned.has(p.id) &&
        Math.round(p.price * 10) <= maxTenths && (clubCount.get(p.clubId) ?? 0) < 3)
      // Best form first — price-descending buried the in-form bargains.
      .sort((a, b) => (formTotal(b.id) - formTotal(a.id)) || (b.price - a.price));
  }, [squad, out, pool, formTotal, sellValue]);

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

  const buy = async (inId: number) => {
    if (busy || selling === null) return;
    setBusy(true); setErr(null);
    try { await api("transfer", { out: selling, in: inId }); setSelling(null); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const nameOf = useCallback((id: number) => byId.get(id)?.name ?? `#${id}`, [byId]);

  /** How a move was paid for, as a label. One definition so the planner can
   *  never describe the same three outcomes differently from the rest of the
   *  page. "free" means a wildcard week: the baseline move everyone gets is
   *  granted as a credit, so off a wildcard it is labelled "Uses a credit". */
  const costTag = useCallback((paid?: string) =>
    paid === "hit" ? { label: `−${HIT_POINTS} pts`, col: "#E08A6B" }
    : paid === "free" ? { label: "Wildcard", col: GOLD }
    : { label: "Uses a credit", col: MUTED },
  []);

  const toggleMark = useCallback((id: number) => {
    // Any change to the selection invalidates the plan on screen. Leaving a
    // stale plan up while the inputs move is how someone acts on an answer to a
    // question they are no longer asking.
    setPlan(null);
    setMarked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }, []);

  const runPlan = useCallback(async () => {
    if (!marked.length) return;
    setPlanning(true); setErr(null);
    try {
      setPlan(await api<PlanResponse>("plan", { considering: marked }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPlanning(false);
    }
  }, [marked]);

  const exitPlanMode = useCallback(() => {
    setPlanMode(false); setMarked([]); setPlan(null);
  }, []);

  if (!state || !squad) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;

  // A player's case takes the whole screen. Expanding it in place pushes the
  // squad down the page and leaves you scrolling back up to where you started —
  // on a phone that reads as losing your place, not as opening something.
  if (profileId !== null) {
    return (
      <main style={page}>
        <Header />
        <PlayerProfile
          playerId={profileId}
          onClose={() => setProfileId(null)}
          onConsider={(id) => {
            // Straight into the planner rather than making someone who has just
            // read bad news go and find the same player again.
            setProfileId(null);
            setPlanMode(true);
            setPlan(null);
            setMarked((cur) => (cur.includes(id) ? cur : [...cur, id]));
          }}
        />
      </main>
    );
  }

  const rowsByPos = (ids: number[]) =>
    POS_ROWS.map((pos) => ({ pos, ids: ids.filter((id) => byId.get(id)?.pos === pos) }));

  const Tile = ({ id }: { id: number }) => {
    const p = byId.get(id);
    const isMarked = marked.includes(id);
    const active = planMode ? isMarked : selling === id;
    // Wrapper is a plain div so the info affordance can be a real <button>
    // beside the tile rather than nested inside it, which is invalid markup and
    // breaks keyboard use.
    return (
      <div style={{ position: "relative", minWidth: 72 }}>
        <button onClick={() => (planMode ? toggleMark(id) : setSelling(active ? null : id))} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2, width: "100%",
          padding: "7px 8px", borderRadius: 10, cursor: "pointer",
          background: active ? "#233B2C" : PANEL, color: INK,
          border: `1px solid ${active ? GOLD : LINE}`,
        }}>
          {planMode && (
            <span aria-hidden style={{
              position: "absolute", top: 4, right: 5, fontSize: 11, fontWeight: 800,
              color: isMarked ? GOLD : LINE,
            }}>{isMarked ? "✓" : "○"}</span>
          )}
          {p && <Crest club={p.club} size={20} />}
          <span style={{ fontSize: 12, fontWeight: 600, textAlign: "center", lineHeight: 1.1 }}>{p?.name ?? id}</span>
          <span style={{ fontSize: 10.5, color: MUTED }}>£{p?.price.toFixed(1)}</span>
        </button>
        {/* The case for the player, on demand. Kept off the main tap so the list
            stays a list — the depth is there when you're deciding, not crowding
            you when you're scanning. */}
        {!planMode && (
          <button
            aria-label={`Why ${p?.name ?? "this player"}?`}
            onClick={(e) => { e.stopPropagation(); setProfileId(id); }}
            style={{
              position: "absolute", top: 3, left: 4, width: 17, height: 17, padding: 0,
              borderRadius: "50%", border: `1px solid ${LINE}`, background: "transparent",
              color: MUTED, fontSize: 10.5, lineHeight: "15px", cursor: "pointer",
            }}
          >i</button>
        )}
      </div>
    );
  };

  return (
    <main style={page}>
      <Header right={<>
        {wildcardActive
          ? <Chip gold>Wildcard active</Chip>
          : <Chip gold>{squad.credits} free</Chip>}
        <Chip>{fmtM(squad.bankTenths)} bank</Chip>
      </>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Transfers</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px", lineHeight: 1.5 }}>
        {wildcardActive
          ? <>Wildcard active. <b style={{ color: GOLD }}>transfers are free this week</b>, no limit and no points hit.</>
          : <>Tap a player to swap him. You earned <b style={{ color: GOLD }}>{squad.credits} free move{squad.credits === 1 ? "" : "s"}</b> this
            week. After that, every transfer costs <b style={{ color: "#E08A6B" }}>4 points</b>.</>}
      </p>

      {/* Running cost — unmissable */}
      {hits > 0 && (
        <div style={{ background: "#3A2320", border: "1px solid #B85C38", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#E08A6B" }}>
            This week so far: {hits} paid transfer{hits === 1 ? "" : "s"} · −{hits * 4} pts
          </span>
        </div>
      )}

      {/* ── What a wildcard would be worth TODAY ────────────────────────────
          Not "when should I play it" — that is a forecast and no chip-timing
          claim has been tested. This is arithmetic: a wildcard makes every
          transfer free, so its value is the moves you would make once cost
          stops being a reason not to. The manager watches the number across the
          weeks and calls it themselves. */}
      {selling === null && !planMode && wc && wc.held > 0 && wc.basis !== "no-history-yet" && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.13em", color: MUTED, marginBottom: 8 }}>
            YOUR WILDCARD
          </div>
          {wc.moves.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>
              Nothing worth doing with it this week — your squad is already about as good as the
              money allows.
            </p>
          ) : (
            <>
              {/* Two facts, not a promise. We are not forecasting points — we
                  are saying what one set of players has already averaged against
                  another. The manager does the subtraction and can disagree. */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
                    {wc.currentXiAvg.toFixed(0)}
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>your XI averages</div>
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: GOLD, fontVariantNumeric: "tabular-nums" }}>
                    {wc.improvedXiAvg.toFixed(0)}
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>
                    the best XI you could afford
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: MUTED, margin: "8px 0 0", lineHeight: 1.45 }}>
                {wc.moves.length} swap{wc.moves.length === 1 ? "" : "s"} would get you there. Those are
                points a week they have <b style={{ color: INK }}>already averaged</b> this season, not
                points we&apos;re promising.
              </p>
              {wc.previousGain !== null && (
                // The trend is the whole point — one figure means nothing, a
                // figure you watch climb is something you can act on.
                <p style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 0" }}>
                  The same gap last gameweek was {wc.previousGain.toFixed(0)}
                  {wc.totalGain > wc.previousGain ? " — it has widened."
                    : wc.totalGain < wc.previousGain ? " — it has narrowed." : "."}
                </p>
              )}
            </>
          )}
          {wc.gameweeksLeft !== null && (
            <p style={{ fontSize: 12, color: wc.gameweeksLeft <= 3 ? "#E08A6B" : MUTED, margin: "8px 0 0" }}>
              {wc.gameweeksLeft === 0
                ? "Expires at this deadline."
                : `${wc.gameweeksLeft} gameweek${wc.gameweeksLeft === 1 ? "" : "s"} left to use it.`}
            </p>
          )}
          <p style={{ fontSize: 11.5, color: MUTED, margin: "8px 0 0", lineHeight: 1.45 }}>
            We won&apos;t tell you when to play it — that&apos;s a guess and we don&apos;t make those.
          </p>
        </Card>
      )}

      {/* ── The planner ─────────────────────────────────────────────────────
          You name the players you're unsure about; the tool works out the best
          legal way to move them on, across all of them at once. */}
      {selling === null && !planMode && (
        <button onClick={() => { setPlanMode(true); setPlan(null); }} style={{
          width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 10, cursor: "pointer",
          background: PANEL, color: INK, border: `1px solid ${LINE}`, textAlign: "left",
        }}>
          <b style={{ fontSize: 13.5 }}>Thinking of dropping someone?</b>
          <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>
            Mark the players you&apos;re unsure about and we&apos;ll work out the best way to do it.
          </span>
        </button>
      )}

      {planMode && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.13em", color: GOLD }}>
              WHO ARE YOU THINKING OF DROPPING?
            </div>
            <button onClick={exitPlanMode} style={{
              background: "none", border: "none", color: MUTED, fontSize: 12, cursor: "pointer", padding: 0,
            }}>Cancel</button>
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 10px", lineHeight: 1.45 }}>
            Tap them below. Pick more than one and we&apos;ll check whether selling one pays for a better
            signing somewhere else.
          </p>

          {marked.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {marked.map((id) => <Chip key={id} gold>{nameOf(id)}</Chip>)}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Btn onClick={runPlan} disabled={marked.length === 0 || planning}>
              {planning ? "Working it out…" : `Plan ${marked.length || ""} ${marked.length === 1 ? "player" : "players"}`.trim()}
            </Btn>
            <span style={{ fontSize: 11.5, color: MUTED }}>
              {marked.length === 0 ? "None marked yet" : `${marked.length} marked`}
            </span>
          </div>

          {plan && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
              {/* The cold start. Before any gameweek has been scored there is no
                  form to judge anything on, so the honest answer is that we have
                  nothing — said plainly, at exactly the moment a confident wrong
                  answer would do the most damage. */}
              {plan.basis === "no-history-yet" ? (
                <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.45 }}>
                  Nobody has played a gameweek yet, so there&apos;s no form to judge this on. Come back once
                  the season is under way and we&apos;ll have something worth telling you.
                </p>
              ) : plan.hold ? (
                <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.45 }}>
                  {plan.perPlayer.every((v) => v.bestInId === null)
                    ? "Keep them. Nothing you could afford beats what you’ve already got."
                    : "Nothing here pays for itself this week — the upgrades available don’t cover what the moves cost."}
                </p>
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, marginBottom: 6 }}>
                    THE PLAN
                  </div>
                  {plan.moves.map((m, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                      padding: "7px 0", borderTop: i === 0 ? "none" : `1px solid ${LINE}` }}>
                      <b style={{ fontSize: 13, color: INK }}>{nameOf(m.outId)}</b>
                      <span style={{ color: MUTED, fontSize: 12 }}>→</span>
                      <b style={{ fontSize: 13, color: GOLD }}>{nameOf(m.inId)}</b>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: costTag(m.paid).col }}>
                        {costTag(m.paid).label}
                      </span>
                      {/* Both averages, not the difference. "+5.8" reads as a
                          promise; "0.0 → 5.8 a week" is what has happened. */}
                      <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                        {m.outAvg.toFixed(1)} → {m.inAvg.toFixed(1)} a week
                      </span>
                    </div>
                  ))}
                  {/* TWO facts, never blended. The weekly figure is the pure
                      season-average delta (matches the per-move lines above); the
                      one-off cost is stated once, as a known cost, not a rate.
                      Both past tense — nothing here is a forecast. */}
                  {(() => {
                    const weekly = plan.moves.reduce((s, m) => s + (m.inAvg - m.outAvg), 0);
                    return (
                      <div style={{ marginTop: 8, fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>
                        The players you&apos;d bring in have averaged{" "}
                        <b style={{ color: weekly >= 0 ? GOLD : "#E08A6B" }}>
                          {weekly >= 0 ? "+" : ""}{weekly.toFixed(1)} a week
                        </b>{" "}
                        more this season.
                        {plan.oneOffCost > 0 && (
                          <>
                            {" "}These moves cost{" "}
                            <b style={{ color: INK }}>
                              {plan.oneOffCost} point{plan.oneOffCost === 1 ? "" : "s"}
                            </b>, once.
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* A verdict on every player they marked, whether or not the plan
                  used him. "Nothing beats him" and "someone better exists, but
                  the money went further elsewhere" are different things to be
                  told, and a single list cannot say either. */}
              {plan.basis !== "no-history-yet" && plan.perPlayer.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: MUTED, marginBottom: 6 }}>
                    PLAYER BY PLAYER
                  </div>
                  {plan.perPlayer.map((v) => (
                    <div key={v.outId} style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap",
                      padding: "5px 0", fontSize: 12.5 }}>
                      <b style={{ color: INK }}>{nameOf(v.outId)}</b>
                      {v.bestInId === null ? (
                        <span style={{ color: MUTED }}>
                          keep him — he has averaged {v.outAvg.toFixed(1)} a week and nothing available
                          has done better
                        </span>
                      ) : v.inPlan ? (
                        <span style={{ color: GOLD }}>in the plan above</span>
                      ) : (
                        <span style={{ color: MUTED }}>
                          best available is {nameOf(v.bestInId)}, who has averaged{" "}
                          {v.inAvg !== null ? v.inAvg.toFixed(1) : "—"} a week against his{" "}
                          {v.outAvg.toFixed(1)} — but the money went further elsewhere
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* An unreadable availability feed and a clean bill of health must
                  never look the same. */}
              {!plan.availabilityLive && (
                <p style={{ fontSize: 11.5, color: "#E08A6B", margin: "10px 0 0", lineHeight: 1.4 }}>
                  We couldn&apos;t reach FPL&apos;s injury and availability information just now, so this
                  is based on scoring alone. Check the team news before you act on it.
                </p>
              )}
            </div>
          )}
        </Card>
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

          {/* Who should you even be looking at? Ranked on what they've actually
              scored in OUR scoring, and filtered to players you could really fit. */}
          {prospects.length > 0 && (
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
                      <Crest club={p.club} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: MUTED }}>
                          {p.pos} · {p.club} · £{p.price.toFixed(1)}m
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
        </>
      )}

      {out && (
        <>
          <Card style={{ marginBottom: 10 }}>
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
                <Crest club={out.club} /> Selling <b>{out.name}</b> ({out.pos})
              </span>
              <Btn small onClick={() => setSelling(null)}>Cancel</Btn>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {candidates.slice(0, 40).map((p) => {
              const better = hasForm && formTotal(p.id) > formTotal(out!.id);
              return (
                <button key={p.id} disabled={busy} onClick={() => buy(p.id)} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px",
                  borderRadius: 10, background: PANEL, color: INK,
                  border: `1px solid ${better ? "#3C5C46" : LINE}`,
                  cursor: "pointer", fontSize: 14, fontWeight: 600, textAlign: "left",
                }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                    <Crest club={p.club} />
                    <span style={{ minWidth: 0 }}>
                      <span>{p.name}</span>
                      <span style={{ display: "block", color: MUTED, fontSize: 11.5, fontWeight: 400 }}>{p.club}</span>
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
                    <FormLine id={p.id} />
                    <span style={{ fontWeight: 700, minWidth: 52, textAlign: "right" }}>£{p.price.toFixed(1)}m</span>
                  </span>
                </button>
              );
            })}
            {!candidates.length && <p style={{ color: MUTED, fontSize: 13 }}>Nobody affordable in this position. Sell someone pricier first.</p>}
          </div>
        </>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, marginTop: 10 }}>{err}</p>}
      <div style={{ marginTop: 14 }}>
        <Btn onClick={() => router.push("/fantasy")}>Done, back to my team</Btn>
      </div>
    </main>
  );
}
