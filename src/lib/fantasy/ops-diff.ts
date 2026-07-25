/**
 * fantasy-ops — pure comparators.
 *
 * Guard A (calendar) and Guard B (facts) diffing, plus the fingerprint dedupe
 * that stops the hourly cron from re-alerting on an unchanged finding. Zero
 * I/O — no fetch, no DB — so every branch is testable on synthetic input.
 *
 * Deliberately split out of ops.ts: ops.ts carries `import "server-only"`,
 * which THROWS the moment the module is `require()`d outside a React Server
 * Component context (see node_modules/server-only/index.js) — so it cannot be
 * loaded by a plain `node --test` run. context.ts hit the same wall and the
 * fix already in this codebase is the same one applied here: keep the pure,
 * testable logic in a plain module (clubKey.ts for context.ts; this file for
 * ops.ts) and let the server-only file import it, not the other way round.
 * Even the fail-open decision on season.ts's ops_hold read lives here
 * (`interpretHoldRead`) for the same reason — season.ts is ALSO server-only.
 */
import type { FantasyPos, MatchFacts } from "./values";

export type OpsGuard = "A" | "B";
export type OpsAction = "alerted" | "clear" | "held" | "green" | "skipped";
export interface OpsReport { guard: OpsGuard; gw: number; action: OpsAction; detail: string }

// ── Guard A: calendar ────────────────────────────────────────────────────────

export interface GwCalRow {
  gw: number; window_start: string; window_end: string;
  deadline: string | null; status: string; sm_season_id: number;
}

export interface OpsFixture {
  id: number;
  /** raw SportMonks "YYYY-MM-DD HH:MM:SS", UTC with no zone marker. */
  startingAt: string | null;
  stateId: number | null;
  clubIds: number[];
  clubNames: string[];
}
export interface OpsRound { gw: number; fixtures: OpsFixture[] }

export interface FplEvent { id: number; deadline_time: string; finished?: boolean }

export interface CalendarFinding {
  type: "deadline_drift" | "out_of_window" | "bad_state" | "club_count" | "no_kickoff_data";
  gw: number;
  /** Stable identity for fingerprinting — deliberately independent of the
   *  human-readable `detail` text (which embeds volatile display formatting). */
  key: string;
  detail: string;
}

/** POSTPONED, SUSPENDED, CANCELLED, ABANDONED — a currently-live fixture in any
 *  of these states means the calendar has moved under us. */
const BAD_STATE_IDS = new Set([10, 11, 12, 15]);
const DEADLINE_LEAD_MIN = 90;
/** Deadline drift tolerance — a scheduling nudge under an hour is normal TV
 *  reshuffling noise; anything past it is worth a human's eyes. */
const DEADLINE_DRIFT_TOLERANCE_MS = 60 * 60 * 1000;

/** SportMonks hands back "2026-08-21 19:00:00" with no zone marker — it is UTC
 *  (same parse as ingest.ts and build-calendar.mjs). */
