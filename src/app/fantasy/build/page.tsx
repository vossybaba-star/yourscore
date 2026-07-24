"use client";
/** Squad builder — pick your 15 once (2 GK / 5 DEF / 5 MID / 3 FWD, £100m, max 3/club). */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, Crest, Deadline, DoubtFlag, EMPTY_CONTEXT, FixtureRun, fmtM, GOLD, Header,
  INK, LINE, MUTED, page, PANEL, PITCH, POS_ORDER, QUOTA,
  type ClientPoolPlayer, type FantasyContext, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";

const BUDGET = 1000;
/** Picks survive leaving the screen and reloading it. Fifteen taps through a
 *  500-player list is real work, and the old screen threw it away on any exit. */
const DRAFT_KEY = "ys-fantasy-draft";

export default function BuildPage() {
  const router = useRouter();
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [tab, setTab] = useState<Pos>("GK");
  const [picked, setPicked] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false); // rebuilding an existing squad
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
    // Fixtures + doubts. Failure-soft: without them the screen is the old
    // price-only builder, which is worse but not broken.
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (c) setCtx(c); })
      .catch(() => {});
    // Pre-load an existing squad so a pre-season rebuild EDITS it (never a blank slate).
    api<FantasyState>("state").then((s) => {
      setDeadline(s.gw.deadline);
      if (!s.squad) {
        // No squad yet — pick up an unfinished draft rather than starting over.
        try {
          const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "[]") as number[];
          if (Array.isArray(saved) && saved.length) setPicked(saved.filter((n) => Number.isInteger(n)));
        } catch { /* corrupt draft — start clean */ }
        setRestored(true);
        return;
      }
      if (!s.canRebuild) { router.replace("/fantasy"); return; } // season started → transfers only
      setEditing(true);
      setPicked(s.squad.picks.map((p) => p.id));
      setRestored(true);
    }).catch(() => setRestored(true));
  }, [router]);

  // Only start writing once we know whether there was a squad to load, or the
  // first render would overwrite a saved draft with an empty one.
  useEffect(() => {
    if (!restored || editing) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(picked)); } catch { /* private mode */ }
  }, [picked, restored, editing]);

  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const picks = picked.map((id) => byId.get(id)!).filter(Boolean);
  const spent = Math.round(picks.reduce((s, p) => s + p.price * 10, 0));
  const bank = BUDGET - spent;
  const posCount = (pos: Pos) => picks.filter((p) => p.pos === pos).length;
  const clubCount = (clubId: number) => picks.filter((p) => p.clubId === clubId).length;
  const complete = POS_ORDER.every((pos) => posCount(pos) === QUOTA[pos]);

  // Why a player can't be added (null = addable). Drives an explicit message
  // rather than a silently-greyed row — the founder hit the club cap blind.
  const blockReason = (p: ClientPoolPlayer): string | null => {
    if (posCount(p.pos) >= QUOTA[p.pos]) return `You've got all ${QUOTA[p.pos]} ${p.pos}. Remove one first.`;
    if (clubCount(p.clubId) >= 3) return `Max 3 players from ${p.club}. You already have 3.`;
    if (spent + Math.round(p.price * 10) > BUDGET) return `Not enough budget. ${fmtM(bank)} left.`;
    return null;
  };
  const clubFull = (clubId: number) => clubCount(clubId) >= 3;

  const toggle = (p: ClientPoolPlayer) => {
    if (picked.includes(p.id)) { setPicked(picked.filter((x) => x !== p.id)); setNotice(null); return; }
    const reason = blockReason(p);
    if (reason) { setNotice(reason); return; }
    setNotice(null); setPicked([...picked, p.id]);
  };

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await api("squad", { pickIds: picked });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
      router.push("/fantasy");
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  /** The list for the open tab. No cap: the old `.slice(0, 60)` against a
   *  price-descending sort put 166 midfielders and 115 defenders out of reach —
   *  nothing under £6.0m in midfield existed as far as the screen was concerned,
   *  so a budget enabler simply could not be picked. Search matches name or club,
   *  because with 226 midfielders scrolling is not a way to find anybody. */
  const needle = q.trim().toLowerCase();
  const listed = useMemo(() => {
    const inTab = pool.filter((p) => p.pos === tab);
    if (!needle) return inTab;
    return inTab.filter((p) =>
      p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle));
  }, [pool, tab, needle]);

  return (
    <>
    <main data-fantasy style={page}>
      <Header
        exit={{ label: "Fantasy", onClick: () => router.push("/fantasy") }}
        right={<Chip gold>{fmtM(bank)} left</Chip>}
      />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>
        {editing ? "Rebuild your squad" : "Build your squad"}
      </h1>
      {/* The rules as a list, not a wall. Four constraints ran together in one
          paragraph and had to be re-read to be counted, on the screen where you
          are actively counting against every one of them. */}
      <ul style={{
        fontSize: 13.5, color: MUTED, lineHeight: 1.5,
        margin: "0 0 14px", paddingLeft: 18,
        // Tailwind's preflight sets list-style:none globally, so the markers have
        // to be asked for by name or this renders as four indented sentences.
        listStyleType: "disc", listStylePosition: "outside",
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {(editing
          ? [
            <>Change as many players as you like</>,
            <>Free to rebuild until the season starts</>,
            <>Once your first gameweek locks, you change your team with transfers instead</>,
          ]
          : [
            <><b style={{ color: INK, fontWeight: 600 }}>15 players</b>: 2 keepers, 5 defenders, 5 midfielders, 3 forwards</>,
            <>Maximum <b style={{ color: INK, fontWeight: 600 }}>3</b> from any one club</>,
            <><b style={{ color: INK, fontWeight: 600 }}>£100.0m</b> to spend, the same as everyone else</>,
            <>This is your team all season. Your knowledge round earns the transfers that improve it</>,
          ]
        ).map((line, i) => <li key={i}>{line}</li>)}
      </ul>

      <Deadline iso={deadline} compact />

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {POS_ORDER.map((pos) => (
          <button key={pos} onClick={() => setTab(pos)} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontWeight: 700, fontSize: 13,
            background: tab === pos ? GOLD : PANEL, color: tab === pos ? "#2A1F00" : INK,
            border: `1px solid ${tab === pos ? GOLD : LINE}`, cursor: "pointer",
          }}>
            {pos} {posCount(pos)}/{QUOTA[pos]}
          </button>
        ))}
      </div>

      {picks.length > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {picks.map((p) => (
              <button key={p.id} onClick={() => toggle(p)} style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 12, padding: "5px 9px", borderRadius: 8, cursor: "pointer",
                background: "transparent", color: INK, border: `1px solid ${LINE}`,
              }}>
                <Crest club={p.club} size={14} /> {p.name} · £{p.price.toFixed(1)} ✕
              </button>
            ))}
          </div>
        </Card>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${tab === "GK" ? "keepers" : tab === "DEF" ? "defenders" : tab === "MID" ? "midfielders" : "forwards"} by name or club`}
        aria-label="Search players"
        style={{
          width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
          fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`,
          outline: "none", marginBottom: 8,
        }}
      />
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8, lineHeight: 1.45 }}>
        {listed.length} {listed.length === 1 ? "player" : "players"}
        {needle ? ` matching "${q.trim()}"` : ` available`}
        {Object.keys(ctx.fixtures).length > 0 && (
          <>. Next three fixtures shown, capitals for home.</>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {!listed.length && (
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>
            Nobody by that name in this position. Check the spelling, or try their club.
          </p>
        )}
        {listed.map((p) => {
          const inSquad = picked.includes(p.id);
          const blocked = !inSquad && blockReason(p) !== null;
          const capped = !inSquad && clubFull(p.clubId);
          return (
            // Kept tappable even when blocked so the tap can EXPLAIN why (club cap etc.)
            <button key={p.id} onClick={() => toggle(p)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                background: inSquad ? "#233B2C" : PANEL, color: INK,
                border: `1px solid ${inSquad ? GOLD : LINE}`, opacity: blocked ? 0.5 : 1,
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, minWidth: 0 }}>
                <Crest club={p.club} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{p.name}</span>
                    <DoubtFlag reason={ctx.doubts[p.id]} />
                    {capped && <span style={{ fontSize: 10.5, color: "#C9884A", border: "1px solid #C9884A", borderRadius: 6, padding: "1px 5px" }}>3/3</span>}
                  </span>
                  {/* The two facts a squad pick actually turns on, finally on the
                      row where the pick happens: who they play next, and whether
                      anyone thinks they'll be in the side. */}
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 400 }}>{p.club}</span>
                    <FixtureRun cells={ctx.fixtures[p.clubId]} />
                  </span>
                </span>
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: inSquad ? GOLD : INK, flexShrink: 0 }}>
                £{p.price.toFixed(1)}m
              </span>
            </button>
          );
        })}
      </div>

      {/* Sticky footer — Confirm is always reachable, no scroll to the bottom of the list. */}
      <div style={{
        position: "sticky", bottom: 0, marginTop: 4,
        background: `linear-gradient(to top, ${PITCH} 72%, transparent)`,
        paddingTop: 16, paddingBottom: 8,
      }}>
        {notice && <p style={{ color: "#C9884A", fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>{notice}</p>}
        {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 8px" }}>{err}</p>}
        <Btn gold disabled={!complete || busy} onClick={submit}>
          {complete ? (busy ? "Saving…" : editing ? "Save my squad" : "Confirm my squad") : `Pick ${15 - picks.length} more`}
        </Btn>
        <p style={{ fontSize: 11.5, color: MUTED, margin: "7px 0 0", lineHeight: 1.4, textAlign: "center" }}>
          We&apos;ll pick your starting XI, captain and bench order. Change any of it next.
        </p>
      </div>
    </main>
      <BottomNav />
    </>
  );
}
