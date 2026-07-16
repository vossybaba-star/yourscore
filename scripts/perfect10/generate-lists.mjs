/**
 * generate-lists.mjs — author + verify "Perfect 10" ranked top-10 lists.
 *
 * Mirrors the quiz factory's philosophy (scripts/quiz-factory/verify.mjs):
 * a dropped list is a SUCCESS, not a failure. Three stages:
 *
 *   Stage A (author)  one model call proposes a title + 10 ranked entries.
 *   Stage B (verify)  EACH of the 10 entries gets its OWN fresh model call
 *                      (no memory of the authoring prompt) with web search,
 *                      asked to independently confirm the rank and cite a
 *                      source. ANY entry unconfirmed ⇒ the WHOLE list is
 *                      dropped — a ranked list is only as good as its
 *                      weakest rung.
 *   Stage C (commit)   surviving list → p10_lists (status='draft'), or
 *                      --json-out to write it to a file for review instead
 *                      (nothing touches the DB in that mode).
 *
 * --fixture loads scripts/perfect10/fixtures/test-list.json instead of
 * running Stage A/B — it is hand-written TEST DATA, not gate-verified, and
 * exists so this script (and the whole pipeline) is exercisable even when
 * the Anthropic key is drained (a real risk right now — see CreditExhausted
 * handling below).
 *
 * Usage:
 *   node --env-file=.env.local scripts/perfect10/generate-lists.mjs --topic "Premier League's all-time top 10 assist providers" [--day 2026-07-20] [--json-out out.json]
 *   node --env-file=.env.local scripts/perfect10/generate-lists.mjs --fixture --json-out /tmp/fixture-list.json
 *   node --env-file=.env.local scripts/perfect10/generate-lists.mjs --fixture --day 2026-07-20   (writes straight to the DB, status='draft')
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callClaude, parseJson, MODELS, WEB_SEARCH_TOOL, usageOf, CreditExhausted, costReport } from "../lib/anthropic.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  return i !== -1 ? args[i + 1] : undefined;
};
const has = (n) => args.includes(n);

const TOPIC = flag("--topic");
const DAY = flag("--day") || null;
const JSON_OUT = flag("--json-out") || null;
const FIXTURE = has("--fixture");

if (!FIXTURE && !TOPIC) {
  console.error("Usage: generate-lists.mjs --topic \"<list topic>\" [--day YYYY-MM-DD] [--json-out path.json]");
  console.error("   or: generate-lists.mjs --fixture [--day YYYY-MM-DD] [--json-out path.json]");
  process.exit(1);
}

// ── Name normalization (KEEP IN SYNC with src/lib/games/perfect10.ts and
// scripts/perfect10/build-player-index.mjs) ────────────────────────────────
function normalizeName(raw) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** clue2 ("Starts with X") is ALWAYS derived from entry.surname programmatically —
 * the model's own clue2 guess (if any) is discarded, never trusted. */
function deriveClue2(surname) {
  const letter = String(surname ?? "").trim().charAt(0).toUpperCase() || "?";
  return `Starts with ${letter}`;
}

// ── Stage A — author ─────────────────────────────────────────────────────

const AUTHOR_SYSTEM = `You author ranked top-10 football lists for a "name the whole top ten" trivia game.

Reply with ONLY a JSON object:
{
  "title": "the exact name of the ranked list, e.g. \\"Premier League's All-Time Top 10 Goalscorers\\"",
  "entries": [
    { "rank": 1, "display": "Full Player Name", "surname": "Surname", "aliases": ["lowercase nickname or short forms a fan might type"], "clue1": "the clubs they're best known for, in order, e.g. \\"Newcastle then Man Utd\\"", "clue2": "Starts with <first letter of surname>" }
  ]
}

Rules:
- Exactly 10 entries, ranks 1-10, no ties, no gaps.
- "display" is the player's commonly-used full name.
- "aliases" should include lowercase common nicknames/short forms (e.g. "mo salah" for Mohamed Salah) — this is what makes the guess typeahead forgiving. Always include the surname alone, lowercased.
- "clue1" names clubs only — never the answer, never the rank.
- Pick a topic that has a genuinely well-documented, sourceable ranking (an official/statistical all-time list) — not something contested or vague.
- Do not invent or guess at a ranking. If you are not confident of the order, say so is not an option — pick a topic where the order is well established instead.`;

async function authorList(topic) {
  const resp = await callClaude({
    model: MODELS.author,
    system: AUTHOR_SYSTEM,
    messages: [{ role: "user", content: `Topic: ${topic}\n\nAuthor the ranked top-10 list.` }],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 4096,
    stage: "p10-author",
  });
  const parsed = parseJson(resp);
  return { parsed, usage: usageOf(resp) };
}

// ── Stage B — independent per-entry verification ─────────────────────────

const VERIFY_SYSTEM = `You are a fact-checker for a football trivia list. You will be told a claimed ranked-list position (a title and one rank + player). You are NOT told anything else about how it was produced.

Use web search. Reply with ONLY a JSON object:
{
  "confirmed": true | false,
  "source_url": "the single best URL supporting your verdict, or null",
  "note": "a short line explaining your verdict, citing what the source says"
}

Rules:
- Confirm ONLY if you find a source that genuinely supports this player being at (or very close to, within any reasonable version of) this exact rank in this list.
- If you cannot find a source that settles it, or the source disagrees, "confirmed" must be false.
- Be strict. A ranked list is only as good as its weakest rung.`;

