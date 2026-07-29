/**
 * Scout's Four Picks (Stage 4 of the Fantasy Scout) — one code-ranked player per
 * category (Safe / Form / Value / Scout's Gamble), the exact way captainAssist.ts
 * picks a captain: MECHANICAL selection first, an AI layer only for the 2-3
 * factual reason lines.
 *
 * ── The shape of the guarantee ──────────────────────────────────────────────
 * Selection (which player, in which category) is 100% code: gates on
 * availability/fixture/ownership, then a rank by a single measured number.
 * Nothing here ever asks a model who to pick. The model is handed a CLOSED
 * payload (pickFacts()) for the player selection already made, and may only
 * rephrase it into 2-3 sentences — the exact discipline tips.ts already proved
 * out for the weekly tips, reused here (not copied): collectPayloadTokens,
 * isProseGrounded, hasUngroundedClaim and CLAIM_TERMS are imported straight
 * from tips.ts, so both surfaces are grounded by the SAME rule, not two that
 * can drift. A field the model writes that fails grounding — or the no-hype/
 * no-dash lint below — never blocks the pick: it falls back to reasons composed
 * by CODE from the same facts, `copy_source` records which happened, and the
 * pick still ships.
 *
 * ── Cold start ───────────────────────────────────────────────────────────────
 * fantasy_player_scores is empty pre-season (verified — see ppg.ts), so before
 * MIN_GW_FOR_PPG scored gameweeks every category falls back to FPL's own
 * `ep_next`, always FPL-attributed and never past-tensed, signal
 * 'fpl_ep_next_cold_start' — the same honesty rule captainAssist.ts already
 * uses for the captain pick.
 *
 * ── Read-time backup swap ───────────────────────────────────────────────────
 * A published pick is frozen at generation time, but availability can move
 * before a manager reads it. resolvePickAtReadTime() re-checks the primary
 * against the NEWEST snapshot; if he now fails the gate, the first passing
 * backup renders instead (labelled), and if neither backup passes the card is
 * hidden. It never falls through to an unapproved player — backups are frozen
 * onto the SAME approved row, never fetched live.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FantasyPos, PoolPlayer } from "./engine";
import { pointsPerAppearance, type ScoreRow } from "./ppg";
import { pricedPool } from "./pool";
import { FORM_WINDOW_GWS } from "./news";
import {
  loadFixtureSet, fixtureStatusFor, MIN_GW_FOR_PPG,
  type FixtureCtx, type FixtureSet, type FixtureStatus,
} from "./captainAssist";
import {
  cleanField, collectPayloadTokens, isProseGrounded, hasUngroundedClaim,
} from "./tips";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

const MODEL = "claude-sonnet-5";

export type ScoutCategory = "safe" | "form" | "value" | "gamble";
export const SCOUT_CATEGORIES: readonly ScoutCategory[] = ["safe", "form", "value", "gamble"];

export type ScoutSignal = "season_ppg" | "fpl_ep_next_cold_start";
export type CopySource = "model" | "mechanical";

/** Availability threshold shared by every category and by the read-time
 *  re-check: below this an "available" player is treated as too doubtful to
 *  recommend at all (distinct from Safe's stricter null/100 test below). */
const GATE_CHANCE_FLOOR = 75;
/** Safe's stricter availability bar: no shade of doubt at all. */
const SAFE_CHANCE_EXACT = 100;
/** Gameweeks of minutes history the Safe "nailed starter" test looks at. */
export const SAFE_WINDOW_GWS = 5;
/** Of that window, the minimum number of 60'+ appearances to count as nailed. */
export const SAFE_MIN_STARTS = 4;
export const SAFE_MIN_MINUTES = 60;
/** Scout's Gamble: FPL ownership below this counts as a genuine differential. */
export const GAMBLE_OWNERSHIP_CEILING = 5;

// ── candidate shape ──────────────────────────────────────────────────────────

/** One player, gate- and rank-ready. Built once per generation run from the
 *  latest FPL snapshot + this gameweek's fixtures + season score history —
 *  never read again mid-ranking, so every category ranks the SAME frozen view. */
