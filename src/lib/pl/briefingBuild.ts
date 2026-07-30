import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlNews } from "./ingest";
import {
  autoBold, BRIEFING_SIZE, capBold, fallbackBriefing, fallbackSubhead, plainBullet,
  selectStories, tidySubhead, type BriefingStory, type PlBriefing,
} from "./briefing";
import { cleanField, collectPayloadTokens, isProseGrounded } from "@/lib/fantasy/tips";
import type { PlNewsItem } from "./news";

/**
 * Building the Daily Briefing.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 * We publish no reporting of our own. The model is given the day's headlines
 * and standfirsts and may ONLY compress them. It is forbidden from using its
 * own football knowledge, and that is enforced after the fact, not just asked
 * for in the prompt: every proper noun and every number in a bullet must trace
 * back to THAT STORY's own headline and standfirst, and anything that doesn't
 * is replaced with the outlet's words verbatim.
 *
 * This is the same guard as the fantasy tips (see lib/fantasy/tips.ts, whose
 * checker this reuses rather than growing a second copy), and it exists for the
 * same reason: asked about current football, a model states stale training
 * facts as present truth. On a briefing whose entire promise is "these are
 * today's real stories", one invented clause is the whole feature broken.
 *
 * Grounding is per-STORY, not per-payload: checking a bullet against all five
 * stories at once would let a bullet for story 3 borrow a name from story 1 and
 * still pass, which is exactly the error a reader would notice.
 */

const MODEL = "claude-sonnet-5";
/** Only today's news. A briefing leading on yesterday isn't a briefing. */
const WINDOW_MS = 24 * 3_600_000;
/** How much of each standfirst the model gets to work from. */
const BRIEFING_SUMMARY_MAX = 420;

const SYSTEM = `You compile a football news briefing from articles other outlets published today.

You are NOT a journalist and you are NOT writing new content. You are compressing
headlines that already exist.

RULES, in order of importance:
1. Use ONLY the words and facts in the articles given to you. You have no football
   knowledge of your own. If it is not in the article's headline or standfirst, it
   does not exist and you cannot write it.
2. Never state a transfer as complete unless the article does. "Linked with",
   "targets" and "closing on" are not "signs" or "joins".
3. Every bullet covers exactly one article, in the order given, and uses only that
   article's own headline and standfirst.
4. British English. No em dashes anywhere. Say "friend", never "mate".
5. A bullet is ONE sentence, under 130 characters, plain and factual. No hype, no
   questions, no exclamation marks, no opinions on what it means.
5b. Each bullet also gets a "detail": ONE more sentence, under 150 characters,
   carrying what the bullet had to leave out — the fee, the contract length, who
   else is involved, what happens next, the quote's substance. It must ADD
   information, never restate the bullet in other words. If the article genuinely
   says nothing beyond the bullet, return an EMPTY STRING for detail. An empty
   detail is correct and expected; a padded one is a failure.
6. In each bullet, wrap the parts a reader scans for in **double asterisks**: the
   people and clubs, and the thing that actually happened. Two or three marked
   runs per bullet, never more, and never the whole sentence. Examples:
   "**Newcastle captain Bruno Guimaraes** is expected to join **Arsenal** this
   summer." / "**Real Madrid** have prepared a bid for **Manchester City's
   Rodri**." / "**Harvey Elliott** says he is ready to take his **second chance**
   at **Liverpool**." Mark only words already in the article.
7. The subhead strings two or three of the biggest hooks together and ends with
   "and more", like "Lacroix joins Chelsea, Spurs target bomba signing and more".
   Separate the hooks with COMMAS only, never with "and" — one "and more" at the
   end is the only "and" allowed. Under 80 characters including that ending. Name
   only clubs and people that appear in the articles.`;

interface StoryInput {
  headline: string;
  standfirst: string;
  outlet: string;
}

