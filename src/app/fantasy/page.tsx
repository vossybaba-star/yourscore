"use client";
/** Squad home — XI + bench, captain/vice, credits, lock, result. */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, extrasLine, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL,
  type ChipName, type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { HALF_SEASON_GW } from "@/lib/fantasy/engine";

type Result = NonNullable<NonNullable<FantasyState["entry"]>["result"]>;

// Fungible tokens (triple_captain, bench_boost, insight, second_chance) all
// spend from the same held count; the wildcard runs on its own separate track.
// Insight and Second Chance are round mechanics that don't exist yet — shown so
// the full chip set is legible, but never playable.
const CHIP_META: { key: ChipName; label: string; blurb: string; comingSoon?: boolean }[] = [
  { key: "wildcard", label: "Wildcard", blurb: "Unlimited free transfers this gameweek" },
  { key: "triple_captain", label: "Triple Captain", blurb: "Your captain's points count ×3, not ×2" },
  { key: "bench_boost", label: "Bench Boost", blurb: "All 15 players score, bench included" },
  { key: "insight", label: "Insight", blurb: "Coming soon", comingSoon: true },
  { key: "second_chance", label: "Second Chance", blurb: "Coming soon", comingSoon: true },
];
const CHIP_LABEL: Record<ChipName, string> = Object.fromEntries(CHIP_META.map((c) => [c.key, c.label])) as Record<ChipName, string>;

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

