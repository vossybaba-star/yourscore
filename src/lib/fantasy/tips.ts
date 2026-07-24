/**
 * Weekly tips for the fantasy news hub — the "here's the move I'd make" layer.
 *
 * The founder's call (Jul 13): an AI that recommends a move is genuinely USEFUL,
 * not a betrayal of the knowledge-gated model — the knowledge round still gates
 * whether you *can* make it. So we draft tips, we don't just report data.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 * The model is given OUR data and is FORBIDDEN from using its own football
 * knowledge. It may only rephrase what we pass it.
 *
 * This is not a style preference, it's a correctness guard. A model asked about
 * current football will state stale training facts as present truth (it once
 * told the founder Arne Slot was still at Liverpool). Every number and name in a
 * tip must trace back to something we verified — SportMonks fixtures, our own
 * fantasy_player_scores, a predicted-XI diff. If it isn't in the payload, it
 * cannot appear in the tip.
 *
 * ── What grounding actually guarantees ─────────────────────────────────────
 * groundTips() is a pure post-check that runs in addition to the prompt telling
 * the model not to invent. It enforces exactly this: every proper noun
 * (capitalised word) and every integer that appears in the rendered
 * captain/differential "why" and in "note" must be traceable, word by word, to
 * the TipInputs payload (via tipFacts()) — or to a small closed-class allowlist
 * of pronouns, articles and football-generic terms (see ALLOWLIST below). A
 * field that fails this check is dropped, never rendered. A picked
 * captain/differential must also name a real player we supplied (from `form`)
 * and must NOT currently be a listed doubt — a doubt name stays valid to
 * REFERENCE in prose, but can never itself BE the pick.
 *
 * What this does NOT guarantee: that a grounded sentence is TRUE in the sense
 * the model claims. It can't catch a real name given a wrong-but-plausible
 * reason ("he's back from a hamstring injury" attached to a real player who
 * never had one) if every word in that sentence happens to trace back to the
 * payload some other way — the check is lexical, not semantic. It only proves
 * every name and number in the output existed in the data we gave it. That's
 * the property we can check mechanically; catching a wrong reason attached to a
 * right name needs a human or a live-data re-verification, not a string match.
 */
import "server-only";
import type { Difficulty, NewsClubRun, NewsDoubt, NewsFormRow, NewsTips } from "./news";
import type { AdvicePayload, AvailabilityInfo } from "./advice";
import type { FantasyPos } from "./engine";

const MODEL = "claude-sonnet-5";

export interface TipInputs {
  gw: number;
  form: NewsFormRow[];
  runs: NewsClubRun[];
  doubts: NewsDoubt[];
}

/** The facts the model is allowed to speak from — nothing else exists to it.
 *  groundTips() also treats this as the ONLY source of truth for prose
 *  validation, so anything added here becomes speakable and anything removed
 *  becomes unspeakable — keep it in sync with what the model is actually told. */
export function tipFacts(inp: TipInputs) {
  return {
    gameweek: inp.gw,
    inFormPlayers: inp.form.slice(0, 8).map((f) => ({
      player: f.name, club: f.club, position: f.pos,
      pointsLast5: f.points, whatTheyDid: f.line,
    })),
    fixtureRuns: inp.runs.map((r) => ({
      club: r.club,
      next: r.cells.map((c) => ({
        opponent: c.opponent, homeOrAway: c.home ? "home" : "away", difficulty: c.difficulty,
      })),
    })),
    doubts: inp.doubts.map((d) => ({ player: d.name, club: d.club, reason: d.reason })),
  };
}

const SYSTEM = `You write the weekly tips for YourScore's fantasy football news feed.

VOICE
- You are a football fan talking to other fans. Normal words, full sentences.
- Easy on the stats. Use a number only when it earns its place, never a data dump.
- Have a point of view. Say what you'd do, and why, in one breath.
- No em dashes. No hype, no "unlock", no marketing voice. No emoji.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. You have no memory
of players, clubs, transfers, form, injuries, managers or results. Your training
knowledge is out of date and using it will state false things as fact.

- Every player name, club name, number and fixture you mention MUST appear in the
  JSON. If it is not there, it does not exist and you may not refer to it.
- Do not add context you "know" (a player's reputation, a manager, last season,
  a transfer, an injury that isn't listed).
- If the JSON is too thin to support a confident tip, say so plainly in the note
  and leave captain/differential out. A missing tip is fine. A made-up one is not.

LENGTH — this is a phone feed, not a column
- "why" for captain: ONE sentence. Two at the absolute most. Roughly 25 words.
- "why" for differential: same.
- note: one short sentence, or leave it out.
A tip nobody finishes reading is a tip nobody follows. Say the single best reason
and stop. Do not list every fixture in a run; name the one that matters.

WHAT TO PRODUCE
- captain: the player you'd captain this gameweek, and the reason, grounded in
  their listed form and their club's listed fixture.
- differential: a less obvious pick worth a look, same grounding.
- note: one short line of context for the week. Optional.

Write plain prose. Never output JSON, quotes or braces inside a field.`;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