async function verifyEntry(title, entry) {
  const resp = await callClaude({
    model: MODELS.verify,
    system: VERIFY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `List: "${title}"\n\nClaim: #${entry.rank} is ${entry.display}.\n\nIs this genuinely ranked #${entry.rank} in "${title}"? Search and cite a source.`,
      },
    ],
    tools: [WEB_SEARCH_TOOL],
    maxTokens: 1024,
    stage: "p10-verify",
  });
  let v;
  try {
    v = parseJson(resp);
  } catch {
    return { confirmed: false, note: "verifier reply was not JSON", usage: usageOf(resp) };
  }
  return { confirmed: Boolean(v.confirmed), sourceUrl: v.source_url ?? null, note: v.note ?? null, usage: usageOf(resp) };
}

// ── Player index force-upsert (so the 10 answers are always guessable) ────

function syntheticId(normalized) {
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;
  return -(1_000_000_000 + (h % 1_000_000_000));
}

async function forceUpsertAnswers(entries) {
  const playersJsonPath = join(ROOT, "public", "perfect10", "players.json");
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(playersJsonPath, "utf8"));
  } catch {
    /* no players.json yet — fine, start empty */
  }
  // Only used to check "is this name already indexed" — NEVER rebuilt back into
  // the output array. Two distinct real players can share a normalized name
  // (different SportMonks ids), and collapsing `existing` through a
  // normalized-keyed Map would silently drop one of them. Only append.
  const existingNormalized = new Set(existing.map((row) => row[2]));

  const newRows = [];
  for (const e of entries) {
    const normalized = normalizeName(e.display);
    if (existingNormalized.has(normalized)) continue; // already indexed (real or synthetic)
    const id = syntheticId(normalized);
    newRows.push([id, e.display, normalized]);
    existingNormalized.add(normalized);
  }
  const toUpsert = newRows.map(([id, name, normalized]) => ({ id, name, normalized, source: "p10-legend" }));

  if (newRows.length) {
    const merged = [...existing, ...newRows].sort((a, b) => a[1].localeCompare(b[1]));
    writeFileSync(playersJsonPath, JSON.stringify(merged));
    console.log(`  players.json: appended ${newRows.length} legend(s), now ${merged.length} total.`);
  }

  if (toUpsert.length) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Missing Supabase service env vars");
      const db = createClient(url, key, { auth: { persistSession: false } });
      const { error } = await db.from("p10_players").upsert(toUpsert, { onConflict: "id" });
      if (error) throw error;
      console.log(`  p10_players: force-upserted ${toUpsert.length} legend(s).`);
    } catch (e) {
      console.warn(`  p10_players upsert PENDING (players.json was still updated): ${e.message}`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  let title, entries, isFixture = FIXTURE;

  if (FIXTURE) {
    const fixturePath = join(__dirname, "fixtures", "test-list.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    title = fixture.title;
    entries = fixture.entries;
    console.log(`Loaded fixture: "${title}" (${entries.length} entries) — TEST DATA, not gate-verified.`);
  } else {
    console.log(`Stage A — authoring "${TOPIC}"...`);
    let authored;
    try {
      authored = await authorList(TOPIC);
    } catch (e) {
      if (e instanceof CreditExhausted) {
        console.error(e.message);
        process.exit(1);
      }
      throw e;
    }
    const parsed = authored.parsed;
    if (!parsed?.title || !Array.isArray(parsed.entries) || parsed.entries.length !== 10) {
      console.error("Stage A produced a malformed list (need exactly 10 entries) — dropping.");
      process.exit(1);
    }
    title = parsed.title;
    entries = parsed.entries.map((e) => ({ ...e, clue2: deriveClue2(e.surname) }));

    console.log(`Stage B — verifying ${entries.length} entries independently (fresh calls, web search)...`);
    const verdicts = [];
    let allConfirmed = true;
    for (const e of entries) {
      let v;
      try {
        v = await verifyEntry(title, e);
      } catch (err) {
        if (err instanceof CreditExhausted) {
          console.error(err.message);
          process.exit(1);
        }
        v = { confirmed: false, note: `verify call failed: ${err.message}` };
      }
      verdicts.push({ rank: e.rank, display: e.display, ...v });
      console.log(`  #${e.rank} ${e.display}: ${v.confirmed ? "CONFIRMED" : "UNCONFIRMED"} — ${v.note ?? ""}`);
      if (!v.confirmed) allConfirmed = false;
    }

    if (!allConfirmed) {
      console.error("\nDROPPED — at least one entry could not be independently confirmed:");
      for (const v of verdicts.filter((x) => !x.confirmed)) console.error(`  #${v.rank} ${v.display}: ${v.note}`);
      console.log("\n" + costReport());
      process.exit(1);
    }
    console.log("All 10 entries confirmed.");
    console.log("\n" + costReport());
  }

  const list = { title, entries, day: DAY, status: "draft", fixture: isFixture || undefined };

  // ── Stage C — commit ───────────────────────────────────────────────────
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(list, null, 2));
    console.log(`\nWrote list to ${JSON_OUT} for review (DB untouched).`);
    return;
  }

  console.log(`\nForce-upserting the 10 answers into the player index...`);
  await forceUpsertAnswers(entries);

  console.log(`Inserting list into p10_lists (status='draft'${DAY ? `, day=${DAY}` : ""})...`);
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service env vars — cannot insert. Use --json-out to review instead.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("p10_lists")
    .insert({ title, day: DAY, status: "draft", entries })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`Inserted p10_lists row ${data.id}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