const asUtc = (s: string) => new Date(`${s.replace(" ", "T")}Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Scope: the gameweek being played right now (lowest non-final) plus the next
 *  two — the near-term window where a fixture reshuffle actually threatens a
 *  live or imminent deadline. Sorted ascending. */
export function selectGuardAScope(dbGws: GwCalRow[]): GwCalRow[] {
  return dbGws.filter((g) => g.status !== "final").sort((a, b) => a.gw - b.gw).slice(0, 3);
}

function firstKickoff(round: OpsRound): Date | null {
  const times = round.fixtures.map((f) => f.startingAt).filter((s): s is string => !!s).sort();
  return times.length ? asUtc(times[0]) : null;
}

/**
 * Diff the DB's calendar against SportMonks' rounds and FPL's own deadlines.
 * Pure: takes the already-fetched round map and FPL events, returns findings
 * tagged by gw. A gw with no published round yet is skipped — that's not a
 * drift, it's upstream not having published, and build-calendar's own dry run
 * already reports that separately.
 */
export function diffCalendar(
  scope: GwCalRow[],
  roundsByGw: Map<number, OpsRound>,
  fplEvents: FplEvent[],
): CalendarFinding[] {
  const findings: CalendarFinding[] = [];
  const eventOf = new Map(fplEvents.map((e) => [e.id, e]));

  for (const gw of scope) {
    const round = roundsByGw.get(gw.gw);
    if (!round || !round.fixtures.length) continue;

    // (a) deadline drift — the SM check and the FPL check are INDEPENDENT of
    //     each other. Nesting the FPL check inside "SM has published kickoff
    //     times" used to mean a round with fixtures still TBD (common weeks
    //     out) silently skipped the FPL cross-check too, with no report at
    //     all — a drift against FPL would go unnoticed for as long as SM
    //     hadn't confirmed times yet.
    if (gw.deadline) {
      const haveDeadlineMs = new Date(gw.deadline).getTime();
      const first = firstKickoff(round);
      if (first) {
        const wantDeadlineMs = first.getTime() - DEADLINE_LEAD_MIN * 60_000;
        const driftMin = Math.round((wantDeadlineMs - haveDeadlineMs) / 60_000);
        if (Math.abs(wantDeadlineMs - haveDeadlineMs) > DEADLINE_DRIFT_TOLERANCE_MS) {
          findings.push({
            type: "deadline_drift", gw: gw.gw, key: `sm:${driftMin}`,
            detail: `DB deadline ${gw.deadline} vs SM first-kickoff−90m ${new Date(wantDeadlineMs).toISOString()}`,
          });
        }
      } else {
        // Round exists but none of its fixtures have a kickoff time yet — a
        // legitimate "not published" state, but it must be VISIBLE, not a
        // silent skip, since it also means the SM check above can't run.
        findings.push({
          type: "no_kickoff_data", gw: gw.gw, key: "nokickoff",
          detail: `skipped: no kickoff data — round ${gw.gw}'s fixtures have no starting_at yet, cannot verify DB deadline against SportMonks`,
        });
      }

      const fplEvent = eventOf.get(gw.gw);
      if (fplEvent?.deadline_time) {
        const fplMs = new Date(fplEvent.deadline_time).getTime();
        const driftMin = Math.round((fplMs - haveDeadlineMs) / 60_000);
        if (Math.abs(fplMs - haveDeadlineMs) > DEADLINE_DRIFT_TOLERANCE_MS) {
          findings.push({
            type: "deadline_drift", gw: gw.gw, key: `fpl:${driftMin}`,
            detail: `DB deadline ${gw.deadline} vs FPL event ${gw.gw} deadline ${fplEvent.deadline_time}`,
          });
        }
      }
    }

    // (b) a fixture whose kickoff date has moved outside the DB's window
    for (const fx of round.fixtures) {
      if (!fx.startingAt) continue;
      const date = ymd(asUtc(fx.startingAt));
      if (date < gw.window_start || date > gw.window_end) {
        findings.push({
          type: "out_of_window", gw: gw.gw, key: `fixture:${fx.id}:${date}`,
          detail: `fixture ${fx.id} (${fx.clubNames.join(" v ")}) kicks off ${date}, outside window [${gw.window_start}, ${gw.window_end}]`,
        });
      }
    }

    // (c) a fixture in the currently-playing gameweek has gone postponed,
    //     suspended, cancelled, or abandoned upstream
    if (gw.status === "locked") {
      for (const fx of round.fixtures) {
        if (fx.stateId != null && BAD_STATE_IDS.has(fx.stateId)) {
          findings.push({
            type: "bad_state", gw: gw.gw, key: `fixture:${fx.id}:state:${fx.stateId}`,
            detail: `fixture ${fx.id} (${fx.clubNames.join(" v ")}) state_id=${fx.stateId}`,
          });
        }
      }
    }

    // (d) blank/double — a normal PL round is 10 fixtures across all 20 clubs,
    //     each appearing exactly once
    if (round.fixtures.length !== 10) {
      findings.push({ type: "club_count", gw: gw.gw, key: `fixturecount:${round.fixtures.length}`, detail: `${round.fixtures.length} fixtures, expected 10` });
    }
    const counts = new Map<number, number>();
    for (const fx of round.fixtures) for (const cid of fx.clubIds) counts.set(cid, (counts.get(cid) ?? 0) + 1);
    if (counts.size < 20) {
      findings.push({ type: "club_count", gw: gw.gw, key: `distinctclubs:${counts.size}`, detail: `only ${counts.size} distinct clubs, expected 20` });
    }
    for (const [cid, n] of Array.from(counts)) {
      if (n !== 1) {
        findings.push({ type: "club_count", gw: gw.gw, key: `club:${cid}:n:${n}`, detail: `club ${cid} appears ${n} time(s), expected 1` });
      }
    }
  }
  return findings;
}

