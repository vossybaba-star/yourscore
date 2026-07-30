"use client";
/**
 * Scout · Player Comparison (Stage 3, brief §14).
 *
 * TWO players, side by side, so a manager can weigh one against the other on the
 * facts. It states differences and STOPS — it never crowns a winner, and there
 * is no buy / sell / verdict anywhere (the whole Scout tab is research, not a
 * market). "Saka has more total points and recent assists. Palmer is priced the
 * same and has the kinder next fixture." is the register; "Saka is the better
 * pick" is forbidden.
 *
 * Everything reuses the pick-surface data + kit: identity + price from the priced
 * pool (/api/fantasy/pool), fixtures + doubts from /api/fantasy/context, and the
 * fantasy record from the SAME per-player profile the profile sheet reads
 * (/api/fantasy/player/[id]). A stat we don't hold shows "—", never a guess.
 *
 * Opened as a full-height <Sheet> (the tab's modal idiom) from three places: a
 * Compare button on the Players + Shortlist rows (pre-loads that player as side
 * one) and a "Compare players" entry on the Briefing (opens empty).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  api, Crest, DoubtFlag, EMPTY_CONTEXT, FixtureRun, Btn,
  INK, LINE, MUTED, PANEL, PANEL_2, TEAL, AMBER, tint,
  Sheet, SectionLabel,
  type ClientPoolPlayer, type FantasyContext, type Difficulty, type ContextFixture,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { faceFor } from "@/lib/fantasy/faces";

// ── the compare affordance, reused on the Players + Shortlist rows ────────────

/** The row Compare button — sits BESIDE the profile + star buttons (a sibling,
 *  never nested), same 38px square idiom as StarButton. Opens the comparison
 *  with this player already on side one. */
export function CompareButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label ?? "Compare this player"}
      title="Compare"
      style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 10, cursor: "pointer",
        display: "grid", placeItems: "center",
        background: "transparent", border: `1px solid ${LINE}`, color: MUTED,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden
        fill="none" stroke={MUTED} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h6M4 12h6M4 17h6" />
        <path d="M14 7h6M14 12h6M14 17h6" opacity="0.55" />
        <path d="M12 3v18" />
      </svg>
    </button>
  );
}

// ── the per-player record, from the profile route ────────────────────────────

interface ProfileStat { label: string; value: string; note: string | null }
interface PlayerProfileResponse {
  name: string; club: string; priceTenths: number;
  profile: {
    playerId: number; pos: "GK" | "DEF" | "MID" | "FWD";
    minutes: number[]; points: number[];
    seasonPoints: number; perGame: number | null;
    flag: { kind: string; severity: "high" | "medium"; reason: string } | null;
    stats: ProfileStat[];
    fixtures: { gw: number; oppShort: string; home: boolean; difficulty: Difficulty }[];
  };
}

type ProfileState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: PlayerProfileResponse };

/** A player's fantasy record, reduced to the numbers the comparison shows.
 *  Anything the profile can't give us stays null → the UI renders "—". */
interface PlayerRecord {
  totalPoints: number;
  perGame: number | null;
  recentReturns: number;
  recentGames: number;
  recentStarts: number;
  goals: number | null;
  assists: number | null;
}

/** Parse "3G 2A" out of the profile's "Goals and assists" stat. That stat is
 *  absent for goalkeepers (a keeper's case never mentions goals) and pre-season,
 *  so a miss is honest missing data → null, shown as "—". */
function goalsAssists(stats: ProfileStat[]): { goals: number | null; assists: number | null } {
  const s = stats.find((x) => x.label.toLowerCase() === "goals and assists");
  const m = s?.value.match(/(\d+)\s*G\s+(\d+)\s*A/i);
  if (!m) return { goals: null, assists: null };
  return { goals: Number(m[1]), assists: Number(m[2]) };
}

