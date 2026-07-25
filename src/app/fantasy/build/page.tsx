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
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import { BottomNav } from "@/components/ui/BottomNav";

const BUDGET = 1000;
const DRAFT_KEY = "ys-fantasy-draft";
/** Pitch order runs attack → defence, top to bottom. */
const PITCH_ORDER: Pos[] = ["FWD", "MID", "DEF", "GK"];
const POS_WORD: Record<Pos, string> = { GK: "keepers", DEF: "defenders", MID: "midfielders", FWD: "forwards" };

/** Surname for the pitch marker — keeps "van Dijk"/"de Bruyne" two words. */
function surname(n: string): string {
  const parts = n.trim().split(/\s+/);
  if (parts.length > 1 && /^(de|van|von|da|dos|del|di|el|al|mc|le)$/i.test(parts[parts.length - 2])) {
    return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
  }
  return parts[parts.length - 1];
}

export default function BuildPage() {
  const router = useRouter();
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

  useEffect(() => {
    api<{ players: ClientPoolPlayer[] }>("pool").then((p) =>
      setPool(p.players.sort((a, b) => b.price - a.price)));
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (c) setCtx(c); })
      .catch(() => {});
    api<FantasyState>("state").then((s) => {
      setDeadline(s.gw.deadline);
      if (!s.squad) {
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

  const blockReason = (p: ClientPoolPlayer): string | null => {
    if (posCount(p.pos) >= QUOTA[p.pos]) return `You've got all ${QUOTA[p.pos]} ${p.pos}. Remove one first.`;
    if (clubCount(p.clubId) >= 3) return `Max 3 players from ${p.club}. You already have 3.`;
    if (spent + Math.round(p.price * 10) > BUDGET) return `Not enough budget. ${fmtM(bank)} left.`;
    return null;
  };

  const remove = (id: number) => { setPicked(picked.filter((x) => x !== id)); setNotice(null); };
  const toggle = (p: ClientPoolPlayer) => {
    if (picked.includes(p.id)) { remove(p.id); return; }
    const reason = blockReason(p);
    if (reason) { setNotice(reason); return; }
    setNotice(null); setPicked([...picked, p.id]);
  };

  /** Open the Add view for a line — jump to the position that needs players. */
  const openAdd = (pos: Pos) => { setTab(pos); setQ(""); setNotice(null); setView("add"); };
  const firstGap = (): Pos => POS_ORDER.find((pos) => posCount(pos) < QUOTA[pos]) ?? "GK";

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

  const needle = q.trim().toLowerCase();
  const listed = useMemo(() => {
    const inTab = pool.filter((p) => p.pos === tab);
    if (!needle) return inTab;
    return inTab.filter((p) =>
      p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle));
  }, [pool, tab, needle]);

  // ---- Squad view: a slot per squad place, filled or empty, on a pitch ----
  const Slot = ({ p, pos }: { p?: ClientPoolPlayer; pos: Pos }) =>
    p ? (
      <button onClick={() => remove(p.id)} aria-label={`${p.name}, £${p.price.toFixed(1)}m — tap to remove`}
        style={{ background: "transparent", border: "none", padding: "2px 1px", cursor: "pointer", flex: "1 1 0", maxWidth: 66, minWidth: 0 }}>
        <PlayerMarker name={p.name} label={surname(p.name)} avatarUrl={faceFor(p.name)}
          size={pos === "GK" ? 36 : 34} doubt={ctx.doubts[p.id]} datum={`£${p.price.toFixed(1)}`} />
      </button>
    ) : (
      <button onClick={() => openAdd(pos)} aria-label={`Add a ${pos}`}
        style={{ background: "transparent", border: "none", padding: "2px 1px", cursor: "pointer", flex: "1 1 0", maxWidth: 66, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{ width: pos === "GK" ? 36 : 34, height: pos === "GK" ? 36 : 34, borderRadius: "50%", border: `1px dashed ${tint(TEAL, "55")}`, background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center", justifyContent: "center", color: tint(TEAL, "bb"), fontSize: 18, lineHeight: 1 }}>+</span>
        <span style={{ fontSize: 9.5, color: MUTED, fontWeight: 700 }}>{pos}</span>
      </button>
    );

  const squadView = (
    <>
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

      {/* The team, forming. A slot per squad place; tap an empty one to fill it. */}
      <div className="rounded-2xl relative overflow-hidden" style={{ border: `1px solid ${LINE}`, marginBottom: 14 }}>
        <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #0c1a13 0%, #0a1710 55%, #091510 100%)" }} />
        <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.26, background: "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0 22px, transparent 22px 44px)" }} />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 12, padding: "16px 8px" }}>
          {PITCH_ORDER.map((pos) => {
            const inPos = picks.filter((p) => p.pos === pos);
            return (
              <div key={pos} style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
                {Array.from({ length: QUOTA[pos] }).map((_, i) => (
                  <Slot key={i} p={inPos[i]} pos={pos} />
                ))}
              </div>
            );
          })}
        </div>
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
          const inSquad = picked.includes(p.id);
          const blocked = !inSquad && blockReason(p) !== null;
          const capped = !inSquad && clubFull(p.clubId);
          return (
            <button key={p.id} onClick={() => toggle(p)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                background: inSquad ? tint(TEAL, "16") : PANEL, color: INK,
                border: `1px solid ${inSquad ? tint(TEAL, "66") : LINE}`, opacity: blocked ? 0.5 : 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, minWidth: 0 }}>
                <PlayerAvatar name={p.name} avatarUrl={faceFor(p.name)} size={36} />
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
                <span style={{ fontSize: 13.5, fontWeight: 700, color: inSquad ? TEAL : INK }}>£{p.price.toFixed(1)}m</span>
                <span aria-hidden style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${inSquad ? tint(TEAL, "66") : LINE}`, color: inSquad ? TEAL : MUTED, fontSize: 15 }}>
                  {inSquad ? "✓" : "+"}
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
          ? { label: "Squad", onClick: () => { setView("squad"); setNotice(null); } }
          : { label: "Fantasy", onClick: () => router.push("/fantasy") }}
        right={<Chip gold>{fmtM(bank)} left</Chip>}
      />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>
        {view === "add" ? `Add a ${tab === "GK" ? "keeper" : POS_WORD[tab].slice(0, -1)}`
          : editing ? "Rebuild your squad" : "Build your squad"}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
        {view === "add"
          ? "Tap a player to add them. They drop straight onto your squad."
          : editing
            ? "Change as many players as you like — free until the season starts."
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
          <Btn onClick={() => { setView("squad"); setNotice(null); }}>
            {complete ? "Back to squad" : `Back to squad · ${15 - picks.length} to pick`}
          </Btn>
        ) : complete ? (
          <>
            <Btn lime disabled={busy} onClick={submit}>
              {busy ? "Saving…" : editing ? "Save my squad" : "Confirm my squad"}
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
