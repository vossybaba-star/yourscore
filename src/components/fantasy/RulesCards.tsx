"use client";
/**
 * The rules stepper — eight full-screen story cards, one per beat of the
 * journey, sitting above the chronological walkthrough on /fantasy/rules.
 *
 * Story-style (IG stories / app onboarding), not a carousel of ad tiles: one
 * card on screen at a time, a segmented progress bar, tap the right ~62% to
 * advance, the left ~38% to go back, swipe works too. The last card hands off
 * to the full walkthrough below it or opens the rules bot.
 *
 * Same law as the rest of the page: every number comes from the engine's own
 * exports, never typed by hand. The one exception is the captain's ×2/×3 —
 * neither is an exported constant (effectiveCaptain/scoreEntry double or
 * triple inline in engine.ts), so the brief allows them here as plain copy,
 * same as the existing walkthrough body does.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode, type TouchEvent,
} from "react";
import {
  BASELINE_CREDITS_PER_GW, BUDGET_TENTHS, CASH_POINTS, CHIPS, CREDIT_CAP,
  creditsForRound, HIT_POINTS, MAX_PER_CLUB, SQUAD_QUOTA, SQUAD_SIZE, XI_SIZE,
  type FantasyPos,
} from "@/lib/fantasy/engine";
import { pointsFor, type MatchFacts } from "@/lib/fantasy/values";
import { KNOWLEDGE_NAME } from "@/lib/fantasy/brand";
import {
  Chip, CORAL, Crest, Deadline, factLine, fmtM, GOLD, INK, LINE, MUTED,
  PANEL, PANEL_2, PITCH, TEAL, tint, type ClientPoolPlayer,
} from "@/components/fantasy/shared";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { MovesBank } from "@/components/fantasy/MovesBank";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";

const money = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;

// The credit curve, read off the engine rather than restated — same
// technique the walkthrough page's own CREDIT_STEPS table uses.
const CREDIT_STEPS = (() => {
  const steps: { correct: number; credits: number }[] = [];
  let last = 0;
  for (let c = 0; c <= 11; c++) {
    const credits = creditsForRound(c);
    if (credits !== last) { steps.push({ correct: c, credits }); last = credits; }
  }
  return steps;
})();
const CREDIT_CURVE_TEXT = CREDIT_STEPS.map((s) => `${s.correct} right → ${s.credits}`).join(" · ");

// ── live data — the two PUBLIC endpoints, fetched once on mount ─────────────
// Founder feedback: these scenes should read as the real screen, not a stand
// in. /api/fantasy/pool (edge cached 1h) and /api/pl/fixtures (this
// gameweek's real fixtures) are both public, no auth. Every scene renders
// instantly with its static sample as fallback and swaps in live data the
// moment the fetch lands — silently, on any failure (non-200, empty payload,
// the 409 a missing gameweek returns), the sample simply stays put.
interface LiveFixture { home: string; away: string; kickoff_at: string }
interface LiveData { pool: ClientPoolPlayer[] | null; fixtures: LiveFixture[] | null }
const EMPTY_LIVE: LiveData = { pool: null, fixtures: null };
const LiveDataContext = createContext<LiveData>(EMPTY_LIVE);

function useLiveFantasyData(): LiveData {
  const [live, setLive] = useState<LiveData>(EMPTY_LIVE);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const [poolRes, fixturesRes] = await Promise.allSettled([
        fetch("/api/fantasy/pool", { signal: controller.signal }),
        fetch("/api/pl/fixtures", { signal: controller.signal }),
      ]);
      let pool: ClientPoolPlayer[] | null = null;
      let fixtures: LiveFixture[] | null = null;
      if (poolRes.status === "fulfilled" && poolRes.value.ok) {
        const json = await poolRes.value.json().catch(() => null);
        if (Array.isArray(json?.players) && json.players.length) pool = json.players;
      }
      if (fixturesRes.status === "fulfilled" && fixturesRes.value.ok) {
        const json = await fixturesRes.value.json().catch(() => null);
        if (Array.isArray(json?.fixtures) && json.fixtures.length) fixtures = json.fixtures;
      }
      if (!controller.signal.aborted && (pool || fixtures)) setLive({ pool, fixtures });
    })();
    return () => controller.abort();
  }, []);
  return live;
}

/** Live players carry a full name only — surname it for the marker label, the
 *  same shape the static P sample's `.label` already provides. */
