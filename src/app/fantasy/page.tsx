"use client";
/** Squad home — XI + bench, captain/vice, credits, lock, result. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, factLine, fmtM, GOLD, Header, INK, LINE, MUTED, page, PANEL,
  type ClientPoolPlayer, type FantasyState, type Pos,
} from "@/components/fantasy/shared";

type Result = NonNullable<NonNullable<FantasyState["entry"]>["result"]>;

export default function FantasyHub() {
  const router = useRouter();
  const [state, setState] = useState<FantasyState | null>(null);
  const [pool, setPool] = useState<Map<number, ClientPoolPlayer>>(new Map());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

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

  const BANNER: Record<typeof phase, { tag: string; head: string; sub: string }> = {
    open: { tag: "GAMEWEEK OPEN", head: `Gameweek ${state.gw.gw} is open`,
      sub: "Play your round, make transfers, set your team — then lock it in. In the live game this closes at the Saturday deadline." },
    locked: { tag: "LOCKED", head: `Gameweek ${state.gw.gw} is locked`,
      sub: "Your team is set and the matches are playing. Nothing changes now until the points land." },
    result: { tag: "GAMEWEEK DONE", head: `Gameweek ${state.gw.gw} result`,
      sub: "The gameweek is scored — here's exactly how your team did. Next week, a fresh round opens." },
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
      </>} />

      {/* You-are-here phase banner */}
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderLeft: `3px solid ${GOLD}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: GOLD, fontWeight: 700 }}>{b.tag}</div>
        <div style={{ fontSize: 16, fontWeight: 700, margin: "2px 0 4px" }}>{b.head}</div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>{b.sub}</p>
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

      {phase === "open" && !roundDone && (
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.breakdown.map((b) => {
              const p = pool.get(b.id);
              return (
                <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
                    {p && <Crest club={p.club} size={18} />}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                        {nameOf(b.id)}{b.captain ? " ©" : ""}{b.subbedIn ? " ↑" : ""}
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: MUTED, lineHeight: 1.35 }}>
                        {[factLine((p?.pos ?? "MID"), b.facts), b.captain ? "captain ×2" : "", b.subbedIn ? "auto-subbed on" : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </span>
                  <b style={{ fontSize: 14, color: b.points >= 12 ? GOLD : INK, whiteSpace: "nowrap" }}>{b.points} pts</b>
                </div>
              );
            })}
          </div>
        </Card>
      )}

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
        <Btn onClick={() => router.push("/fantasy/transfers")}>
          Transfers ({squad.credits} free · extras −4 pts)
        </Btn>
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
