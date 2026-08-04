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
  /** The £m price printed next to the player, if the screenshot shows one
   *  (e.g. 4.5 for "£4.5m"). Undefined when not visible. Some FPL screens
   *  (the "Transfers"/squad-list view) show all 15 grouped by position with NO
   *  visual bench separation at all — price is the one reliable signal left
   *  for guessing who starts, see repairInvalidFormation(). */
  price?: number;
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
 *  short compound or a two-word mononym like "João Pedro"), everything after
 *  the first token joined (a longer compound surname in full, e.g. "van de
 *  Ven"), and the FIRST token alone — FPL prints the first name as the shirt
 *  name for a whole class of players (Gabriel Magalhães shows "Gabriel", Son
 *  Heung-min shows "Son", Rodri-style Brazilians and Koreans especially), so
 *  without this key those read as an unmatched surname the last-token index
 *  never sees. Collisions it introduces (three Arsenal "Gabriel"s) are what
 *  the club + position narrowing in resolveAmbiguous is there to split.
 *  Deduped per player so a short name doesn't add the same key twice. */
function surnameKeys(name: string): string[] {
  const tokens = name.trim().split(/\s+/);
  const keys = new Set<string>();
  keys.add(foldName(tokens[tokens.length - 1]));
  if (tokens.length > 1) {
    keys.add(foldName(tokens.slice(-2).join(" ")));
    keys.add(foldName(tokens.slice(1).join(" ")));
    keys.add(foldName(tokens[0]));
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
    const price = typeof o.price === "number" && Number.isFinite(o.price) && o.price > 0 ? o.price : undefined;
    out.push({
      surname: o.surname.trim(),
      club: typeof o.club === "string" ? o.club.trim() : "",
      position: pos,
      isCaptain: o.isCaptain === true,
      isVice: o.isVice === true,
      isBench: o.isBench === true,
      ...(price !== undefined ? { price } : null),
    });
  }
  return out;
}

/** Repair the one structural rule the vision model most often breaks on an FPL
 *  team: EXACTLY ONE goalkeeper starts (the second is always a substitute). Only
 *  touches the clear case — a standard two-keeper squad whose GK split is wrong —
 *  and leaves everything else (cropped reads, odd shapes) to padSlots. Works on
 *  the isBench flags so it composes before matching. Pure. */
export function enforceOneGkStarter(players: ExtractedPlayer[]): ExtractedPlayer[] {
  const gks = players.filter((p) => p.position === "GK");
  if (gks.length !== 2) return players; // not the standard two-keeper squad
  const startingGks = gks.filter((p) => !p.isBench);
  if (startingGks.length === 1) return players; // already valid

  const out = players.map((p) => ({ ...p }));
  if (startingGks.length === 2) {
    // Two keepers starting: bench the second, start the first spare outfielder.
    const secondGk = out.filter((p) => p.position === "GK" && !p.isBench)[1];
    const spareOutfielder = out.find((p) => p.isBench && p.position !== "GK");
    if (secondGk && spareOutfielder) { secondGk.isBench = true; spareOutfielder.isBench = false; }
  } else {
    // No keeper starting: start the first benched keeper, bench a starting outfielder.
    const benchGk = out.find((p) => p.position === "GK" && p.isBench);
    const startingOutfielder = out.find((p) => !p.isBench && p.position !== "GK");
    if (benchGk && startingOutfielder) { benchGk.isBench = false; startingOutfielder.isBench = true; }
  }
  return out;
}

/** Legal FPL starting-outfielder splits: DEF 3-5, MID 2-5, FWD 1-3, ten total
 *  (the eleventh is the goalkeeper, handled separately by enforceOneGkStarter).
 *  Generated once at module load — nine combinations, not worth computing per call. */
const LEGAL_FORMATIONS: { def: number; mid: number; fwd: number }[] = (() => {
  const out: { def: number; mid: number; fwd: number }[] = [];
  for (let def = 3; def <= 5; def++) {
    for (let mid = 2; mid <= 5; mid++) {
      const fwd = 10 - def - mid;
      if (fwd >= 1 && fwd <= 3) out.push({ def, mid, fwd });
    }
  }
  return out;
})();

/** Repair a starting XI that isn't a legal FPL formation — the failure mode
 *  vision hits on FPL's "Transfers"/squad-list screen, which lists the full 15
 *  grouped by position count (2 GK, 5 DEF, 5 MID, 3 FWD) with NO visual
 *  distinction between a formation and a bench, unlike the "Pick Team" screen.
 *  Reading that layout top-to-bottom as if it were bench-separated benches
 *  every forward (0 starting, illegal — FPL requires 1 to 3) even when a
 *  £15m striker is sitting right there. No amount of vision prompting fixes
 *  this: the information genuinely is not in those pixels.
 *
 *  So this does not re-ask the model — it recomputes deterministically. Price
 *  is the one signal that IS in the pixels and is a reasonable proxy for who a
 *  manager actually starts (their most expensive players, almost always).
 *  Requires exactly one starting goalkeeper already decided (run this AFTER
 *  enforceOneGkStarter) and exactly 15 total players — a cropped/partial read
 *  is left to padSlots, same boundary enforceOneGkStarter draws. A missing
 *  price sorts last within its position (never preferred over a priced peer)
 *  but never blocks the repair. Pure. */
export function repairInvalidFormation(players: ExtractedPlayer[]): ExtractedPlayer[] {
  if (players.length !== 15) return players;
  const outfield = players.filter((p) => p.position !== "GK");
  if (outfield.length !== 13) return players; // not the standard 5 DEF/5 MID/3 FWD squad

  const startingCounts = { def: 0, mid: 0, fwd: 0 };
  for (const p of outfield) {
    if (p.isBench) continue;
    if (p.position === "DEF") startingCounts.def++;
    else if (p.position === "MID") startingCounts.mid++;
    else if (p.position === "FWD") startingCounts.fwd++;
  }
  const alreadyLegal = LEGAL_FORMATIONS.some(
    (f) => f.def === startingCounts.def && f.mid === startingCounts.mid && f.fwd === startingCounts.fwd,
  );
  if (alreadyLegal) return players;

  const byPos = (pos: ExtractedPosition) => outfield
    .map((p, i) => ({ p, i })) // stable sort: original order breaks ties, never random
    .filter(({ p }) => p.position === pos)
    .sort((a, b) => (b.p.price ?? -1) - (a.p.price ?? -1) || a.i - b.i)
    .map(({ p }) => p);
  const def = byPos("DEF"), mid = byPos("MID"), fwd = byPos("FWD");
  if (def.length < 3 || mid.length < 2 || fwd.length < 1) return players; // can't form a legal XI at all

  const sumPrice = (xs: ExtractedPlayer[]) => xs.reduce((s, p) => s + (p.price ?? 0), 0);
  let best: { def: number; mid: number; fwd: number } | null = null;
  let bestValue = -Infinity;
  for (const f of LEGAL_FORMATIONS) {
    if (f.def > def.length || f.mid > mid.length || f.fwd > fwd.length) continue;
    const value = sumPrice(def.slice(0, f.def)) + sumPrice(mid.slice(0, f.mid)) + sumPrice(fwd.slice(0, f.fwd));
    if (value > bestValue) { bestValue = value; best = f; }
  }
  if (!best) return players;

  const starting = new Set([
    ...def.slice(0, best.def), ...mid.slice(0, best.mid), ...fwd.slice(0, best.fwd),
  ]);
  return players.map((p) => (p.position === "GK" ? p : { ...p, isBench: !starting.has(p) }));
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
