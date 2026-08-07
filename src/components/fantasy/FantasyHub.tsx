"use client";
/** Squad home — XI + bench, captain/vice, credits, lock, result.
 *
 * Fantasy is a SECTION of the Premier League tab, not a destination of its own
 * (nav canon: "everything under it IS the PL — Fantasy is a PL squad").
 * `embedded` is the house pattern from LeaguesPanel/FriendsPanel: it strips the
 * page chrome the tab shell already provides. The /fantasy route still exists
 * because share links, result emails and the deadline push all point at it, and
 * it renders the same component with the nav attached so a deep link is never a
 * dead end. */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, CORAL, Deadline, EMPTY_CONTEXT, ErrorState, fmtM, GOLD, INK,
  LIME, LINE, Loading, MUTED, page, PANEL, PANEL_2, POS_COLOR, Sheet, Skel, TEAL, tint,
  type ChipName, type ClientPoolPlayer, type FantasyContext, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { MovesBank } from "@/components/fantasy/MovesBank";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { GameweekBreakdown } from "@/components/fantasy/GameweekBreakdown";
import { FinalStory } from "@/components/fantasy/FinalStory";
import CaptainAssistCard from "@/components/fantasy/CaptainAssistCard";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { pitchName, DEPARTED_NAME, DEPARTED_PITCH, type BoardPlayer, type LiveDatum } from "@/lib/fantasy/board";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { BUDGET_TENTHS, CREDIT_CAP, HALF_SEASON_GW, MAX_PER_CLUB, SQUAD_SIZE } from "@/lib/fantasy/engine";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";

type Result = NonNullable<NonNullable<FantasyState["entry"]>["result"]>;

/** Inside the Premier League tab the shell already owns the background, the
 *  max-width and the bottom padding for the nav — only the horizontal gutter is
 *  ours, and it must match the sibling sections. */
const EMBEDDED_PAGE: CSSProperties = { padding: "4px 16px 8px", color: INK };

// The three chips (triple_captain, bench_boost, insight) all spend from the same
// held count. Insight fires inside the round (a 50/50); the others act at scoring.
/** `earn` is the half the card was missing. A manager who has never held a chip
 *  saw three names, three effects and three "None held" labels, with no way to
 *  learn how any of them arrives — so the whole mechanic read as something the
 *  game might give you one day for reasons of its own. */
const CHIP_META: { key: ChipName; label: string; blurb: string; earn: string; accent: string; comingSoon?: boolean }[] = [
  { key: "triple_captain", label: "Triple Captain", blurb: "Your captain scores ×3", accent: GOLD,
    earn: "One a month — use the other two before it comes back" },
  { key: "bench_boost", label: "Bench Boost", blurb: "All 15 players score, bench included", accent: LIME,
    earn: "One a month — use the other two before it comes back" },
  { key: "insight", label: "Insight", blurb: "50/50 on one question of the round", accent: TEAL,
    earn: "One a month — use the other two before it comes back" },
];
const CHIP_LABEL: Record<ChipName, string> = Object.fromEntries(CHIP_META.map((c) => [c.key, c.label])) as Record<ChipName, string>;
// The wildcard sits OUTSIDE CHIP_META — it's a half-season resource, not a
// monthly-rotation chip — so its label/blurb are looked up first before falling
// back to the rotation. Keeps CHIP_META (and the set-of-three UI) three-wide.
const WILDCARD_BLURB = "Unlimited free transfers this gameweek";
const labelOf = (c: ChipName): string => (c === "wildcard" ? "Wildcard" : CHIP_LABEL[c]);
const blurbOf = (c: ChipName): string => (c === "wildcard" ? WILDCARD_BLURB : CHIP_META.find((m) => m.key === c)?.blurb ?? "");

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

/** Squad shape in line art — same motif as the PL tab's fantasy tile.
 *  Module scope so the signed-out hero can use it before the component's
 *  own consts are initialised. */
const FormationArt = () => (
  <svg viewBox="0 0 100 100" aria-hidden="true"
    style={{ position: "absolute", right: -16, bottom: -20, width: 150, height: 150, opacity: 0.09, pointerEvents: "none" }}>
    <rect x="6" y="6" width="88" height="88" rx="4" fill="none" stroke={TEAL} strokeWidth="2" />
    <line x1="6" y1="50" x2="94" y2="50" stroke={TEAL} strokeWidth="2" />
    <circle cx="50" cy="50" r="12" fill="none" stroke={TEAL} strokeWidth="2" />
    {[[50], [18, 39, 61, 82], [18, 39, 61, 82], [39, 61]].map((row, ri) =>
      row.map((x) => <circle key={`${ri}-${x}`} cx={x} cy={16 + ri * 22} r="3.4" fill={TEAL} />))}
  </svg>
);

