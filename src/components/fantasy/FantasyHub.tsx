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
  api, Btn, Card, Crest, extrasLine, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL, PANEL_2, TEAL, tint,
  type ChipName, type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { HALF_SEASON_GW } from "@/lib/fantasy/engine";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";

type Result = NonNullable<NonNullable<FantasyState["entry"]>["result"]>;

/** Inside the Premier League tab the shell already owns the background, the
 *  max-width and the bottom padding for the nav — only the horizontal gutter is
 *  ours, and it must match the sibling sections. */
const EMBEDDED_PAGE: CSSProperties = { padding: "4px 16px 8px", color: INK };

/** Width of the dugout strip. Wide enough for a crest and a surname, narrow
 *  enough that five outfielders still fit across the pitch beside it. */
const DUGOUT_W = 68;

/** Long surnames don't fit a 68px dugout strip at the default size, and
 *  "Arrizabalaga" was rendering as "Arrizab…". Sizing for the WORST case
 *  ("Williams-Barnett", 16 chars) would shrink every name to unreadable, so the
 *  size adapts: 83% of the pool is 8 characters or fewer and keeps full size.
 *  Measured against the real pool, not guessed. */
function benchFontSize(name: string): number {
  // A hyphenated name wraps AT the hyphen, so what has to fit on one line is the
  // longest segment, not the whole string. Sizing "Williams-Barnett" as 16
  // characters shrank it to 6.8px when its widest line is only "Williams-".
  const n = Math.max(...name.split("-").map((part) => part.length));
  return n <= 8 ? 9.5 : n <= 10 ? 8.5 : n <= 13 ? 7.5 : 6.8;
}

/** On the pitch there is room for ONE word. "Jean-Philippe Mateta" forced every
 *  tile in the row wide enough to hold it, which is what made the pitch too big
 *  and the rows wrap. The crest disambiguates two players sharing a surname, and
 *  the full name is still used everywhere it fits (menus, tables, transfers). */
