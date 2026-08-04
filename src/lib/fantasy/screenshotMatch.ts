/**
 * Screenshot squad matcher — turns what the vision model read off an FPL "Pick
 * Team" screenshot into pool ids, club-aware and accent-safe.
 *
 * PURE on purpose: no `server-only`, no `@/`-aliased imports, no JSON imports.
 * The pool is always passed in by the caller (the route reads it from
 * pricedPool()/clientPricedPool(), the tests hand-build a small fixture from
 * the real pool.json ids) so this file compiles in run-tests.sh's FIRST tsc
 * block alongside months.ts and clubKey.ts, the same relative-imports-only
 * recipe — see scripts/fantasy/run-tests.sh for why squadRating.ts can't make
 * that trade but this one can.
 *
 * ── The matching problem ─────────────────────────────────────────────────
 * A screenshot only ever prints a SURNAME (sometimes with a disambiguating
 * initial), a club badge/fixture line, and a pitch position. Vision reads that
 * back as plain text — accents may or may not survive, and the pool's own
 * names carry the accents that FPL's data does. foldName() is the shared
 * normal form both sides run through before comparing.
 *
 * Resolution order per extracted player (see matchExtractedSquad):
 *   1. Surname-unique within the read club → high confidence.
 *   2. Surname matches several players at that club → narrow by initial, then
 *      by position; one left → high. Still several → best-by-position, low
 *      confidence, flagged "ambiguous".
 *   3. No one at the read club, but the surname is unique across the WHOLE
 *      pool → resolve anyway, low confidence, flagged "clubMismatch" (never
 *      silently high — a screenshot's club read is the least reliable field,
 *      the pool's own club label is occasionally wrong too).
 *   4. Nothing at all → unresolved (id null), flagged "unresolved".
 * A resolved player whose extracted position disagrees with the pool's drops
 * the confidence one step (high → low) and adds "posMismatch", on top of
 * whichever path resolved him.
 */

import { clubKey } from "./clubKey";

// ── folding ──────────────────────────────────────────────────────────────

/** Characters NFKD does not decompose into base + combining marks, so the
 *  generic accent-strip below would otherwise just drop them (ß → nothing,
 *  not "ss"). Applied before the generic strip. */
const EXPLICIT_FOLD: Record<string, string> = {
  ß: "ss", ø: "o", æ: "ae", đ: "d", ð: "d", þ: "th", ł: "l",
};

/** Lowercase → explicit table for the characters NFKD misses → NFKD →
 *  strip combining marks → strip everything left that isn't a-z. Whitespace,
 *  apostrophes, hyphens and periods all disappear here, which is exactly what
 *  lets "O'Reilly", "Gibbs-White" and "Groß" compare equal to their pool
 *  counterparts regardless of how a screenshot rendered the punctuation. */
export function foldName(s: string): string {
  const lower = s.toLowerCase();
  const explicit = lower.split("").map((ch) => EXPLICIT_FOLD[ch] ?? ch).join("");
  const stripped = explicit.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return stripped.replace(/[^a-z]/g, "");
}

// ── types ────────────────────────────────────────────────────────────────

export type ExtractedPosition = "GK" | "DEF" | "MID" | "FWD";

export interface ExtractedPlayer {
  /** Whatever the vision model read under the shirt — a plain surname
   *  ("Haaland"), a multi-word one ("Van de Ven", "João Pedro"), or an
   *  initial-prefixed one ("N.Williams") when FPL disambiguates two
   *  same-surname squad members. */
  surname: string;
  club: string;
  position: ExtractedPosition;
  isCaptain: boolean;
  isVice: boolean;
  isBench: boolean;
}

/** The minimal pool shape this file needs — deliberately narrower than
 *  PoolPlayer (no smId/priceTenths) so a caller can hand in any pool-shaped
 *  array, real or fixture, without importing engine.ts. */
export interface MatchPoolPlayer {
  id: number; name: string; club: string; clubId: number; pos: string;
}

