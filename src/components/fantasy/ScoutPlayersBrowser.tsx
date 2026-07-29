"use client";
/**
 * Scout · Players — the research browser (Stage 2).
 *
 * A destination for looking players UP, not a transfer market: browse → open the
 * profile. There is deliberately no buy / sell / add-to-squad here (that lives on
 * the build + transfer screens), and no shortlist star or compare action yet —
 * those are Stage 3.
 *
 * Everything reuses the pick-surface data + kit: the priced pool (/api/fantasy/
 * pool), fixtures + doubts (/api/fantasy/context), and recent YourScore form
 * (/api/fantasy/form) are the SAME three reads the builder and transfer screens
 * make, so a price, a fixture run and a doubt read identically wherever you meet
 * a player. Tapping a row opens the existing <PlayerProfile> in a bottom Sheet —
 * the same modal idiom the transfer screen uses for player detail.
 */
import { useEffect, useMemo, useState } from "react";
import {
  api, Crest, DoubtFlag, EMPTY_CONTEXT, FixtureRun, INK, LINE, MUTED, PANEL,
  TEAL, tint, Sheet, Loading, ErrorState,
  type ClientPoolPlayer, type FantasyContext, type Difficulty, type Pos,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";
import { PlayerProfile } from "@/components/fantasy/PlayerProfile";

interface Form { gws: number[]; points: Record<number, number[]> }

const POS_TABS: (Pos | "ALL")[] = ["ALL", "GK", "DEF", "MID", "FWD"];
const AVAIL_TABS = [
  { key: "all", label: "All" },
  { key: "available", label: "Available" },
  { key: "doubtful", label: "Doubtful" },
] as const;
type Avail = (typeof AVAIL_TABS)[number]["key"];

type SortKey = "points" | "priceHigh" | "priceLow" | "fixtures" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "priceHigh", label: "Price · high to low" },
  { key: "priceLow", label: "Price · low to high" },
  { key: "points", label: "Total points" },
  { key: "fixtures", label: "Fixture difficulty" },
  { key: "name", label: "Name · A to Z" },
];

const DIFF_WEIGHT: Record<Difficulty, number> = { kind: 1, medium: 2, tough: 3 };

const selectStyle = {
  boxSizing: "border-box" as const, padding: "9px 10px", borderRadius: 10, fontSize: 13,
  background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none",
};