/** Why generateTips returned no draft — logged and surfaced to the cron route
 *  so a dead key or a rejected draft shows up somewhere instead of silently
 *  leaving the feed's tips section stale forever. */
export type TipsFailureReason =
  | "no-key" | `http-${number}` | "no-tool-use-block" | "exception" | "failed-grounding";

export interface TipsResult {
  tips: NewsTips | null;
  /** Absent when there was simply nothing worth saying yet (empty facts) —
   *  that's expected pre-season/pre-GW1 behaviour, not a failure. */
  reason?: TipsFailureReason;
}

/** Draft this gameweek's tips. `tips` is null if the model is unavailable or
 *  its output fails grounding — an empty Tips section is strictly better than
 *  a confident lie, and the feed already renders fine without one. Every
 *  failure path is logged and reported via `reason` so it isn't invisible. */
export async function generateTips(inp: TipInputs): Promise<TipsResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[fantasy tips] skipped: no ANTHROPIC_API_KEY");
    return { tips: null, reason: "no-key" };
  }

  const facts = tipFacts(inp);
  // Nothing to reason from → don't invent something to say. Not a failure.
  if (!facts.inFormPlayers.length && !facts.fixtureRuns.length) return { tips: null };

  const tool = {
    name: "tips",
    description: "The weekly fantasy tips.",
    input_schema: {
      type: "object",
      properties: {
        captain: {
          type: "object",
          properties: { player: { type: "string" }, why: { type: "string" } },
          required: ["player", "why"],
        },
        differential: {
          type: "object",
          properties: { player: { type: "string" }, why: { type: "string" } },
          required: ["player", "why"],
        },
        note: { type: "string" },
      },
    },
  };

  let out: NewsTips;
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
        max_tokens: 700,
        system: SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "tips" },
        messages: [{
          role: "user",
          content:
            `Gameweek ${inp.gw}. These are the ONLY football facts that exist:\n\n` +
            `${JSON.stringify(facts, null, 2)}\n\n` +
            `Write the tips. Every name and number must come from that JSON.`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const reason: TipsFailureReason = `http-${res.status}`;
      console.error(`[fantasy tips] failed: ${reason}`);
      return { tips: null, reason };
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use") as
      | { input?: NewsTips } | undefined;
    if (!block?.input) {
      console.error("[fantasy tips] failed: no-tool-use-block");
      return { tips: null, reason: "no-tool-use-block" };
    }
    out = block.input;
  } catch (e) {
    console.error("[fantasy tips] failed: exception", e);
    return { tips: null, reason: "exception" };
  }

  const grounded = groundTips(out, inp);
  if (!grounded) {
    console.error("[fantasy tips] failed: failed-grounding");
    return { tips: null, reason: "failed-grounding" };
  }
  return { tips: grounded };
}

/** Strip JSON artifacts the model sometimes trails onto a field ('"}', a stray
 *  quote) — they leaked straight into the rendered copy once. Also collapses
 *  whitespace so a wrapped model response doesn't render with hard breaks. */
