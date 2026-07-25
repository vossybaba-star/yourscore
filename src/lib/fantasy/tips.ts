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
import type { NewsClubRun, NewsDoubt, NewsFormRow, NewsTips } from "./news";

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