const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;
/** The pool's `price` is £m (e.g. 14.5), not tenths — fmtM and the engine's
 *  BUDGET_TENTHS/MAX_PER_CLUB math want tenths, same units the static P
 *  sample's prices already use. */
const liveTenths = (p: ClientPoolPlayer) => Math.round(p.price * 10);

// ── scene fragments — miniature slices of the REAL fantasy screens ──────────
// Founder feedback: abstract SVG diagrams don't teach a user what to actually
// tap. Every scene below is built from the app's own presentational
// components (PlayerMarker, PitchSurface, BenchStrip, MovesBank, Deadline,
// Chip, Crest, PlayerAvatar) fed static sample data — never a redrawn
// stand-in. Each sits inside the same "window onto the real screen" frame: a
// rounded clip, a hairline border, the pitch background, content scaled down
// so it reads as a segment of an actual screen rather than a diagram.
// aria-hidden + pointer-events: none throughout, so a tap still lands on the
// stepper's own left/right zones, never on the scene.

function SceneFrame({ children, align = "center", scale = 0.86 }: {
  children: ReactNode;
  /** "center" for short slices (no dead space around them); "top" for tall
   *  content that is MEANT to crop at the bottom, like the full pitch. */
  align?: "top" | "center";
  scale?: number;
}) {
  return (
    <div aria-hidden style={{ pointerEvents: "none", width: "100%", height: "100%", position: "relative" }}>
      <div style={{
        position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14,
        border: `1px solid ${LINE}`, background: PITCH,
      }}>
        <div aria-hidden style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
        }} />
        <div style={{
          position: "absolute", inset: 0, display: "flex", justifyContent: "center",
          alignItems: align === "center" ? "center" : "flex-start",
          padding: 10, transform: `scale(${scale})`,
          transformOrigin: align === "center" ? "center center" : "top center",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Sample squad — real PL names, real clubs (so the real Crest renders),
// MAX_PER_CLUB respected across the 15: Arsenal 3, Newcastle United 3,
// Man City 2, Aston Villa 2, Liverpool 2, Man United 1, Chelsea 1, Spurs 1.
// Prices are plausible sample data, not looked-up facts.
const P = {
  haaland: { name: "Erling Haaland", label: "Haaland", club: "Man City", price: 145 },
  watkins: { name: "Ollie Watkins", label: "Watkins", club: "Aston Villa" },
  saka: { name: "Bukayo Saka", label: "Saka", club: "Arsenal", price: 100 },
  fernandes: { name: "Bruno Fernandes", label: "Fernandes", club: "Man United", price: 85 },
  palmer: { name: "Cole Palmer", label: "Palmer", club: "Chelsea", price: 105 },
  son: { name: "Son Heung-min", label: "Son", club: "Tottenham Hotspur", price: 75 },
  saliba: { name: "William Saliba", label: "Saliba", club: "Arsenal" },
  gvardiol: { name: "Josko Gvardiol", label: "Gvardiol", club: "Man City" },
  konsa: { name: "Ezri Konsa", label: "Konsa", club: "Aston Villa" },
  trippier: { name: "Kieran Trippier", label: "Trippier", club: "Newcastle United", price: 65 },
  alisson: { name: "Alisson Becker", label: "Alisson", club: "Liverpool", price: 55 },
  raya: { name: "David Raya", label: "Raya", club: "Arsenal" },
  robertson: { name: "Andy Robertson", label: "Robertson", club: "Liverpool" },
  gordon: { name: "Anthony Gordon", label: "Gordon", club: "Newcastle United" },
  isak: { name: "Alexander Isak", label: "Isak", club: "Newcastle United" },
} as const;

/** Shape every squad/captain/scoring marker renders from, whether it's a
 *  static P sample entry or a live pool player mapped through this. */
interface MarkerPlayer { name: string; label: string; club: string; avatarUrl?: string | null; price?: number }
const toLiveMarker = (p: ClientPoolPlayer): MarkerPlayer =>
  ({ name: p.name, label: surname(p.name), club: p.club, avatarUrl: p.avatarUrl, price: liveTenths(p) });

/** Mid build on the real builder: for each position, the priciest players the
 *  live pool has, respecting MAX_PER_CLUB across the whole 15 — same rule
 *  validateSquad enforces server side. Returns null if the pool can't fill a
 *  full XI + bench (too few players for a position, or too club-concentrated),
 *  in which case the scene falls back to the static sample. */
function pickLiveSquad(pool: ClientPoolPlayer[]) {
  const used = new Set<number>();
  const clubCount = new Map<number, number>();
  const takeTop = (pos: FantasyPos, n: number): ClientPoolPlayer[] => {
    const picked: ClientPoolPlayer[] = [];
    for (const p of pool.filter((x) => x.pos === pos && !used.has(x.id)).sort((a, b) => b.price - a.price)) {
      if (picked.length >= n) break;
      const count = clubCount.get(p.clubId) ?? 0;
      if (count >= MAX_PER_CLUB) continue;
      picked.push(p); used.add(p.id); clubCount.set(p.clubId, count + 1);
    }
    return picked;
  };
  const fwd = takeTop("FWD", 2);
  const mid = takeTop("MID", 4);
  const def = takeTop("DEF", 4);
  const gk = takeTop("GK", 1);
  const benchGk = takeTop("GK", 1);
  const benchOutfield: ClientPoolPlayer[] = [];
  for (const p of pool.filter((x) => x.pos !== "GK" && !used.has(x.id)).sort((a, b) => b.price - a.price)) {
    if (benchOutfield.length >= 3) break;
    const count = clubCount.get(p.clubId) ?? 0;
    if (count >= MAX_PER_CLUB) continue;
    benchOutfield.push(p); used.add(p.id); clubCount.set(p.clubId, count + 1);
  }
  if (fwd.length < 2 || mid.length < 4 || def.length < 4 || gk.length < 1
    || benchGk.length < 1 || benchOutfield.length < 3) return null;
  // The picker strip: the next best players still on the market, not yet on
  // this squad — mirrors what the builder's own list shows mid session.
  const extra = pool.filter((x) => !used.has(x.id)).sort((a, b) => b.price - a.price).slice(0, 3);
  return {
    rows: [
      { pos: "FWD" as FantasyPos, size: 24, players: fwd.map(toLiveMarker) },
      { pos: "MID" as FantasyPos, size: 20, players: mid.map(toLiveMarker) },
      { pos: "DEF" as FantasyPos, size: 20, players: def.map(toLiveMarker) },
      { pos: "GK" as FantasyPos, size: 24, players: gk.map(toLiveMarker) },
    ],
    bench: [...benchGk, ...benchOutfield].map(toLiveMarker),
    picker: extra.map(toLiveMarker),
  };
}

function SquadScene() {
  const { pool } = useContext(LiveDataContext);
  const live = useMemo(() => (pool ? pickLiveSquad(pool) : null), [pool]);

  // The real attacking-top row order (lib/fantasy/board's ATTACK_ORDER):
  // forwards nearest the opposition goal, keeper at the back.
  // Sizes stay small: the pitch is a 1:1 square, so four full-height marker
  // rows (as the 375px hub draws them) would overflow this miniature and crop
  // the keeper out of the story.
  const rows: { pos: FantasyPos; size: number; players: MarkerPlayer[] }[] = live?.rows ?? [
    { pos: "FWD", size: 24, players: [P.haaland, P.watkins] },
    { pos: "MID", size: 20, players: [P.saka, P.fernandes, P.palmer, P.son] },
    { pos: "DEF", size: 20, players: [P.saliba, P.gvardiol, P.konsa, P.trippier] },
    { pos: "GK", size: 24, players: [P.alisson] },
  ];
  const bench: MarkerPlayer[] = live?.bench ?? [P.raya, P.robertson, P.gordon, P.isak];
  // The picker strip below the pitch — a slim slice of the builder's own
  // browse list: face, name, crest, real price, a quiet + Add affordance.
  const picker: MarkerPlayer[] = live?.picker ?? [P.fernandes, P.palmer, P.son];

  return (
    <SceneFrame align="top" scale={0.82}>
      <div style={{ width: 270 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <Chip gold>{fmtM(BUDGET_TENTHS)}</Chip>
        </div>
        <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, display: "flex", alignItems: "stretch", overflow: "hidden" }}>
          <PitchSurface round="left">
            {rows.map((row) => (
              <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 3 }}>
                {row.players.map((p) => (
                  <div key={p.label} style={{ flex: "1 1 0", maxWidth: 48, minWidth: 0 }}>
                    <PlayerMarker name={p.name} label={p.label} club={p.club} avatarUrl={p.avatarUrl} size={row.size} />
                  </div>
                ))}
              </div>
            ))}
          </PitchSurface>
          <BenchStrip>
            {bench.map((p) => <PlayerMarker key={p.label} name={p.name} label={p.label} club={p.club} avatarUrl={p.avatarUrl} size={18} dim />)}
          </BenchStrip>
        </div>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {picker.map((p) => (
            <div key={p.label} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
              borderRadius: 8, background: PANEL_2, border: `1px solid ${LINE}`,
            }}>
              <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={20} />
              <span style={{
                fontSize: 10, fontWeight: 600, color: INK, flex: 1, minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{p.label}</span>
              <Crest club={p.club} size={12} />
              <span style={{ fontSize: 9.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{fmtM(p.price ?? 0)}</span>
              <span style={{
                fontSize: 8.5, fontWeight: 700, color: TEAL, background: tint(TEAL, "1e"),
                border: `1px solid ${tint(TEAL, "44")}`, borderRadius: 999, padding: "2px 6px", flexShrink: 0,
              }}>+ Add</span>
            </div>
          ))}
        </div>
      </div>
    </SceneFrame>
  );
}

function CaptainScene() {
  const { pool } = useContext(LiveDataContext);
  const attackers = useMemo(() => {
    if (!pool) return null;
    const fwds = pool.filter((p) => p.pos === "FWD").sort((a, b) => b.price - a.price);
    return fwds.length >= 2 ? [fwds[0], fwds[1]].map(toLiveMarker) : null;
  }, [pool]);
  const captain: MarkerPlayer = attackers?.[0] ?? P.haaland;
  const vice: MarkerPlayer = attackers?.[1] ?? P.saka;
  return (
    <SceneFrame>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 40 }}>
        <div style={{ width: 154 }}>
          <PlayerMarker name={captain.name} label={captain.label} club={captain.club} avatarUrl={captain.avatarUrl}
            size={128} isCaptain datum="scores ×2" />
        </div>
        <div style={{ width: 118, opacity: 0.85 }}>
          <PlayerMarker name={vice.name} label={vice.label} club={vice.club} avatarUrl={vice.avatarUrl}
            size={94} isVice datum="steps up" />
        </div>
      </div>
    </SceneFrame>
  );
}