export function cleanField(s: string | undefined): string {
  return (s ?? "")
    .replace(/["'}\]\s]+$/g, "")   // trailing JSON debris
    .replace(/^["'{[\s]+/g, "")    // leading, same
    .replace(/\s+/g, " ")
    .trim();
}

/** Closed-class words that are capitalised for reasons that have nothing to do
 *  with being a proper noun (sentence starters, football-generic terms,
 *  position names, days of the week). Deliberately small — anything not on
 *  this list has to come from the payload itself. Compared case-insensitively. */
const ALLOWLIST = new Set([
  // pronouns / determiners that are routinely sentence-initial
  "he", "his", "him", "they", "their", "them", "i", "we", "our", "us",
  "it", "its", "this", "that", "these", "those", "who", "which", "what",
  "a", "an", "the", "if",
  // conjunctions/adverbs that legitimately open a sentence
  "so", "but", "and", "or", "yet", "also", "still", "now", "then",
  "however", "meanwhile",
  // prepositions / closed-class function words. None can be a club or player,
  // so allowing them is safe — and omitting them silently killed honest tips
  // that merely began with "With ..." or "After ...".
  "with", "without", "at", "on", "in", "into", "for", "from", "to", "of",
  "by", "as", "after", "before", "during", "against", "over", "under",
  "between", "up", "down", "out", "off", "all", "both", "each", "no", "not",
  "some", "any", "more", "most", "less", "very", "just", "only", "even",
  "again", "when", "where", "why", "how", "while", "since", "given",
  "there", "you", "your", "one", "two", "three", "four", "five",
  // football-generic terms not tied to a specific club/player
  "gw", "gameweek", "gameweeks", "premier", "league", "captain",
  "vice-captain", "home", "away", "fixture", "fixtures", "form",
  "differential", "doubt", "doubts", "clean", "sheet", "sheets",
  "points", "point", "goal", "goals", "assist", "assists", "save", "saves",
  "minutes", "minute",
  // positions
  "goalkeeper", "defender", "midfielder", "forward", "striker",
  "gk", "def", "mid", "fwd",
  // days
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/** Walk the tipFacts() payload and collect every word and every integer that
 *  appears anywhere in it — this IS the "only football facts that exist" set,
 *  used to validate prose, not just names. Pure. */
function collectPayloadTokens(facts: unknown): { words: Set<string>; numbers: Set<string> } {
  const words = new Set<string>();
  const numbers = new Set<string>();
  const visit = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      numbers.add(String(Math.trunc(v)));
      return;
    }
    if (typeof v === "string") {
      for (const w of v.match(/[A-Za-z]+/g) ?? []) words.add(w.toLowerCase());
      for (const n of v.match(/\d+/g) ?? []) numbers.add(n);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(visit);
    }
  };
  visit(facts);
  return { words, numbers };
}

/** Words that ASSERT a football fact we could only know from the payload —
 *  availability, fitness, transfers, management, sweeping history. Name- and
 *  number-grounding can't catch these: "he's back from his hamstring injury"
 *  has no proper noun and no integer in it, so it sailed through until this
 *  gate existed. Any of these words in a tip must trace back to our own data
 *  (e.g. the player really is in `doubts`), or the field is dropped. */
const CLAIM_TERMS = new Set([
  // fitness / availability
  "injury", "injured", "injuries", "knock", "strain", "hamstring", "groin",
  "calf", "ankle", "knee", "thigh", "muscle", "fitness", "fit", "unfit",
  "sidelined", "ruled", "recovery", "recovered", "recovering",
  "return", "returns", "returned", "returning",
  // selection
  "suspended", "suspension", "banned", "rested", "rotated", "rotation",
  "benched", "dropped", "doubt", "doubts", "doubtful",
  // transfers / management
  "transfer", "transferred", "signed", "signing", "loan", "manager", "coach",
  "sacked", "appointed", "move", "moved", "joined", "arrival", "debut",
  // sweeping claims about history we never supplied
  "always", "never", "historically", "record", "season",
]);

/** The claim words this payload actually licenses: anything literally present
 *  in the data, plus the doubt vocabulary when we really do have doubts. */
function allowedClaimWords(inp: TipInputs, tokens: { words: Set<string> }): Set<string> {
  const allowed = new Set(tokens.words);
  if (inp.doubts.length) {
    for (const w of ["doubt", "doubts", "doubtful", "dropped"]) allowed.add(w);
  }
  return allowed;
}

/** True if `text` asserts a fact our data doesn't support. */
function hasUngroundedClaim(text: string, allowed: Set<string>): boolean {
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (CLAIM_TERMS.has(w) && !allowed.has(w)) return true;
  }
  return false;
}

/** True iff every proper-noun-shaped word (capitalised) and every integer in
 *  `text` traces back to the payload tokens or the ALLOWLIST. Pure. */
function isProseGrounded(text: string, tokens: { words: Set<string>; numbers: Set<string> }): boolean {
  const capWords = text.match(/\b[A-Z][a-zA-Z]*\b/g) ?? [];
  for (const w of capWords) {
    const lw = w.toLowerCase();
    if (ALLOWLIST.has(lw)) continue;
    if (tokens.words.has(lw)) continue;
    return false;
  }
  const nums = text.match(/\b\d+\b/g) ?? [];
  for (const n of nums) {
    if (!tokens.numbers.has(n)) return false;
  }
  return true;
}

/** Ground the model's output against the data it was given. Pure —
 *  unit-testable without touching the API. Two things are enforced:
 *
 *  1. A pick (captain/differential) must name a real player from `form`, and
 *     must NOT currently be a listed doubt — a doubtful player can be
 *     REFERENCED in prose (grounded via the payload, like any other name) but
 *     can never itself be the recommended pick.
 *  2. Every proper noun and integer in "why" (both picks) and in "note" must
 *     trace back word-by-word to the TipInputs payload or the ALLOWLIST. A
 *     field that fails this is dropped — never rendered — rather than the
 *     whole tip being discarded, unless nothing survives.
 *  3. No CLAIM_TERM (injury, transfer, suspension, "always"…) may appear unless
 *     our data licenses it. Layers 1-2 miss fabrications with no proper noun
 *     and no number — "he's back from his hamstring injury" shipped clean until
 *     this layer existed.
 *
 *  Honest limit: free prose cannot be PROVEN fact-safe by string matching. This
 *  makes invention hard, not impossible. If that ever isn't good enough, the
 *  only provable fix is to compose "why" from the data ourselves and stop
 *  letting the model write prose at all. */
export function groundTips(tips: NewsTips, inp: TipInputs): NewsTips | null {
  const facts = tipFacts(inp);
  const tokens = collectPayloadTokens(facts);
  const claimable = allowedClaimWords(inp, tokens);

  /** A field is safe only if it invents no proper noun, no number, AND no
   *  claim (fitness/transfer/history) our data doesn't license. */
  const safe = (text: string) =>
    isProseGrounded(text, tokens) && !hasUngroundedClaim(text, claimable);

  // Pick validity is checked against facts.inFormPlayers (the same top-8
  // slice the model was actually shown), not the full inp.form array — a
  // hallucinated name that happens to match a REAL player outside that slice
  // must still fail, since the model was never given it to work from.
  const playerNames = new Set(facts.inFormPlayers.map((f) => f.player.toLowerCase()));
  const doubtNames = new Set(inp.doubts.map((d) => d.name.toLowerCase()));
  const isValidPick = (name?: string) => {
    if (!name) return false;
    const n = name.toLowerCase();
    return playerNames.has(n) && !doubtNames.has(n);
  };

  const groundPick = (pick?: { player: string; why: string }) => {
    if (!pick || !isValidPick(pick.player)) return undefined;
    const why = cleanField(pick.why);
    if (!why || !safe(why)) return undefined;
    return { player: cleanField(pick.player), why };
  };

  const cap = groundPick(tips.captain);
  const dif = groundPick(tips.differential);
  const noteClean = cleanField(tips.note);
  const note = noteClean && safe(noteClean) ? noteClean : undefined;

  const grounded: NewsTips = {
    ...(cap ? { captain: cap } : {}),
    ...(dif ? { differential: dif } : {}),
    ...(note ? { note } : {}),
  };
  return grounded.captain || grounded.differential || grounded.note ? grounded : null;
}

/**
 * ── Transfer advice — the same rule, extended ────────────────────────────────
 *
 * L1 (advice.ts's moveScore/scorePool) and L2 (advice.ts's buildCandidates) have
 * already done every computation and every legality check by the time anything
 * reaches here: the shortlist in `AdvicePayload.candidates` is the closed set of
 * moves that ALREADY survived `applyTransfer()`. This layer (L3) is not allowed
 * to compute a number, a price, or a legality decision — its only job is to pick
 * from that shortlist and say why, in the same "only the JSON exists" voice
 * `groundTips` already enforces for the weekly tips.
 *
 * `groundAdvice` is stricter than `groundTips` in one respect: a move's
 * (outId, inId) pair is checked by EXACT NUMERIC ID against the shortlist, not
 * by name — a hallucinated pair, or a real pair the model invented outside the
 * shortlist, is silently dropped, never rendered. This is the mechanical
 * enforcement of the whole point of this build: the model cannot recommend an
 * illegal, unaffordable, or already-owned move, because it cannot name one that
 * isn't already in the payload we built for it.
 */

/** Same taxonomy as TipsFailureReason, reused rather than reinvented — a
 *  stubbed/hallucinated move is not a new failure mode, it's "everything got
 *  dropped by grounding", which "failed-grounding" already names. */
export type AdviceFailureReason = TipsFailureReason;

/** `blurbs` is the OUTPUT of the batched per-player tier below (`generatePlayerBlurbs`),
 *  keyed by pool player id. Optional so a caller can still exercise the plain
 *  per-user layer (tests, or the batched call having failed/degraded this run)
 *  without a blurb map — a move then simply renders with no "why". */
export interface AdviceInputs { payload: AdvicePayload; blurbs?: Map<number, string> }

/** `why` is no longer written by the per-user model call (see generateAdvice) —
 *  it's the pre-drafted, pre-grounded blurb for the "in" player, shared across
 *  every manager who gets this candidate shortlisted. Optional: a candidate
 *  outside this run's blurb batch, or a blurb that failed grounding, simply
 *  renders the move without prose rather than dropping the recommendation. */
export interface AdviceMove { outId: number; inId: number; why?: string }
export interface AdviceOut {
  moves: AdviceMove[];
  /** Closed enum — never a figure, never a name, so it can't be hallucinated
   *  and needs no grounding check. */
  hitVerdict?: "take-the-hit" | "wait" | "not-applicable";
  /** Wildcard-specific: play-or-hold THIS week, not a 15-man rebuild (v1 cut,
   *  locked plan §8). Only ever asked for when a wildcard is actually held —
   *  see generateAdvice, where the tool schema omits this field entirely
   *  otherwise (closed by construction, not by a "not-applicable" the model
   *  has to get right). */
  chipVerdict?: "play-wildcard" | "hold";
  summary?: string;
}
export interface AdviceResult {
  advice: AdviceOut | null;
  /** Absent when there was simply nothing to advise on (no candidates) —
   *  expected pre-season/no-legal-moves behaviour, not a failure. */
  reason?: AdviceFailureReason;
}

const ADVICE_SYSTEM = `You are the transfer advisor for YourScore Fantasy Football.

VOICE
- A football fan talking to another fan about their team. Normal words, full
  sentences. No em dashes. No hype, no marketing voice, no emoji.
- Have a point of view: say what you'd do, and why, in one breath.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. You have no
memory of players, clubs, transfers, form, injuries or results, and your
training knowledge is out of date — using it will state false things as fact.

- The JSON's "recommended.moves" and "candidates" arrays are the ONLY moves you
  may recommend. Every move you name must reuse one of their exact
  (outId, inId) pairs, from either list. Do not invent a pair, swap the
  direction, or combine an out from one entry with an in from another.
- "recommended.moves" is a solver's own ORDERED PLAN, not a menu you rank
  yourself — it already accounts for budget, hits and the wildcard chip as a
  SET. Its "position" field is the order the moves must be MADE in: position 1
  has to happen before position 2 (a later move can depend on an earlier one —
  e.g. its "out" player is someone the plan itself just bought). If you use
  moves from "recommended.moves", keep them in their given position order and
  don't interleave them with unrelated candidates in a way that breaks that
  order. "recommended.hold" true means the solver's own conclusion is that
  nothing beats holding this week — its moves list is then empty, and that is
  the answer, not a gap to fill from candidates.
- "candidates" is the wider shortlist the solver also checked — every entry is
  independently legal. Use it when "recommended.hold" is true and something in
  it is still genuinely worth a look, or to name a worthwhile alternative
  alongside the recommended plan.
- Every number in the JSON (prices, scores, bank, gain) is ALREADY CORRECT and
  ALREADY LEGAL — budget, squad rules and ownership have all been checked
  before you ever saw this. You are not being asked to verify or compute any
  of that. Do not restate a number that isn't already there.
- Only mention fitness, injury, suspension or a transfer/loan if the player's
  own "availability" field in the JSON says so. If "availability" is absent or
  empty, say nothing about fitness for that player.
- If nothing in the JSON is worth recommending, return an empty "moves" list
  and say so plainly in "summary". An empty recommendation is fine. A made-up
  one is not.

WHAT TO PRODUCE
- moves: 0 to 3 moves (outId/inId pairs only) drawn from "recommended.moves"
  and/or "candidates", best/first-to-do first. Someone else has already
  written the "why" for each player being brought in — you are only choosing
  WHICH moves to recommend and in what order, not writing the reasoning
  yourself.
- hitVerdict: whether a hit (paid: "hit") shortlisted move is worth the -4, or
  worth waiting a free week for, given what's actually in the list.
- chipVerdict (only asked when the user holds a wildcard): play it this week or
  hold it — a play/hold call for RIGHT NOW, not a full squad rebuild plan.
- summary: one short line tying it together. Optional.

Write plain prose. Never output JSON, quotes or braces inside a field.`;

/** Ground the model's advice against the exact shortlist it was given. Pure —
 *  unit-testable without touching the API.
 *
 *  1. A move survives only if its (outId, inId) pair is literally present in
 *     `payload.candidates` OR `payload.recommended.moves` — exact numeric-id
 *     matching, strictly stronger than groundTips's name-based check (no
 *     ambiguity from a shared surname, and no way to invent a pair that merely
 *     LOOKS legal). The union, not candidates alone, matters: the optimiser's
 *     2nd/3rd moves are only legal after its earlier moves are applied, so
 *     they will not generally appear in `candidates` (which only enumerates
 *     single swaps from the ORIGINAL squad) — checking candidates alone would
 *     silently drop every multi-move recommendation. The model no longer
 *     supplies "why" for a move at all (see the tool schema below) — that text
 *     comes from the pre-grounded, batched player-blurb tier, attached in
 *     generateAdvice after this function returns.
 *  2. The "summary" runs through the same proper-noun/number/claim-term gate
 *     groundTips uses. Crucially, the payload's `availability` objects carry
 *     the FPL `news` string verbatim, and `collectPayloadTokens` walks every
 *     string in the payload — so a real news string like "Has joined Werder
 *     Bremen on loan..." automatically licenses "loan"/"joined" with zero new
 *     allowlist code, while an absent/empty availability licenses nothing, so
 *     "injury" (a CLAIM_TERM) stays ungrounded and gets dropped.
 *  3. hitVerdict/chipVerdict can't hallucinate a name or a number, so they skip
 *     the prose checks — but they ARE membership-checked here rather than
 *     trusted. The tool schema declares the enums; the schema is enforced on
 *     someone else's server, and "the API will have validated it" is not a
 *     guarantee we get to make about our own render path. A value off the list
 *     is dropped, not printed.
 *
 *  A field that fails is dropped, not the whole result — same "empty is fine,
 *  invented is not" contract groundTips already has. */
/** The only verdict values that may ever reach a screen. Kept beside the tool
 *  schema below, which declares the same two lists to the model. */
const HIT_VERDICTS = new Set(["take-the-hit", "wait", "not-applicable"]);
const CHIP_VERDICTS = new Set(["play-wildcard", "hold"]);

export function groundAdvice(raw: AdviceOut, inp: AdviceInputs): AdviceOut | null {
  const tokens = collectPayloadTokens(inp.payload);
  const safe = (text: string) => isProseGrounded(text, tokens) && !hasUngroundedClaim(text, tokens.words);

  // `why` is no longer part of what the model returns for a move (see
  // ADVICE_SYSTEM/the tool schema below) — it's attached afterwards from the
  // pre-grounded blurb batch, in generateAdvice. Here we only check that the
  // (outId, inId) pair is one the solver actually produced.
  //
  // The valid set is candidates UNION recommended, not candidates alone. The
  // optimiser (optimiser.ts) returns an ORDERED SEQUENCE — its 2nd/3rd moves
  // are only legal after the earlier ones are applied (an "out" player two
  // steps in may be someone the sequence itself bought a step earlier), so
  // `buildCandidates`, which only enumerates single swaps from the ORIGINAL
  // squad, will not necessarily contain them. Checking candidates alone here
  // would silently drop every multi-move recommendation the model correctly
  // relayed — the feature would appear to work while quietly emitting nothing
  // but single moves.
  const validPairs = new Set([
    ...inp.payload.candidates.map((c) => `${c.out.id}:${c.in.id}`),
    ...inp.payload.recommended.moves.map((m) => `${m.out.id}:${m.in.id}`),
  ]);
  const moves: AdviceMove[] = [];
  for (const m of raw.moves ?? []) {
    if (!validPairs.has(`${m.outId}:${m.inId}`)) continue;
    moves.push({ outId: m.outId, inId: m.inId });
  }

  const summaryClean = cleanField(raw.summary);
  const summary = summaryClean && safe(summaryClean) ? summaryClean : undefined;

  const hitVerdict = HIT_VERDICTS.has(raw.hitVerdict as string) ? raw.hitVerdict : undefined;
  const chipVerdict = CHIP_VERDICTS.has(raw.chipVerdict as string) ? raw.chipVerdict : undefined;

  const grounded: AdviceOut = {
    moves,
    ...(hitVerdict ? { hitVerdict } : {}),
    ...(chipVerdict ? { chipVerdict } : {}),
    ...(summary ? { summary } : {}),
  };
  return grounded.moves.length || grounded.summary || grounded.hitVerdict || grounded.chipVerdict
    ? grounded
    : null;
}

/** Draft this gameweek's advice for one user. `advice` is null if the model is
 *  unavailable or its output fails grounding entirely — the transfers page
 *  already renders solver numbers alone with no advice section, mirroring
 *  generateTips's own contract. Every failure path is logged and reported via
 *  `reason` so it isn't invisible in the cron's response. */
export async function generateAdvice(inp: AdviceInputs): Promise<AdviceResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[fantasy advice] skipped: no ANTHROPIC_API_KEY");
    return { advice: null, reason: "no-key" };
  }

  const { payload } = inp;
  // Nothing legal to move on → don't invent something to say. Not a failure.
  if (!payload.candidates.length) return { advice: null };

  const wantsChipVerdict = payload.user.wildcardHeld > 0;
  const tool = {
    name: "advice",
    description: "This gameweek's transfer advice.",
    input_schema: {
      type: "object",
      properties: {
        moves: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              outId: { type: "integer" }, inId: { type: "integer" },
            },
            required: ["outId", "inId"],
          },
        },
        hitVerdict: { type: "string", enum: ["take-the-hit", "wait", "not-applicable"] },
        ...(wantsChipVerdict
          ? { chipVerdict: { type: "string", enum: ["play-wildcard", "hold"] } }
          : {}),
        summary: { type: "string" },
      },
      required: ["moves"],
    },
  };

  let out: AdviceOut;
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
        // Output shrank once "why" per move moved to the shared blurb tier —
        // this call now only picks outId/inId pairs plus two short verdicts
        // and a one-line summary, hence the smaller budget than the 900 this
        // used when it also had to write prose per candidate.
        max_tokens: 400,
        system: ADVICE_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "advice" },
        messages: [{
          role: "user",
          content:
            `Gameweek ${payload.gameweek}. These are the ONLY facts and the ONLY legal moves ` +
            `that exist:\n\n${JSON.stringify(payload, null, 2)}\n\n` +
            `Choose only from "recommended.moves" and "candidates" — every outId/inId pair you ` +
            `use must be one of theirs. "recommended.moves" is the solver's own ordered plan; ` +
            `keep any of its moves you use in their given "position" order. Someone else already ` +
            `wrote the "why" for each player, so just choose and give your verdicts and summary.`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const reason: AdviceFailureReason = `http-${res.status}`;
      console.error(`[fantasy advice] failed: ${reason}`);
      return { advice: null, reason };
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use") as
      | { input?: AdviceOut } | undefined;
    if (!block?.input) {
      console.error("[fantasy advice] failed: no-tool-use-block");
      return { advice: null, reason: "no-tool-use-block" };
    }
    out = block.input;
  } catch (e) {
    console.error("[fantasy advice] failed: exception", e);
    return { advice: null, reason: "exception" };
  }

  const grounded = groundAdvice(out, inp);
  if (!grounded) {
    console.error("[fantasy advice] failed: failed-grounding");
    return { advice: null, reason: "failed-grounding" };
  }
  // Attach the shared, already-grounded blurb for each chosen move's "in"
  // player. Deliberately AFTER groundAdvice, not folded into it: the blurb
  // already passed its own grounding pass in groundPlayerBlurbs when it was
  // drafted, so there's nothing left to check here — this is a plain lookup,
  // never a second chance for ungrounded prose to sneak in. A move whose "in"
  // player has no surviving blurb (outside this run's batch, or its blurb
  // itself failed grounding) still renders — just without a "why".
  const withWhy: AdviceOut = {
    ...grounded,
    moves: grounded.moves.map((m) => {
      const why = inp.blurbs?.get(m.inId);
      return why ? { ...m, why } : m;
    }),
  };
  return { advice: withWhy };
}