/** The only facts that exist to the model. */
function storyInputs(picked: { item: PlNewsItem }[]): StoryInput[] {
  return picked.map(({ item }) => ({
    headline: item.title,
    standfirst: item.summary ?? "",
    outlet: item.source,
  }));
}

export interface BriefingResult {
  briefing: PlBriefing | null;
  /** Set when we didn't get a clean model briefing — visible in the cron
   *  response so a silently degraded briefing can't hide. */
  issue?: string;
  /** Fields the grounding check rejected and replaced with the outlet's words. */
  rejected?: number;
}

export async function buildBriefing(
  db: SupabaseClient,
  now = new Date(),
): Promise<BriefingResult> {
  const date = londonDate(now);
  // Longer standfirsts than the news feed keeps: the model has to get a bullet
  // AND a line of detail out of each one, and it can only use what we hand it.
  const { items } = await fetchPlNews({ summaryMax: BRIEFING_SUMMARY_MAX });
  const fresh = items.filter(
    (i) => now.getTime() - new Date(i.publishedAt).getTime() <= WINDOW_MS,
  );
  // Better a thinner briefing than yesterday's news dressed as today's, but an
  // empty one is not worth publishing at all.
  const pool = fresh.length >= BRIEFING_SIZE ? fresh : items;
  if (pool.length === 0) return { briefing: null, issue: "no items" };

  const picked = selectStories(pool, now.getTime());
  const builtAt = now.toISOString();

  const compiled = await compile(storyInputs(picked));
  let briefing: PlBriefing;
  let rejected = 0;

  if (!compiled.ok) {
    briefing = fallbackBriefing(picked, date, builtAt);
  } else {
    const stories: BriefingStory[] = picked.map(({ item, desks }, idx) => {
      // Ground each bullet against ITS OWN story only.
      const tokens = collectPayloadTokens({ headline: item.title, standfirst: item.summary ?? "" });
      const candidate = cleanField(compiled.bullets[idx]);
      // Ground the STRIPPED text. The emphasis markers are ours, not the
      // model's claim, and `**Arsenal**` must not read as a different word from
      // `Arsenal` to the checker.
      const usable = candidate.length > 0 && isProseGrounded(plainBullet(candidate), tokens);
      if (!usable) rejected++;
      return {
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        image: item.image,
        publishedAt: item.publishedAt,
        // Rejected → the outlet's own words, with the names marked by us so a
        // fallback bullet doesn't sit in the list as the one flat paragraph.
        bullet: usable ? capBold(candidate) : autoBold(item.summary ?? item.title),
        detail: pickDetail(compiled.details[idx], plainBullet(candidate), tokens),
        desks,
      };
    });

    const allTokens = collectPayloadTokens(storyInputs(picked));
    // Trim BEFORE grounding: a hook the trim drops shouldn't be able to fail the
    // check and cost us the whole subhead.
    const sub = tidySubhead(cleanField(compiled.subhead));
    const subOk = sub.length > 0 && isProseGrounded(sub, allTokens);
    if (!subOk) rejected++;

    briefing = {
      date,
      subhead: subOk ? sub : fallbackSubhead(picked.map((p) => p.item.title)),
      stories,
      builtAt,
      compiledBy: "model",
    };
  }

  // One row per day, overwritten — re-running the cron refreshes today rather
  // than stacking duplicates.
  const { error } = await db
    .from("pl_briefings")
    .upsert({ date, doc: briefing, updated_at: builtAt });
  if (error) return { briefing, issue: `write failed: ${error.message}`, rejected };

  return { briefing, issue: compiled.ok ? undefined : compiled.reason, rejected };
}

/**
 * The second line, or nothing.
 *
 * Dropped rather than shown when it fails grounding, when it's too short to be
 * worth a line, or when it mostly repeats the bullet. That last check matters
 * most: asked for extra detail the model will always produce a sentence, and a
 * restatement dressed as new information is worse than a bullet standing alone —
 * the reader spends attention on it and gets nothing back.
 *
 * There is no fallback here on purpose. The bullet can fall back to the outlet's
 * standfirst because that text exists; a detail we cannot ground has no honest
 * substitute, so it simply doesn't render.
 */