/** Only ever fires for rows an autosync write is safe to touch: open, and the
 *  deadline hasn't passed. Never locked/scored/final, never a passed deadline. */
export function shouldAutosync(status: string, deadlineIso: string | null, now: number): boolean {
  if (status !== "open") return false;
  if (!deadlineIso) return false;
  return new Date(deadlineIso).getTime() > now;
}

/** Autosync is default OFF — only the literal string "true" turns it on. */
export function autosyncEnabled(env: string | undefined): boolean {
  return env === "true";
}

export interface CorrectedGwFields { window_start: string; window_end: string; deadline: string }

/** The corrected window/deadline for a round, same derivation as
 *  build-calendar.mjs (first kickoff − 90m; window = first..last kickoff date). */
export function correctedFieldsFromRound(round: OpsRound): CorrectedGwFields | null {
  const times = round.fixtures.map((f) => f.startingAt).filter((s): s is string => !!s).sort();
  if (!times.length) return null;
  const first = asUtc(times[0]);
  const last = asUtc(times[times.length - 1]);
  return {
    window_start: ymd(first),
    window_end: ymd(last),
    deadline: new Date(first.getTime() - DEADLINE_LEAD_MIN * 60_000).toISOString(),
  };
}

// ── Guard A: raw SportMonks parsing (pure) ───────────────────────────────────

interface RawFixtureParticipant { id: number; name?: string }
interface RawFixture { id: number; starting_at?: string; state_id?: number; participants?: RawFixtureParticipant[] }
interface RawRound { name?: string; fixtures?: RawFixture[] }
export interface RawRoundsResponse { data?: RawRound[] }

/** Turn the raw `/rounds/seasons/{id}?include=fixtures;fixtures.participants`
 *  body into a gw-keyed map. Round→gw mapping is `Number(round.name)`, same as
 *  build-calendar.mjs. A round whose name isn't a plain integer is skipped. */
export function parseRounds(body: RawRoundsResponse): Map<number, OpsRound> {
  const out = new Map<number, OpsRound>();
  for (const r of body.data ?? []) {
    const gw = Number(r.name);
    if (!Number.isInteger(gw)) continue;
    const fixtures: OpsFixture[] = (r.fixtures ?? []).map((f) => ({
      id: f.id,
      startingAt: f.starting_at ?? null,
      stateId: f.state_id ?? null,
      clubIds: (f.participants ?? []).map((p) => p.id),
      clubNames: (f.participants ?? []).map((p) => p.name ?? String(p.id)),
    }));
    out.set(gw, { gw, fixtures });
  }
  return out;
}

// ── Guard B: facts ────────────────────────────────────────────────────────────

/**
 * HOLD tier sets `ops_hold=true` (vetoes finalise) — reserved for fields that
 * are UNAMBIGUOUS against FPL. ALERT tier tells the founder on Telegram but
 * never touches the flag — these fields have known definitional slop against
 * FPL's own numbers (dc/dcr is position-insensitive and we approximate it
 * differently than FPL's own threshold stat; clean-sheet uses full-match-
 * conceded where FPL's rule is 60+min-and-subbed; Opta vs FPL assist
 * attribution differs on deflections/own-goal-adjacent plays) and would hold
 * nearly every gameweek on a non-bug if they could veto finalise. A field
 * moves from ALERT to HOLD here, explicitly, once GW1 live calibration shows
 * it doesn't false-positive — never silently.
 */