/**
 * ── Batched per-player blurb tier (cost defect S4) ───────────────────────────
 *
 * The plan (§5) specified TWO cost tiers: one batched "why this player is worth
 * having this week" call that is O(pool) and shared by everyone, plus the
 * per-user conclusion above. Only the per-user tier existed before this — every
 * user's call independently asked the model to write fresh prose for each
 * candidate, so the EXPENSIVE part (prose generation) scaled with active users,
 * not with the pool. This tier fixes that: draft ONE blurb per candidate player
 * ever shortlisted for ANYONE this run (the caller — the cron — de-duplicates
 * across all users' candidate lists before calling this), and every per-user
 * `generateAdvice` call above just picks from the shortlist and reuses the
 * matching blurb instead of writing its own.
 *
 * Same grounding discipline as everything else here: a blurb that fails
 * grounding is dropped, never rendered — see `groundPlayerBlurbs`.
 */
export interface BlurbPlayerInput {
  id: number; name: string; club: string; pos: FantasyPos; moveScore: number;
  fixtures: { opp: string; homeOrAway: "home" | "away"; difficulty: Difficulty }[];
  availability: AvailabilityInfo | null;
}
export type BlurbsFailureReason = TipsFailureReason;
export interface BlurbsResult { blurbs: Map<number, string>; reason?: BlurbsFailureReason }