function pickDetail(
  raw: string | undefined,
  bulletPlain: string,
  tokens: { words: Set<string>; numbers: Set<string> },
): string | undefined {
  const detail = cleanField(raw);
  // The model marks emphasis here too, unasked. Strip it for every check —
  // grounding, length, and the repetition test all reason about words, and
  // `**Newcastle**` must not read as a different word from `Newcastle`.
  const plain = plainBullet(detail);
  if (plain.length < 25) return undefined;
  if (!isProseGrounded(plain, tokens)) return undefined;
  if (addsNothing(plain, bulletPlain)) return undefined;
  // Two marked runs, not three: the second line is supporting text, and matching
  // the bullet's weight would flatten the difference between them.
  return capBold(detail, 2);
}

/** A detail has to carry at least this many substantial words the bullet
 *  didn't. Three is what separated the real ones from the restatements on a
 *  live pull; two let a pure echo through. */
const MIN_NEW_WORDS = 3;

/**
 * True when the detail is the bullet's own words back again.
 *
 * Measured as NEW substantial words, not as an overlap ratio. The ratio version
 * couldn't do the job: on a live briefing a pure restatement ("Chelsea and
 * Manchester City have both made contact over the Scottish striker") scored 0.60
 * and a genuinely useful line ("Elliott called his loan spell at Villa 'tough'
 * and wants to enjoy his football again") scored 0.50 — no threshold separates
 * those. What actually differs is that the second one introduces words like
 * "spell", "wants" and "football" while the first introduces only "have", "both"
 * and "made". Counting new words of five letters or more finds that directly,
 * and short filler words never reach the bar.
 */
function addsNothing(detail: string, bullet: string): boolean {
  const substantial = (s: string) =>
    new Set(s.toLowerCase().match(/\b[a-z']{5,}\b/g) ?? []);
  const inBullet = substantial(bullet);
  let fresh = 0;
  substantial(detail).forEach((w) => { if (!inBullet.has(w)) fresh++; });
  return fresh < MIN_NEW_WORDS;
}

type Compiled =
  | { ok: true; subhead: string; bullets: string[]; details: string[] }
  | { ok: false; reason: string };

async function compile(stories: StoryInput[]): Promise<Compiled> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: "no ANTHROPIC_API_KEY" };

  const tool = {
    name: "briefing",
    description: "The compiled briefing.",
    input_schema: {
      type: "object",
      properties: {
        subhead: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        details: {
          type: "array",
          items: { type: "string" },
          description: "One per bullet, same order. Empty string where the article adds nothing.",
        },
      },
      required: ["subhead", "bullets", "details"],
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
        max_tokens: 900,
        system: SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "briefing" },
        messages: [{
          role: "user",
          content: `Today's articles, in order. One bullet each, same order.\n\n${JSON.stringify(stories, null, 2)}`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `anthropic ${res.status}` };
    const json = await res.json();
    const block = (json.content ?? []).find((c: { type: string }) => c.type === "tool_use");
    if (!block) return { ok: false, reason: "no tool_use in response" };
    const input = block.input as { subhead?: string; bullets?: string[]; details?: string[] };
    if (!input.subhead || !Array.isArray(input.bullets)) return { ok: false, reason: "malformed output" };
    if (input.bullets.length !== stories.length) return { ok: false, reason: "bullet count mismatch" };
    // A short details array is survivable — the missing ones simply render
    // without a second line. A short bullets array is not.
    const details = Array.isArray(input.details) ? input.details : [];
    return { ok: true, subhead: input.subhead, bullets: input.bullets, details };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** The briefing's day, in London — the audience's clock, not the server's. */
export function londonDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