export type FactFindingType = "goals" | "assists" | "clean_sheet" | "minutes" | "coverage" | "dc";
export const GUARD_B_TIER: Record<FactFindingType, "hold" | "alert"> = {
  goals: "hold",
  coverage: "hold",
  assists: "alert",
  clean_sheet: "alert",
  minutes: "alert",
  dc: "alert",
};

export interface FactFinding {
  type: FactFindingType;
  tier: "hold" | "alert";
  playerId: number;
  /** Structural comparison values — what actually gets hashed for dedupe.
   *  `detail` is display-only (see fingerprint() below). */
  ourValue: number;
  fplValue: number;
  detail: string;
}

export interface FplLiveStats {
  minutes: number; goals_scored: number; assists: number; saves: number;
  clean_sheets: number; clearances_blocks_interceptions: number; tackles: number;
  recoveries: number; defensive_contribution: number;
}
export interface FplLiveElement { id: number; stats: FplLiveStats }
export interface FplElementMeta { id: number; selectedByPercent: number }
export interface StoredScoreRow { playerId: number; facts: MatchFacts }

/** event/{gw}/live returns {elements: []} pre-season (until GW1). A guard that
 *  can't tell "nothing happened" from "the feed is empty" must treat both as
 *  the same safe no-op. */
export function hasLiveData(live: FplLiveElement[] | null): boolean {
  return !!live && live.length > 0;
}

/** dc/dcr are our own approximation of FPL's stat, not a literal re-derivation
 *  — alert on drift beyond tolerance, not strict equality. */
const DC_TOLERANCE = 2;
/** A handful of players off by a few minutes is normal (added time timing,
 *  a sub at 89'). Five or more off by this much smells like a feed problem. */
const MINUTES_DRIFT_THRESHOLD = 5;
const MIN_MINUTES_DRIFT_PLAYERS = 5;
/** Ownership floor for the goals/assists/clean-sheet checks — a 0.1%-owned
 *  player's mismatch isn't worth a 3am ping; a widely-owned one is. */
const OWNERSHIP_FILTER_PCT = 5.0;

/**
 * Diff our stored per-player facts against FPL's live feed. Pure: every input
 * is already fetched/read.
 *
 * `poolIds` scopes EVERY comparison to players actually in our game — FPL's
 * live feed covers its whole ~558-player universe, ~36 of whom (in a 522-
 * player pool) aren't in ours at all. Without this a >5%-owned FPL player who
 * isn't even in our pool can trip a false RED and hold a gameweek over a
 * player nobody here can pick. `ownedIds` (real managers' locked picks — the
 * coverage check) is exempt from the filter in name only: a pick can only
 * ever be a pool id (validateSquad enforces it), so it's pool-scoped by
 * construction — it's unioned in explicitly as a belt-and-braces guarantee
 * that an owned pick is always checked even if pool.json and a stale live
 * squad ever disagree.
 */