function deriveRecord(r: PlayerProfileResponse): PlayerRecord {
  const p = r.profile;
  const { goals, assists } = goalsAssists(p.stats);
  return {
    totalPoints: p.seasonPoints,
    perGame: p.perGame,
    recentReturns: p.points.reduce((a, b) => a + b, 0),
    recentGames: p.minutes.length,
    // A "start" ≈ a meaningful appearance: 60+ minutes (the same 60' line the
    // profile's clean-sheet stat uses). Derived from real per-GW minutes.
    recentStarts: p.minutes.filter((m) => m >= 60).length,
    goals,
    assists,
  };
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const DIFF_WEIGHT: Record<Difficulty, number> = { kind: 1, medium: 2, tough: 3 };

/** Mean difficulty of the next 3 fixtures (lower = kinder). null when the club
 *  has no fixture in range (a blank run), so the summary stays silent rather
 *  than inventing a comparison. */
function fixtureEase(cells: ContextFixture[] | undefined): number | null {
  const next = (cells ?? []).slice(0, 3);
  if (!next.length) return null;
  return next.reduce((a, c) => a + DIFF_WEIGHT[c.difficulty], 0) / next.length;
}

function nextOpponent(cells: ContextFixture[] | undefined): string | null {
  const n = (cells ?? [])[0];
  if (!n) return null;
  return `${n.home ? "vs" : "@"} ${n.oppShort.toUpperCase()}`;
}

// ── a resolved side (pool identity + optional loaded record) ──────────────────

interface Side {
  player: ClientPoolPlayer;
  doubt: string | undefined;
  profile: ProfileState;
  fixtures: ContextFixture[] | undefined;
}

// ── the factual difference summary (describe, NEVER crown) ────────────────────

/** A short, factual read of the visible differences. Every clause is a stated
 *  fact with the numbers beside it; nothing here recommends, ranks as better, or
 *  says buy/sell. Skips any dimension where either side's data is missing. */
function buildSummary(a: Side, b: Side): string[] {
  const an = a.player.name, bn = b.player.name;
  const ra = a.profile.status === "ready" ? deriveRecord(a.profile.data) : null;
  const rb = b.profile.status === "ready" ? deriveRecord(b.profile.data) : null;
  const out: string[] = [];

  if (ra && rb) {
    // Total points.
    if (ra.totalPoints !== rb.totalPoints) {
      const [hi, lo, hn] = ra.totalPoints > rb.totalPoints ? [ra, rb, an] : [rb, ra, bn];
      out.push(`${hn} has more total points (${hi.totalPoints} to ${lo.totalPoints}).`);
    } else {
      out.push(`${an} and ${bn} are level on total points (${ra.totalPoints} each).`);
    }

    // Recent starts — only when both actually have a recent window.
    if (ra.recentGames > 0 && rb.recentGames > 0 && ra.recentStarts !== rb.recentStarts) {
      const [hi, hn, hg, lo, lg] = ra.recentStarts > rb.recentStarts
        ? [ra.recentStarts, an, ra.recentGames, rb.recentStarts, rb.recentGames]
        : [rb.recentStarts, bn, rb.recentGames, ra.recentStarts, ra.recentGames];
      out.push(`${hn} has started more of the recent games (${hi} of ${hg} vs ${lo} of ${lg}).`);
    }

    // Goals + assists, only where both sides carry them (skips keepers).
    if (ra.goals !== null && ra.assists !== null && rb.goals !== null && rb.assists !== null) {
      const sa = ra.goals + ra.assists, sb = rb.goals + rb.assists;
      if (sa !== sb) {
        const [hn, hg, ha, , lg, la] = sa > sb
          ? [an, ra.goals, ra.assists, bn, rb.goals, rb.assists]
          : [bn, rb.goals, rb.assists, an, ra.goals, ra.assists];
        out.push(`${hn} has more goals and assists (${hg}G ${ha}A vs ${lg}G ${la}A).`);
      }
    }
  }

  // Price — from the pool, always available.
  const pa = a.player.price, pb = b.player.price;
  if (Math.abs(pa - pb) < 0.05) {
    out.push(`They are priced the same at £${pa.toFixed(1)}m.`);
  } else {
    const [ln, lp, hp] = pa < pb ? [an, pa, pb] : [bn, pb, pa];
    out.push(`${ln} is cheaper by £${(hp - lp).toFixed(1)}m (£${lp.toFixed(1)}m vs £${hp.toFixed(1)}m).`);
  }

  // Next fixtures.
  const ea = fixtureEase(a.fixtures), eb = fixtureEase(b.fixtures);
  if (ea !== null && eb !== null && Math.abs(ea - eb) > 0.01) {
    out.push(`${ea < eb ? an : bn} has the kinder next fixtures.`);
  }

  // Availability — a doubt is a fact worth stating, never a verdict.
  if (a.doubt && !b.doubt) out.push(`${an} is carrying a doubt right now; ${bn} has no availability flag.`);
  else if (b.doubt && !a.doubt) out.push(`${bn} is carrying a doubt right now; ${an} has no availability flag.`);
  else if (a.doubt && b.doubt) out.push(`Both are carrying an availability doubt.`);

  return out;
}

// ── small presentational bits ─────────────────────────────────────────────────

const dash = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/** One comparison row: a muted label, then the two players' values side by side.
 *  Deliberately NO winner highlight — a tint on the higher number would crown a
 *  side, which this surface must never do. */
function Row({ label, a, b }: { label: string; a: string; b: string }) {
  const cell: CSSProperties = {
    fontSize: 13.5, fontWeight: 700, color: INK, textAlign: "center",
    fontVariantNumeric: "tabular-nums", padding: "6px 4px",
    background: PANEL_2, borderRadius: 8, minWidth: 0,
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 4, textAlign: "center" }}>
        {label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={cell}>{a}</div>
        <div style={cell}>{b}</div>
      </div>
    </div>
  );
}