/** "Sat 17:30" — weekday plus a 24h clock, in the viewer's own timezone (same
 *  convention as the Deadline pill above it), built by hand rather than via
 *  toLocaleTimeString so the hour never grows an AM/PM suffix in a locale
 *  that defaults to 12h. */
function formatKickoff(iso: string): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function DeadlineScene() {
  // Computed client-side at render, not a fixed date — the component is
  // client-only ("use client" at the top of this file), so there is no
  // server/client hydration mismatch to worry about.
  const [iso] = useState(() => new Date(Date.now() + 40 * 3_600_000).toISOString());
  const { fixtures: liveFixtures } = useContext(LiveDataContext);
  const fallback = [
    { home: "Arsenal", away: "Man City", time: "17:30" },
    { home: "Liverpool", away: "Chelsea", time: "20:00" },
  ];
  const rows = liveFixtures?.length
    ? liveFixtures.slice(0, 4).map((f) => ({ home: f.home, away: f.away, time: formatKickoff(f.kickoff_at) }))
    : fallback;
  const more = liveFixtures && liveFixtures.length > 4 ? liveFixtures.length - 4 : 0;
  return (
    <SceneFrame>
      <div style={{ width: "100%" }}>
        <Deadline iso={iso} compact />
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {rows.map((f, i) => (
            <div key={`${f.home}-${i}`} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
              borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`,
            }}>
              <Crest club={f.home} size={14} />
              <span style={{ fontSize: 10.5, color: MUTED, fontWeight: 700 }}>v</span>
              <Crest club={f.away} size={14} />
              <span style={{ marginLeft: "auto", fontSize: 10.5, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{f.time}</span>
            </div>
          ))}
        </div>
        {more > 0 && (
          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 5, textAlign: "right" }}>
            +{more} more this gameweek
          </div>
        )}
      </div>
    </SceneFrame>
  );
}

function RoundScene() {
  const options = [
    { label: "Harry Kane", correct: false },
    { label: "Son Heung-min", correct: true },
  ];
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "10px 11px" }}>
          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: MUTED, marginBottom: 5 }}>QUESTION 6 OF 11</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginBottom: 8, lineHeight: 1.35 }}>
            Who scored the most goals against Spurs?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {options.map((o) => (
              <div key={o.label} style={{
                padding: "7px 9px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: INK,
                background: o.correct ? "#1E3B2A" : PANEL,
                border: `1.5px solid ${o.correct ? GOLD : LINE}`,
              }}>{o.label}{o.correct ? "  ✓" : ""}</div>
            ))}
          </div>
        </div>
        <MovesBank held={BASELINE_CREDITS_PER_GW} cap={CREDIT_CAP} roundEarns />
      </div>
    </SceneFrame>
  );
}

function BankScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
        <MovesBank held={CREDIT_CAP} cap={CREDIT_CAP} chips={[{ label: "Triple Captain", accent: GOLD }]} />
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 10, padding: "7px 9px" }}>
            <div style={{ fontSize: 9.5, color: MUTED }}>Extra move</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: CORAL }}>−{HIT_POINTS}</div>
          </div>
          <div style={{ flex: 1, background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 10, padding: "7px 9px" }}>
            <div style={{ fontSize: 9.5, color: MUTED }}>Cashed out</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>+{CASH_POINTS}</div>
          </div>
        </div>
      </div>
    </SceneFrame>
  );
}

// Reproduced from FantasyHub's own CHIP_META — that array is module-private,
// so the labels and blurbs are copied here verbatim rather than imported.
const CHIP_LOOK: Record<string, { label: string; blurb: string }> = {
  triple_captain: { label: "Triple Captain", blurb: "Your captain scores ×3" },
  bench_boost: { label: "Bench Boost", blurb: "All 15 players score, bench included" },
  insight: { label: "Insight", blurb: "50/50 on one question of the round" },
};

function ChipsScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <Chip teal>One chip a month</Chip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {CHIPS.map((key, i) => {
            const c = CHIP_LOOK[key];
            const playable = i === 0;
            return (
              <div key={key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 10,
                background: PANEL, border: `1px solid ${LINE}`,
                color: playable ? INK : MUTED, opacity: playable ? 1 : 0.55,
              }}>
                <span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, display: "block" }}>{c.label}</span>
                  <span style={{ fontSize: 10, display: "block" }}>{c.blurb}</span>
                </span>
                <span style={{ fontSize: 9.5, color: MUTED, flexShrink: 0 }}>{playable ? "Play" : "Held"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </SceneFrame>
  );
}

// Sample match facts, run through the real scoring function — the points
// shown are computed, never typed by hand. Five slots so the card fills
// (founder feedback: three left dead space): keeper, defender, two
// midfielders, forward — the forward wears the armband, so his row doubles.
type ScoringSlot = "GK" | "DEF" | "MID1" | "MID2" | "FWD";
const SCORING_POS: Record<ScoringSlot, FantasyPos> = { GK: "GK", DEF: "DEF", MID1: "MID", MID2: "MID", FWD: "FWD" };
const SCORING_FACTS: Record<ScoringSlot, MatchFacts> = {
  GK: { minutes: 90, goals: 0, assists: 0, cleanSheet: 1, conceded: 0, saves: 3, pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0 },
  DEF: { minutes: 90, goals: 0, assists: 0, cleanSheet: 1, conceded: 0, saves: 0, pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 12, dcRec: 0 },
  MID1: { minutes: 90, goals: 1, assists: 1, cleanSheet: 0, conceded: 1, saves: 0, pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0 },
  MID2: { minutes: 90, goals: 0, assists: 1, cleanSheet: 0, conceded: 1, saves: 0, pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0 },
  FWD: { minutes: 90, goals: 2, assists: 0, cleanSheet: 0, conceded: 1, saves: 0, pensSaved: 0, pensMissed: 0, yellows: 0, reds: 0, ownGoals: 0, dc: 0, dcRec: 0 },
};
const SCORING_ORDER: ScoringSlot[] = ["GK", "DEF", "MID1", "MID2", "FWD"];
const SCORING_CAPTAIN: ScoringSlot = "FWD";
const SCORING_FALLBACK: Record<ScoringSlot, MarkerPlayer> = {
  GK: P.alisson, DEF: P.trippier, MID1: P.palmer, MID2: P.son, FWD: P.haaland,
};

/** The priciest GK, DEF, two MIDs and a FWD the live pool can offer — same
 *  "well known, real face" idea as the squad and captain scenes. Returns null
 *  (falls back to the static sample) if the pool is missing a position. */
function pickScoringFive(pool: ClientPoolPlayer[]): Partial<Record<ScoringSlot, MarkerPlayer>> | null {
  const byPos = (pos: FantasyPos) => pool.filter((p) => p.pos === pos).sort((a, b) => b.price - a.price);
  const gk = byPos("GK")[0];
  const def = byPos("DEF")[0];
  const mids = byPos("MID");
  const fwd = byPos("FWD")[0];
  if (!gk || !def || mids.length < 2 || !fwd) return null;
  return { GK: toLiveMarker(gk), DEF: toLiveMarker(def), MID1: toLiveMarker(mids[0]), MID2: toLiveMarker(mids[1]), FWD: toLiveMarker(fwd) };
}

function ScoringScene() {
  const { pool } = useContext(LiveDataContext);
  const live = useMemo(() => (pool ? pickScoringFive(pool) : null), [pool]);
  return (
    <SceneFrame>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
        {SCORING_ORDER.map((slot) => {
          const player = live?.[slot] ?? SCORING_FALLBACK[slot];
          const pos = SCORING_POS[slot];
          const facts = SCORING_FACTS[slot];
          const isCaptain = slot === SCORING_CAPTAIN;
          const points = pointsFor(pos, facts) * (isCaptain ? 2 : 1);
          return (
            <div key={slot} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", minHeight: 44,
              borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}`,
            }}>
              <div style={{ width: 42, flexShrink: 0 }}>
                <PlayerMarker name={player.name} label={player.label} club={player.club} avatarUrl={player.avatarUrl}
                  size={24} isCaptain={isCaptain} />
              </div>
              <span style={{ flex: 1, fontSize: 10, color: MUTED, minWidth: 0 }}>{factLine(pos, facts)}</span>
              {isCaptain && (
                <span style={{ fontSize: 9, fontWeight: 800, color: GOLD }}>×2</span>
              )}
              <span style={{ fontSize: 13, fontWeight: 700, color: GOLD }}>{points}</span>
            </div>
          );
        })}
      </div>
    </SceneFrame>
  );
}