export interface PickCandidate {
  playerId: number;
  name: string;
  club: string;
  pos: FantasyPos;
  priceTenths: number;
  status: string; // FPL letter: a/d/i/s/u
  chance: number | null;
  fixtureStatus: FixtureStatus;
  fixtures: FixtureCtx[];
  /** Season points per appearance (pointsPerAppearance from ppg.ts) — null pre-PPG. */
  ppg: number | null;
  /** Total points across the last FORM_WINDOW_GWS SCORED gameweeks — null pre-PPG. */
  formPoints: number | null;
  /** 60'+ appearances among the last SAFE_WINDOW_GWS scored gameweeks — null pre-PPG. */
  nailedStarts: number | null;
  /** How many scored rows this player has at all — context only, never ranked on. */
  scoredCount: number;
  epNext: number | null;
  ownershipPct: number | null;
}

// ── gates (mechanical, code-ranked — see captainAssist.ts for the precedent) ─

/** The floor every pick (primary or backup, any category) must clear: FPL says
 *  available, no more than a shade of doubt, and a CONFIRMED fixture. An
 *  'unknown' fixture status never passes — that is the fail-closed direction. */
export function passesAvailabilityFixtureGate(c: Pick<PickCandidate, "status" | "chance" | "fixtureStatus">): boolean {
  if (c.status !== "a") return false;
  if (c.chance !== null && c.chance < GATE_CHANCE_FLOOR) return false;
  if (c.fixtureStatus !== "confirmed_fixture") return false;
  return true;
}

/** Safe's stricter bar: the base gate, PLUS (once there is a season to judge
 *  minutes over) zero shade of doubt and a genuinely nailed starting berth.
 *  Pre-PPG (cold start) there is no minutes history to test, so the base gate
 *  IS the whole test — exactly the honesty rule captainAssist.ts uses. */
export function passesSafeGate(
  c: Pick<PickCandidate, "status" | "chance" | "fixtureStatus" | "nailedStarts">,
  usePpg: boolean,
): boolean {
  if (!passesAvailabilityFixtureGate(c)) return false;
  if (!usePpg) return true;
  if (c.chance !== null && c.chance !== SAFE_CHANCE_EXACT) return false;
  if (c.nailedStarts === null || c.nailedStarts < SAFE_MIN_STARTS) return false;
  return true;
}

/** Scout's Gamble's extra filter: a genuine differential, not just "available". */
export function passesGambleOwnership(c: Pick<PickCandidate, "ownershipPct">): boolean {
  return c.ownershipPct !== null && c.ownershipPct < GAMBLE_OWNERSHIP_CEILING;
}

function gateFor(category: ScoutCategory, c: PickCandidate, usePpg: boolean): boolean {
  switch (category) {
    case "safe": return passesSafeGate(c, usePpg);
    case "form": return passesAvailabilityFixtureGate(c);
    // "best output per £m among players passing the Safe minutes test" — the
    // FULL Safe gate is Value's candidate pool, not just the base gate.
    case "value": return passesSafeGate(c, usePpg);
    case "gamble": return passesAvailabilityFixtureGate(c) && passesGambleOwnership(c);
  }
}

// ── ranking (mechanical, one number per category) ───────────────────────────

function safeMetric(c: PickCandidate, usePpg: boolean): number {
  return usePpg ? (c.ppg ?? 0) : (c.epNext ?? 0);
}
function formMetric(c: PickCandidate, usePpg: boolean): number {
  return usePpg ? (c.formPoints ?? 0) : (c.epNext ?? 0);
}
function valueMetric(c: PickCandidate, usePpg: boolean): number {
  const output = usePpg ? (c.ppg ?? 0) : (c.epNext ?? 0);
  const priceM = c.priceTenths / 10;
  return priceM > 0 ? output / priceM : 0;
}
/** "ranked by form/ep_next" — the SAME per-gameweek signal Form itself ranks
 *  by (our own recent points once there's a season, FPL's projection before
 *  that), just restricted to the low-ownership pool. */
function gambleMetric(c: PickCandidate, usePpg: boolean): number {
  return formMetric(c, usePpg);
}

function metricFor(category: ScoutCategory): (c: PickCandidate, usePpg: boolean) => number {
  switch (category) {
    case "safe": return safeMetric;
    case "form": return formMetric;
    case "value": return valueMetric;
    case "gamble": return gambleMetric;
  }
}

/** Gate then rank a category's candidates, highest metric first (playerId tie-
 *  break for determinism). `exclude` keeps the four categories on DISTINCT
 *  players: once a player has been chosen as another category's PRIMARY pick,
 *  he drops out of every later category's pool entirely (primary and backups
 *  alike), so a later category never has to reach for a player already the
 *  headline elsewhere. Pure. */