export default function FantasyHub() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<Map<number, ClientPoolPlayer>>(new Map());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [hasLeagues, setHasLeagues] = useState(false);

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
    return (["GK", "DEF", "MID", "FWD"] as Pos[]).map((pos) => ({
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

  // Playing a chip is the biggest call of the week — confirm before spending it.
  const playChipAction = async (chip: ChipName, label: string) => {
    if (!state?.chips) return;
    const count = chip === "wildcard" ? state.chips.wildcards : state.chips.held;
    const noun = chip === "wildcard" ? "wildcard" : `chip${count === 1 ? "" : "s"}`;
    if (!window.confirm(`Play ${label} this gameweek? You hold ${count} ${noun}.`)) return;
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


  if (needsAuth) return (
    <main style={page}>
      <Header />
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Sign in to play</div>
        <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
          Your squad is saved to your YourScore account, so you&apos;ll need to be signed in.
        </p>
        <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy")}>Sign in</Btn>
      </Card>
    </main>
  );
  if (err) return (
    <main style={page}>
      <Header />
      <Card style={{ marginTop: 12 }}><p style={{ color: "#E08A6B", fontSize: 13.5, margin: 0 }}>{err}</p></Card>
      <div style={{ marginTop: 10 }}><Btn onClick={() => { setErr(null); refresh(); }}>Try again</Btn></div>
    </main>
  );
  if (!state || !squad) return <main style={page}><Header /><p style={{ color: MUTED }}>Loading…</p></main>;
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

  const gwN = state.gw.gw, total = state.season.total;
  const preseason = state.canRebuild && !roundDone && !locked; // never locked, week not started
  const seasonPos = `Week ${gwN} of ${total}`;
  const BANNER: Record<typeof phase, { tag: string; head: string; sub: string }> = {
    open: preseason
      ? { tag: `PRE-SEASON · ${seasonPos.toUpperCase()}`, head: gwN === 1 ? "The season kicks off here" : `Gameweek ${gwN} is open`,
          sub: "Your squad isn't committed yet — build and edit it freely, then lock it in for the gameweek. From next gameweek on, your knowledge round earns the transfers to improve it." }
      : { tag: `GAMEWEEK OPEN · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is open`,
          sub: "Play your round, make transfers, set your team — then lock it in. In the live game this closes at the Saturday deadline." },
    locked: { tag: `LOCKED · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} is locked`,
      sub: "Your team is set and the matches are playing. Nothing changes now until the points land." },
    result: { tag: `GAMEWEEK DONE · ${seasonPos.toUpperCase()}`, head: `Gameweek ${gwN} result`,
      sub: gwN < total ? "Scored — here's how your team did. Move on to the next gameweek when you're ready; your squad and credits carry over."
        : "That's the last gameweek of the demo season — here's your final result." },
  };
  const b = BANNER[phase];

  const PlayerTile = ({ id, benchIdx }: { id: number; benchIdx?: number }) => {
    const p = pool.get(id);
    const isCap = squad.captain === id, isVice = squad.vice === id;
    return (
      <div style={{ position: "relative" }}>
        <button onClick={() => !locked && setMenuFor(menuFor === id ? null : id)} style={{
          background: PANEL, border: `1px solid ${isCap || isVice ? GOLD : LINE}`, color: INK,
          borderRadius: 10, padding: "8px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 74,
        }}>
          {p && <Crest club={p.club} size={20} />}
          <span>{p?.name ?? `#${id}`}{isCap ? " ©" : isVice ? " ⓥ" : ""}</span>
          <span style={{ color: MUTED, fontSize: 11 }}>
            {benchIdx !== undefined ? `Bench ${benchIdx + 1}` : `£${p?.price.toFixed(1)}`}
          </span>
        </button>
        {menuFor === id && !locked && (
          <div style={{
            position: "absolute", zIndex: 5, top: "105%", left: 0, background: PANEL,
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
    <main style={page} onClick={() => menuFor !== null && setMenuFor(null)}>
      <Header right={<>
        <Chip>GW {state.gw.gw} · {state.gw.season}</Chip>
        <Chip gold>{squad.credits} credit{squad.credits === 1 ? "" : "s"}</Chip>
        <Chip>{fmtM(squad.bankTenths)} bank</Chip>
        <Btn small onClick={() => router.push("/fantasy/leagues")}>Leagues</Btn>
      </>} />

      {/* You-are-here phase banner */}
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: GOLD, fontWeight: 700 }}>{b.tag}</div>
        <div style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 4px" }}>{b.head}</div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>{b.sub}</p>
      </div>

      {/* News & insights — team news, form and tips for the week */}
      <div
        onClick={() => router.push("/fantasy/news")}
        style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>News &amp; insights</span>
        <span style={{ fontSize: 12, color: MUTED }}>team news · form · tips →</span>
      </div>

      {/* Demo stepper — walk the weekly journey (replay/prototype only) */}
      {isDemo && (
        <div style={{ marginBottom: 14 }}>
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
                cursor: "pointer", background: active ? GOLD : PANEL, color: active ? "#2A1F00" : INK,
                border: `1px solid ${active ? GOLD : LINE}`,
              }}>{label}</button>
            ))}
          </div>
          <p style={{ fontSize: 10.5, color: MUTED, margin: "5px 0 0", lineHeight: 1.4 }}>
            Prototype control. In the real game the season moves you through these on its own; the
            live &ldquo;locked, matches playing&rdquo; stage sits between open and result.
          </p>
        </div>
      )}

      {phase === "open" && !roundDone && !preseason && (
        <Card style={{ marginBottom: 12, border: `1px solid ${GOLD}` }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>
            This week&apos;s knowledge round is open
          </div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 10px", lineHeight: 1.45 }}>
            Eleven questions. Right answers earn the transfer credits that improve this squad.
          </p>
          <Btn gold onClick={() => router.push("/fantasy/round")}>
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
              1 wildcard held — expires at the GW{chips.wildcardHalf === 1 ? HALF_SEASON_GW : state.season.total} deadline
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
                  <button key={c.key} disabled={!playable || busy} onClick={() => playChipAction(c.key, c.label)} style={{
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

      {result && (
        <Card style={{ marginBottom: 12, border: `1px solid ${GOLD}` }}>
          <div style={{ fontSize: 12, letterSpacing: "0.1em", color: GOLD, fontWeight: 700 }}>
            YOUR SCORE
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, margin: "2px 0 2px" }}>{result.points} pts</div>
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 10px" }}>
            Your 11 starters, scored off the real matches.{entry!.hits > 0
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
                {result.breakdown.map((b) => {
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
                            {b.captain && <span style={{ color: GOLD }} title="Captain — points doubled"> ©</span>}
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
          {gwN < total && (
            <div style={{ marginTop: 14 }}>
              <Btn gold disabled={busy} onClick={advance}>
                {busy ? "…" : `Start Gameweek ${gwN + 1} →`}
              </Btn>
            </div>
          )}
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

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        {rows.map((row) => (
          <div key={row.pos}>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 4 }}>{row.pos}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {row.ids.map((id) => <PlayerTile key={id} id={id} />)}
            </div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 4 }}>BENCH (auto-subs in order)</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {squad.bench.map((id, i) => <PlayerTile key={id} id={id} benchIdx={i} />)}
          </div>
        </div>
      </div>

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 10px" }}>{err}</p>}

      {!locked && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!preseason && (
          <Btn onClick={() => router.push("/fantasy/transfers")}>
            {chips?.playedThisGw === "wildcard"
              ? "Transfers (wildcard active — all free)"
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
      {locked && !result && <p style={{ color: MUTED, fontSize: 13 }}>Locked — scoring…</p>}

      {state.canRebuild && (
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
          <button onClick={() => router.push("/fantasy/build")} style={{
            fontSize: 12.5, color: MUTED, background: "none", border: "none",
            cursor: "pointer", textDecoration: "underline", padding: 0,
          }}>
            Edit my squad — swap any players before the season starts
          </button>
        </div>
      )}
    </main>
  );
}