export type Confidence = "high" | "low";

export interface Slot {
  extracted: ExtractedPlayer;
  id: number | null;
  confidence: Confidence;
  flags: string[];
  isCaptain: boolean;
  isVice: boolean;
  isBench: boolean;
}

// ── surname index ────────────────────────────────────────────────────────

/** Every folded key a pool player's surname could plausibly be read as: the
 *  last token alone (covers single-word surnames and hyphenated ones, which
 *  are already one token — "Gibbs-White"), the last two tokens joined (a
 *  short compound or a two-word mononym like "João Pedro"), and everything
 *  after the first token joined (a longer compound surname in full, e.g.
 *  "van de Ven"). Deduped per player so a short name doesn't add the same key
 *  twice. */
function surnameKeys(name: string): string[] {
  const tokens = name.trim().split(/\s+/);
  const keys = new Set<string>();
  keys.add(foldName(tokens[tokens.length - 1]));
  if (tokens.length > 1) {
    keys.add(foldName(tokens.slice(-2).join(" ")));
    keys.add(foldName(tokens.slice(1).join(" ")));
  }
  return Array.from(keys);
}

function buildSurnameIndex(pool: MatchPoolPlayer[]): Map<string, MatchPoolPlayer[]> {
  const index = new Map<string, MatchPoolPlayer[]>();
  for (const p of pool) {
    for (const key of surnameKeys(p.name)) {
      const arr = index.get(key);
      if (arr) arr.push(p); else index.set(key, [p]);
    }
  }
  return index;
}

/** "N.Williams" → initial "n", surname part "Williams". Anything that
 *  doesn't match "single letter, period, rest" is returned whole as the
 *  surname part with no initial. */
function splitInitial(raw: string): { initial: string | null; surnamePart: string } {
  const m = raw.trim().match(/^([A-Za-z])\.\s*(.+)$/);
  if (!m) return { initial: null, surnamePart: raw };
  return { initial: foldName(m[1]), surnamePart: m[2] };
}

/** Step 2: several candidates share the read club. Narrow by initial (if the
 *  screenshot gave one), then by position; if that leaves exactly one, it's a
 *  confident resolution after all. Otherwise fall back to the best position
 *  match among the ORIGINAL club candidates (not the narrowed set — a wrong
 *  initial guess shouldn't strand the pick with nothing), low confidence,
 *  flagged ambiguous. */
function resolveAmbiguous(
  candidatesClub: MatchPoolPlayer[], extracted: ExtractedPlayer, initial: string | null,
): { player: MatchPoolPlayer; confidence: Confidence; flags: string[] } {
  let narrowed = candidatesClub;
  if (initial) {
    const byInitial = narrowed.filter((c) => foldName(c.name.split(/\s+/)[0]).startsWith(initial));
    if (byInitial.length) narrowed = byInitial;
  }
  const byPos = narrowed.filter((c) => c.pos === extracted.position);
  if (byPos.length) narrowed = byPos;
  if (narrowed.length === 1) return { player: narrowed[0], confidence: "high", flags: [] };

  const posMatches = candidatesClub.filter((c) => c.pos === extracted.position);
  const best = posMatches[0] ?? candidatesClub[0];
  return { player: best, confidence: "low", flags: ["ambiguous"] };
}

