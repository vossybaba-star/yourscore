/**
 * experience.mjs — Layer 7A: deterministic gamer-QA invariants.
 *
 * Not "is it up?" but "does it feel right to a player?": recycled daily packs,
 * answer-shuffle regressions (a real shipped bug: every answer sat in slot A),
 * malformed questions, repeat questions served to the same player, and a draft
 * slate that never changes. Pack checks are pure DB reads; the repetition and
 * slate checks consume artifacts left in ctx by the journeys layer (Phase 2).
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../lib/report.mjs";

const LETTERS = ["A", "B", "C", "D"];

/** Normalize question text for duplicate detection across shuffles/reprints. */
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

/** Extract {text, options[], answerText} from either published-pack shape
 *  ({q|question, options:{A..D}, answer:"A"}) or bank shape ({question, options:[...], answer:idx}). */
function parseQuestion(q) {
  const text = q.q ?? q.question ?? q.text ?? "";
  let options = [];
  let answerText = null;
  let answerKey = null;
  if (q.options && !Array.isArray(q.options)) {
    options = LETTERS.map((l) => q.options[l]).filter((v) => v !== undefined);
    if (LETTERS.includes(q.answer)) { answerKey = q.answer; answerText = q.options[q.answer]; }
  } else if (Array.isArray(q.options)) {
    options = q.options;
    if (Number.isInteger(q.answer)) { answerKey = LETTERS[q.answer]; answerText = q.options[q.answer]; }
  }
  return { text, options, answerText, answerKey };
}