function AvailabilityLine({ doubt }: { doubt: string | undefined }) {
  if (!doubt) {
    return (
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", padding: "1px 6px", borderRadius: 999,
        color: TEAL, border: `1px solid ${tint(TEAL, "55")}`, background: tint(TEAL, "12"),
      }}>FIT</span>
    );
  }
  return <DoubtFlag reason={doubt} />;
}

/** The identity header for one side: portrait, name, club/pos, price, availability,
 *  and the remove / replace controls. */
function IdentityHead({ side, onRemove, onReplace }: {
  side: Side; onRemove: () => void; onReplace: () => void;
}) {
  const p = side.player;
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 11 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, textAlign: "center" }}>
        <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={52} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, lineHeight: 1.15 }}>{p.name}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 3 }}>
            <Crest club={p.club} size={13} />
            <span style={{ fontSize: 11.5, color: MUTED }}>{p.club} · {p.pos}</span>
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>£{p.price.toFixed(1)}m</div>
        <AvailabilityLine doubt={side.doubt} />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onReplace}
          style={{
            flex: 1, fontSize: 11.5, fontWeight: 600, padding: "6px 8px", borderRadius: 8, cursor: "pointer",
            background: PANEL_2, color: INK, border: `1px solid ${LINE}`,
          }}>Replace</button>
        <button onClick={onRemove} aria-label={`Remove ${p.name}`}
          style={{
            flex: 1, fontSize: 11.5, fontWeight: 600, padding: "6px 8px", borderRadius: 8, cursor: "pointer",
            background: PANEL_2, color: MUTED, border: `1px solid ${LINE}`,
          }}>Remove</button>
      </div>
    </div>
  );
}

/** An empty slot: the call to add a player. */
function EmptySlot({ index, onPick }: { index: 1 | 2; onPick: () => void }) {
  return (
    <button onClick={onPick}
      style={{
        width: "100%", minHeight: 168, borderRadius: 12, cursor: "pointer",
        background: PANEL, border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
      }}>
      <span style={{
        width: 40, height: 40, borderRadius: 999, display: "grid", placeItems: "center",
        border: `1px solid ${tint(TEAL, "66")}`, fontSize: 22, lineHeight: 1,
      }}>+</span>
      <span style={{ fontSize: 12.5, fontWeight: 600 }}>Add player {index === 1 ? "one" : "two"}</span>
    </button>
  );
}

// ── the player picker (fills / replaces one slot) ─────────────────────────────

const selectStyle: CSSProperties = {
  boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, fontSize: 14,
  background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none", width: "100%",
};