// Reproduced from GlobalStandings' own Row() — sample names, sample points.
const STANDINGS_SAMPLE = [
  { rank: 1, name: "Jordan K", points: 812, isMe: false },
  { rank: 2, name: "Alex M", points: 795, isMe: true },
  { rank: 3, name: "Priya S", points: 780, isMe: false },
  { rank: 4, name: "Marcus O", points: 754, isMe: false },
];

function TablesScene() {
  return (
    <SceneFrame>
      <div style={{ width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <span style={{ fontSize: 9, letterSpacing: "0.1em", color: MUTED }}>GLOBAL STANDINGS</span>
          <Chip teal>AUGUST</Chip>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {STANDINGS_SAMPLE.map((r) => (
            <div key={r.rank} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 8,
              background: r.isMe ? tint(TEAL, "18") : PANEL,
              border: `1px solid ${r.isMe ? tint(TEAL, "66") : LINE}`,
            }}>
              <span style={{ width: 14, textAlign: "center", fontWeight: 800, fontSize: 10.5, color: r.rank <= 3 ? GOLD : MUTED }}>{r.rank}</span>
              <PlayerAvatar name={r.name} size={17} />
              <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: INK, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}{r.isMe && <span style={{ color: TEAL, fontWeight: 700 }}> · you</span>}
              </span>
              <span style={{ fontWeight: 800, fontSize: 11, color: INK }}>{r.points}</span>
            </div>
          ))}
        </div>
      </div>
    </SceneFrame>
  );
}
// ── card content ───────────────────────────────────────────────────────────
interface CardDef { title: string; body: string; factRow?: string; Scene: () => ReactNode }