export function diffFacts(
  stored: StoredScoreRow[],
  live: FplLiveElement[],
  poolIds: Set<number>,
  meta: Map<number, FplElementMeta>,
  posOf: Map<number, FantasyPos>,
  ownedIds: Set<number>,
): FactFinding[] {
  const findings: FactFinding[] = [];
  const storedById = new Map(stored.map((s) => [s.playerId, s.facts]));
  const liveById = new Map(live.map((l) => [l.id, l.stats]));
  const candidateIds = new Set([...Array.from(storedById.keys()), ...Array.from(liveById.keys())]);
  // Pool-scope, then union in ownedIds as a belt-and-braces guarantee.
  const allIds = new Set(Array.from(candidateIds).filter((id) => poolIds.has(id)));
  for (const id of Array.from(ownedIds)) allIds.add(id);

  let minutesDriftCount = 0;
  const minutesDriftExamples: number[] = [];

  for (const id of Array.from(allIds)) {
    const ours = storedById.get(id);
    const fpl = liveById.get(id);
    const pct = meta.get(id)?.selectedByPercent ?? 0;
    const ourMinutes = ours?.minutes ?? 0;
    const fplMinutes = fpl?.minutes ?? 0;

    if (Math.abs(ourMinutes - fplMinutes) > MINUTES_DRIFT_THRESHOLD) {
      minutesDriftCount++;
      if (minutesDriftExamples.length < 5) minutesDriftExamples.push(id);
    }

    // Coverage: a REAL manager's pick showing nothing while FPL says he played.
    // Ownership-gated, not percent-gated — this is the "someone's actual squad
    // is silently wrong" case, not a familiarity threshold. HOLD tier.
    if (ownedIds.has(id) && ourMinutes === 0 && fplMinutes > 0) {
      findings.push({
        type: "coverage", tier: GUARD_B_TIER.coverage, playerId: id,
        ourValue: ourMinutes, fplValue: fplMinutes,
        detail: `owned player ${id}: our minutes 0, FPL minutes ${fplMinutes}`,
      });
    }

    if (pct >= OWNERSHIP_FILTER_PCT) {
      const ourGoals = ours?.goals ?? 0, fplGoals = fpl?.goals_scored ?? 0;
      if (ourGoals !== fplGoals) {
        findings.push({
          type: "goals", tier: GUARD_B_TIER.goals, playerId: id,
          ourValue: ourGoals, fplValue: fplGoals,
          detail: `our goals ${ourGoals} vs FPL ${fplGoals} (${pct}% owned)`,
        });
      }
      const ourAssists = ours?.assists ?? 0, fplAssists = fpl?.assists ?? 0;
      if (ourAssists !== fplAssists) {
        findings.push({
          type: "assists", tier: GUARD_B_TIER.assists, playerId: id,
          ourValue: ourAssists, fplValue: fplAssists,
          detail: `our assists ${ourAssists} vs FPL ${fplAssists} (${pct}% owned)`,
        });
      }
      const pos = posOf.get(id);
      if (pos === "GK" || pos === "DEF") {
        const ourCs = (ours?.cleanSheet ?? 0) > 0;
        const fplCs = (fpl?.clean_sheets ?? 0) > 0;
        if (ourCs !== fplCs) {
          findings.push({
            type: "clean_sheet", tier: GUARD_B_TIER.clean_sheet, playerId: id,
            ourValue: ourCs ? 1 : 0, fplValue: fplCs ? 1 : 0,
            detail: `our CS ${ourCs} vs FPL ${fplCs} (${pct}% owned)`,
          });
        }
      }
    }

    if (ours && fpl) {
      const ourDc = ours.dc ?? 0;
      const fplDc = (fpl.clearances_blocks_interceptions ?? 0) + (fpl.tackles ?? 0);
      if (Math.abs(ourDc - fplDc) > DC_TOLERANCE) {
        findings.push({
          type: "dc", tier: GUARD_B_TIER.dc, playerId: id,
          ourValue: ourDc, fplValue: fplDc,
          detail: `our dc ${ourDc} vs FPL cbi+tackles ${fplDc} (tolerance ±${DC_TOLERANCE})`,
        });
      }
      const ourDcRec = ours.dcRec ?? 0;
      const fplDcr = fpl.defensive_contribution ?? 0;
      if (Math.abs(ourDcRec - fplDcr) > DC_TOLERANCE) {
        findings.push({
          type: "dc", tier: GUARD_B_TIER.dc, playerId: id,
          ourValue: ourDcRec, fplValue: fplDcr,
          detail: `our dcRec ${ourDcRec} vs FPL defensive_contribution ${fplDcr} (tolerance ±${DC_TOLERANCE})`,
        });
      }
    }
  }

  if (minutesDriftCount >= MIN_MINUTES_DRIFT_PLAYERS) {
    findings.push({
      type: "minutes", tier: GUARD_B_TIER.minutes, playerId: 0,
      ourValue: minutesDriftCount, fplValue: MINUTES_DRIFT_THRESHOLD,
      detail: `${minutesDriftCount} players have minutes drift >${MINUTES_DRIFT_THRESHOLD} (e.g. ${minutesDriftExamples.join(", ")})`,
    });
  }
  return findings;
}

// ── fingerprint dedupe ───────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Drop the human-display `detail` field before hashing — it embeds volatile
 *  numbers (ownership %, formatted timestamps) that drift on their own and
 *  would churn the fingerprint independent of whether the underlying finding
 *  actually changed. Every other field (type, tier, ids, structural values)
 *  stays — that's the substance. */