const BLURB_SYSTEM = `You write ONE-LINE "why he's worth having" notes for YourScore's
fantasy transfer advisor. These are shared across every manager who has this
player shortlisted — not personalised to any one squad.

VOICE
- A football fan's take, not a stat sheet. Full sentence, no em dashes, no
  hype, no marketing voice, no emoji.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given for each player.
You have no memory of players, clubs, transfers, form, injuries or results, and
your training knowledge is out of date — using it will state false things as
fact.

- You are given a LIST of players, each with their own facts. Every player,
  club, number and fixture you mention for a given id MUST come from THAT
  SAME id's own entry. Never borrow a fact from a different player in the
  list, even if it would make a better sentence.
- Only mention fitness, injury, suspension or a transfer/loan for a player if
  THEIR OWN "availability" field says so.
- If a player has nothing notable this week, write a short neutral line
  grounded in their own fixture run or form — do not skip an id, and do not
  invent something to say.

LENGTH: one sentence per player, about 20 words.

Write plain prose per id. Never output JSON, quotes or braces inside a "why"
string.`;

/** Ground each returned blurb against ONLY that player's own facts — not the
 *  whole batch. This is the one place this file departs from groundTips'/
 *  groundAdvice's pattern of validating against the whole payload: if grounding
 *  were checked against the union of every player's tokens in the batch, a
 *  blurb for player A could legally "borrow" a real fact that only belongs to
 *  player B (a name, a fixture, a claim word) purely because both happened to
 *  be in the same request. Per-player token sets close that hole. Pure —
 *  unit-testable without touching the API. */