function PlayerPicker({ pool, ctx, slot, onCancel, onPick }: {
  pool: ClientPoolPlayer[];
  ctx: FantasyContext;
  slot: 1 | 2;
  onCancel: () => void;
  onPick: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered = pool.filter((p) =>
      !needle || p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle));
    filtered.sort((a, b) => (b.price - a.price) || a.name.localeCompare(b.name));
    return filtered.slice(0, 80);
  }, [pool, needle]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={onCancel} aria-label="Back"
          style={{
            background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
            fontSize: 12.5, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
          }}>← Back</button>
        <h2 id="compare-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: INK }}>
          Pick player {slot === 1 ? "one" : "two"}
        </h2>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a player or club"
        aria-label="Search players"
        autoFocus
        style={{ ...selectStyle, marginBottom: 10 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!rows.length && (
          <p style={{ fontSize: 13, color: MUTED, margin: "4px 0" }}>No players match that search.</p>
        )}
        {rows.map((p) => {
          const doubtful = !!ctx.doubts[p.id];
          return (
            <button key={p.id} onClick={() => onPick(p.id)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                padding: "9px 12px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                background: PANEL, color: INK, border: `1px solid ${LINE}`,
              }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={34} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                    <DoubtFlag reason={ctx.doubts[p.id]} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                    <Crest club={p.club} size={12} />
                    <span style={{ fontSize: 11.5, color: MUTED }}>{p.club} · {p.pos}</span>
                  </span>
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>£{p.price.toFixed(1)}m</span>
                {doubtful && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: "#E08A6B" }}>DOUBT</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── the comparison sheet ──────────────────────────────────────────────────────

export function PlayerComparison({ initialOneId, initialTwoId, onClose }: {
  initialOneId?: number | null;
  initialTwoId?: number | null;
  onClose: () => void;
}) {
  const [pool, setPool] = useState<ClientPoolPlayer[] | null>(null);
  const [ctx, setCtx] = useState<FantasyContext>(EMPTY_CONTEXT);
  const [loadErr, setLoadErr] = useState(false);

  const [one, setOne] = useState<number | null>(initialOneId ?? null);
  const [two, setTwo] = useState<number | null>(initialTwoId ?? null);
  const [picking, setPicking] = useState<1 | 2 | null>(null);
  const [profiles, setProfiles] = useState<Map<number, ProfileState>>(new Map());

  // Pool + context, the same two reads every Scout surface makes.
  useEffect(() => {
    let live = true;
    api<{ players: ClientPoolPlayer[] }>("pool")
      .then((p) => { if (live) setPool(p.players); })
      .catch(() => { if (live) setLoadErr(true); });
    fetch("/api/fantasy/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: FantasyContext | null) => { if (live && c) setCtx(c); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Fetch each selected player's profile once. Explicit GET — the profile route
  // is GET-only; the shared api() helper would POST an un-listed path.
  const ensureProfile = useCallback((id: number) => {
    setProfiles((prev) => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, { status: "loading" });
      fetch(`/api/fantasy/player/${id}`, { method: "GET" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: PlayerProfileResponse) =>
          setProfiles((m) => new Map(m).set(id, { status: "ready", data })))
        .catch(() => setProfiles((m) => new Map(m).set(id, { status: "error" })));
      return next;
    });
  }, []);

  useEffect(() => { if (one !== null) ensureProfile(one); }, [one, ensureProfile]);
  useEffect(() => { if (two !== null) ensureProfile(two); }, [two, ensureProfile]);

  const byId = useMemo(() => {
    const m = new Map<number, ClientPoolPlayer>();
    for (const p of pool ?? []) m.set(p.id, p);
    return m;
  }, [pool]);

  const sideFor = useCallback((id: number | null): Side | null => {
    if (id === null) return null;
    const player = byId.get(id);
    if (!player) return null;
    return {
      player,
      doubt: ctx.doubts[id],
      profile: profiles.get(id) ?? { status: "loading" },
      fixtures: ctx.fixtures[player.clubId],
    };
  }, [byId, ctx, profiles]);

  const sideA = sideFor(one);
  const sideB = sideFor(two);
  const samePlayer = one !== null && one === two;

  const pick = (id: number) => {
    if (picking === 1) setOne(id);
    else if (picking === 2) setTwo(id);
    setPicking(null);
  };
  const swap = () => { const t = one; setOne(two); setTwo(t); };

  const recordCell = (side: Side | null, get: (r: PlayerRecord) => string): string => {
    if (!side) return "—";
    if (side.profile.status === "ready") return get(deriveRecord(side.profile.data));
    return "…"; // loading / error → nothing claimed
  };

  const summary = sideA && sideB && !samePlayer ? buildSummary(sideA, sideB) : [];

  return (
    <Sheet onClose={onClose} labelledBy="compare-title">
      {picking !== null && pool ? (
        <PlayerPicker
          pool={pool}
          ctx={ctx}
          slot={picking}
          onCancel={() => setPicking(null)}
          onPick={pick}
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <h2 id="compare-title" style={{ margin: 0, fontSize: 19, fontWeight: 800, color: INK }}>
              Compare players
            </h2>
            <button onClick={onClose} aria-label="Close comparison"
              style={{
                background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
                fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, cursor: "pointer",
              }}>Close</button>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>
            The facts, side by side. You decide.
          </p>

          {loadErr && !pool ? (
            <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: MUTED }}>Couldn&apos;t load players right now.</p>
            </div>
          ) : (
            <>
              {/* The two sides. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {sideA
                  ? <IdentityHead side={sideA} onRemove={() => setOne(null)} onReplace={() => setPicking(1)} />
                  : <EmptySlot index={1} onPick={() => setPicking(1)} />}
                {sideB
                  ? <IdentityHead side={sideB} onRemove={() => setTwo(null)} onReplace={() => setPicking(2)} />
                  : <EmptySlot index={2} onPick={() => setPicking(2)} />}
              </div>

              {sideA && sideB && (
                <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 2px" }}>
                  <button onClick={swap}
                    style={{
                      fontSize: 11.5, fontWeight: 600, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                      background: PANEL_2, color: MUTED, border: `1px solid ${LINE}`,
                    }}>⇄ Swap sides</button>
                </div>
              )}

              {/* Guidance for the partial states. */}
              {!sideA && !sideB && (
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "14px 2px 0" }}>
                  Pick two players to compare them side by side.
                </p>
              )}
              {(!!sideA !== !!sideB) && (
                <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, margin: "14px 2px 0" }}>
                  Add a second player to compare.
                </p>
              )}
              {samePlayer && (
                <p style={{ fontSize: 13, color: AMBER, lineHeight: 1.5, margin: "14px 2px 0" }}>
                  That&apos;s the same player on both sides. Replace one to compare two different players.
                </p>
              )}

              {/* Fixtures + record, only once BOTH sides are set (and distinct). */}
              {sideA && sideB && !samePlayer && (
                <div style={{ marginTop: 16 }}>
                  <SectionLabel>NEXT FIXTURES</SectionLabel>
                  <Row
                    label="NEXT"
                    a={dash(nextOpponent(sideA.fixtures))}
                    b={dash(nextOpponent(sideB.fixtures))}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      {sideA.fixtures?.length
                        ? <FixtureRun cells={sideA.fixtures} max={3} />
                        : <span style={{ fontSize: 11.5, color: MUTED }}>—</span>}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      {sideB.fixtures?.length
                        ? <FixtureRun cells={sideB.fixtures} max={3} />
                        : <span style={{ fontSize: 11.5, color: MUTED }}>—</span>}
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <SectionLabel>FANTASY RECORD</SectionLabel>
                    <Row label="TOTAL POINTS"
                      a={recordCell(sideA, (r) => String(r.totalPoints))}
                      b={recordCell(sideB, (r) => String(r.totalPoints))} />
                    <Row label="POINTS PER GAME"
                      a={recordCell(sideA, (r) => dash(r.perGame))}
                      b={recordCell(sideB, (r) => dash(r.perGame))} />
                    <Row label="RECENT RETURNS"
                      a={recordCell(sideA, (r) => r.recentGames ? `${r.recentReturns} pts` : "—")}
                      b={recordCell(sideB, (r) => r.recentGames ? `${r.recentReturns} pts` : "—")} />
                    <Row label="RECENT STARTS"
                      a={recordCell(sideA, (r) => r.recentGames ? `${r.recentStarts} of ${r.recentGames}` : "—")}
                      b={recordCell(sideB, (r) => r.recentGames ? `${r.recentStarts} of ${r.recentGames}` : "—")} />
                    <Row label="GOALS"
                      a={recordCell(sideA, (r) => dash(r.goals))}
                      b={recordCell(sideB, (r) => dash(r.goals))} />
                    <Row label="ASSISTS"
                      a={recordCell(sideA, (r) => dash(r.assists))}
                      b={recordCell(sideB, (r) => dash(r.assists))} />
                  </div>

                  {(sideA.profile.status === "error" || sideB.profile.status === "error") && (
                    <p style={{ fontSize: 11.5, color: MUTED, margin: "2px 2px 0", lineHeight: 1.45 }}>
                      Some record data couldn&apos;t load, so it shows as &ldquo;…&rdquo;. Everything shown is real.
                    </p>
                  )}

                  {/* The factual difference read — describes, never crowns. */}
                  {summary.length > 0 && (
                    <div style={{
                      marginTop: 16, background: PANEL, border: `1px solid ${tint(TEAL, "33")}`,
                      borderRadius: 12, padding: 13,
                    }}>
                      <div className="font-display tracking-widest" style={{ fontSize: 11, color: TEAL, marginBottom: 7 }}>
                        THE DIFFERENCES
                      </div>
                      <p style={{ margin: 0, fontSize: 13.5, color: INK, lineHeight: 1.55 }}>
                        {summary.join(" ")}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <Btn onClick={onClose}>Done</Btn>
              </div>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