const CARDS: CardDef[] = [
  {
    title: "Build your squad",
    Scene: SquadScene,
    body: `Pick ${SQUAD_SIZE} players for ${money(BUDGET_TENTHS)}, with no more than ${MAX_PER_CLUB} from any one club. ${XI_SIZE} of them start each gameweek, the rest wait on the bench. Rebuild your squad as often as you like, right up until your first gameweek locks.`,
    factRow: `${SQUAD_QUOTA.GK} keepers · ${SQUAD_QUOTA.DEF} defenders · ${SQUAD_QUOTA.MID} midfielders · ${SQUAD_QUOTA.FWD} forwards`,
  },
  {
    title: "Name your captain",
    Scene: CaptainScene,
    body: "The armband doubles his score. If he does not play a single minute, your vice captain steps up in his place. If neither of them takes the pitch, the armband passes to whichever starter is in the best form, so the double is never wasted.",
  },
  {
    title: "Beat the deadline",
    Scene: DeadlineScene,
    body: "Your team locks the moment the gameweek's first match kicks off. Miss the deadline and your team simply plays exactly as it stands. Nothing is lost and nothing changes, there is no penalty beyond that.",
  },
  {
    title: "Earn extra transfers",
    Scene: RoundScene,
    body: `Everyone gets ${BASELINE_CREDITS_PER_GW} free transfer every single gameweek, no strings attached. Play the optional ${KNOWLEDGE_NAME} round of eleven questions and right answers earn you more. Skip it entirely and you still play the gameweek exactly as normal.`,
    factRow: CREDIT_CURVE_TEXT,
  },
  {
    title: "Bank your moves",
    Scene: BankScene,
    body: `Transfers you earn apply to your next gameweek, banking up to ${CREDIT_CAP} at a time. Go beyond what you hold and each extra move costs ${HIT_POINTS} points. If your bank is already full, further earned transfers cash out at ${CASH_POINTS} points each, straight onto your score.`,
  },
  {
    title: "Play a chip",
    Scene: ChipsScene,
    body: `You get one chip a month, your pick of three. Triple Captain scores your captain at ×3, Bench Boost scores all ${SQUAD_SIZE} of your players including the bench, and Insight removes two wrong answers from one question in the round. A chip cannot come back around until you have used the other two.`,
  },
  {
    title: "Score on real matches",
    Scene: ScoringScene,
    body: "Every point you score traces back to a real match fact: goals, assists, clean sheets, minutes played, saves. No panel sits behind the scenes deciding your bonus. Two managers with the same players always score exactly the same.",
  },
  {
    title: "Climb the tables",
    Scene: TablesScene,
    body: `Your season total keeps a running score across every gameweek, alongside a fresh monthly competition, so a rough month never buries your whole season. Any leagues you have joined sit alongside both. Level on points, the better round record wins, ${KNOWLEDGE_NAME} is the tiebreak.`,
  },
];