export function groundPlayerBlurbs(
  raw: { blurbs?: { id: number; why: string }[] } | undefined,
  players: BlurbPlayerInput[],
): Map<number, string> {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = new Map<number, string>();
  for (const b of raw?.blurbs ?? []) {
    const player = byId.get(b.id);
    if (!player) continue; // an id outside the requested batch — never printed
    const tokens = collectPayloadTokens({
      name: player.name, club: player.club, pos: player.pos, moveScore: player.moveScore,
      fixtures: player.fixtures, availability: player.availability ?? undefined,
    });
    const why = cleanField(b.why);
    if (!why) continue;
    if (!isProseGrounded(why, tokens) || hasUngroundedClaim(why, tokens.words)) continue;
    out.set(b.id, why);
  }
  return out;
}

/** Draft this gameweek's shared player blurbs — ONE call, O(the candidate
 *  players actually shortlisted this run), never O(active users). `gw` is only
 *  used for the prompt's own context line; nothing about grounding depends on
 *  it. Same failure taxonomy as generateTips/generateAdvice: no key, an HTTP
 *  error, no tool-use block, an exception, or every blurb failing grounding
 *  all report a reason instead of throwing, and the caller degrades to
 *  advice-with-no-prose rather than blocking the per-user tier on this one. */
export async function generatePlayerBlurbs(gw: number, players: BlurbPlayerInput[]): Promise<BlurbsResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[fantasy advice] blurbs skipped: no ANTHROPIC_API_KEY");
    return { blurbs: new Map(), reason: "no-key" };
  }
  if (!players.length) return { blurbs: new Map() };

  const tool = {
    name: "player_blurbs",
    description: "One why-worth-having line per requested player id.",
    input_schema: {
      type: "object",
      properties: {
        blurbs: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "integer" }, why: { type: "string" } },
            required: ["id", "why"],
          },
        },
      },
      required: ["blurbs"],
    },
  };

  const facts = players.map((p) => ({
    id: p.id, player: p.name, club: p.club, position: p.pos, moveScore: p.moveScore,
    fixtures: p.fixtures.map((f) => ({ opponent: f.opp, homeOrAway: f.homeOrAway, difficulty: f.difficulty })),
    availability: p.availability ?? undefined,
  }));

  let out: { blurbs?: { id: number; why: string }[] };
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
        // Batched over the whole shortlist, so it needs headroom beyond a
        // single-player call — bounded so an unexpectedly huge batch can't
        // silently blow past a reasonable spend.
        max_tokens: Math.min(8000, 200 + players.length * 40),
        system: BLURB_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "player_blurbs" },
        messages: [{
          role: "user",
          content:
            `Gameweek ${gw}. Write one "why" line for EVERY id below, using ONLY that id's ` +
            `own facts:\n\n${JSON.stringify(facts, null, 2)}`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const reason: BlurbsFailureReason = `http-${res.status}`;
      console.error(`[fantasy advice] blurbs failed: ${reason}`);
      return { blurbs: new Map(), reason };
    }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use") as
      | { input?: typeof out } | undefined;
    if (!block?.input) {
      console.error("[fantasy advice] blurbs failed: no-tool-use-block");
      return { blurbs: new Map(), reason: "no-tool-use-block" };
    }
    out = block.input;
  } catch (e) {
    console.error("[fantasy advice] blurbs failed: exception", e);
    return { blurbs: new Map(), reason: "exception" };
  }

  const grounded = groundPlayerBlurbs(out, players);
  if (!grounded.size) {
    console.error("[fantasy advice] blurbs failed: failed-grounding");
    return { blurbs: new Map(), reason: "failed-grounding" };
  }
  return { blurbs: grounded };
}