export function FantasyHub({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<Map<number, ClientPoolPlayer>>(new Map());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [noSquad, setNoSquad] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasLeagues, setHasLeagues] = useState(false);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [confirmChip, setConfirmChip] = useState<ChipName | null>(null);
  /** The result table defaults to the players who contributed; the full eleven
   *  is opt-in. */

  const refresh = useCallback(async () => {
    try {
      const s = await api<FantasyState>("state");
      // No squad yet → the intro, not a silent jump into the builder. A first-time
      // manager should read what the game IS and choose to start, not be dropped
      // mid-flow into a 500-player list with no idea why (founder, 25 Jul).
      if (!s.squad) { setNoSquad(true); return; }
      setNoSquad(false);
      setState(s);
    } catch (e) {
      // Show an explicit sign-in prompt instead of a silent redirect — an
      // auto-redirect to /auth/sign-in bounced already-signed-in users around.
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, [router]);

  // Come back from an outage automatically. A user who lost signal mid-session
  // and regained it shouldn't have to guess that a manual reload is the fix — the
  // moment the browser reports it's back online, we re-fetch. Only retries when
  // we're actually in an error state, so it's a no-op on a healthy screen.
  useEffect(() => {
    const onOnline = () => { if (err) { setErr(null); refresh(); } };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [err, refresh]);

  useEffect(() => {
    refresh();
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(new Map(p.players.map((x) => [x.id, x]))));
    // Leagues count for the "Play with friends" → "Your leagues" copy switch.
    // Failure-soft — a signed-out or 500 response must never break the hub.
    fetch("/api/fantasy/leagues")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { leagues?: unknown[] } | null) => { if (j?.leagues?.length) setHasLeagues(true); })
      .catch(() => {});
    // Fixtures + doubts, for the pre-deadline checks below. Failure-soft.
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (c) setCtx(c); })
      .catch(() => {});
  }, [refresh]);

  /** While the matches are on, the screen keeps itself current. The tick re-scores
   *  every ten minutes, so a minute's polling is plenty and stops the "is this
   *  number stale?" doubt that a manual refresh button leaves behind. Only while
   *  a provisional score exists — the rest of the week this does nothing. */
  const livePolling = !!state?.entry?.result?.provisional && state.gw.mode !== "replay";
  useEffect(() => {
    if (!livePolling) return;
    const t = setInterval(() => { refresh(); }, 60_000);
    return () => clearInterval(t);
  }, [livePolling, refresh]);

  const squad = state?.squad;
  const nameOf = useCallback((id: number) => pool.get(id)?.name ?? DEPARTED_NAME, [pool]);

  // Anchor picks for the intro's "where to start" — the priciest name in each
  // line. "Most expensive" is a fact we can read straight off the pool (no form
  // claim we'd have to stand behind), and the premiums are where a new manager
  // sensibly builds a spine before filling in value. Recomputes only when the
  // pool arrives; empty until then, and the tile simply hides.
  const starterPicks = useMemo(() => {
    const best: Partial<Record<Pos, ClientPoolPlayer>> = {};
    for (const p of Array.from(pool.values())) {
      const cur = best[p.pos as Pos];
      if (!cur || p.price > cur.price) best[p.pos as Pos] = p;
    }
    return (["FWD", "MID", "DEF", "GK"] as Pos[])
      .map((pos) => best[pos])
      .filter((p): p is ClientPoolPlayer => Boolean(p));
  }, [pool]);

  const setSel = async (patch: Partial<{ xi: number[]; bench: number[]; captain: number; vice: number }>) => {
    if (!squad) return;
    setBusy(true); setErr(null);
    try {
      await api("selection", {
        xi: patch.xi ?? squad.xi, bench: patch.bench ?? squad.bench,
        captain: patch.captain ?? squad.captain, vice: patch.vice ?? squad.vice,
      });
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    setMenuFor(null); setBusy(false);
  };

  const swapWithBench = (starterId: number, benchId: number) => {
    if (!squad) return;
    setSel({
      xi: squad.xi.map((id) => (id === starterId ? benchId : id)),
      bench: squad.bench.map((id) => (id === benchId ? starterId : id)),
      captain: squad.captain === starterId ? benchId : squad.captain,
      vice: squad.vice === starterId ? benchId : squad.vice,
    });
  };

  const lock = async () => {
    setBusy(true); setErr(null);
    try { await api("lock"); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  // Playing a chip is the biggest call of the week, so it still confirms — but
  // in the app's own language. window.confirm() put an OS dialog in the middle
  // of a screen we'd just rebuilt, and on a phone it reads like a browser error.
  const playChipAction = (chip: ChipName) => setConfirmChip(chip);

  const commitChip = async (chip: ChipName) => {
    setConfirmChip(null);
    setBusy(true); setErr(null);
    try { await api("chip", { chip }); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const undoChip = async () => {
    setBusy(true); setErr(null);
    try { await apiRaw("chip", { method: "DELETE" }); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };


  // The intro — shown to anyone who hasn't got a squad yet, signed in or not.
  // Say what the game IS, then invite them to start. A cold guest off an ad used
  // to land on a bare "Sign in" card; a signed-in newcomer used to be dropped
  // straight into the builder with no explanation. Same screen for both now —
  // only the button differs (sign in, versus start building).
  const intro = (cta: { label: string; onClick: () => void; note: string }) => (
    <main data-fantasy style={embedded ? EMBEDDED_PAGE : page}>
      <div className="relative">
        {!embedded && <FantasyHeader subtitle="Build your squad, then dig in with the Scout." />}

        {/* Hero — the headline the founder rated over anything written for the
            page. The 01-04 explainer that used to sit here moved behind the
            "How it works" tile below: the landing is a set of doors now, not a
            wall of rules (founder, 25 Jul). */}
        <div className="rounded-2xl relative overflow-hidden px-5 pt-5 pb-5"
          style={{
            background: `linear-gradient(150deg, ${tint(TEAL, "1a")}, ${tint(TEAL, "05")})`,
            border: `1px solid ${tint(TEAL, "38")}`, marginBottom: 12,
          }}>
          <FormationArt />
          <div className="relative">
            <p className="font-display text-white" style={{ fontSize: 38, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
              <span style={{ display: "block" }}>One transfer.</span>
              <span style={{ display: "block" }}>Earn the rest.</span>
            </p>
            <p className="font-body" style={{ fontSize: 14, color: MUTED, marginTop: 12, maxWidth: "80%", lineHeight: 1.5 }}>
              Everyone gets a move each gameweek. What you know earns you more.
            </p>
            {/* Real faces, not just line art — the premiums a new manager knows. */}
            {starterPicks.length >= 3 && (
              <div style={{ display: "flex", marginTop: 16 }}>
                {starterPicks.slice(0, 5).map((p, i) => (
                  <div key={p.id} style={{ marginLeft: i === 0 ? 0 : -12, zIndex: 10 - i }}>
                    <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={42} ring="#0a1310" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* How it works — a tile, not a wall. Full-width tap into the rules. */}
        <button onClick={() => router.push("/fantasy/rules")}
          className="w-full flex items-center gap-3 rounded-2xl active:scale-[0.99] transition-transform"
          style={{
            background: `linear-gradient(150deg, ${tint(TEAL, "12")}, ${tint(TEAL, "03")})`,
            border: `1px solid ${tint(TEAL, "2a")}`, padding: "14px 16px", marginBottom: 12, textAlign: "left",
          }}>
          <div className="font-display rounded-full flex items-center justify-center"
            style={{ flexShrink: 0, width: 34, height: 34, fontSize: 16, background: tint(TEAL, "16"), color: TEAL, border: `1px solid ${tint(TEAL, "34")}` }}>?</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="font-display text-white" style={{ fontSize: 15, lineHeight: 1.15 }}>How it works</p>
            <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
              Squad, transfers, scoring and chips. The full rules.
            </p>
          </div>
          <span aria-hidden style={{ color: TEAL, fontSize: 18, flexShrink: 0 }}>→</span>
        </button>

        {/* The one action the page is for. */}
        <Btn gold glow onClick={cta.onClick}>{cta.label}</Btn>
        <p className="font-body" style={{ fontSize: 12, color: MUTED, margin: "10px 0 14px", textAlign: "center" }}>
          {cta.note}
        </p>

        {/* Where to start — premium anchors read live off the pool, plus a few
            tips drawn from the game's own rules (all verifiable, no form claims). */}
        <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 18, marginBottom: 12 }}>
          <p className="font-display tracking-widest" style={{ fontSize: 10, color: TEAL, marginBottom: 12 }}>WHERE TO START</p>
          {starterPicks.length > 0 && (
            <>
              <p className="font-body" style={{ fontSize: 13, color: INK, marginBottom: 10, lineHeight: 1.5 }}>
                Build a spine around a big name or two, then fill in value. The
                headline picks in each line:
              </p>
              {/* The spine as a formation: the priciest name in each line stacked
                  forward-to-back (FWD top → GK bottom, the order starterPicks is
                  built in), faces + the one fact this section stands on — price.
                  A faint centre line ties them into a spine, not a list. */}
              <div style={{ position: "relative", padding: "6px 0 2px", marginBottom: 14 }}>
                <div aria-hidden style={{
                  position: "absolute", left: "50%", top: 14, bottom: 14, width: 2,
                  background: `linear-gradient(${tint(TEAL, "00")}, ${tint(TEAL, "33")}, ${tint(TEAL, "00")})`,
                  transform: "translateX(-50%)",
                }} />
                <div style={{ display: "grid", gap: 14, justifyItems: "center", position: "relative" }}>
                  {starterPicks.map((p) => (
                    <div key={p.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span className="font-display" style={{ fontSize: 9, color: POS_COLOR[p.pos as Pos] ?? TEAL, letterSpacing: "0.1em" }}>{p.pos}</span>
                      <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={54} ring={tint(POS_COLOR[p.pos as Pos] ?? TEAL, "88")} />
                      <span className="font-body" style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 2 }}>{p.name}</span>
                      <span className="font-body" style={{ fontSize: 11, color: MUTED }}>
                        {p.club} · <span style={{ color: GOLD, fontWeight: 700 }}>£{p.price}m</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {[
              `${SQUAD_SIZE} players, £${(BUDGET_TENTHS / 10).toFixed(0)}m to spend. Use all of it, an unused million scores nothing.`,
              `No more than ${MAX_PER_CLUB} from any one club, so spread the risk across the league.`,
              "Your captain scores double every week, so give the armband to a nailed-on starter.",
              "Nothing's locked: rebuild as often as you like right up to the first deadline.",
            ].map((tip) => (
              <div key={tip} style={{ display: "flex", gap: 10 }}>
                <span aria-hidden style={{ color: TEAL, fontSize: 13, lineHeight: "1.5", flexShrink: 0 }}>›</span>
                <p className="font-body" style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>{tip}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );

  // A signed-out visitor gets the SAME intro and goes straight into the builder —
  // no sign-in wall at the door (founder, 4 Aug). They can pick a full team; the
  // account is only asked for when they save it.
  if (needsAuth) return intro({
    label: "Build your squad",
    onClick: () => router.push("/fantasy/build"),
    note: "Fifteen players, one budget. Build it now, sign in when you want to save.",
  });
  if (noSquad) return intro({
    label: "Build your squad",
    onClick: () => router.push("/fantasy/build"),
    note: "Fifteen players, one budget. You can change it freely until the season starts.",
  });
  if (err) return (
    <main data-fantasy style={embedded ? EMBEDDED_PAGE : page}>
      {!embedded && <FantasyHeader />}
      <ErrorState message={err} onRetry={() => { setErr(null); refresh(); }} />
    </main>
  );
  if (!state || !squad) return (
    <main data-fantasy style={embedded ? EMBEDDED_PAGE : page}>
      {!embedded && <FantasyHeader />}
      <Loading label="Loading your team">
        {/* Shaped like the hub: hero, the three numbers, the pitch. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Skel h={128} r={16} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <Skel h={66} r={16} /><Skel h={66} r={16} /><Skel h={66} r={16} />
          </div>
          <Skel h={240} r={16} />
        </div>
      </Loading>
    </main>
  );
  const entry = state.entry;
  const chips = state.chips;
  const result = entry?.result as Result | undefined | null;
  const locked = !state.openForEdits;
  const roundDone = !!entry?.round.done;
  const isDemo = state.gw.mode === "replay";
  /** A provisional score is NOT a result. The tick re-scores every ten minutes
   *  from the deadline onwards, so `result` appears on Saturday lunchtime with
   *  three fixtures played — and the hub used to read that as "gameweek done",
   *  headline the running total in gold, and offer "Start Gameweek 2". Replay
   *  scores in one shot, so it never has a live phase. */
  const isLive = !isDemo && !!result?.provisional;
  const phase: "open" | "locked" | "live" | "result" =
    isLive ? "live" : result ? "result" : locked ? "locked" : "open";

  const demo = async (target: string) => {
    setBusy(true); setErr(null);
    try {
      await api("demo", { phase: target });      // setup clears entries → pre-season
      if (target === "setup") { router.push("/fantasy/build"); return; }
      await refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const advance = async () => {
    setBusy(true); setErr(null);
    try { await api("advance"); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  /** Mint the short link server-side (the score is never trusted from the
   *  client), then hand it to the share sheet — clipboard as the fallback.
   *
   *  `kind: "squad"` forces the pre-season card even once results exist, because
   *  "here's my team" and "here's what I scored" are different things to say. */
  const share = async (kind?: "squad") => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ url: string }>("share", kind ? { kind } : undefined);
      const url = `${window.location.origin}${r.url}`;
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice("Link copied. Paste it in the group chat");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    }
    setBusy(false);
  };
  const shareResult = () => share();

  const gwN = state.gw.gw, total = state.season.total;
  const preseason = state.canRebuild && !roundDone && !locked; // never locked, week not started
  const seasonPos = `Week ${gwN} of ${total}`;
  // Copy branches on MODE, not just phase. Every sub-line below used to describe
  // the replay sandbox, where the user drove the clock: "lock it in", "move on to
  // the next gameweek when you're ready", "the Saturday deadline". In a live
  // season the season drives the clock, nothing is submitted, and gameweek 1's
  // deadline is a Friday — so the live copy says what is actually true.
  const BANNER: Record<typeof phase, { tag: string; head: string; sub: string }> = {
    open: preseason
      ? { tag: `PRE-SEASON · ${seasonPos.toUpperCase()}`, head: gwN === 1 ? "Your squad is in for gameweek 1" : `Gameweek ${gwN} is open`,
          sub: isDemo
            ? "Your squad isn't committed yet. Build and edit it freely, then lock it in for the gameweek."
            : "Change your team as much as you like before the deadline, and keep an eye on team news. The weekly quiz is an optional bonus that earns extra transfers." }
      : { tag: `GAMEWEEK OPEN · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is open`,
          sub: isDemo
            ? "Play your round, make transfers, set your team, then lock it in."
            : "Play your round, make your transfers and pick your captain. Whatever your team looks like at the deadline is what plays." },
    locked: { tag: `LOCKED · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is locked`,
      sub: "Your team is set and the matches are about to start. The first points land as they're played." },
    live: { tag: `LIVE · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is live`,
      sub: "Points are landing as the matches are played. Everything here is provisional until the gameweek finishes." },
    result: {
      tag: gwN < total ? `GAMEWEEK DONE · ${seasonPos.toUpperCase()}` : "SEASON COMPLETE",
      head: gwN < total ? `Gameweek ${gwN} result` : "That's the season",
      sub: gwN < total
        ? (isDemo
          ? "Scored. Move on to the next gameweek when you're ready; your squad and credits carry over."
          : "Scored. Your squad, credits and chips carry into the next gameweek on their own.")
        : "Your last gameweek of the season, scored. The tables are final.",
    },
  };
  const b = BANNER[phase];

  /** Who actually did something. Best first, so the week reads as a story rather
   *  than a squad list: a 25-point haul at the top, the blanks folded away. */
  /** One line of colour under the score: who carried the week, and what the
   *  hits cost. Built from the same breakdown the table below renders. */
  const topLine = (() => {
    if (!result) return "";
    const best = [...result.breakdown].sort((a, b2) => b2.points - a.points)[0];
    const cap = result.breakdown.find((x) => x.captain);
    const bits: string[] = [];
    if (best) bits.push(`${nameOf(best.id)} ${isLive ? "leads with" : "top scored with"} ${best.points}`);
    if (cap && cap.id !== best?.id) bits.push(`your captain ${nameOf(cap.id)} ${isLive ? "is on" : "got"} ${cap.points}`);
    if (entry && entry.hits > 0) bits.push(`includes −${entry.hits * 4} for extra transfers`);
    return bits.length ? `${bits.join(", ")}.` : "Your eleven starters, scored off the real matches.";
  })();

  /** THE LIVE SPLIT — who has been reported on and who hasn't.
   *
   *  `reported` is the set of picks whose fixture the feed has ingested. A player
   *  with no row yet has a Sunday kickoff still to come; a player with a row and
   *  no minutes was in the squad and didn't get on. Those are completely different
   *  facts and the old card rendered both as "Didn't play", which on a Saturday
   *  afternoon is simply wrong. */
  const live = (() => {
    if (!result) return null;
    const reported = new Set(result.reported ?? []);
    const rows = result.breakdown;
    const played = rows.filter((r) => reported.has(r.id) && (r.facts?.minutes ?? 0) > 0);
    const benched = rows.filter((r) => reported.has(r.id) && (r.facts?.minutes ?? 0) === 0);
    const toCome = rows.filter((r) => !reported.has(r.id));
    return { played, benched, toCome, total: rows.length };
  })();

  /** `preseason` means "has never locked a gameweek" — which in a LIVE season is
   *  true for the whole of gameweek 1, because the first lock only happens at the
   *  first deadline. Gating the round on it therefore hid the round for all of
   *  gameweek 1, so a new manager could never earn a transfer credit or make any
   *  chip progress in their opening week. Replay is genuinely self-paced and keeps
   *  the old behaviour; live opens the round with the gameweek. */
  const roundOpen = !isDemo || !preseason;

  /** The knowledge round is a LIVE-GAMEWEEK thing. In a live pre-season — squad
   *  picking, before the first deadline — it isn't available yet: the round opens
   *  with the gameweek. So the hub shows no "play the round" CTAs pre-season and
   *  leads on squad selection instead (founder, 30 Jul). `roundOpen` still gates
   *  the chips card, which IS shown pre-season ("chips unlock when GW1 kicks off"),
   *  so the two are kept distinct. Replay keeps the self-paced behaviour; LIVE now
   *  takes the server's own gate (state.roundOpen: gameday onwards, pre-deadline)
   *  — the API enforces it, so the hub advertising anything else was a lie. */
  const roundPlayable = isDemo ? (roundOpen && !preseason) : state.roundOpen;

  /** THE PRE-DEADLINE CHECK.
   *
   *  Everything the game knew about your team going wrong, it kept to itself: a
   *  captain with no fixture, a starter flagged as a doubt, an unplayed round
   *  worth up to four transfers. All of it was discoverable only by going and
   *  looking. These are the things worth interrupting someone for, and nothing
   *  else — a warnings list that cries wolf gets scrolled past.
   *
   *  Silent once the gameweek locks: there is nothing left to act on. */
  const warnings = (() => {
    if (locked || !squad) return [] as { tone: "warn" | "info"; text: string; action?: { label: string; onClick: () => void } }[];
    const out: { tone: "warn" | "info"; text: string; action?: { label: string; onClick: () => void } }[] = [];
    const hasFixtures = Object.keys(ctx.fixtures).length > 0;
    const thisGw = ctx.gw;

    const fixtureFor = (id: number) => {
      const clubId = pool.get(id)?.clubId;
      if (clubId === undefined) return undefined;
      return ctx.fixtures[clubId]?.find((c) => c.gw === thisGw);
    };

    // The captain is the single biggest points decision of the week.
    const capName = nameOf(squad.captain);
    if (ctx.doubts[squad.captain]) {
      out.push({
        tone: "warn",
        text: `${capName} is your captain and is a doubt for this gameweek.`,
        action: { label: "Change captain", onClick: () => setMenuFor(squad.captain) },
      });
    } else if (hasFixtures && thisGw > 0 && !fixtureFor(squad.captain)) {
      out.push({
        tone: "warn",
        text: `${capName} is your captain and has no fixture this gameweek. If he doesn't play, the armband passes to your vice.`,
        action: { label: "Change captain", onClick: () => setMenuFor(squad.captain) },
      });
    }

    // Starters who might not start. Named, not counted — "3 doubts" makes you
    // go looking; the names let you decide from here.
    const doubtful = squad.xi.filter((id) => id !== squad.captain && ctx.doubts[id]).map(nameOf);
    if (doubtful.length) {
      out.push({
        tone: "warn",
        text: doubtful.length === 1
          ? `${doubtful[0]} is in your starting eleven and is a doubt.`
          : `${doubtful.length} of your starters are doubts: ${doubtful.join(", ")}.`,
        action: { label: "Transfers", onClick: () => router.push("/fantasy/transfers") },
      });
    }

    // Blank gameweek for a starter — free points left on the bench.
    if (hasFixtures && thisGw > 0) {
      const blanks = squad.xi.filter((id) => id !== squad.captain && !fixtureFor(id)).map(nameOf);
      if (blanks.length) {
        out.push({
          tone: "warn",
          text: blanks.length === 1
            ? `${blanks[0]} has no fixture this gameweek and will score nothing.`
            : `${blanks.length} of your starters have no fixture this gameweek: ${blanks.join(", ")}.`,
        });
      }
    }

    // The round is the game's own differentiator, and it expires with the deadline.
    // Not pre-season though — there's no round to play yet, so no nag about it.
    if (!roundDone && roundPlayable) {
      out.push({
        tone: "info",
        text: entry && entry.round.answered > 0
          ? `Your round is unfinished at ${entry.round.answered} of 11. Right answers earn transfers.`
          : "You haven't played this week's round. Right answers earn transfers.",
        action: { label: "Play the round", onClick: () => router.push("/fantasy/round") },
      });
    }
    return out;
  })();

  /** Team value = what the fifteen are priced at right now, in tenths (fmtM's
   *  unit). Read off the same pool the pitch draws from; blank until it loads so
   *  the header never flashes £0.0m. */
  const valueKnown = pool.size > 0;
  const teamValueTenths = squad.picks.reduce((s, pk) => s + Math.round((pool.get(pk.id)?.price ?? 0) * 10), 0);

  /** The squad mapped onto the shared SquadBoard's shape — the SAME board the
   *  builder and the live/result views draw, so there is one pitch, not three. */
  const boardPlayers: BoardPlayer[] = squad.picks.map((pk) => {
    const p = pool.get(pk.id);
    return {
      id: pk.id, name: p?.name ?? DEPARTED_NAME, label: p ? pitchName(p.name) : DEPARTED_PITCH,
      pos: pk.pos, club: p?.club, avatarUrl: p ? (p.avatarUrl ?? faceFor(p.name)) : undefined, price: p?.price,
    };
  });

  /** Per-player live/final standing for the board, straight off the real point
   *  breakdown. State drives the dim: a player still to play is dimmed and reads
   *  "to play"; a scorer shows their points. No fabricated match minute — the
   *  feed gives points and whether a fixture has been reported, not a live clock. */
  const boardMode = isLive ? "live" : result ? "final" : "complete";
  const liveData: Record<number, LiveDatum> = {};
  if (result) {
    const reportedSet = new Set(result.reported ?? []);
    const bd = new Map(result.breakdown.map((b) => [b.id, b]));
    for (const id of [...squad.xi, ...squad.bench]) {
      const played = reportedSet.has(id);
      const b = bd.get(id);
      liveData[id] = {
        points: b?.points ?? 0,
        minute: null,
        state: !played ? "tocome" : isLive ? "live" : "done",
      };
    }
  }

  /** The per-player menu the board anchors under a tapped shirt. The board owns
   *  the layout; this owns the actions (captain, vice, swap with the bench). */
  const renderPlayerMenu = (id: number, { onBench }: { onBench: boolean }) => (
    <div style={{
      background: PANEL, border: `1px solid ${GOLD}`, borderRadius: 10, padding: 8, minWidth: 170,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      {!onBench && <>
        <Btn small onClick={() => setSel({ captain: id })}>Make captain</Btn>
        <Btn small onClick={() => setSel({ vice: id })}>Make vice</Btn>
        {squad.bench.filter((b) => pool.get(b)?.pos === pool.get(id)?.pos || (pool.get(b)?.pos !== "GK" && pool.get(id)?.pos !== "GK")).map((b) => (
          <Btn small key={b} onClick={() => swapWithBench(id, b)}>↔ {nameOf(b)}</Btn>
        ))}
      </>}
      {onBench && squad.xi
        .filter((s) => (pool.get(s)?.pos === "GK") === (pool.get(id)?.pos === "GK"))
        .slice(0, 6).map((s) => (
          <Btn small key={s} onClick={() => swapWithBench(s, id)}>↔ {nameOf(s)}</Btn>
        ))}
    </div>
  );

  /** The compact secondary row under the dominant Edit squad button. One line,
   *  small pills, scrollable rather than wrapped — everything the old
   *  share/edit block, 2-up destination grid and bottom Transfers button used
   *  to spread across the screen. Transfers keeps the same lock condition it
   *  always had (no transfers to make before the season starts, you rebuild
   *  freely instead). Chips just scrolls to the chips card below rather than
   *  duplicating its content up here. */
  const pillStyle: CSSProperties = {
    flexShrink: 0, whiteSpace: "nowrap", padding: "9px 15px", fontSize: 12.5, fontWeight: 700,
    cursor: "pointer", background: PANEL_2, color: INK, border: `1px solid ${LINE}`,
  };
  const secondaryActions: { key: string; label: string; onClick: () => void; disabled?: boolean }[] = [
    ...(!preseason && !isDemo
      ? [{ key: "transfers", label: "Transfers", onClick: () => router.push("/fantasy/transfers") }]
      : []),
    { key: "plan", label: "Plan ahead", onClick: () => router.push("/fantasy/plan") },
    { key: "chips", label: "Chips", onClick: () => document.getElementById("chips-card")?.scrollIntoView({ behavior: "smooth" }) },
    { key: "scout", label: "Scout", onClick: () => router.push("/fantasy/scout/squad") },
    { key: "share", label: busy ? "…" : "Share", onClick: () => share("squad"), disabled: busy },
  ];

  /** Small text link, the shared style for the demoted "More" card at the
   *  bottom — quiz guide, knowledge board, leagues nudge, the quiet rebuild
   *  link. None of them earn a place above the pitch anymore. */
  const moreLinkStyle: CSSProperties = {
    textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer",
    fontSize: 12.5, color: MUTED, textDecoration: "underline",
  };

  return (
    <main data-fantasy style={embedded ? EMBEDDED_PAGE : page} onClick={() => menuFor !== null && setMenuFor(null)}>
      <div className="relative">
      {!embedded && <FantasyHeader />}

      {/* HERO — the you-are-here, sold rather than announced. Gradient wash +
          formation art bleeding off the tile, the house pattern from the PL tab. */}
      {/* THE SCORE IS THE HEADLINE once a gameweek lands — big gold tile. But
          pre-season that tile carried no real value, so it's just a header then;
          the squad board below is the star (founder, 2 Aug). */}
      {result ? (
        <div className="rounded-2xl relative overflow-hidden"
          style={{
            background: `linear-gradient(150deg, ${tint(TEAL, "14")}, ${tint(TEAL, "03")})`,
            border: `1px solid ${tint(TEAL, "22")}`,
            padding: "18px 18px 18px", marginBottom: 12,
          }}>
          <FormationArt />
          <div className="relative">
            <p className="font-display tracking-widest" style={{ fontSize: 11.5, color: TEAL, marginBottom: 8 }}>{b.tag}</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="font-display" style={{ fontSize: 64, lineHeight: 0.86, letterSpacing: "-0.02em", color: isLive ? TEAL : GOLD }}>
                {result.points}
              </span>
              <span className="font-display" style={{ fontSize: 22, color: isLive ? TEAL : GOLD, opacity: 0.85 }}>pts</span>
              {isLive && (
                <span className="font-body" style={{
                  fontSize: 10.5, letterSpacing: "0.08em", color: TEAL, fontWeight: 700,
                  border: `1px solid ${tint(TEAL, "55")}`, borderRadius: 999, padding: "3px 9px",
                  marginLeft: 2, whiteSpace: "nowrap",
                }}>SO FAR</span>
              )}
            </div>
            <p className="font-body" style={{ fontSize: 13, color: MUTED, marginTop: 8, lineHeight: 1.5, maxWidth: "92%" }}>{topLine}</p>
          </div>
        </div>
      ) : (
        <div style={{ margin: "2px 0 14px" }}>
          <p className="font-display tracking-widest" style={{ fontSize: 11, color: TEAL, marginBottom: 6 }}>{b.tag}</p>
          <h1 className="font-display text-white" style={{ fontSize: 25, lineHeight: 1.05, letterSpacing: "-0.01em", margin: 0 }}>{b.head}</h1>
        </div>
      )}

      {/* When it closes — sits ABOVE the pitch (founder, 2 Aug) so "how long
          have I got?" is the first thing answered. Replay has no deadline; once
          points exist the deadline is history and the live panel takes over. */}
      {!isDemo && !result && <Deadline iso={state.gw.deadline} />}

      {/* WHAT NEEDS ATTENTION, before it's too late to act on it. Sits between
          the deadline and the pitch because that's the order the questions
          arrive in: how long have I got, what's wrong, what do I do. */}
      {warnings.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {warnings.map((w, i) => (
            <div key={i} className="rounded-xl" style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "10px 13px",
              background: w.tone === "warn" ? "rgba(184,92,56,0.10)" : PANEL,
              border: `1px solid ${w.tone === "warn" ? "#B85C38" : LINE}`,
            }}>
              <span className="font-body" style={{
                fontSize: 12.5, lineHeight: 1.45, color: w.tone === "warn" ? "#E08A6B" : MUTED, minWidth: 0,
              }}>{w.text}</span>
              {w.action && (
                <button onClick={w.action.onClick} className="font-body"
                  style={{
                    flexShrink: 0, background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: w.tone === "warn" ? "#E08A6B" : TEAL, fontSize: 12, fontWeight: 700,
                    textDecoration: "underline",
                  }}>{w.action.label}</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* THE PITCH — the identity of this screen, moved above everything except
          the score and the warnings. Your team in the shape you actually picture
          it: forwards attacking the top of the screen, keeper at the back, subs
          in a DUGOUT down the touchline.

          The playing area is a SQUARE. A real pitch is ~1.6:1, but drawing the
          true ratio on a phone gives you a tall thin strip whose markings can't
          line up with four rows of players — the halfway line landed under the
          defenders and the boxes sat nowhere near anybody. Square is a lie that
          reads right: with the rows spaced across it, the forwards stand in the
          attacking box, the halfway line falls between midfield and defence, and
          the keeper stands in his own six-yard box. The viewBox is square too, so
          nothing is stretched. */}
      <div style={{ marginBottom: 10 }}>
        <SquadBoard
          mode={boardMode}
          players={boardPlayers}
          xi={squad.xi}
          bench={squad.bench}
          captain={squad.captain}
          vice={squad.vice}
          doubts={ctx.doubts}
          live={liveData}
          menuFor={locked ? null : menuFor}
          onSlot={locked ? undefined : (id) => setMenuFor(menuFor === id ? null : id)}
          renderMenu={locked ? undefined : renderPlayerMenu}
        />
      </div>

      {/* THE DOMINANT ACTION, directly under the pitch. Same condition the edit
          button always had: free to rebuild until the season starts, hidden the
          moment the squad locks. Everything else on this screen is secondary
          to this one action. */}
      {state.canRebuild && !isDemo && (
        <div style={{ marginBottom: 10 }}>
          <Btn lime glow onClick={() => router.push("/fantasy/build")}>Edit my squad</Btn>
          <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 7, textAlign: "center" }}>
            Free to change any player until the season starts.
          </p>
        </div>
      )}

      {/* THE SECONDARY ROW — one compact line, small pills. Replaces what used
          to be spread across a share+edit block, a 2-up destination grid and a
          Transfers button at the bottom. */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {secondaryActions.map((a) => (
            <button key={a.key} disabled={a.disabled} onClick={a.onClick} className="font-body rounded-full"
              style={{ ...pillStyle, opacity: a.disabled ? 0.5 : 1, cursor: a.disabled ? "default" : "pointer" }}>
              {a.label}
            </button>
          ))}
        </div>
        {notice && (
          <p className="font-body" style={{ fontSize: 12, color: GOLD, marginTop: 7, textAlign: "center" }}>
            {notice}
          </p>
        )}
      </div>

      {/* THE LIVE PANEL — the weekend hook. What's counted, what's still to come,
          and an honest label on a number that can still move. */}
      {live && result && (
        <div className="rounded-2xl" style={{
          background: `linear-gradient(150deg, ${tint(TEAL, "12")}, ${PANEL})`,
          border: `1px solid ${tint(TEAL, isLive ? "44" : "22")}`,
          padding: "14px 16px", marginBottom: 12,
        }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
            <span className="font-display tracking-widest" style={{ fontSize: 10.5, color: isLive ? TEAL : MUTED }}>
              {isLive ? "LIVE THIS GAMEWEEK" : "FINAL THIS GAMEWEEK"}
            </span>
            {isLive && (
              <button onClick={() => refresh()} disabled={busy}
                className="font-body"
                style={{
                  background: "none", border: "none", color: TEAL, fontSize: 11.5,
                  fontWeight: 600, cursor: "pointer", padding: 0,
                }}>Refresh</button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {([
              { label: "Counted", value: live.played.length, accent: true },
              { label: isLive ? "Still to play" : "Didn't feature", value: isLive ? live.toCome.length : live.benched.length, accent: false },
              { label: "Your captain", value: result.breakdown.find((r) => r.captain)?.points ?? 0, accent: true },
            ] as const).map((t) => (
              <div key={t.label}>
                <div className="font-display" style={{ fontSize: 24, lineHeight: 1, color: t.accent ? INK : MUTED }}>
                  {t.value}
                </div>
                <div className="font-body" style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>{t.label}</div>
              </div>
            ))}
          </div>

          {/* Auto-subs, named. They are the one thing that changes your team
              without you touching it, so they cannot be silent. */}
          {result.autosubs?.length > 0 && (
            <p className="font-body" style={{ fontSize: 12, color: MUTED, margin: "12px 0 0", lineHeight: 1.5 }}>
              {result.autosubs.map((s) => `${nameOf(s.in)} came on for ${nameOf(s.out)}`).join(". ")}.
            </p>
          )}

          {isLive && (
            <p className="font-body" style={{ fontSize: 11.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.45 }}>
              Provisional. Bonus and stat corrections can still move this, and your bench only
              counts if a starter doesn&apos;t play. Last updated{" "}
              {new Date(result.scoredAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.
            </p>
          )}
        </div>
      )}

      {/* The captain tip — the one recommendation with proof. Only while the
          squad is still editable; self-hides when the flag is off or there's no
          change to suggest. onApplied refreshes so the new armband shows
          immediately. */}
      {!locked && !result && <CaptainAssistCard onApplied={refresh} />}

      {/* The Moves Bank — knowledge-earned moves are the product's whole
          story, so it gets its own row rather than a bare "Transfers: 3" tile.
          The two money figures sit beside it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        <MovesBank held={squad.credits} cap={CREDIT_CAP}
          roundEarns={!roundDone && roundPlayable} chips={CHIP_META.map((c) => ({ label: c.label, accent: c.accent }))} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {([
            { label: "In the bank", value: fmtM(squad.bankTenths), accent: TEAL },
            { label: "Team value", value: valueKnown ? fmtM(teamValueTenths) : "—", accent: GOLD },
          ] as const).map((t) => (
            <div key={t.label} className="rounded-xl" style={{ background: `linear-gradient(150deg, ${tint(t.accent, "12")}, ${PANEL} 70%)`, border: `1px solid ${tint(t.accent, "33")}`, padding: "9px 12px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <div className="font-body" style={{ fontSize: 11, color: MUTED, letterSpacing: "0.04em" }}>{t.label}</div>
              <div className="font-display" style={{ fontSize: 18, lineHeight: 1, color: t.accent }}>{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      {phase === "open" && !roundDone && roundPlayable && (
        <Card style={{ marginBottom: 12, border: `1px solid ${tint(TEAL, "44")}`, background: `linear-gradient(150deg, ${tint(TEAL, "0e")}, ${PANEL})` }}>
          <div className="font-display" style={{ fontSize: 22, lineHeight: 1.05, marginBottom: 6 }}>
            ⚡ EARN A TRANSFER
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px", lineHeight: 1.45 }}>
            Eleven questions. Right answers earn the transfer credits that improve this squad.
          </p>
          <Btn gold glow onClick={() => router.push("/fantasy/round")}>
            {entry && entry.round.answered > 0 ? `Continue round (${entry.round.answered}/11)` : "Play the round"}
          </Btn>
        </Card>
      )}
      {phase === "open" && roundDone && entry && (
        <Card style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>
            Round done: <b style={{ color: GOLD }}>{entry.round.correct}/11</b> → earned{" "}
            {entry.round.creditsEarned} transfer{entry.round.creditsEarned === 1 ? "" : "s"} for next week
          </span>
        </Card>
      )}

      {/* The pending tray — what you've earned THIS gameweek for NEXT. Shows the
          best of your round and your first gameday quiz (it only ever rises), and
          lands in your bank when the gameweek opens. This is the final-day rush:
          play a gameday quiz on Sunday and watch it tick up. */}
      {squad && squad.earnedForNextGw > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13.5 }}>
            <b style={{ color: GOLD }}>{squad.earnedForNextGw} transfer{squad.earnedForNextGw === 1 ? "" : "s"}</b>{" "}
            earned for next week
            {squad.earnedSource === "gameday" ? " (your gameday quiz)" : squad.earnedSource === "round" ? " (the round)" : ""}.
            {" "}Lands in your bank when the gameweek opens.
          </span>
        </Card>
      )}

      {/* Chips — shown from the first visit in a live season, even at zero held.
          Hiding the card until a manager had committed a squad meant the whole
          mechanic was invisible
          through onboarding and all of gameweek 1. A locked card that names the
          chips and shows progress teaches the game; an absent one doesn't.
          `chips-card` is the anchor id the Chips pill above scrolls to. */}
      {phase === "open" && roundOpen && chips && (
        <div id="chips-card">
          <Card style={{ marginBottom: 12, background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${tint(GOLD, "04")})`, border: `1px solid ${tint(GOLD, "33")}` }}>
            <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: GOLD, letterSpacing: "0.02em" }}>Chips</div>
            {/* Monthly rotation: one a month, a fresh set of three once all three
                are used. No progress bar — nothing accrues, you simply have the set. */}
            <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 8px", lineHeight: 1.45 }}>
              {preseason
                ? "Your powers for the season. Chips unlock to play once gameweek 1 kicks off."
                : chips.playedThisMonth
                ? "You've played this month's chip. A fresh pick opens next month."
                : chips.available.length >= CHIP_META.length
                  ? "One chip a month, your pick. Use all three before any comes back."
                  : `One chip a month. ${chips.available.length} left in this set before it refreshes.`}
            </p>
            {chips.playedThisGw ? (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                background: "#233B2C", border: `1px solid ${GOLD}`, borderRadius: 10, padding: "9px 12px", marginTop: 6,
              }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: GOLD }}>
                  {labelOf(chips.playedThisGw)} played this gameweek
                </span>
                <Btn small disabled={busy} onClick={undoChip}>Undo</Btn>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {CHIP_META.map((c) => {
                  const held = chips.available.includes(c.key);
                  // Pre-season a chip can't be played — the season hasn't started.
                  const playable = held && !c.comingSoon && !preseason;
                  return (
                    <button key={c.key} disabled={!playable || busy} onClick={() => playChipAction(c.key)} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                      padding: "9px 12px", borderRadius: 10, textAlign: "left",
                      // Each chip owns a colour so the row isn't three identical tiles.
                      background: `linear-gradient(150deg, ${tint(c.accent, "16")}, ${tint(c.accent, "04")})`,
                      border: `1px solid ${tint(c.accent, "3a")}`, borderLeft: `3px solid ${c.accent}`,
                      color: playable ? INK : MUTED,
                      cursor: playable ? "pointer" : "default", opacity: playable ? 1 : 0.55,
                    }}>
                      <span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, display: "block", color: c.accent }}>{c.label}</span>
                        <span style={{ fontSize: 11.5, display: "block" }}>{c.comingSoon ? "Coming soon" : c.blurb}</span>
                        {/* How it's earned, shown only while you don't hold it —
                            once you do, the effect is the only thing that matters. */}
                        {!held && !c.comingSoon && (
                          <span style={{ fontSize: 11, color: "#5b645e", display: "block", marginTop: 2, lineHeight: 1.4 }}>
                            {c.earn}
                          </span>
                        )}
                      </span>
                      {!c.comingSoon && (
                        <span style={{ fontSize: 11, color: playable ? c.accent : MUTED, fontWeight: 700, flexShrink: 0 }}>
                          {held ? "Play" : chips.playedThisMonth ? "Next month" : "Used this set"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Wildcard — a SEPARATE resource from the monthly chips (founder 7 Aug,
          "same as FPL"): one per half of the season, unlimited free transfers for
          one gameweek. It shares only the one-chip-per-gameweek slot, so it's
          hidden the moment any chip is already played this week. */}
      {phase === "open" && roundOpen && chips && !chips.playedThisGw && (
        <Card style={{ marginBottom: 12, background: `linear-gradient(150deg, ${tint(CORAL, "14")}, ${tint(CORAL, "04")})`, border: `1px solid ${tint(CORAL, "33")}` }}>
          <div className="font-display" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: CORAL, letterSpacing: "0.02em" }}>Wildcard</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 8px", lineHeight: 1.45 }}>
            Rebuild as much as you like for one gameweek, every transfer free. One
            for each half of the season, so spend it on a week worth rebuilding.
          </p>
          {chips.wildcards > 0 ? (
            <button disabled={busy || preseason} onClick={() => playChipAction("wildcard")} style={{
              width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 10, textAlign: "left",
              background: `linear-gradient(150deg, ${tint(CORAL, "16")}, ${tint(CORAL, "04")})`,
              border: `1px solid ${tint(CORAL, "3a")}`, borderLeft: `3px solid ${CORAL}`,
              color: preseason ? MUTED : INK, cursor: preseason ? "default" : "pointer", opacity: preseason ? 0.55 : 1,
            }}>
              <span style={{ fontSize: 12.5 }}>
                1 wildcard ready. Expires at the GW{(chips.wildcardHalf ?? 1) === 1 ? HALF_SEASON_GW : total} deadline.
              </span>
              <span style={{ fontSize: 11, color: preseason ? MUTED : CORAL, fontWeight: 700, flexShrink: 0 }}>
                {preseason ? "GW1" : "Play"}
              </span>
            </button>
          ) : (
            <p style={{ fontSize: 11.5, color: "#5b645e", margin: 0, lineHeight: 1.4 }}>
              {(chips.wildcardHalf ?? 1) >= 2
                ? "Both wildcards used. A fresh one arrives next season."
                : `Your next wildcard arrives at the GW${HALF_SEASON_GW + 1} deadline, for the second half.`}
            </p>
          )}
        </Card>
      )}

      {/* Chip confirm, in the app's own voice. Anchored bottom on a phone so the
          answer is under your thumb, not in the middle of the screen. */}
      {confirmChip && chips && (
        <Sheet onClose={() => setConfirmChip(null)} labelledBy="chip-confirm-title">
          <div id="chip-confirm-title" className="font-display" style={{ fontSize: 22, lineHeight: 1.05, marginBottom: 6 }}>
            Play {labelOf(confirmChip)}?
          </div>
          <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 6px", lineHeight: 1.45 }}>
            {blurbOf(confirmChip)}. It applies to gameweek {gwN} and
            can be taken back until the matches start.
          </p>
          <p className="font-body" style={{ fontSize: 12.5, color: confirmChip === "wildcard" ? CORAL : GOLD, margin: "0 0 14px" }}>
            {confirmChip === "wildcard"
              ? "Your wildcard for this half of the season. Use it or lose it at the half deadline."
              : "This is your one chip for the month."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><Btn onClick={() => setConfirmChip(null)}>Not yet</Btn></div>
            <div style={{ flex: 1 }}><Btn gold disabled={busy} onClick={() => commitChip(confirmChip)}>Play it</Btn></div>
          </div>
        </Sheet>
      )}

      {/* THE FINAL STORY — a settled gameweek as a gold, shareable cover: star
          man, captain, biggest regret, moves earned. Only once the football is
          over (a provisional total can still move). The full table sits below. */}
      {result && !isLive && (
        <FinalStory
          gw={gwN}
          points={result.points}
          breakdown={result.breakdown}
          xi={squad.xi}
          pool={pool}
          nameOf={nameOf}
          movesEarned={entry?.round.creditsEarned ?? 0}
          busy={busy}
          onShare={shareResult}
        />
      )}

      {result && (
        <GameweekBreakdown
          result={result}
          isLive={isLive}
          hits={entry?.hits ?? 0}
          pool={pool}
          nameOf={nameOf}
          busy={busy}
          notice={notice}
          onShare={shareResult}
          advance={isDemo && gwN < total ? { label: `Start Gameweek ${gwN + 1} →`, onClick: advance } : undefined}
        />
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}

      {/* Locking is the SEASON's job in a live gameweek — this button answers
          403 there, and the paragraph under it told live managers they were in
          replay mode. Both are replay-only now; the deadline strip at the top
          of the screen is what a live manager needs instead. */}
      {!locked && isDemo && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn gold disabled={busy} onClick={lock}>
            {busy ? "Locking…" : `Lock team & play gameweek ${state.gw.gw}`}
          </Btn>
          <p style={{ fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.4 }}>
            Replay mode: this scores your XI against the real results of gameweek {state.gw.gw},
            {" "}{state.gw.season}. In the live season this happens automatically at the deadline.
          </p>
        </div>
      )}
      {locked && !result && <p style={{ color: MUTED, fontSize: 13 }}>Locked. Scoring…</p>}

      {/* Demo stepper — walk the weekly journey (replay/prototype only) */}
      {isDemo && (
        <div style={{ marginTop: 22, paddingTop: 14, borderTop: `1px solid ${LINE}`, opacity: 0.75 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, marginBottom: 5 }}>
            DEMO · JUMP TO A STAGE
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {([
              ["setup", "Squad setup", false],
              ["open", "Gameweek open", phase === "open"],
              ["result", "Result", phase === "result"],
            ] as [string, string, boolean][]).map(([target, label, active]) => (
              <button key={target} disabled={busy} onClick={() => demo(target)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12, fontWeight: 700,
                cursor: "pointer", background: active ? PANEL_2 : PANEL, color: active ? TEAL : MUTED,
                border: `1px solid ${active ? tint(TEAL, "44") : LINE}`,
              }}>{label}</button>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: MUTED, margin: "5px 0 0", lineHeight: 1.4 }}>
            Prototype control. In the real game the season moves you through these on its own; the
            live &ldquo;locked, matches playing&rdquo; stage sits between open and result.
          </p>
        </div>
      )}

      {/* MORE — everything demoted off the main screen, folded into one quiet
          card of small text links. Was four separate big-card destinations
          (the pre-season quiz explainer, the knowledge board, the leagues nudge,
          the rebuild link); none of them earn a place above the pitch, so they
          demote together at the very bottom. */}
      <Card style={{ marginBottom: 12 }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: MUTED, marginBottom: 8 }}>MORE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {preseason && !result && (
            <button onClick={() => router.push("/fantasy/quiz-guide")} className="font-body" style={moreLinkStyle}>
              How the weekly quiz earns transfers
            </button>
          )}
          <button onClick={() => router.push("/fantasy/knowledge")} className="font-body" style={moreLinkStyle}>
            {KNOWLEDGE_NAME} table
          </button>
          <button onClick={() => router.push("/fantasy/history")} className="font-body" style={moreLinkStyle}>
            My gameweek history
          </button>
          <button onClick={() => router.push("/fantasy/rules")} className="font-body" style={moreLinkStyle}>
            How the game works
          </button>
          <button onClick={() => router.push("/fantasy/leagues")} className="font-body" style={moreLinkStyle}>
            {hasLeagues ? "Your leagues" : "Play with friends in a league"}
          </button>
          {state.canRebuild && isDemo && (
            <button onClick={() => router.push("/fantasy/build")} className="font-body" style={moreLinkStyle}>
              Edit my squad. Swap any players before the season starts
            </button>
          )}
        </div>
      </Card>
      </div>
    </main>
  );
}
