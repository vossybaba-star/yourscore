"use client";
/** Squad builder — pick your 15 once (2 GK / 5 DEF / 5 MID / 3 FWD, £100m, max 3/club).
 *
 * Two connected views (founder redesign, 25 Jul):
 *   Squad  — the team forming on a pitch, a slot per squad place, progress and
 *            budget in view. You can SEE what you're building, not just a counter.
 *   Add    — the player list (portraits, fixtures, doubts, club-cap), filtered to
 *            the position you tapped an empty slot for.
 * Tapping an empty slot opens Add for that line; picking a player drops it back
 * onto the pitch. All the original logic (draft persistence, editing an existing
 * squad, club-cap explanations, budget) is unchanged underneath.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Chip, Crest, Deadline, DoubtFlag, EMPTY_CONTEXT, FixtureRun, fmtM, GOLD, Header,
  INK, LINE, MUTED, page, PANEL, PITCH, POS_ORDER, QUOTA, TEAL, tint,
  type ClientPoolPlayer, type FantasyContext, type FantasyState, type Pos,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import { pitchName, type BoardPlayer } from "@/lib/fantasy/board";
import { PRESETS, solvePreset } from "@/lib/fantasy/presets";
import { faceFor } from "@/lib/fantasy/faces";
import { BottomNav } from "@/components/ui/BottomNav";
import { trackFantasySquad } from "@/lib/analytics/trackGame";
import { useUser } from "@/hooks/useUser";

const BUDGET = 1000;
const DRAFT_KEY = "ys-fantasy-draft";
const POS_WORD: Record<Pos, string> = { GK: "keepers", DEF: "defenders", MID: "midfielders", FWD: "forwards" };

export default function BuildPage() {
  const router = useRouter();
  const { user } = useUser();
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [view, setView] = useState<"squad" | "add">("squad");
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
  const [anchors, setAnchors] = useState<number[]>([]);        // up to 3 core players
  const [activePreset, setActivePreset] = useState<string | null>(null); // loaded shape, for flip highlight
  const [lastPreset, setLastPreset] = useState<string | null>(null);     // last shape loaded, for re-solving after a hand edit
  const [startFastCollapsed, setStartFastCollapsed] = useState(false); // tucked away, never gone
  const [picking, setPicking] = useState<"squad" | "anchor">("squad"); // what the Add list taps into

  useEffect(() => {
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (c) setCtx(c); })
      .catch(() => {});
    // Restore an in-progress team from the local draft (2 GK / 5 DEF / …). Used by
    // both a signed-in newcomer and a signed-out guest, so a team survives a reload
    // and the build → sign-in → save round trip.
    const restoreDraft = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "[]") as number[];
        if (Array.isArray(saved) && saved.length) setPicked(saved.filter((n) => Number.isInteger(n)));
      } catch { /* corrupt draft — start clean */ }
    };
    api<FantasyState>("state").then((s) => {
      setDeadline(s.gw.deadline);
      if (!s.squad) {
        restoreDraft();
        setRestored(true);
        return;
      }
      if (!s.canRebuild) { router.replace("/fantasy/squad"); return; } // season started → transfers only
      setEditing(true);
      setPicked(s.squad.picks.map((p) => p.id));
      setRestored(true);
    }).catch(() => {
      // Signed-out guest: no server state, just their local draft.
      restoreDraft();
      setRestored(true);
    });
  }, [router]);

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
  const clubFull = (clubId: number) => clubCount(clubId) >= 3;

  // The picks mapped onto the shared SquadBoard's shape. Derived from `picked`,
  // so every add/remove re-renders the board, budget and progress together.
  const boardPlayers: BoardPlayer[] = picks.map((p) => ({
    id: p.id, name: p.name, label: pitchName(p.name), pos: p.pos,
    club: p.club, avatarUrl: p.avatarUrl ?? faceFor(p.name), price: p.price,
  }));

  const blockReason = (p: ClientPoolPlayer): string | null => {
    if (posCount(p.pos) >= QUOTA[p.pos]) return `You've got all ${QUOTA[p.pos]} ${p.pos}. Remove one first.`;
    if (clubCount(p.clubId) >= 3) return `Max 3 players from ${p.club}. You already have 3.`;
    if (spent + Math.round(p.price * 10) > BUDGET) return `Not enough budget. ${fmtM(bank)} left.`;
    return null;
  };

  /** A hand edit means the squad no longer matches the loaded shape, so drop the
   *  active highlight and tuck the strip away. It is never gone — the "Start fast"
   *  header reopens it — so the options can always be worked back to. */
  const noteManualEdit = () => { if (activePreset) { setActivePreset(null); setStartFastCollapsed(true); } };

  const remove = (id: number) => {
    setPicked(picked.filter((x) => x !== id));
    if (anchors.includes(id)) setAnchors(anchors.filter((x) => x !== id)); // dropping a shirt drops the anchor too
    setNotice(null); noteManualEdit();
  };
  const toggle = (p: ClientPoolPlayer) => {
    if (picked.includes(p.id)) { remove(p.id); return; }
    const reason = blockReason(p);
    if (reason) { setNotice(reason); return; }
    setNotice(null); setPicked([...picked, p.id]); noteManualEdit();
  };

  const asPresetPool = () => pool.map((p) => ({
    id: p.id, pos: p.pos, clubId: p.clubId, priceTenths: Math.round(p.price * 10),
  }));

  /** Load a preset shape, solved around the current core players. This is the one
   *  entry point for both a first load and a flip — the anchors are passed in so a
   *  flip keeps them and just re-fills the other slots. */
  const applyPresetWith = (shapeId: string, anchorList: number[]) => {
    const shape = PRESETS.find((s) => s.id === shapeId);
    if (!shape || !pool.length) return;
    const ids = solvePreset(shape, asPresetPool(), undefined, anchorList);
    if (ids.length !== 15) {
      setNotice("Those core players don't leave enough for a legal squad. Swap one out.");
      return;
    }
    setPicked(ids); setActivePreset(shapeId); setLastPreset(shapeId);
    setNotice(`Loaded ${shape.name}${anchorList.length ? ` around your ${anchorList.length} core` : ""}. Flip or tweak, then confirm.`);
  };
  const applyPreset = (shapeId: string) => applyPresetWith(shapeId, anchors);

  /** A core player is only bounded by ANCHOR-level rules, never the full-squad
   *  ones: the shape re-solves around them, so "that line is already full" never
   *  applies. We check the anchor count for the position, the 3-per-club cap among
   *  anchors, and that a legal 15 can still be built around the set. */
  const anchorBlockReason = (p: ClientPoolPlayer, next: number[]): string | null => {
    const chosen = next.map((id) => byId.get(id)!).filter(Boolean);
    if (chosen.filter((a) => a.pos === p.pos).length > QUOTA[p.pos])
      return `A squad only holds ${QUOTA[p.pos]} ${p.pos}.`;
    if (chosen.filter((a) => a.clubId === p.clubId).length > 3)
      return `Max 3 players from ${p.club}.`;
    // Feasibility: can the rest of the squad still be filled inside £100m? Dry-run
    // the solver — length 15 means yes (it falls back to a cheapest-legal fill).
    const test = solvePreset(PRESETS[0], asPresetPool(), undefined, next);
    if (test.length !== 15) return "Those core players don't leave enough for a legal squad. Swap one out.";
    return null;
  };

  /** Add or drop a core player (up to 3). While a shape is loaded, re-solve so the
   *  squad rebuilds around the new anchor set; before one is chosen, just reflect
   *  the pick on the board. */
  const toggleAnchor = (p: ClientPoolPlayer) => {
    const has = anchors.includes(p.id);
    if (!has && anchors.length >= 3) { setNotice("Pick up to 3 core players."); return; }
    const next = has ? anchors.filter((x) => x !== p.id) : [...anchors, p.id];
    if (!has) { const r = anchorBlockReason(p, next); if (r) { setNotice(r); return; } }
    setAnchors(next); setNotice(null);
    // Picking a core player drops you straight back to the pitch — that's the view
    // you build from. Tap "+ Core player" again for the next one.
    if (!has) { setView("squad"); setPicking("squad"); }
    if (activePreset) { applyPresetWith(activePreset, next); return; } // rebuild around the new set
    if (has) { setPicked(picked.filter((x) => x !== p.id)); return; }
    if (picked.includes(p.id)) return;                    // already on the board, now just anchored
    if (picks.length < 15) { setPicked([...picked, p.id]); return; } // room on the board, drop them in
    applyPresetWith(lastPreset ?? "balanced", next);      // full squad, no active shape → re-solve around them
  };

  /** Open the Add view for a line — jump to the position that needs players. */
  const openAdd = (pos: Pos) => { setPicking("squad"); setTab(pos); setQ(""); setNotice(null); setView("add"); };
  /** Open the Add view to pick core players (any position). */
  const openAnchorAdd = () => { setPicking("anchor"); setTab("FWD"); setQ(""); setNotice(null); setView("add"); };
  const firstGap = (): Pos => POS_ORDER.find((pos) => posCount(pos) < QUOTA[pos]) ?? "GK";

  const submit = async () => {
    // Saving is the one thing that needs an account (founder, 4 Aug). A guest has
    // built a full team by now; send them to sign-in with the draft still in
    // localStorage, so they land back on the builder and confirm in one tap.
    if (!user) { router.push("/auth/sign-in?next=/fantasy/build"); return; }
    setBusy(true); setErr(null);
    try {
      await api("squad", { pickIds: picked });
      trackFantasySquad({ size: picked.length });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
      router.push("/fantasy/squad");
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  };

  const needle = q.trim().toLowerCase();
  const listed = useMemo(() => {
    const inTab = pool.filter((p) => p.pos === tab);
    if (!needle) return inTab;
    return inTab.filter((p) =>
      p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle));
  }, [pool, tab, needle]);

  // Start-fast is available the whole time you're building a new squad (never when
  // rebuilding an existing one). It is collapsible, not lockable: a hand edit just
  // tucks it away and the header always brings it back.
  const startFastAvailable = !editing && pool.length > 0;

  const squadView = (
    <>
      {/* Start fast — pick up to 3 core players, then load a shape solved around
          them. Flip shapes freely (anchors survive). Collapsible and never a dead
          end: the header always reopens the options. */}
      {startFastAvailable && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => setStartFastCollapsed((c) => !c)} aria-expanded={!startFastCollapsed}
            style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none",
              cursor: "pointer", padding: "2px 0", color: INK, marginBottom: startFastCollapsed ? 0 : 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Start fast</span>
            <span style={{ fontSize: 11, color: MUTED }}>{startFastCollapsed ? "▾ show presets" : "▴ hide"}</span>
          </button>

          {!startFastCollapsed && (<>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8, lineHeight: 1.4 }}>
            Pick up to 3 core players, then load a shape around them. Flip anytime.
          </div>

          {/* Core players — your must-keep picks, gold to set them apart. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {anchors.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              return (
                <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "3px 6px 3px 3px", borderRadius: 999, background: tint(GOLD, "16"), border: `1px solid ${tint(GOLD, "55")}` }}>
                  <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={22} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>{pitchName(p.name)}</span>
                  <button aria-label={`Remove ${p.name}`} onClick={() => toggleAnchor(p)}
                    style={{ width: 18, height: 18, borderRadius: 999, border: "none", cursor: "pointer",
                      background: "transparent", color: MUTED, fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                </span>
              );
            })}
            {anchors.length < 3 && (
              <button onClick={openAnchorAdd}
                style={{ fontSize: 12, fontWeight: 600, padding: "6px 11px", borderRadius: 999, cursor: "pointer",
                  border: `1px dashed ${tint(GOLD, "66")}`, background: "transparent", color: GOLD }}>
                + Core player
              </button>
            )}
          </div>

          {/* Fill shapes — active one filled in, tap another to flip. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PRESETS.map((s) => {
              const on = activePreset === s.id;
              return (
                <button key={s.id} onClick={() => applyPreset(s.id)} title={s.blurb}
                  style={{ fontSize: 12, fontWeight: on ? 700 : 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                    background: on ? TEAL : tint(TEAL, "12"), color: on ? "#04201d" : TEAL,
                    border: `1px solid ${on ? TEAL : tint(TEAL, "44")}` }}>
                  {s.name}
                </button>
              );
            })}
          </div>
          </>)}
        </div>
      )}

      {/* Budget + progress, connected to the squad that's forming below it. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        {([
          { k: "Squad", v: `${picks.length} / 15`, gold: false },
          { k: "Budget left", v: fmtM(bank), gold: bank >= 0 },
        ] as const).map((s) => (
          <div key={s.k} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: "11px 13px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800, color: s.gold ? GOLD : INK }}>{s.v}</div>
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3, letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.k}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {POS_ORDER.map((pos) => {
          const done = posCount(pos) === QUOTA[pos];
          return (
            <button key={pos} onClick={() => openAdd(pos)}
              style={{ fontSize: 11.5, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${done ? tint(TEAL, "55") : LINE}`, background: done ? tint(TEAL, "14") : PANEL,
                color: done ? TEAL : MUTED, fontVariantNumeric: "tabular-nums" }}>
              {pos} {posCount(pos)}/{QUOTA[pos]}{done ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      {/* The team, forming — the shared SquadBoard. Tap a filled shirt to remove,
          an empty slot to add for that line. */}
      <div style={{ marginBottom: 14 }}>
        <SquadBoard
          mode="build"
          players={boardPlayers}
          doubts={ctx.doubts}
          onSlot={(id) => remove(id)}
          onEmpty={(pos) => openAdd(pos as Pos)}
        />
      </div>
    </>
  );

  // ---- Add view: the list, with faces ----
  const addView = (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {POS_ORDER.map((pos) => (
          <button key={pos} onClick={() => { setTab(pos); setQ(""); }} style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontWeight: 700, fontSize: 13,
            background: tab === pos ? GOLD : PANEL, color: tab === pos ? "#2A1F00" : INK,
            border: `1px solid ${tab === pos ? GOLD : LINE}`, cursor: "pointer",
          }}>
            {pos} {posCount(pos)}/{QUOTA[pos]}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${POS_WORD[tab]} by name or club`}
        aria-label="Search players"
        style={{ width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
          fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none", marginBottom: 8 }}
      />
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8, lineHeight: 1.45 }}>
        {listed.length} {listed.length === 1 ? "player" : "players"}{needle ? ` matching "${q.trim()}"` : ` available`}
        {Object.keys(ctx.fixtures).length > 0 && <>. Next three fixtures shown, capitals for home.</>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 96 }}>
        {!listed.length && (
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>
            Nobody by that name in this position. Check the spelling, or try their club.
          </p>
        )}
        {listed.map((p) => {
          const anchorMode = picking === "anchor";
          const ACC = anchorMode ? GOLD : TEAL;              // gold for core players, teal for squad
          const inSquad = anchorMode ? anchors.includes(p.id) : picked.includes(p.id);
          const atCap = anchorMode && anchors.length >= 3 && !inSquad;
          const blocked = !inSquad && (atCap || blockReason(p) !== null);
          const capped = !inSquad && clubFull(p.clubId);
          return (
            <button key={p.id} onClick={() => (anchorMode ? toggleAnchor(p) : toggle(p))}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                background: inSquad ? tint(ACC, "16") : PANEL, color: INK,
                border: `1px solid ${inSquad ? tint(ACC, "66") : LINE}`, opacity: blocked ? 0.5 : 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, minWidth: 0 }}>
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={36} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{p.name}</span>
                    <DoubtFlag reason={ctx.doubts[p.id]} />
                    {capped && <span style={{ fontSize: 10.5, color: "#C9884A", border: "1px solid #C9884A", borderRadius: 6, padding: "1px 5px" }}>3/3</span>}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Crest club={p.club} size={13} />
                    <span style={{ fontSize: 11.5, color: MUTED, fontWeight: 400 }}>{p.club}</span>
                    <FixtureRun cells={ctx.fixtures[p.clubId]} />
                  </span>
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: inSquad ? ACC : INK }}>£{p.price.toFixed(1)}m</span>
                <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${inSquad ? tint(ACC, "66") : LINE}`, color: inSquad ? ACC : MUTED, fontSize: 15 }}>
                  {inSquad ? (anchorMode ? "★" : "✓") : "+"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <>
    <main data-fantasy style={page}>
      <Header
        exit={view === "add"
          ? { label: "Squad", onClick: () => { setView("squad"); setPicking("squad"); setNotice(null); } }
          : { label: "Squad", onClick: () => router.push("/fantasy/squad") }}
        right={<Chip gold>{fmtM(bank)} left</Chip>}
      />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>
        {view === "add"
          ? (picking === "anchor" ? "Pick your core players" : `Add a ${tab === "GK" ? "keeper" : POS_WORD[tab].slice(0, -1)}`)
          : editing ? "Rebuild your squad" : "Build your squad"}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
        {view === "add"
          ? (picking === "anchor"
            ? `Tap up to 3 players you definitely want. A preset builds the rest around them. ${anchors.length}/3 picked.`
            : "Tap a player to add them. They drop straight onto your squad.")
          : editing
            ? "Change as many players as you like, free until the season starts."
            : "15 players, £100m, no more than 3 from any club. Tap a shirt to fill it."}
      </p>

      {view === "squad" && <Deadline iso={deadline} compact />}
      {view === "squad" ? squadView : addView}

      {/* Sticky footer — reachable without scrolling the list. */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 4,
        background: `linear-gradient(to top, ${PITCH} 72%, transparent)`, paddingTop: 16, paddingBottom: 8 }}>
        {notice && <p style={{ color: "#C9884A", fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>{notice}</p>}
        {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 8px" }}>{err}</p>}
        {view === "add" ? (
          <Btn onClick={() => { setView("squad"); setPicking("squad"); setNotice(null); }}>
            {picking === "anchor"
              ? (anchors.length ? `Done · ${anchors.length}/3 core players` : "Back to squad")
              : complete ? "Back to squad" : `Back to squad · ${15 - picks.length} to pick`}
          </Btn>
        ) : complete ? (
          <>
            <Btn lime disabled={busy} onClick={submit}>
              {busy ? "Saving…" : !user ? "Sign in to save my squad" : editing ? "Save my squad" : "Confirm my squad"}
            </Btn>
            <p style={{ fontSize: 11.5, color: MUTED, margin: "7px 0 0", lineHeight: 1.4, textAlign: "center" }}>
              We&apos;ll pick your starting XI, captain and bench order. Change any of it next.
            </p>
          </>
        ) : (
          <Btn lime onClick={() => openAdd(firstGap())}>
            Add players · {15 - picks.length} to pick
          </Btn>
        )}
      </div>
    </main>
      <BottomNav />
    </>
  );
}