export function rankCandidates(
  category: ScoutCategory,
  pool: PickCandidate[],
  usePpg: boolean,
  exclude: ReadonlySet<number> = new Set(),
): PickCandidate[] {
  const metric = metricFor(category);
  return pool
    .filter((c) => !exclude.has(c.playerId) && gateFor(category, c, usePpg))
    .sort((a, b) => metric(b, usePpg) - metric(a, usePpg) || a.playerId - b.playerId);
}

// ── the closed payload the model may speak from ─────────────────────────────

export interface PickFacts {
  category: ScoutCategory;
  signal: ScoutSignal;
  player: string;
  club: string;
  position: FantasyPos;
  priceM: number;
  availability: string; // "available" when status 'a', the raw FPL letter otherwise
  chanceOfPlaying: number | null;
  fixture: { opponent: string; homeOrAway: "home" | "away" }[] | null;
  seasonPointsPerAppearance: number | null;
  recentFormPoints: number | null;
  formWindowGws: number;
  nailedStarts: number | null;
  fplProjection: number | null;
  ownershipPercent: number | null;
}

/** The facts the model is allowed to speak from for THIS pick — nothing else
 *  exists to it. Mirrors tips.ts's tipFacts(): this is also the only source of
 *  truth groundPickCopy() validates prose against, so anything added here
 *  becomes speakable and anything removed becomes unspeakable. Deliberately
 *  omits raw FPL `news` text — every candidate here has already cleared the
 *  availability gate, so there is no fitness story to tell, and leaving it out
 *  means the claim-term gate below can never be tempted to ground one. */
export function pickFacts(category: ScoutCategory, c: PickCandidate, signal: ScoutSignal): PickFacts {
  const usePpg = signal === "season_ppg";
  return {
    category,
    signal,
    player: c.name,
    club: c.club,
    position: c.pos,
    priceM: Math.round((c.priceTenths / 10) * 10) / 10,
    availability: c.status === "a" ? "available" : c.status,
    chanceOfPlaying: c.chance,
    fixture: c.fixtures.length
      ? c.fixtures.map((f) => ({ opponent: f.opponent ?? "TBC", homeOrAway: (f.home ? "home" : "away") as "home" | "away" }))
      : null,
    seasonPointsPerAppearance: usePpg ? c.ppg : null,
    recentFormPoints: usePpg ? c.formPoints : null,
    formWindowGws: FORM_WINDOW_GWS,
    nailedStarts: usePpg ? c.nailedStarts : null,
    fplProjection: !usePpg ? c.epNext : null,
    ownershipPercent: c.ownershipPct,
  };
}

// ── no-hype / no-dash copy lint (acceptance criterion 6) ────────────────────

/** Single words banned in ANY rendered string — model or mechanical. Hype
 *  adjectives are the open-ended part of the rule; this is a deliberately
 *  short, defensible list rather than an attempt at completeness. */
const BANNED_TERMS = new Set([
  "must", "essential", "unlock", "guaranteed",
  // hype adjectives
  "amazing", "incredible", "insane", "unbelievable", "elite", "unmissable",
  "unstoppable", "perfect", "flawless", "premium", "sensational", "phenomenal",
  "outstanding", "electric", "explosive", "unbeatable", "legendary",
]);
/** Em dash and en dash specifically — a plain hyphen ("60-minute", "£8.5m-ish")
 *  is not what "no dashes" bans here; a house-style em/en dash used as a
 *  sentence break is. */
const DASH_RE = /[–—]/;

/** True iff `text` contains no banned term and no em/en dash. Exported so the
 *  unit test can drive it directly with the banned-term list. */