function pitchName(full: string): string {
  const parts = full.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  // Keep two words for "de Bruyne" / "van Dijk" style names, which read wrong alone.
  if (parts.length > 1 && /^(de|van|von|da|dos|del|di|el|al|mc|le)$/i.test(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}

// Fungible tokens (triple_captain, bench_boost, insight) all
// spend from the same held count; the wildcard runs on its own separate track.
// Insight fires inside the round (a 50/50), Second Chance after it (retry one
// the full chip set is legible, but never playable.
const CHIP_META: { key: ChipName; label: string; blurb: string; comingSoon?: boolean }[] = [
  { key: "wildcard", label: "Wildcard", blurb: "Unlimited free transfers this gameweek" },
  { key: "triple_captain", label: "Triple Captain", blurb: "Your captain's points count ×3, not ×2" },
  { key: "bench_boost", label: "Bench Boost", blurb: "All 15 players score, bench included" },
  { key: "insight", label: "Insight", blurb: "50/50 on one question of the round" },
];
const CHIP_LABEL: Record<ChipName, string> = Object.fromEntries(CHIP_META.map((c) => [c.key, c.label])) as Record<ChipName, string>;

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
  const [notice, setNotice] = useState<string | null>(null);
  const [hasLeagues, setHasLeagues] = useState(false);
  const [confirmChip, setConfirmChip] = useState<ChipName | null>(null);
  /** The result table defaults to the players who contributed; the full eleven
   *  is opt-in. */
  const [fullSheet, setFullSheet] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await api<FantasyState>("state");
      if (!s.squad) { router.replace("/fantasy/build"); return; }
      setState(s);
    } catch (e) {
      // Show an explicit sign-in prompt instead of a silent redirect — an
      // auto-redirect to /auth/sign-in bounced already-signed-in users around.
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, [router]);

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
  }, [refresh]);

  const squad = state?.squad;
  const nameOf = useCallback((id: number) => pool.get(id)?.name ?? `#${id}`, [pool]);
  const rows = useMemo(() => {
    if (!squad) return [];
    const posOf = new Map(squad.picks.map((p) => [p.id, p.pos]));
    // Top of the screen is the opposition goal: FWD → MID → DEF → GK.
    return (["FWD", "MID", "DEF", "GK"] as Pos[]).map((pos) => ({
      pos, ids: squad.xi.filter((id) => posOf.get(id) === pos),
    }));
  }, [squad]);

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


  // A cold guest off an ad used to land on a bare "Sign in to play" card and
  // learn nothing about the game before being asked for an account. Say what it
  // is FIRST, then ask — and always leave a route back into the rest of YourScore.
  if (needsAuth) return (
    <main style={embedded ? EMBEDDED_PAGE : page}>
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative">
        {!embedded && <Header right={<Btn small onClick={() => router.push("/")}>All games</Btn>} />}

        {/* The hero and the numbered beats are lifted from the live PL-tab
            holding screen, which the founder rated over anything written for
            this page. Same headline, same 01-04 structure; only the CTA differs,
            because the game now exists and the ask is "sign in" rather than
            "join the waitlist". (That holding screen is deleted — this IS the
            Fantasy section now.) */}
        <div className="rounded-2xl relative overflow-hidden px-5 pt-5 pb-5"
          style={{
            background: `linear-gradient(150deg, ${tint(TEAL, "1a")}, ${tint(TEAL, "05")})`,
            border: `1px solid ${tint(TEAL, "38")}`, marginBottom: 14,
          }}>
          <FormationArt />
          <div className="relative">
            <p className="font-display tracking-widest" style={{ fontSize: 10, color: TEAL, marginBottom: 10 }}>
              YOURSCORE FANTASY FOOTBALL
            </p>
            <p className="font-display text-white" style={{ fontSize: 40, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
              <span style={{ display: "block" }}>One transfer.</span>
              <span style={{ display: "block" }}>Earn the rest.</span>
            </p>
            <p className="font-body" style={{ fontSize: 14, color: MUTED, marginTop: 12, maxWidth: "80%", lineHeight: 1.5 }}>
              Everyone gets a move each gameweek. What you know earns you more.
            </p>
          </div>
        </div>

        <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 20, marginBottom: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {([
              { n: "01", t: "Build it once",
                d: "Fifteen players, £100m, no more than three from any one club. That's your squad." },
              { n: "02", t: "Earn extra transfers",
                d: "Everyone gets one transfer a gameweek. Answer the round to earn more, so the better you know your football, the more moves you get." },
              { n: "03", t: "Real points, no mystery",
                d: "Your score comes from what actually happened on the pitch. No bonus-point panel quietly deciding your week." },
              { n: "04", t: "A fresh table every month",
                d: "Months are their own competition, so a rough August doesn't bury your season." },
            ] as const).map((b) => (
              <div key={b.n} style={{ display: "flex", gap: 14 }}>
                <div className="font-display rounded-full"
                  style={{
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    width: 26, height: 26, fontSize: 11,
                    background: tint(TEAL, "18"), color: TEAL, border: `1px solid ${tint(TEAL, "35")}`,
                  }}>{b.n}</div>
                <div style={{ minWidth: 0 }}>
                  <p className="font-body" style={{ fontSize: 14, color: INK, fontWeight: 600, margin: 0 }}>{b.t}</p>
                  <p className="font-body" style={{ fontSize: 12.5, color: MUTED, margin: "3px 0 0", lineHeight: 1.55 }}>{b.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Btn gold glow onClick={() => router.push("/auth/sign-in?next=/fantasy")}>Build my squad</Btn>
        <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 10, textAlign: "center" }}>
          Takes a minute. Your squad saves to your account, so it&apos;s there every week.
        </p>
      </div>
    </main>
  );
  if (err) return (
    <main style={embedded ? EMBEDDED_PAGE : page}>
      {!embedded && <Header />}
      <Card style={{ marginTop: 12 }}><p style={{ color: "#E08A6B", fontSize: 13.5, margin: 0 }}>{err}</p></Card>
      <div style={{ marginTop: 10 }}><Btn onClick={() => { setErr(null); refresh(); }}>Try again</Btn></div>
    </main>
  );
  if (!state || !squad) return <main style={embedded ? EMBEDDED_PAGE : page}>{!embedded && <Header />}<p style={{ color: MUTED }}>Loading…</p></main>;
  const entry = state.entry;
  const chips = state.chips;
  const result = entry?.result as Result | undefined | null;
  const locked = !state.openForEdits;
  const roundDone = !!entry?.round.done;
  const phase: "open" | "locked" | "result" = result ? "result" : locked ? "locked" : "open";
  const isDemo = state.gw.mode === "replay";

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
   *  client), then hand it to the share sheet — clipboard as the fallback. */
  const shareResult = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ url: string }>("share");
      const url = `${window.location.origin}${r.url}`;
      if (navigator.share) await navigator.share({ url });
      else { await navigator.clipboard.writeText(url); setNotice("Link copied. Paste it in the group chat"); }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    }
    setBusy(false);
  };

  const gwN = state.gw.gw, total = state.season.total;
  const preseason = state.canRebuild && !roundDone && !locked; // never locked, week not started
  const seasonPos = `Week ${gwN} of ${total}`;
  const BANNER: Record<typeof phase, { tag: string; head: string; sub: string }> = {
    open: preseason
      ? { tag: `PRE-SEASON · ${seasonPos.toUpperCase()}`, head: gwN === 1 ? "The season kicks off here" : `Gameweek ${gwN} is open`,
          sub: "Your squad isn't committed yet. Build and edit it freely, then lock it in for the gameweek. From next gameweek on, your knowledge round earns the transfers to improve it." }
      : { tag: `GAMEWEEK OPEN · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is open`,
          sub: "Play your round, make transfers, set your team, then lock it in. In the live game this closes at the Saturday deadline." },
    locked: { tag: `LOCKED · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is locked`,
      sub: "Your team is set and the matches are playing. Nothing changes now until the points land." },
    result: {
      tag: gwN < total ? `GAMEWEEK DONE · ${seasonPos.toUpperCase()}` : "SEASON COMPLETE",
      head: gwN < total ? `Gameweek ${gwN} result` : "That's the season",
      sub: gwN < total ? "Scored. Move on to the next gameweek when you're ready; your squad and credits carry over."
        : "Your last gameweek of the season, scored. The tables are final.",
    },
  };
  const b = BANNER[phase];
  const seasonOver = phase === "result" && gwN >= total;

  /** Who actually did something. Best first, so the week reads as a story rather
   *  than a squad list: a 25-point haul at the top, the blanks folded away. */
  const scorers = result ? result.breakdown.filter((b) => b.points !== 0) : [];
  const shownRows = result
    ? (fullSheet ? result.breakdown : [...scorers].sort((a, b) => b.points - a.points))
    : [];

  /** One line of colour under the score: who carried the week, and what the
   *  hits cost. Built from the same breakdown the table below renders. */
  const topLine = (() => {
    if (!result) return "";
    const best = [...result.breakdown].sort((a, b2) => b2.points - a.points)[0];
    const cap = result.breakdown.find((x) => x.captain);
    const bits: string[] = [];
    if (best) bits.push(`${nameOf(best.id)} top scored with ${best.points}`);
    if (cap && cap.id !== best?.id) bits.push(`your captain ${nameOf(cap.id)} got ${cap.points}`);
    if (entry && entry.hits > 0) bits.push(`includes −${entry.hits * 4} for extra transfers`);
    return bits.length ? `${bits.join(", ")}.` : "Your eleven starters, scored off the real matches.";
  })();

  /** The one thing this screen wants you to do, hoisted above the fold. Mirrors
   *  the detailed control further down rather than replacing it. */
  const primary: { label: string; note?: string; onClick: () => void } | null =
    seasonOver ? { label: "See where you finished", note: "Your league tables and Top Marks are final.", onClick: () => router.push("/fantasy/leagues") }
    : phase === "result" ? { label: `Start Gameweek ${gwN + 1} →`, note: "Your squad, credits and chips carry over.", onClick: advance }
    : phase === "locked" ? null
    : preseason ? { label: "Lock in my squad", note: "You can still change it until you lock.", onClick: lock }
    : !roundDone ? {
        label: entry && entry.round.answered > 0 ? `Continue round (${entry.round.answered}/11)` : "Play this week's round",
        note: "Eleven questions. Right answers earn transfers.",
        onClick: () => router.push("/fantasy/round"),
      }
    : { label: `Lock team & play gameweek ${gwN}`, note: `${squad.credits} transfer${squad.credits === 1 ? "" : "s"} in hand.`, onClick: lock };

  const PlayerTile = ({ id, benchIdx }: { id: number; benchIdx?: number }) => {
    const p = pool.get(id);
    const isCap = squad.captain === id, isVice = squad.vice === id;
    const onBench = benchIdx !== undefined;
    const label = p ? pitchName(p.name) : `#${id}`;
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => !locked && setMenuFor(menuFor === id ? null : id)} style={{
          background: onBench ? "rgba(255,255,255,0.03)" : "rgba(9,21,16,0.72)",
          border: `1px solid ${isCap || isVice ? GOLD : onBench ? "transparent" : LINE}`,
          color: onBench ? MUTED : INK,
          borderRadius: 8, padding: onBench ? "5px 2px" : "5px 4px",
          fontSize: onBench ? benchFontSize(label) : 10.5, fontWeight: 600, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          width: onBench ? "100%" : 62, minWidth: 0, lineHeight: 1.15,
        }}>
          {p && <Crest club={p.club} size={onBench ? 15 : 17} />}
          <span style={onBench ? {
            // Wrap rather than truncate: a name you can't read is worse than a
            // two-line tile, and hyphenated names break at the hyphen anyway.
            maxWidth: "100%", overflowWrap: "anywhere", textAlign: "center", lineHeight: 1.1,
          } : {
            maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {label}{isCap ? " ©" : isVice ? " ⓥ" : ""}
          </span>
          <span style={{ color: onBench ? "#5b645e" : MUTED, fontSize: 9 }}>
            {onBench ? `${benchIdx! + 1}` : `£${p?.price.toFixed(1)}`}
          </span>
        </button>
        {menuFor === id && !locked && (
          <div style={{
            // Anchored to the RIGHT for a sub: the dugout sits against the screen
            // edge, so a 170px menu opening leftwards from a 62px tile would run
            // ~100px off a 375px phone.
            position: "absolute", zIndex: 5, top: "105%",
            ...(onBench ? { right: 0 } : { left: 0 }),
            background: PANEL,
            border: `1px solid ${GOLD}`, borderRadius: 10, padding: 8, minWidth: 170,
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {benchIdx === undefined && <>
              <Btn small onClick={() => setSel({ captain: id })}>Make captain</Btn>
              <Btn small onClick={() => setSel({ vice: id })}>Make vice</Btn>
              {squad.bench.filter((b) => pool.get(b)?.pos === pool.get(id)?.pos || (pool.get(b)?.pos !== "GK" && pool.get(id)?.pos !== "GK")).map((b) => (
                <Btn small key={b} onClick={() => swapWithBench(id, b)}>↔ {nameOf(b)}</Btn>
              ))}
            </>}
            {benchIdx !== undefined && squad.xi
              .filter((s) => (pool.get(s)?.pos === "GK") === (pool.get(id)?.pos === "GK"))
              .slice(0, 6).map((s) => (
                <Btn small key={s} onClick={() => swapWithBench(s, id)}>↔ {nameOf(s)}</Btn>
              ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <main style={embedded ? EMBEDDED_PAGE : page} onClick={() => menuFor !== null && setMenuFor(null)}>
      {/* Squared backdrop — the same fixed grid the 38-0 screens use. */}
      <div className="pointer-events-none fixed inset-0 bg-grid-pattern bg-grid" style={{ opacity: 0.5 }} />
      <div className="relative">
      {!embedded && <Header right={<Btn small onClick={() => router.push("/fantasy/leagues")}>Leagues</Btn>} />}

      {/* HERO — the you-are-here, sold rather than announced. Gradient wash +
          formation art bleeding off the tile, the house pattern from the PL tab. */}
      <div className="rounded-2xl relative overflow-hidden"
        style={{
          background: `linear-gradient(150deg, ${tint(TEAL, "14")}, ${tint(TEAL, "03")})`,
          border: `1px solid ${tint(TEAL, "22")}`,
          padding: "18px 18px 18px", marginBottom: 12,
        }}>
        <FormationArt />
        <div className="relative">
          <p className="font-display tracking-widest" style={{ fontSize: 11.5, color: TEAL, marginBottom: 8 }}>
            {b.tag}
          </p>
          {/* THE SCORE IS THE HEADLINE once a gameweek lands. It used to sit
              below the pitch, 1.6 screens down, while the top of the "result"
              screen was pixel-identical to the "open" screen — you could finish
              the week unsure anything had happened. */}
          {result ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="font-display" style={{ fontSize: 64, lineHeight: 0.86, color: GOLD, letterSpacing: "-0.02em" }}>
                  {result.points}
                </span>
                <span className="font-display" style={{ fontSize: 22, color: GOLD, opacity: 0.85 }}>pts</span>
              </div>
              <p className="font-body" style={{ fontSize: 13, color: MUTED, marginTop: 8, lineHeight: 1.5, maxWidth: "92%" }}>
                {topLine}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-white" style={{ fontSize: 38, lineHeight: 0.92, letterSpacing: "-0.015em" }}>
                {b.head}
              </p>
              <p className="font-body" style={{ fontSize: 13, color: MUTED, marginTop: 8, lineHeight: 1.5, maxWidth: "88%" }}>
                {b.sub}
              </p>
            </>
          )}
        </div>
      </div>

      {/* THE WEEK'S ACTION, above the fold. The pitch sits high by design, which
          pushed every actual verb (play the round, transfers, lock) 1.6 to 2.5
          screens down — you opened the app and couldn't reach the thing you came
          to do. One primary button here, the detail still below. */}
      {primary && (
        <div style={{ marginBottom: 12 }}>
          <Btn gold glow disabled={busy} onClick={primary.onClick}>{primary.label}</Btn>
          {primary.note && (
            <p className="font-body" style={{ fontSize: 12, color: MUTED, marginTop: 7, textAlign: "center" }}>
              {primary.note}
            </p>
          )}
        </div>
      )}

      {/* The three numbers that govern every decision, given their own weight. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        {([
          { label: "Transfers", value: String(squad.credits), accent: squad.credits > 0 },
          { label: "In the bank", value: fmtM(squad.bankTenths), accent: false },
          { label: "Chips", value: String(state.chips?.held ?? 0), accent: (state.chips?.held ?? 0) > 0 },
        ] as const).map((t) => (
          <div key={t.label} className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${LINE}`, padding: "12px 10px" }}>
            <div className="font-display" style={{ fontSize: 26, lineHeight: 1, color: t.accent ? GOLD : INK }}>
              {t.value}
            </div>
            <div className="font-body" style={{ fontSize: 10.5, color: MUTED, marginTop: 5, letterSpacing: "0.04em" }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>

      {/* THE PITCH — your team in the shape you actually picture it: forwards
          attacking the top of the screen, keeper at the back, subs in a DUGOUT
          down the touchline.

          The playing area is a SQUARE. A real pitch is ~1.6:1, but drawing the
          true ratio on a phone gives you a tall thin strip whose markings can't
          line up with four rows of players — the halfway line landed under the
          defenders and the boxes sat nowhere near anybody. Square is a lie that
          reads right: with the rows spaced across it, the forwards stand in the
          attacking box, the halfway line falls between midfield and defence, and
          the keeper stands in his own six-yard box. The viewBox is square too, so
          nothing is stretched. */}
      <div className="rounded-2xl relative overflow-hidden" style={{ marginBottom: 12, border: `1px solid ${LINE}` }}>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* the eleven, on a square field */}
          <div style={{ flex: 1, minWidth: 0, position: "relative", aspectRatio: "1 / 1" }}>
            <div aria-hidden style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)",
            }} />
            <div aria-hidden style={{
              position: "absolute", inset: 0, opacity: 0.28,
              background: "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0 24px, transparent 24px 48px)",
            }} />
            <svg aria-hidden viewBox="0 0 100 100"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.2 }}>
              {/* touchlines */}
              <rect x="2" y="2" width="96" height="96" fill="none" stroke={TEAL} strokeWidth="0.7" />
              {/* halfway line + centre circle, dead centre — the rows straddle it */}
              <line x1="2" y1="50" x2="98" y2="50" stroke={TEAL} strokeWidth="0.7" />
              <circle cx="50" cy="50" r="13" fill="none" stroke={TEAL} strokeWidth="0.7" />
              <circle cx="50" cy="50" r="1.2" fill={TEAL} />
              {/* attacking box (top) — the forwards' row sits inside it */}
              <rect x="25" y="2" width="50" height="16" fill="none" stroke={TEAL} strokeWidth="0.7" />
              <rect x="37" y="2" width="26" height="7" fill="none" stroke={TEAL} strokeWidth="0.7" />
              {/* own box (bottom) — the keeper stands in the six-yard */}
              <rect x="25" y="82" width="50" height="16" fill="none" stroke={TEAL} strokeWidth="0.7" />
              <rect x="37" y="91" width="26" height="7" fill="none" stroke={TEAL} strokeWidth="0.7" />
            </svg>

            {/* Rows spread across the square so each lands on its marking. */}
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              justifyContent: "space-between", padding: "5% 4%",
            }}>
              {rows.map((row) => (
                <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "nowrap" }}>
                  {row.ids.map((id) => <PlayerTile key={id} id={id} />)}
                </div>
              ))}
            </div>
          </div>

          {/* the dugout — off the field, down the touchline */}
          <div style={{
            width: DUGOUT_W, flexShrink: 0, padding: "8px 5px",
            borderLeft: `1px dashed ${tint(TEAL, "26")}`,
            background: "rgba(0,0,0,0.28)",
            display: "flex", flexDirection: "column", gap: 5,
          }}>
            <div className="font-display tracking-widest"
              style={{ fontSize: 8, color: "#5b645e", textAlign: "center", lineHeight: 1.2 }}>
              DUGOUT
            </div>
            {squad.bench.map((id, i) => <PlayerTile key={id} id={id} benchIdx={i} />)}
          </div>
        </div>
      </div>

      {/* Secondary destinations — quiet, one line each. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([
          // Embedded, the header is gone, so Leagues joins the destinations
          // rather than floating on a row of its own.
          ...(embedded ? [{ label: "Leagues", to: "/fantasy/leagues" }] : []),
          { label: "Fantasy tips", to: "/fantasy/news" },
          { label: KNOWLEDGE_NAME, to: "/fantasy/knowledge" },
        ] as const).map((l) => (
          <div key={l.to} onClick={() => router.push(l.to)}
            className="rounded-2xl font-body"
            style={{
              flex: 1, background: PANEL, border: `1px solid ${LINE}`, padding: "11px 13px",
              fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
            }}>
            <span>{l.label}</span>
            <span style={{ color: TEAL }}>→</span>
          </div>
        ))}
      </div>

      {phase === "open" && !roundDone && !preseason && (
        <Card style={{ marginBottom: 12, border: `1px solid ${tint(TEAL, "44")}`, background: `linear-gradient(150deg, ${tint(TEAL, "0e")}, ${PANEL})` }}>
          <div className="font-display" style={{ fontSize: 22, lineHeight: 1.05, marginBottom: 6 }}>
            THIS WEEK&apos;S ROUND IS OPEN
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
            Round done: <b style={{ color: GOLD }}>{entry.round.correct}/11</b> → {entry.round.creditsEarned} transfer
            credit{entry.round.creditsEarned === 1 ? "" : "s"} earned
          </span>
        </Card>
      )}

      {/* Chips — only once the gameweek is live and your squad is committed;
          pre-season there's nothing yet to spend a chip protecting. */}
      {phase === "open" && !preseason && chips && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>Chips</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 4px", lineHeight: 1.45 }}>
            {chips.held} chip{chips.held === 1 ? "" : "s"} held · {chips.progress} of {chips.gameweeksPerChip} gameweeks
            played toward the next one
          </p>
          {chips.wildcards > 0 && (
            <p style={{ fontSize: 12.5, color: GOLD, margin: "0 0 8px" }}>
              1 wildcard held. Expires at the GW{chips.wildcardHalf === 1 ? HALF_SEASON_GW : state.season.total} deadline
            </p>
          )}
          {chips.playedThisGw ? (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
              background: "#233B2C", border: `1px solid ${GOLD}`, borderRadius: 10, padding: "9px 12px", marginTop: 6,
            }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: GOLD }}>
                {CHIP_LABEL[chips.playedThisGw]} played this gameweek
              </span>
              <Btn small disabled={busy} onClick={undoChip}>Undo</Btn>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
              {CHIP_META.map((c) => {
                const held = c.key === "wildcard" ? chips.wildcards > 0 : chips.held > 0;
                const playable = held && !c.comingSoon;
                return (
                  <button key={c.key} disabled={!playable || busy} onClick={() => playChipAction(c.key)} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    padding: "9px 12px", borderRadius: 10, textAlign: "left",
                    background: PANEL, border: `1px solid ${LINE}`, color: playable ? INK : MUTED,
                    cursor: playable ? "pointer" : "default", opacity: playable ? 1 : 0.55,
                  }}>
                    <span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, display: "block" }}>{c.label}</span>
                      <span style={{ fontSize: 11.5 }}>{c.comingSoon ? "Coming soon" : c.blurb}</span>
                    </span>
                    {!c.comingSoon && (
                      <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{held ? "Play" : "None held"}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Chip confirm, in the app's own voice. Anchored bottom on a phone so the
          answer is under your thumb, not in the middle of the screen. */}
      {confirmChip && chips && (
        <div onClick={() => setConfirmChip(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 40, background: "rgba(4,8,6,0.72)",
            display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 14,
          }}>
          <div onClick={(e) => e.stopPropagation()} className="rounded-2xl"
            style={{ background: PANEL, border: `1px solid ${tint(TEAL, "44")}`, padding: 18, width: "100%", maxWidth: 480 }}>
            <div className="font-display" style={{ fontSize: 22, lineHeight: 1.05, marginBottom: 6 }}>
              Play {CHIP_LABEL[confirmChip]}?
            </div>
            <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "0 0 6px", lineHeight: 1.45 }}>
              {CHIP_META.find((c) => c.key === confirmChip)?.blurb}. It applies to gameweek {gwN} and
              can be taken back until the matches start.
            </p>
            <p className="font-body" style={{ fontSize: 12.5, color: GOLD, margin: "0 0 14px" }}>
              You hold {confirmChip === "wildcard" ? chips.wildcards : chips.held}{" "}
              {confirmChip === "wildcard"
                ? `wildcard${chips.wildcards === 1 ? "" : "s"}`
                : `chip${chips.held === 1 ? "" : "s"}`}.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><Btn onClick={() => setConfirmChip(null)}>Not yet</Btn></div>
              <div style={{ flex: 1 }}><Btn gold disabled={busy} onClick={() => commitChip(confirmChip)}>Play it</Btn></div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <Card style={{ marginBottom: 12, border: `1px solid ${GOLD}` }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.1em", color: GOLD, fontWeight: 700 }}>
              WHERE THE POINTS CAME FROM
            </div>
            <button onClick={() => setFullSheet((v) => !v)}
              className="font-body"
              style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 }}>
              {fullSheet ? "Show less" : "Show all 11"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: MUTED, margin: "4px 0 10px" }}>
            {fullSheet
              ? "Every starter, including the ones who didn't play."
              : `${scorers.length} of your 11 scored.`}{entry!.hits > 0
              ? ` Includes −${entry!.hits * 4} for ${entry!.hits} extra transfer${entry!.hits === 1 ? "" : "s"}.`
              : ""}
          </p>
          {/* Point drivers as columns — so you can scan WHY a player scored, not
              just what he scored. Extras (saves, cards, conceded) sit under the
              name; they'd need six more columns nobody could read on a phone. */}
          <div style={{ overflowX: "auto", margin: "0 -4px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>
                  <th style={{ textAlign: "left", padding: "0 4px 6px", fontWeight: 600 }}>PLAYER</th>
                  {(["MIN", "G", "A", "CS"] as const).map((h) => (
                    <th key={h} style={{ textAlign: "center", padding: "0 4px 6px", fontWeight: 600 }}>{h}</th>
                  ))}
                  <th style={{ textAlign: "right", padding: "0 4px 6px", fontWeight: 600 }}>PTS</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((b) => {
                  const p = pool.get(b.id);
                  const pos = p?.pos ?? "MID";
                  const f = b.facts;
                  const played = !!f && f.minutes > 0;
                  const extras = extrasLine(pos, f);
                  const csEligible = pos === "GK" || pos === "DEF" || pos === "MID";
                  const cell: CSSProperties = {
                    textAlign: "center", padding: "7px 4px", borderTop: `1px solid ${LINE}`,
                    color: played ? INK : MUTED, fontVariantNumeric: "tabular-nums",
                  };
                  return (
                    <tr key={b.id}>
                      <td style={{ padding: "7px 4px", borderTop: `1px solid ${LINE}`, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {p && <Crest club={p.club} size={16} />}
                          <span style={{ fontWeight: 600, fontSize: 13 }}>
                            {nameOf(b.id)}
                            {b.captain && <span style={{ color: GOLD }} title="Captain, points doubled"> ©</span>}
                            {b.subbedIn && <span style={{ color: GOLD }} title="Auto-subbed on"> ↑</span>}
                          </span>
                        </span>
                        {(extras || !played) && (
                          <span style={{ display: "block", fontSize: 11, color: MUTED, marginTop: 2, paddingLeft: 22 }}>
                            {played ? extras : "Didn't play"}
                          </span>
                        )}
                      </td>
                      <td style={cell}>{played ? f!.minutes : "–"}</td>
                      <td style={{ ...cell, color: played && f!.goals ? GOLD : cell.color, fontWeight: played && f!.goals ? 700 : 400 }}>
                        {played ? (f!.goals || "–") : "–"}
                      </td>
                      <td style={{ ...cell, color: played && f!.assists ? GOLD : cell.color, fontWeight: played && f!.assists ? 700 : 400 }}>
                        {played ? (f!.assists || "–") : "–"}
                      </td>
                      <td style={cell}>{played && csEligible ? (f!.cleanSheet ? "✓" : "–") : "–"}</td>
                      <td style={{
                        textAlign: "right", padding: "7px 4px", borderTop: `1px solid ${LINE}`,
                        fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: b.points >= 10 ? GOLD : INK,
                      }}>{b.points}</td>
                    </tr>
                  );
                })}
                {entry!.hits > 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "7px 4px", borderTop: `1px solid ${LINE}`, color: "#E08A6B", fontSize: 12.5 }}>
                      {entry!.hits} extra transfer{entry!.hits === 1 ? "" : "s"}
                    </td>
                    <td style={{ textAlign: "right", padding: "7px 4px", borderTop: `1px solid ${LINE}`, color: "#E08A6B", fontWeight: 700 }}>
                      −{entry!.hits * 4}
                    </td>
                  </tr>
                )}
                <tr>
                  <td colSpan={5} style={{ padding: "9px 4px", borderTop: `1.5px solid ${GOLD}`, fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: "right", padding: "9px 4px", borderTop: `1.5px solid ${GOLD}`, fontWeight: 700, color: GOLD }}>
                    {result.points}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {notice && <p style={{ fontSize: 12.5, color: GOLD, margin: "10px 0 0" }}>{notice}</p>}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Btn disabled={busy} onClick={shareResult}>Share this gameweek</Btn>
            {gwN < total && (
              <Btn gold disabled={busy} onClick={advance}>
                {busy ? "…" : `Start Gameweek ${gwN + 1} →`}
              </Btn>
            )}
          </div>
        </Card>
      )}

      {/* Leagues — a nudge into leagues, or a shortcut back once you're already in one */}
      {/* Wrapped rather than clicking the Card itself: Card takes no onClick, and an
          inner-div handler leaves its 14px padding dead to the tap. */}
      <div onClick={() => router.push("/fantasy/leagues")} style={{ cursor: "pointer" }}>
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
            {hasLeagues ? "Your leagues" : "Play with friends"}
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>
            {hasLeagues
              ? "See how you stack up this gameweek and this month."
              : "Create a league, share the code, see who really knows football."}
          </p>
        </Card>
      </div>

      {/* The knowledge board — the quiz's own competition, win or lose at the weekend */}
      <div onClick={() => router.push("/fantasy/knowledge")} style={{ cursor: "pointer" }}>
        <Card style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{KNOWLEDGE_NAME}</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>
            The quiz table. Right answers count here even when your team lets you down.
          </p>
        </Card>
      </div>


      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}

      {!locked && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!preseason && (
          <Btn onClick={() => router.push("/fantasy/transfers")}>
            {chips?.playedThisGw === "wildcard"
              ? "Transfers (wildcard active, all free)"
              : `Transfers (${squad.credits} free · extras −4 pts)`}
          </Btn>
        )}
        <Btn gold disabled={busy} onClick={lock}>
          {busy ? "Locking…" : `Lock team & play gameweek ${state.gw.gw}`}
        </Btn>
        <p style={{ fontSize: 11.5, color: MUTED, margin: 0, lineHeight: 1.4 }}>
          Replay mode: this scores your XI against the real results of gameweek {state.gw.gw},
          {" "}{state.gw.season}. In the live season this happens automatically at the deadline.
        </p>
      </div>}
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

      {state.canRebuild && (
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
          <button onClick={() => router.push("/fantasy/build")} style={{
            fontSize: 12.5, color: MUTED, background: "none", border: "none",
            cursor: "pointer", textDecoration: "underline", padding: 0,
          }}>
            Edit my squad. Swap any players before the season starts
          </button>
        </div>
      )}
      </div>
    </main>
  );
}