export function ScoutPlayersBrowser() {
  const [pool, setPool] = useState<ClientPoolPlayer[] | null>(null);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [form, setForm] = useState<Form>({ gws: [], points: {} });
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // Controls
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<Pos | "ALL">("ALL");
  const [club, setClub] = useState<string>("ALL");
  const [avail, setAvail] = useState<Avail>("all");
  const [minPrice, setMinPrice] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(999);
  const [sort, setSort] = useState<SortKey>("priceHigh");
  const [detailFor, setDetailFor] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setErr(null);
    api<{ players: ClientPoolPlayer[] }>("pool")
      .then((p) => { if (live) setPool(p.players); })
      .catch((e) => { if (live) setErr((e as Error).message || "Couldn't load players."); });
    // Fixtures + doubts and recent form are the same optional context the pick
    // surfaces read — a failure here degrades gracefully (no fixture run / no form),
    // it never blocks the list.
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (live && c) setCtx(c); })
      .catch(() => {});
    api<Form>("form").then((f) => { if (live) setForm(f); }).catch(() => {});
    return () => { live = false; };
  }, [reload]);

  // Price bounds for the range selects, from the pool itself (0.5m steps).
  const priceSteps = useMemo(() => {
    if (!pool?.length) return [] as number[];
    const lo = Math.floor(Math.min(...pool.map((p) => p.price)) * 2) / 2;
    const hi = Math.ceil(Math.max(...pool.map((p) => p.price)) * 2) / 2;
    const out: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += 0.5) out.push(Math.round(v * 10) / 10);
    return out;
  }, [pool]);

  const clubs = useMemo(
    () => Array.from(new Set((pool ?? []).map((p) => p.club))).sort((a, b) => a.localeCompare(b)),
    [pool],
  );

  const formTotal = useMemo(() => {
    const m = new Map<number, number>();
    for (const [id, pts] of Object.entries(form.points)) m.set(Number(id), pts.reduce((a, b) => a + b, 0));
    return m;
  }, [form]);
  const hasForm = form.gws.length > 0;

  /** Mean fixture difficulty over the club's next fixtures (kindest first).
   *  Clubs with no fixture in range sort last. */
  const fixtureScore = useMemo(() => {
    const m = new Map<number, number>();
    for (const [clubId, cells] of Object.entries(ctx.fixtures)) {
      const next = cells.slice(0, 3);
      if (!next.length) continue;
      m.set(Number(clubId), next.reduce((a, c) => a + DIFF_WEIGHT[c.difficulty], 0) / next.length);
    }
    return m;
  }, [ctx]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!pool) return [];
    const filtered = pool.filter((p) => {
      if (pos !== "ALL" && p.pos !== pos) return false;
      if (club !== "ALL" && p.club !== club) return false;
      if (p.price < minPrice || p.price > maxPrice) return false;
      if (avail !== "all") {
        const doubtful = !!ctx.doubts[p.id];
        if (avail === "available" && doubtful) return false;
        if (avail === "doubtful" && !doubtful) return false;
      }
      if (needle && !(p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle))) return false;
      return true;
    });
    const byName = (a: ClientPoolPlayer, b: ClientPoolPlayer) => a.name.localeCompare(b.name);
    const ft = (id: number) => formTotal.get(id) ?? 0;
    const fx = (clubId: number) => fixtureScore.get(clubId) ?? 99;
    switch (sort) {
      case "priceLow": return filtered.sort((a, b) => (a.price - b.price) || byName(a, b));
      case "points": return filtered.sort((a, b) => (ft(b.id) - ft(a.id)) || (b.price - a.price));
      case "fixtures": return filtered.sort((a, b) => (fx(a.clubId) - fx(b.clubId)) || (b.price - a.price));
      case "name": return filtered.sort(byName);
      case "priceHigh":
      default: return filtered.sort((a, b) => (b.price - a.price) || byName(a, b));
    }
  }, [pool, pos, club, minPrice, maxPrice, avail, needle, sort, ctx, formTotal, fixtureScore]);

  if (err && !pool) return <ErrorState message={err} onRetry={() => setReload((n) => n + 1)} />;
  if (!pool) return <Loading label="Loading players" />;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Search */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a player or club"
        aria-label="Search players"
        style={{ ...selectStyle, width: "100%", padding: "11px 12px", fontSize: 14 }}
      />

      {/* Position */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {POS_TABS.map((t) => {
          const on = pos === t;
          return (
            <button key={t} onClick={() => setPos(t)}
              style={{
                fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${on ? tint(TEAL, "66") : LINE}`, background: on ? tint(TEAL, "16") : PANEL,
                color: on ? TEAL : MUTED,
              }}>
              {t === "ALL" ? "All" : t}
            </button>
          );
        })}
      </div>

      {/* Club + sort */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>CLUB</span>
          <select value={club} onChange={(e) => setClub(e.target.value)} aria-label="Filter by club"
            style={{ ...selectStyle, width: "100%" }}>
            <option value="ALL">All clubs</option>
            {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>SORT BY</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort players"
            style={{ ...selectStyle, width: "100%" }}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {/* Price range */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>MIN PRICE</span>
          <select value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} aria-label="Minimum price"
            style={{ ...selectStyle, width: "100%" }}>
            <option value={0}>No min</option>
            {priceSteps.map((v) => <option key={v} value={v}>£{v.toFixed(1)}m</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.08em", color: MUTED }}>MAX PRICE</span>
          <select value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} aria-label="Maximum price"
            style={{ ...selectStyle, width: "100%" }}>
            <option value={999}>No max</option>
            {priceSteps.map((v) => <option key={v} value={v}>£{v.toFixed(1)}m</option>)}
          </select>
        </label>
      </div>

      {/* Availability */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {AVAIL_TABS.map((t) => {
          const on = avail === t.key;
          return (
            <button key={t.key} onClick={() => setAvail(t.key)}
              style={{
                fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${on ? tint(TEAL, "66") : LINE}`, background: on ? tint(TEAL, "16") : PANEL,
                color: on ? TEAL : MUTED,
              }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 11.5, color: MUTED }}>
        {rows.length} {rows.length === 1 ? "player" : "players"}
        {sort === "points" && !hasForm && " · no scored gameweeks yet, so points are level"}
      </div>

      {/* The list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!rows.length && (
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0", lineHeight: 1.5 }}>
            No players match these filters. Widen the price range or clear the search.
          </p>
        )}
        {rows.map((p) => {
          const doubtful = !!ctx.doubts[p.id];
          return (
            <button key={p.id} onClick={() => setDetailFor(p.id)}
              aria-label={`${p.name} — view profile`}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                padding: "9px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                background: PANEL, color: INK, border: `1px solid ${LINE}`, width: "100%",
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <PlayerAvatar name={p.name} avatarUrl={faceFor(p.name)} size={36} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <DoubtFlag reason={ctx.doubts[p.id]} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Crest club={p.club} size={13} />
                    <span style={{ fontSize: 11.5, color: MUTED }}>{p.club} · {p.pos}</span>
                    <FixtureRun cells={ctx.fixtures[p.clubId]} max={2} />
                  </span>
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>£{p.price.toFixed(1)}m</span>
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 999,
                  color: doubtful ? "#E08A6B" : TEAL,
                  border: `1px solid ${doubtful ? "#B85C38" : tint(TEAL, "55")}`,
                  background: doubtful ? "rgba(184,92,56,0.10)" : tint(TEAL, "12"),
                }}>{doubtful ? "DOUBT" : "FIT"}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail — the existing PlayerProfile, opened over the list in a bottom
          Sheet (the transfer screen's idiom). Research only: no consider/drop
          action is passed, so this is a pure read. */}
      {detailFor !== null && (
        <Sheet onClose={() => setDetailFor(null)} labelledBy="fantasy-player-profile-name">
          <PlayerProfile playerId={detailFor} onClose={() => setDetailFor(null)} />
        </Sheet>
      )}
    </div>
  );
}