export function lintCopy(text: string): boolean {
  if (DASH_RE.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return !words.some((w) => BANNED_TERMS.has(w));
}

// ── grounding (reuses tips.ts, does not re-implement it) ────────────────────

export interface PickCopyOutput { reasons: string[]; risk?: string }

/** Ground the model's reasons (and, for Gamble, its risk line) against
 *  pickFacts(). Pure — unit-testable without touching the API, same shape as
 *  tips.ts's groundTips(). A reason line is kept only if it invents no proper
 *  noun, no number, no ungrounded claim term AND passes the copy lint; at
 *  least 2 surviving reasons are required or the whole thing is rejected
 *  (mechanical composes the fallback, never a half-empty card). Gamble's risk
 *  is mandatory: if it fails any check, the ENTIRE copy is rejected — a
 *  gamble pick with a reason but no risk line is worse than one with neither. */
export function groundPickCopy(
  output: PickCopyOutput,
  facts: PickFacts,
  requireRisk: boolean,
): PickCopyOutput | null {
  const base = collectPayloadTokens(facts);
  // Vocabulary the scout-picks context licenses beyond tips.ts's ALLOWLIST: the
  // data source we cite (FPL), the this-season framing every pick is built on,
  // and the plain ownership verb the mechanical reasons themselves use. None is
  // a fabrication vector — proper nouns, numbers and injury/transfer claims all
  // stay gated — but without them the gate rejects the very phrasing that
  // composeMechanicalReasons() treats as ground truth, so the model copy could
  // never survive and every pick would silently fall back to mechanical.
  // forEach, not spread: this tsconfig target can't iterate a Set directly.
  const words = new Set<string>();
  base.words.forEach((w) => words.add(w));
  ["fpl", "owned", "season", "record"].forEach((w) => words.add(w));
  const tokens = { words, numbers: base.numbers };
  const safe = (text: string) =>
    isProseGrounded(text, tokens) && !hasUngroundedClaim(text, words) && lintCopy(text);

  const reasons = (output.reasons ?? [])
    .map((r) => cleanField(r))
    .filter((r) => r.length > 0 && safe(r))
    .slice(0, 3);
  if (reasons.length < 2) return null;

  if (!requireRisk) return { reasons };

  const risk = cleanField(output.risk);
  if (!risk || !safe(risk)) return null;
  return { reasons, risk };
}

// ── mechanical fallback (deterministic, from pickFacts only) ────────────────

function fixtureText(c: Pick<PickCandidate, "fixtures">): string | null {
  if (!c.fixtures.length) return null;
  return c.fixtures
    .map((f) => `${f.home ? "home to" : "away at"} ${f.opponent ?? "TBC"}`)
    .join(" and ");
}

/** Code-composed reasons (and risk, for Gamble) built ONLY from pickFacts-shape
 *  data — no free text, so there is nothing here to ground: it IS the ground
 *  truth, formatted. This is what ships when the model is unavailable or its
 *  output fails grounding, and it is what backups are stored with (see
 *  buildBackup below) — never blocking, never a made-up sentence. */
export function composeMechanicalReasons(
  category: ScoutCategory, c: PickCandidate, signal: ScoutSignal,
): PickCopyOutput {
  const usePpg = signal === "season_ppg";
  const fx = fixtureText(c);
  const fixtureLine = `Available, with a confirmed fixture ${fx ?? "this gameweek"}.`;
  const lines: string[] = [];

  if (usePpg) {
    if (category === "safe") {
      lines.push(fixtureLine);
      if (c.nailedStarts !== null) {
        lines.push(`Played ${SAFE_MIN_MINUTES}+ minutes in ${c.nailedStarts} of his last ${SAFE_WINDOW_GWS} scored gameweeks.`);
      }
      if (c.ppg !== null) lines.push(`${c.ppg.toFixed(1)} points per appearance this season.`);
    } else if (category === "form") {
      if (c.formPoints !== null) lines.push(`${c.formPoints} points across his last ${FORM_WINDOW_GWS} scored gameweeks.`);
      lines.push(fixtureLine);
    } else if (category === "value") {
      if (c.ppg !== null) lines.push(`${c.ppg.toFixed(1)} points per appearance for £${(c.priceTenths / 10).toFixed(1)}m.`);
      lines.push(fixtureLine);
    } else {
      if (c.formPoints !== null) lines.push(`${c.formPoints} points across his last ${FORM_WINDOW_GWS} scored gameweeks.`);
      lines.push(fixtureLine);
    }
  } else {
    lines.push(c.epNext !== null
      ? `FPL projects ${c.epNext.toFixed(1)} points for him this gameweek.`
      : "FPL has not published a projection for him yet.");
    lines.push(fixtureLine);
    if (category === "value" && c.epNext !== null) {
      const priceM = c.priceTenths / 10;
      if (priceM > 0) lines.push(`That is ${(c.epNext / priceM).toFixed(2)} projected FPL points per £m.`);
    }
  }

  const risk = category === "gamble"
    ? (c.ownershipPct !== null
        ? `Owned by ${c.ownershipPct.toFixed(1)}% of FPL managers, so there is little public form data to weigh him against.`
        : "FPL ownership data is not available for him yet.")
    : undefined;

  return { reasons: lines.slice(0, 3), risk };
}

// ── AI copy layer (Sonnet, tool-forced — same fetch shape as tips.ts) ───────

interface AnthropicResponse { content?: { type: string; input?: PickCopyOutput }[] }

const COPY_SYSTEM = `You write 2-3 short factual lines for a YourScore fantasy football "Scout" pick.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. Every name, club,
number and fixture you mention MUST appear in that JSON. If it is not there, it
does not exist and you may not refer to it. Do not add context you "know" — a
reputation, a manager, an injury, a transfer, last season.

VOICE
- State facts. This pick was already chosen by the app, not by you — you are
  explaining it, not arguing for it.
- No verdicts, no hype. Never write "must", "essential", "unlock" or
  "guaranteed", and no hype adjectives (amazing, elite, unstoppable, and the
  like).
- No em dashes or en dashes anywhere.
- Plain prose. Never output JSON, quotes or braces inside a field.

WHAT TO PRODUCE
- reasons: 2 to 3 short sentences, each grounded in the JSON (price, points,
  fixture, projection, availability — whatever is present).
- risk (only when asked for it): one short factual sentence about why this
  pick carries more uncertainty than the others — grounded the same way,
  never invented.`;

async function callModelForCopy(facts: PickFacts, requireRisk: boolean): Promise<PickCopyOutput | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[scout picks] copy skipped: no ANTHROPIC_API_KEY");
    return null;
  }

  const tool = {
    name: "scout_pick_copy",
    description: "The 2-3 factual reason lines for a Scout pick, and (for Scout's Gamble) a risk line.",
    input_schema: {
      type: "object",
      properties: {
        reasons: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
        ...(requireRisk ? { risk: { type: "string" } } : {}),
      },
      required: requireRisk ? ["reasons", "risk"] : ["reasons"],
    },
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: COPY_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "scout_pick_copy" },
        messages: [{
          role: "user",
          content:
            `These are the ONLY facts that exist for this player:\n\n${JSON.stringify(facts, null, 2)}\n\n` +
            `Write the reasons${requireRisk ? " and the risk" : ""}. Every name and number must come from that JSON.`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[scout picks] copy failed: http-${res.status}`);
      return null;
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use");
    if (!block?.input) {
      console.error("[scout picks] copy failed: no-tool-use-block");
      return null;
    }
    return block.input;
  } catch (e) {
    console.error("[scout picks] copy failed: exception", e);
    return null;
  }
}

/** The full copy step for the PRIMARY pick in a category: ask the model, ground
 *  it, fall back to mechanical reasons on any failure. Never throws, never
 *  blocks generation. */
export async function generateCategoryCopy(
  category: ScoutCategory, candidate: PickCandidate, signal: ScoutSignal,
): Promise<{ facts: PickFacts; reasons: string[]; risk?: string; copySource: CopySource }> {
  const facts = pickFacts(category, candidate, signal);
  const requireRisk = category === "gamble";
  const modelOut = await callModelForCopy(facts, requireRisk);
  const grounded = modelOut ? groundPickCopy(modelOut, facts, requireRisk) : null;
  if (grounded) return { facts, ...grounded, copySource: "model" };
  const mech = composeMechanicalReasons(category, candidate, signal);
  return { facts, ...mech, copySource: "mechanical" };
}

// ── backups (frozen facts, mechanically-composed reasons — no extra AI calls) ─

export interface BackupCandidate {
  playerId: number; name: string; club: string; pos: FantasyPos; priceTenths: number;
  facts: PickFacts; reasons: string[]; risk?: string;
}

/** A backup's own frozen facts + reasons. Mechanical only — the reader only
 *  ever sees a backup when the primary has already failed the live gate, which
 *  is rare and time-sensitive, so this avoids tripling the AI call cost of
 *  every generation for a path that mostly goes unused while staying exactly
 *  as factual (composeMechanicalReasons is the same function the primary falls
 *  back to). */
export function buildBackup(category: ScoutCategory, c: PickCandidate, signal: ScoutSignal): BackupCandidate {
  const facts = pickFacts(category, c, signal);
  const { reasons, risk } = composeMechanicalReasons(category, c, signal);
  return { playerId: c.playerId, name: c.name, club: c.club, pos: c.pos, priceTenths: c.priceTenths, facts, reasons, risk };
}

// ── read-time backup swap (pure — acceptance criterion 7) ───────────────────

export interface LiveAvailability { status: string; chance: number | null }

/** Walk primary → backup 1 → backup 2 against the NEWEST snapshot + fixture
 *  read, in order, and return the first that still clears the base gate. A
 *  player absent from the live map (not in the newest snapshot at all) is
 *  treated as failing — the same fail-closed direction the rest of this file
 *  uses for missing data. Returns null when nobody passes: the card is
 *  hidden, never an unapproved player. Pure — `live` and `fixtureOf` are
 *  supplied by the caller so this is trivially unit-testable. */
export function resolvePickAtReadTime(
  row: { playerId: number; backups: { playerId: number }[] },
  live: ReadonlyMap<number, LiveAvailability>,
  fixtureOf: (playerId: number) => FixtureStatus,
): { playerId: number; isBackup: boolean } | null {
  const candidates = [
    { playerId: row.playerId, isBackup: false },
    ...row.backups.map((b) => ({ playerId: b.playerId, isBackup: true })),
  ];
  for (const cand of candidates) {
    const av = live.get(cand.playerId);
    if (!av) continue;
    if (!passesAvailabilityFixtureGate({ status: av.status, chance: av.chance, fixtureStatus: fixtureOf(cand.playerId) })) continue;
    return cand;
  }
  return null;
}

// ── generation (impure: DB reads, the AI call, the draft write) ─────────────

type SnapRow = {
  player_id: number; web_name: string | null; team: number | null;
  status: string | null; chance_of_playing_next_round: number | null;
  ep_next: number | null; selected_by_percent: number | string | null;
  next_event: number | null; next_deadline: string | null;
};

export interface StoredScoutPickRow {
  gw: number; category: ScoutCategory; status: "draft";
  player_id: number; backups: BackupCandidate[]; facts: PickFacts;
  reasons: string[]; risk: string | null; signal: ScoutSignal; copy_source: CopySource;
  data_cutoff: string; generated_at: string; expires_at: string;
}

export type GenerateScoutPicksResult =
  | { ok: true; gw: number; dataCutoff: string; rows: StoredScoutPickRow[]; skipped: ScoutCategory[] }
  | { ok: false; reason: "no-snapshot" | "fixtures-unknown" | "no-candidates" };

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Build every candidate from the latest snapshot + this gameweek's fixtures +
 *  season score history. Exported mainly for the unit tests, which construct
 *  PickCandidate rows directly rather than exercising the DB path. */
export function buildCandidates(
  snap: SnapRow[],
  poolById: Map<number, PoolPlayer>,
  fixtureSet: FixtureSet,
  scoresByPlayer: Map<number, ScoreRow[]>,
  usePpg: boolean,
  ppgById: Map<number, number>,
): PickCandidate[] {
  const out: PickCandidate[] = [];
  for (const r of snap) {
    const p = poolById.get(r.player_id);
    if (!p) continue;
    const fixtures = r.team !== null ? (fixtureSet.byTeam.get(r.team) ?? []) : [];
    const fixtureStatus = fixtureStatusFor(fixtureSet, r.team);
    const rows = (scoresByPlayer.get(r.player_id) ?? []).slice().sort((a, b) => b.gw - a.gw);
    const last5 = rows.slice(0, SAFE_WINDOW_GWS);
    const nailedStarts = usePpg ? last5.filter((row) => (row.minutes ?? 0) >= SAFE_MIN_MINUTES).length : null;
    const formPoints = usePpg ? rows.slice(0, FORM_WINDOW_GWS).reduce((s, row) => s + (row.points ?? 0), 0) : null;
    out.push({
      playerId: r.player_id,
      name: r.web_name ?? p.name,
      club: p.club,
      pos: p.pos,
      priceTenths: p.priceTenths,
      status: (r.status ?? "u").trim().toLowerCase() || "u",
      chance: r.chance_of_playing_next_round,
      fixtureStatus, fixtures,
      ppg: usePpg ? (ppgById.get(r.player_id) ?? 0) : null,
      formPoints, nailedStarts,
      scoredCount: rows.length,
      epNext: num(r.ep_next),
      ownershipPct: num(r.selected_by_percent),
    });
  }
  return out;
}

/** Generate this gameweek's four draft picks. MECHANICAL selection (gates +
 *  ranking), then one AI copy call per category for the primary pick (backups
 *  are mechanical-only, see buildBackup). Refuses — writes nothing — when the
 *  fixture set is incomplete ('unknown' must never silently pass as a
 *  fixture) or when there is no snapshot to read at all. A category with zero
 *  eligible candidates is skipped rather than failing the whole run; callers
 *  see which in `skipped`. */
export async function generateScoutPicks(db: Db, requestedGw?: number): Promise<GenerateScoutPicksResult> {
  const { data: latest } = await db
    .from("fantasy_fpl_snapshot").select("captured_at")
    .eq("is_rehearsal", false).order("captured_at", { ascending: false }).limit(1);
  const cutoff: string | undefined = latest?.[0]?.captured_at;
  if (!cutoff) return { ok: false, reason: "no-snapshot" };

  const { data: snapRows } = await db
    .from("fantasy_fpl_snapshot")
    .select("player_id, web_name, team, status, chance_of_playing_next_round, ep_next, selected_by_percent, next_event, next_deadline")
    .eq("captured_at", cutoff).eq("is_rehearsal", false).range(0, 9999);
  const snap = (snapRows ?? []) as SnapRow[];
  if (!snap.length) return { ok: false, reason: "no-snapshot" };

  const gw = requestedGw ?? snap[0]?.next_event ?? null;
  if (gw === null) return { ok: false, reason: "no-snapshot" };

  const fixtureSet = await loadFixtureSet(db, gw, cutoff, false);
  if (!fixtureSet.complete) return { ok: false, reason: "fixtures-unknown" };

  const pool = await pricedPool(db, gw);
  const poolById = new Map(pool.map((p) => [p.id, p]));

  const { data: scoreRows } = await db
    .from("fantasy_player_scores").select("gw, player_id, points, minutes").range(0, 49999);
  const scores = (scoreRows ?? []) as ScoreRow[];
  const usePpg = new Set(scores.map((s) => s.gw)).size >= MIN_GW_FOR_PPG;
  const ppgById = usePpg ? pointsPerAppearance(scores) : new Map<number, number>();

  const scoresByPlayer = new Map<number, ScoreRow[]>();
  for (const s of scores) {
    const list = scoresByPlayer.get(s.player_id) ?? [];
    list.push(s);
    scoresByPlayer.set(s.player_id, list);
  }

  const candidates = buildCandidates(snap, poolById, fixtureSet, scoresByPlayer, usePpg, ppgById);
  const signal: ScoutSignal = usePpg ? "season_ppg" : "fpl_ep_next_cold_start";

  // Deadline / expiry: prefer fantasy_gameweeks (the canonical calendar), fall
  // back to the snapshot's own next_deadline so a missing calendar row still
  // yields a bounded, honest expiry rather than one that never expires.
  const { data: gwRow } = await db.from("fantasy_gameweeks").select("deadline").eq("gw", gw).maybeSingle();
  const expiresAt: string = gwRow?.deadline ?? snap[0]?.next_deadline ?? new Date(Date.now() + 7 * 86_400_000).toISOString();

  const generatedAt = new Date().toISOString();
  const usedPrimaries = new Set<number>();
  const rows: StoredScoutPickRow[] = [];
  const skipped: ScoutCategory[] = [];

  for (const category of SCOUT_CATEGORIES) {
    const ranked = rankCandidates(category, candidates, usePpg, usedPrimaries);
    if (!ranked.length) { skipped.push(category); continue; }
    const [primary, b1, b2] = ranked;
    usedPrimaries.add(primary.playerId);

    const copy = await generateCategoryCopy(category, primary, signal);
    const backups = [b1, b2]
      .filter((x): x is PickCandidate => !!x)
      .map((b) => buildBackup(category, b, signal));

    rows.push({
      gw, category, status: "draft",
      player_id: primary.playerId,
      backups,
      facts: copy.facts,
      reasons: copy.reasons,
      risk: copy.risk ?? null,
      signal, copy_source: copy.copySource,
      data_cutoff: cutoff, generated_at: generatedAt, expires_at: expiresAt,
    });
  }

  if (!rows.length) return { ok: false, reason: "no-candidates" };

  // Replace DRAFT only (acceptance criterion 1) — approved/published rows are
  // never touched by a generate call, only by the admin approve/publish steps.
  for (const row of rows) {
    await db.from("fantasy_scout_picks").delete().eq("gw", row.gw).eq("category", row.category).eq("status", "draft");
    await db.from("fantasy_scout_picks").insert(row);
  }

  return { ok: true, gw, dataCutoff: cutoff, rows, skipped };
}

// ── published read (impure: DB reads, resolved with the pure swap above) ────

export interface ResolvedScoutPick {
  category: ScoutCategory;
  isBackup: boolean;
  player: { id: number; name: string; club: string; pos: FantasyPos; priceTenths: number };
  fixture: { opponent: string; home: boolean }[];
  reasons: string[];
  risk?: string;
  facts: PickFacts;
  signal: ScoutSignal;
  copySource: CopySource;
}

type StoredRow = {
  gw: number; category: ScoutCategory; player_id: number;
  backups: BackupCandidate[]; facts: PickFacts; reasons: string[]; risk: string | null;
  signal: ScoutSignal; copy_source: CopySource;
};

/** Published-only read (acceptance criterion 1: no read path ever returns a
 *  non-published row), resolved against the NEWEST availability snapshot via
 *  resolvePickAtReadTime — never the frozen data_cutoff, so a primary who has
 *  gone doubtful since generation is caught. `gw` defaults to the most recent
 *  gameweek that has any published pick. Expired rows (`expires_at` in the
 *  past) are excluded at the query itself (criterion 10). */
export async function loadPublishedScoutPicks(db: Db, requestedGw?: number): Promise<ResolvedScoutPick[]> {
  const nowIso = new Date().toISOString();
  let q = db.from("fantasy_scout_picks").select("*").eq("status", "published").gt("expires_at", nowIso);
  q = requestedGw !== undefined ? q.eq("gw", requestedGw) : q.order("gw", { ascending: false });
  const { data } = await q;
  const rows = (data ?? []) as StoredRow[];
  if (!rows.length) return [];

  const gw = requestedGw ?? rows[0].gw;
  const gwRows = rows.filter((r) => r.gw === gw);
  if (!gwRows.length) return [];

  const { data: latest } = await db
    .from("fantasy_fpl_snapshot").select("captured_at")
    .eq("is_rehearsal", false).order("captured_at", { ascending: false }).limit(1);
  const cutoff: string | undefined = latest?.[0]?.captured_at;

  const ids = new Set<number>();
  for (const r of gwRows) { ids.add(r.player_id); for (const b of r.backups ?? []) ids.add(b.playerId); }

  const live = new Map<number, LiveAvailability>();
  const teamOf = new Map<number, number | null>();
  if (cutoff && ids.size) {
    const { data: snapRows } = await db
      .from("fantasy_fpl_snapshot")
      .select("player_id, team, status, chance_of_playing_next_round")
      .eq("captured_at", cutoff).eq("is_rehearsal", false).in("player_id", Array.from(ids));
    for (const r of (snapRows ?? []) as { player_id: number; team: number | null; status: string | null; chance_of_playing_next_round: number | null }[]) {
      live.set(r.player_id, { status: (r.status ?? "u"), chance: r.chance_of_playing_next_round });
      teamOf.set(r.player_id, r.team);
    }
  }
  const fixtureSet = cutoff ? await loadFixtureSet(db, gw, undefined, false) : null;
  const fixtureOf = (playerId: number): FixtureStatus =>
    fixtureSet ? fixtureStatusFor(fixtureSet, teamOf.get(playerId) ?? null) : "unknown";

  const out: ResolvedScoutPick[] = [];
  for (const r of gwRows) {
    const resolved = resolvePickAtReadTime(
      { playerId: r.player_id, backups: r.backups ?? [] }, live, fixtureOf,
    );
    if (!resolved) continue; // nobody passes — card hidden

    if (!resolved.isBackup) {
      const fixtures = fixtureSet ? (fixtureSet.byTeam.get(teamOf.get(r.player_id) ?? -1) ?? []) : [];
      out.push({
        category: r.category, isBackup: false,
        player: { id: r.player_id, name: r.facts.player, club: r.facts.club, pos: r.facts.position, priceTenths: Math.round(r.facts.priceM * 10) },
        fixture: fixtures.map((f) => ({ opponent: f.opponent ?? "TBC", home: f.home })),
        reasons: r.reasons, risk: r.risk ?? undefined,
        facts: r.facts, signal: r.signal, copySource: r.copy_source,
      });
    } else {
      const b = (r.backups ?? []).find((x) => x.playerId === resolved.playerId);
      if (!b) continue;
      const fixtures = fixtureSet ? (fixtureSet.byTeam.get(teamOf.get(b.playerId) ?? -1) ?? []) : [];
      out.push({
        category: r.category, isBackup: true,
        player: { id: b.playerId, name: b.name, club: b.club, pos: b.pos, priceTenths: b.priceTenths },
        fixture: fixtures.map((f) => ({ opponent: f.opponent ?? "TBC", home: f.home })),
        reasons: b.reasons, risk: b.risk,
        facts: b.facts, signal: r.signal, copySource: "mechanical",
      });
    }
  }
  return out;
}