export async function run(report, ctx) {
  const pack = ctx.todayPack;

  // ── Today's pack: integrity, shuffle spread, recycling ──────────────────────
  if (!pack) {
    report.add("gamer", "pack QA", true, { warn: true, detail: "no pack for today yet — pack checks skipped" });
  } else {
    const questions = Array.isArray(pack.questions) ? pack.questions : [];
    const parsed = questions.map(parseQuestion);

    // Integrity: 4 distinct non-empty options, one valid answer, sane text,
    // and no answer leaked verbatim inside the question text.
    const problems = [];
    parsed.forEach((p, i) => {
      const n = `Q${i + 1}`;
      if (norm(p.text).length < 10) problems.push(`${n}: question text too short/empty`);
      if (p.options.length !== 4 || p.options.some((o) => !norm(o))) problems.push(`${n}: needs 4 non-empty options`);
      if (new Set(p.options.map(norm)).size !== p.options.length) problems.push(`${n}: duplicate options`);
      if (!p.answerKey) problems.push(`${n}: no valid correct answer`);
      if (p.answerText && norm(p.answerText).length > 3 && norm(p.text).includes(norm(p.answerText)))
        problems.push(`${n}: correct answer appears in the question text`);
    });
    report.add("gamer", "question integrity", problems.length === 0, {
      detail: problems.slice(0, 3).join("; ") + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ""),
      hint: "fix today's pack JSON and republish via seed-daily-quiz.mjs",
    });

    // Duplicates INSIDE today's pack.
    const texts = parsed.map((p) => norm(p.text));
    const dupsInPack = texts.filter((t, i) => t && texts.indexOf(t) !== i);
    report.add("gamer", "no repeats in pack", dupsInPack.length === 0, {
      detail: dupsInPack.length ? `${dupsInPack.length} duplicated question(s) in today's pack` : "",
      hint: "today's players see the same question twice — republish",
    });

    // Answer-shuffle regression: >70% of answers on one letter (or all-A) means
    // the publish-time shuffle silently stopped working.
    const dist = {};
    parsed.forEach((p) => { if (p.answerKey) dist[p.answerKey] = (dist[p.answerKey] ?? 0) + 1; });
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    const maxShare = total ? Math.max(...Object.values(dist)) / total : 0;
    report.add("gamer", "answer shuffle", total > 0 && maxShare <= 0.7, {
      detail: total ? `spread ${JSON.stringify(dist)}` : "no parseable answers",
      warn: false,
      hint: "publish-time option shuffle regressed (seed-daily-quiz.mjs shuffleOptions)",
    });

    // Recycling vs the previous daily packs (fetched by the freshness layer).
    const prior = (ctx.recentDailyPacks ?? []).filter((p) => p.id !== pack.id);
    let worst = { share: 0, date: null, dups: 0 };
    for (const old of prior) {
      const oldTexts = new Set((old.questions ?? []).map((q) => norm(parseQuestion(q).text)).filter(Boolean));
      const overlap = texts.filter((t) => t && oldTexts.has(t)).length;
      const share = texts.length ? overlap / texts.length : 0;
      if (share > worst.share) worst = { share, date: old.metadata?.date ?? old.name, dups: overlap };
    }
    const recycled = worst.share > 0.2;
    report.add("gamer", "daily pack freshness", !recycled, {
      warn: !recycled && worst.dups > 0,
      detail: worst.dups ? `${worst.dups} question(s) repeat from ${worst.date} (${Math.round(worst.share * 100)}%)` : "",
      hint: "today's quiz is recycled — regenerate the pack",
    });
  }

  // ── Journey-served questions: repeats within + across sessions ─────────────
  // ctx.servedQuestions is set by the journeys layer (Phase 2): the questions
  // /api/quiz/start actually dealt to the bot this run.
  if (ctx.servedQuestions?.length) {
    const served = ctx.servedQuestions.map(parseQuestion);
    const sTexts = served.map((p) => norm(p.text));
    const dupNow = sTexts.filter((t, i) => t && sTexts.indexOf(t) !== i);
    report.add("gamer", "no repeats in session", dupNow.length === 0 && new Set(ctx.servedQuestions.map((q) => q.id)).size === ctx.servedQuestions.length, {
      detail: dupNow.length ? `duplicate question in one quiz: "${dupNow[0].slice(0, 60)}…"` : "",
      hint: "quiz/start dealt the same question twice in one game",
    });

    // Cross-session: the bot keeps its user_question_history, so any repeat of a
    // PREVIOUS run's question means dedup regressed for every long-term player.
    const seenFile = join(DATA_DIR, "bot-seen-questions.jsonl");
    let seenBefore = new Set();
    try {
      seenBefore = new Set(readFileSync(seenFile, "utf8").trim().split("\n").map((l) => JSON.parse(l).id));
    } catch { /* first run */ }
    const repeats = ctx.servedQuestions.filter((q) => q.id && seenBefore.has(q.id));
    // The server deliberately recycles the oldest 50% of history once a
    // difficulty tier runs dry for this player (quiz/start serves 15 and
    // resets when <8 remain). A short deal (<15 served) means the bot is in
    // exhaustion territory, so repeats there are the by-design recycle — a
    // CONTENT-DEPTH problem, not a dedup regression. Repeats on a full
    // 15-question deal with plenty of bank = dedup genuinely broken → red.
    const exhaustion = ctx.servedQuestions.length < 15 || (ctx.entitySupply > 0 && ctx.entityHistory + 15 >= ctx.entitySupply);
    report.add("gamer", "no repeats across sessions", repeats.length === 0 || exhaustion, {
      warn: repeats.length > 0 && exhaustion,
      detail: repeats.length
        ? `${repeats.length} repeat(s) for ${ctx.quizEntity}${exhaustion ? ` — bank recycling (by design): a regular ${ctx.quizEntity} player sees repeats. Bank needs more questions (${ctx.entityHistory}/${ctx.entitySupply} servable seen)` : " with a full deal and unseen bank left"}`
        : "",
      hint: "user_question_history dedup regressed — real users are seeing repeats",
    });

    // Content depth: thin banks make heavy players hit recycling fast.
    // quiz/start draws 6 easy per game, so easy < 18 = repeats within ~3 games.
    if (ctx.entitySupply > 0) {
      const thinEasy = (ctx.entityEasySupply ?? 99) < 18;
      const thinTotal = ctx.entitySupply < 45; // < 3 full games
      report.add("gamer", "question bank depth", true, {
        warn: thinEasy || thinTotal,
        detail: thinEasy || thinTotal
          ? `${ctx.quizEntity}: ${ctx.entitySupply} servable questions (easy: ${ctx.entityEasySupply}) — a fan playing daily hits repeats within days; generate more (esp. easy)`
          : "",
      });
    }
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const fresh = ctx.servedQuestions.filter((q) => q.id && !seenBefore.has(q.id));
      if (fresh.length) appendFileSync(seenFile, fresh.map((q) => JSON.stringify({ id: q.id, ts: Date.now() })).join("\n") + "\n");
    } catch { /* best-effort */ }
  }

  // ── Draft slate variety: same pick-0 slate two days running = stale content ─
  if (ctx.slatePlayerIds?.length) {
    const slateFile = join(DATA_DIR, "slate-history.jsonl");
    let prev = null;
    try {
      const lines = readFileSync(slateFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      prev = lines.filter((l) => l.edition !== ctx.edition).at(-1);
    } catch { /* first run */ }
    const same = prev && JSON.stringify([...prev.ids].sort()) === JSON.stringify([...ctx.slatePlayerIds].sort());
    report.add("gamer", "draft slate variety", true, {
      warn: !!same,
      detail: same ? `pick-0 slate identical to edition ${prev.edition} — content may not be rolling` : "",
    });
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      appendFileSync(slateFile, JSON.stringify({ edition: ctx.edition, ids: ctx.slatePlayerIds, ts: Date.now() }) + "\n");
    } catch { /* best-effort */ }
  }
}
