/**
 * FACTS-FIRST research (founder's call, 2026-07-16).
 *
 * The old order was backwards: an author searched the web ad hoc and wrote 30 questions, then
 * a verifier did 30 MORE web searches to check them. Two lots of searching, and the author's
 * own citation was untrusted — which is precisely why the verifier had to redo the work.
 *
 * The new order, which the SportMonks path already proved ($0.12 vs $4.32 — a facts-first win,
 * not a SportMonks win):
 *
 *     gather verified facts  →  author ONLY from the sheet  →  cheap consistency check
 *
 * Search cost collapses from O(questions) to O(1) per club/category. More importantly the
 * failure mode changes: a question derived from a verified fact cannot be a hallucination —
 * the worst it can be is a misreading, and catching a misreading needs no web search, just a
 * comparison against the sheet.
 *
 * THE RISK, and why the bar here is high: correlated failure. Per-question verification failed
 * independently; a bad FACT poisons every question built from it. So every fact must carry a
 * trusted source (scripts/quiz-factory/sources.mjs), untrusted ones are dropped, and the sheet
 * is small enough (~30 facts) for the founder to actually review — which is the real backstop.
 */

import { callClaude, parseJson, MODELS, WEB_SEARCH_TOOL, usageOf } from "../lib/anthropic.mjs";
import { isTrustedSource, sourceTier, TRUSTED_SOURCES_BRIEF } from "./sources.mjs";
import { norm } from "../lib/question-text.mjs";

/**
 * A stable id for a fact, derived from its text. Questions built from the same fact share it,
 * which is how the draw avoids dealing two related questions in one quiz (migration 81).
 * Deterministic, so re-researching the same fact reuses the key rather than orphaning it.
 */
export function factKey(factText) {
  let h = 2166136261 >>> 0; // FNV-1a over the normalized text
  const s = norm(factText);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `f${(h >>> 0).toString(36)}`;
}

const RESEARCH_SYSTEM = `You are a football researcher. You gather FACTS. You do not write quiz questions.

Search the web, then report atomic, verifiable facts. Reply with ONLY a JSON array:

[{
  "fact": "one complete, self-contained sentence stating the fact",
  "competition": "Premier League" | "Champions League" | "Europa League" | "FA Cup" | "League Cup" | "UEFA Super Cup" | "Europa Conference League" | "other",
  "season": "2019/20" or a year like "1886", or null if genuinely timeless",
  "source_url": "the page you took it from",
  "source_quote": "the exact line from that page that proves it"
}]

RULES — a fact breaking any of these is thrown away, so don't collect it:
- ATOMIC: one fact per entry. "Arsenal beat Chelsea 2-1 in the 2020 FA Cup final" is one fact. "Arsenal have won 14 FA Cups and were founded in 1886" is two.
- SELF-CONTAINED and SPECIFIC: always name the club, the competition and the season/year. "They won it in 2020" is useless. "Arsenal won the 2019/20 FA Cup" is a fact.
- FIXED FOR EVER: only facts that will read the same in ten years. NEVER anything phrased as current — no "currently", "this season", "recently", "still", "the reigning champions". A squad list or a league position "right now" is not a fact, it is a snapshot.
- The "season" field must be the season the fact belongs to, so a question built from it can be anchored.
- Prefer facts that are interesting to a fan: trophies, finals, records, famous matches, milestone signings, defining moments.

${TRUSTED_SOURCES_BRIEF}`;

/**
 * Research atomic facts for an entity + category from the web.
 * ONE call with web search, however many facts — that's the whole cost saving.
 * Returns { facts, dropped, usage }; `facts` are already source-tier filtered.
 */
export async function researchFacts({ entity, category, categoryBrief, count = 30, model = MODELS.author } = {}) {
  const resp = await callClaude({
    model,
    system: RESEARCH_SYSTEM,
    messages: [{
      role: "user",
      content: `Club: ${entity}
Topic: ${category} — ${categoryBrief}

Search for and report ${count} atomic facts about ${entity} on this topic.

SPREAD BY FAME — this is the most important instruction. Questions inherit their difficulty from the facts they're built on, so a sheet of obscure trivia can only produce a brutally hard quiz. Our bank is already 5% easy and new players bounce off it. Gather roughly:
- ${Math.round(count * 0.4)} facts that ANY ${entity} fan knows — the headline trophies, the famous finals, the iconic seasons, the legendary names. These feel obvious. Gather them anyway: they are the ones we are short of.
- ${Math.round(count * 0.4)} facts a fan who properly follows ${entity} would know.
- ${Math.round(count * 0.2)} deeper cuts for the specialists.
Do NOT fill the sheet with founding-era minutiae and record-book obscurities. A famous fact is more valuable to us than a rare one.

Also spread across eras and types — trophies, finals, record signings, milestone matches, club records, defining moments — so the questions don't all look the same.

PREFER PRIMARY SOURCES. Check the club's own official site and premierleague.com / uefa.com / thefa.com first. Only fall back to Wikipedia or the press when a primary source doesn't cover it.

Report ${count} facts. Each needs its own source URL and a quote proving it.`,
    }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 16000,
    stage: "research",
  });

  let raw;
  try {
    raw = parseJson(resp);
  } catch (e) {
    return { facts: [], dropped: [{ fact: "(model reply unparseable)", reason: e.message.slice(0, 80) }], usage: usageOf(resp) };
  }

  const facts = [];
  const dropped = [];
  const seen = new Set();

  for (const f of Array.isArray(raw) ? raw : []) {
    const text = String(f?.fact ?? "").trim();
    if (!text) continue;

    // Untrusted source ⇒ the fact does not exist. This is the tier-1/2 gate, and it is
    // deterministic and free — no model judgement involved.
    if (!isTrustedSource(f?.source_url)) {
      dropped.push({ fact: text.slice(0, 70), reason: `untrusted source: ${f?.source_url ?? "none"}` });
      continue;
    }
    // Cheap in-batch dedupe so the sheet doesn't carry the same fact three times.
    const key = text.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
    if (seen.has(key)) { dropped.push({ fact: text.slice(0, 70), reason: "duplicate fact" }); continue; }
    seen.add(key);

    facts.push({
      fact: text,
      key: factKey(text),
      competition: f?.competition ?? null,
      season: f?.season ?? null,
      source_url: f.source_url,
      source_quote: f?.source_quote ?? null,
      tier: sourceTier(f.source_url),
    });
  }

  return { facts, dropped, usage: usageOf(resp) };
}

/**
 * Render a researched fact sheet for an authoring prompt. Numbered, because the author cites
 * the NUMBER of the fact it used — we then map that back to the fact's stable key. We trust
 * our own numbering, never the model's paraphrase of the fact.
 */
export function factsText(facts) {
  return facts
    .map((f, i) => `${i + 1}. ${f.fact}${f.competition ? ` [${f.competition}` : " ["}${f.season ? `, ${f.season}` : ""}]`)
    .join("\n");
}

/** Human review rendering — what the founder samples. Facts, not questions. */
export function factsReviewText(facts) {
  return facts
    .map((f, i) => `${i + 1}. ${f.fact}\n   ${f.competition ?? "?"}${f.season ? ` · ${f.season}` : ""} · tier ${f.tier} · ${f.source_url}${f.source_quote ? `\n   "${String(f.source_quote).slice(0, 140)}"` : ""}`)
    .join("\n\n");
}