function hashPayload(item: unknown): unknown {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (k !== "detail") rest[k] = v;
    }
    return rest;
  }
  return item;
}

/** A stable sort key so two runs that produce the SAME finding set in
 *  DIFFERENT order (e.g. `fantasy_player_scores` has no `order by`, so row
 *  order isn't guaranteed tick to tick) hash identically. Falls back through
 *  whichever identity fields the item has — CalendarFinding's `key`/`gw`,
 *  FactFinding's `playerId` — so one sort works for both guards. */
function sortKey(item: unknown): string {
  const o = (item ?? {}) as Record<string, unknown>;
  return [o.type, o.playerId, o.key, o.gw].map((v) => (v === undefined || v === null ? "" : String(v))).join(":");
}

/** djb2 over a sorted, display-text-stripped finding set — good enough for a
 *  dedupe key, no crypto dependency needed, and identical FINDINGS always
 *  hash identical regardless of row order or how their volatile numbers read
 *  today. */
export function fingerprint(findings: unknown[]): string {
  const sorted = [...findings].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const s = stableStringify(sorted.map(hashPayload));
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

/** The fingerprint of "no findings" — constant regardless of guard/gw. Used to
 *  tell "just went clean" (send one all-clear) apart from "has been clean the
 *  whole time" (stay quiet) without a separate boolean column. */
export const EMPTY_FINDINGS_FINGERPRINT = fingerprint([]);

export type DedupeDecision = "silent" | "alert" | "clear" | "green";

/**
 * silent = findings unchanged since the last alert — no telegram.
 * alert  = findings new or changed — send.
 * clear  = was alerting, now clean — send ONE all-clear.
 * green  = clean, and was already clean (or never alerted) — stay quiet.
 */
export function dedupeDecision(prevFingerprint: string | null, findingsCount: number, newFingerprint: string): DedupeDecision {
  if (findingsCount === 0) {
    return prevFingerprint && prevFingerprint !== EMPTY_FINDINGS_FINGERPRINT ? "clear" : "green";
  }
  return newFingerprint === prevFingerprint ? "silent" : "alert";
}

// ── Telegram message shaping ──────────────────────────────────────────────────

/** Telegram's hard cap is 4096 chars; a mass-mismatch (a broad feed/mapping
 *  failure — precisely the case Guard B exists to catch) can produce hundreds
 *  of lines, sendMessage 400s, and the founder never gets paged for the one
 *  alert that matters most. Cap to the top N lines + a "…and N more" footer,
 *  and keep shrinking until the whole message is safely under the cap. */
const TELEGRAM_MAX_CHARS = 3900;

export function buildAlertText(header: string, lines: string[], footer: string, maxLines = 20): string {
  const compose = (shown: string[]) => {
    const omitted = lines.length - shown.length;
    return [header, ...shown, omitted > 0 ? `…and ${omitted} more` : "", footer].filter(Boolean).join("\n");
  };
  let shown = lines.slice(0, maxLines);
  let text = compose(shown);
  while (text.length > TELEGRAM_MAX_CHARS && shown.length > 0) {
    shown = shown.slice(0, -1);
    text = compose(shown);
  }
  return text;
}

// ── fail-open: the watchdog's own read must never stall the season ──────────

/**
 * season.ts's `finaliseGameweek` does a fresh point-read of `ops_hold` before
 * any scored→final transition. That read can fail for reasons that have
 * nothing to do with an actual veto — migration 210 not yet applied in prod,
 * a transient DB blip — and a safety net that can crash the thing it protects
 * is worse than no net at all. This is the pure decision: an error (or a
 * still-missing row) FAILS OPEN — never held. Only an explicit `ops_hold:
 * true` row holds. Lives here (not inline in season.ts) for the same reason
 * everything else in this file does: season.ts is `server-only` too, so the
 * decision has to live somewhere `node --test` can reach it.
 */
export function interpretHoldRead(row: { ops_hold: boolean } | null, error: unknown): boolean {
  if (error) return false;
  return !!row?.ops_hold;
}