function resolveOne(
  extracted: ExtractedPlayer, index: Map<string, MatchPoolPlayer[]>,
): Slot {
  const { initial, surnamePart } = splitInitial(extracted.surname);
  const foldedSurname = foldName(surnamePart);
  const candidates = index.get(foldedSurname) ?? [];
  const wantClub = clubKey(extracted.club);
  const candidatesClub = candidates.filter((c) => clubKey(c.club) === wantClub);

  let player: MatchPoolPlayer | null = null;
  let confidence: Confidence = "low";
  let flags: string[] = [];

  if (candidatesClub.length === 1) {
    player = candidatesClub[0];
    confidence = "high";
  } else if (candidatesClub.length > 1) {
    const resolved = resolveAmbiguous(candidatesClub, extracted, initial);
    player = resolved.player;
    confidence = resolved.confidence;
    flags = resolved.flags;
  } else if (candidates.length === 1) {
    // No one at the read club, but the surname is unique across the whole
    // pool — resolve, but never silently: the club disagreement is flagged
    // and the confidence stays low no matter how "obvious" the surname is.
    player = candidates[0];
    confidence = "low";
    flags = ["clubMismatch"];
  } else {
    flags = ["unresolved"];
  }

  if (player && player.pos !== extracted.position) {
    flags = [...flags, "posMismatch"];
    confidence = "low";
  }

  return {
    extracted, id: player ? player.id : null, confidence, flags,
    isCaptain: extracted.isCaptain, isVice: extracted.isVice, isBench: extracted.isBench,
  };
}

/** Match every extracted player against the pool, independently — order
 *  preserved, one Slot per input. Pure: builds the surname index once, then
 *  resolves each slot with no shared mutable state between them. */
export function matchExtractedSquad(extracted: ExtractedPlayer[], pool: MatchPoolPlayer[]): Slot[] {
  const index = buildSurnameIndex(pool);
  return extracted.map((e) => resolveOne(e, index));
}

// ── input hardening (the vision model is untrusted output) ──────────────────

const POSITIONS: ExtractedPosition[] = ["GK", "DEF", "MID", "FWD"];
const MAX_EXTRACTED = 20; // a Pick Team screen is 15; cap well above, drop the rest.

/** Coerce the model's raw tool output into clean ExtractedPlayer[]. The vision
 *  model is untrusted: a non-string surname would throw in foldName(), a bad
 *  position would mis-slot a player. Drop anything malformed, cap the length.
 *  Pure. */
export function sanitizeExtracted(raw: unknown): ExtractedPlayer[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedPlayer[] = [];
  for (const r of raw) {
    if (out.length >= MAX_EXTRACTED) break;
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.surname !== "string" || !o.surname.trim()) continue;
    const pos = POSITIONS.includes(o.position as ExtractedPosition) ? (o.position as ExtractedPosition) : "MID";
    out.push({
      surname: o.surname.trim(),
      club: typeof o.club === "string" ? o.club.trim() : "",
      position: pos,
      isCaptain: o.isCaptain === true,
      isVice: o.isVice === true,
      isBench: o.isBench === true,
    });
  }
  return out;
}

const XI_SLOTS = 11;
const BENCH_SLOTS = 4;

/** Guarantee a full 15 (11 starters + 4 bench) so the confirm screen is never a
 *  dead end. A cropped screenshot the model could only partly read comes back
 *  short; we pad the gaps with unresolved slots the user fills in, and trim any
 *  over-read down to size. Pure. */
export function padSlots(slots: Slot[]): Slot[] {
  const empty = (isBench: boolean, position: ExtractedPosition): Slot => ({
    extracted: { surname: "", club: "", position, isCaptain: false, isVice: false, isBench },
    id: null, confidence: "low", flags: ["unresolved"], isCaptain: false, isVice: false, isBench,
  });
  const xi = slots.filter((s) => !s.isBench).slice(0, XI_SLOTS);
  const bench = slots.filter((s) => s.isBench).slice(0, BENCH_SLOTS);
  // Any starters read beyond 11 spill onto the bench if there is room.
  for (const s of slots.filter((s) => !s.isBench).slice(XI_SLOTS)) {
    if (bench.length < BENCH_SLOTS) bench.push({ ...s, isBench: true });
  }
  while (xi.length < XI_SLOTS) xi.push(empty(false, xi.length === 0 ? "GK" : "MID"));
  while (bench.length < BENCH_SLOTS) bench.push(empty(true, "MID"));
  return [...xi, ...bench];
}