export function RulesCards({ onDone }: { onDone?: () => void } = {}) {
  const live = useLiveFantasyData();
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const isLast = index === CARDS.length - 1;
  const card = CARDS[index];

  const goNext = useCallback(() => {
    setDir("next");
    setIndex((i) => Math.min(CARDS.length - 1, i + 1));
  }, []);
  const goBack = useCallback(() => {
    setDir("back");
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goNext(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  };
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null) return;
    const delta = (e.changedTouches[0]?.clientX ?? start) - start;
    if (delta <= -40) goNext();
    else if (delta >= 40) goBack();
  };

  const handleDone = useCallback(() => {
    if (onDone) { onDone(); return; }
    rootRef.current?.nextElementSibling?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [onDone]);

  const askQuestion = useCallback(() => {
    window.dispatchEvent(new CustomEvent("rules-bot-open"));
  }, []);

  // Recomputed only when index changes, so a plain render (e.g. a parent
  // re-render) doesn't recreate the button handlers on every paint.
  const lastCardActions = useMemo(() => (isLast ? { handleDone, askQuestion } : null), [isLast, handleDone, askQuestion]);

  return (
    <LiveDataContext.Provider value={live}>
    <div ref={rootRef} style={{ margin: "18px 0 4px" }}>
      <div
        tabIndex={0}
        role="group"
        aria-roledescription="story"
        aria-label={`How it works, card ${index + 1} of ${CARDS.length}: ${card.title}`}
        onKeyDown={onKeyDown}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{ outline: "none" }}
      >
        <div
          key={index}
          className={dir === "next" ? "rules-card-in-next" : "rules-card-in-back"}
          style={{
            position: "relative", overflow: "hidden",
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 20,
            height: "64dvh", minHeight: 420, maxHeight: 560, width: "100%",
            display: "flex", flexDirection: "column", padding: "16px 18px 18px",
          }}
        >
          <div style={{ display: "flex", gap: 4 }}>
            {CARDS.map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i <= index ? TEAL : LINE,
                opacity: i === index ? 0.55 : 1,
              }} />
            ))}
          </div>
          <div className="font-body" style={{ textAlign: "right", fontSize: 11, color: MUTED, marginTop: 6 }}>
            {index + 1} of {CARDS.length}
          </div>

          <div className="font-display tracking-widest" style={{ fontSize: 11, color: TEAL, marginTop: 14 }}>
            {`STEP ${index + 1}`}
          </div>
          <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 4, lineHeight: 1.15 }}>
            {card.title}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", margin: "8px 0" }}>
            <card.Scene />
          </div>

          <p style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, margin: 0 }}>{card.body}</p>

          {card.factRow && (
            <div className="font-body" style={{
              alignSelf: "flex-start", marginTop: 10, borderRadius: 999,
              background: PANEL_2, border: `1px solid ${LINE}`, color: INK,
              fontSize: 11.5, padding: "6px 12px",
            }}>
              {card.factRow}
            </div>
          )}

          {index === 0 && (
            <div className="font-body" style={{ marginTop: "auto", paddingTop: 10, textAlign: "center", fontSize: 11, color: MUTED }}>
              Tap to continue
            </div>
          )}

          {lastCardActions && (
            <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, position: "relative", zIndex: 3 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lastCardActions.handleDone(); }}
                className="font-body rounded-xl"
                style={{
                  width: "100%", padding: "13px 16px", fontSize: 14.5, fontWeight: 700,
                  background: TEAL, color: "#03211d", border: `1px solid ${TEAL}`, cursor: "pointer",
                }}
              >
                Read the full rules
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); lastCardActions.askQuestion(); }}
                className="font-body rounded-xl"
                style={{
                  width: "100%", padding: "13px 16px", fontSize: 14.5, fontWeight: 600,
                  background: PANEL_2, color: INK, border: `1px solid ${LINE}`, cursor: "pointer",
                }}
              >
                Ask a question
              </button>
            </div>
          )}

          <div
            aria-hidden
            onClick={goBack}
            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "38%", zIndex: 2, cursor: "pointer" }}
          />
          <div
            aria-hidden
            onClick={goNext}
            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "62%", zIndex: 2, cursor: "pointer" }}
          />
        </div>
      </div>
    </div>
    </LiveDataContext.Provider>
  );
}
