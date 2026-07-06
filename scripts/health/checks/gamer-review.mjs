/**
 * gamer-review.mjs — Layer 7B: the LLM plays QA employee once a day.
 *
 * Feeds Claude today's daily pack, the questions the bot was actually served,
 * and the browser-layer screenshots, framed as a football-mad player + harsh
 * QA reviewer. Deterministic checks (7A) catch structural problems; this
 * catches the judgment calls — wrong/debatable answers, awkward phrasing,
 * options that give the answer away, stale-feeling content, embarrassing UI.
 *
 * Runs on the morning slot (08:xx) or when forced with --with-llm. Findings
 * are fingerprinted into gamer-findings.jsonl so a known issue is reported to
 * Telegram once, not every day.
 */

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../lib/report.mjs";
import { hourUK } from "../lib/db.mjs";

const MODEL = "claude-sonnet-5";
const FINDINGS_FILE = join(DATA_DIR, "gamer-findings.jsonl");
const SUPPRESS_DAYS = 7;

const fingerprint = (f) => `${f.area}:${String(f.item).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60)}`;

export async function run(report, ctx) {
  const morning = hourUK() < 11;
  if (!ctx.withLLM && !morning) return; // one LLM pass per day is plenty
  if (!process.env.ANTHROPIC_API_KEY) {
    report.add("gamer", "LLM review", true, { warn: true, detail: "ANTHROPIC_API_KEY not set — skipped" });
    return;
  }

  // ── Assemble the day's evidence ─────────────────────────────────────────────
  const content = [];
  const pack = ctx.todayPack;
  if (pack) {
    const packQA = (pack.questions ?? []).map((q, i) => {
      const opts = q.options && !Array.isArray(q.options) ? q.options : {};
      return `${i + 1}. ${q.q ?? q.question} | A:${opts.A} B:${opts.B} C:${opts.C} D:${opts.D} | correct:${q.answer}`;
    }).join("\n");
    content.push({ type: "text", text: `TODAY'S DAILY QUIZ PACK "${pack.name}":\n${packQA}` });
  }
  if (ctx.servedQuestions?.length) {
    const served = ctx.servedQuestions.map((q, i) => {
      const o = q.options ?? {};
      return `${i + 1}. [${q.difficulty}] ${q.question} | A:${o.A} B:${o.B} C:${o.C} D:${o.D} | correct:${q.answer}`;
    }).join("\n");
    content.push({ type: "text", text: `QUESTIONS SERVED IN A "${ctx.quizEntity}" QUIZ TODAY:\n${served}` });
  }
  for (const shot of (ctx.screenshots ?? []).slice(0, 4)) {
    try {
      content.push({ type: "text", text: `SCREENSHOT: ${shot.page}` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(shot.path).toString("base64") } });
    } catch { /* skip unreadable shots */ }
  }
  if (!content.length) {
    report.add("gamer", "LLM review", true, { warn: true, detail: "nothing to review (no pack, no journeys, no screenshots)" });
    return;
  }

  content.push({
    type: "text",
    text: `You are a football-mad player opening YourScore today, and also its harshest QA employee. Flag anything that would annoy, confuse, or bore a real player: repeated or near-identical questions, factually wrong or genuinely debatable answers, awkward/unnatural phrasing, options that give the answer away, stale or samey content, and anything in the screenshots that looks broken, misaligned, or embarrassing.

Judge quality, not taste. Do NOT flag stylistic preferences or nitpick difficulty. Only include findings a founder should act on.

Respond with ONLY a JSON array (possibly empty): [{"severity":"high|medium|low","area":"quiz-content|draft|ui|other","item":"<short name>","evidence":"<one concrete sentence>"}]. "high" is reserved for factually wrong answers or visibly broken UI.`,
  });

  // ── Ask Claude ──────────────────────────────────────────────────────────────
  let findings;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`anthropic API ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const j = await res.json();
    const text = j.content?.map((c) => c.text ?? "").join("") ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    findings = match ? JSON.parse(match[0]) : [];
  } catch (e) {
    report.add("gamer", "LLM review", true, { warn: true, detail: `review failed: ${e.message}` });
    return;
  }

  // ── De-dup vs the last 7 days of findings, then report ─────────────────────
  let known = new Map();
  try {
    for (const line of readFileSync(FINDINGS_FILE, "utf8").trim().split("\n")) {
      const f = JSON.parse(line);
      known.set(f.fp, f.ts);
    }
  } catch { /* first run */ }
  const cutoff = Date.now() - SUPPRESS_DAYS * 86_400_000;

  const fresh = [];
  for (const f of findings) {
    const fp = fingerprint(f);
    if ((known.get(fp) ?? 0) > cutoff) continue; // already reported this week
    fresh.push(f);
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      appendFileSync(FINDINGS_FILE, JSON.stringify({ fp, ts: Date.now(), ...f }) + "\n");
    } catch { /* best-effort */ }
  }

  const high = fresh.filter((f) => f.severity === "high");
  const rest = fresh.filter((f) => f.severity !== "high");

  for (const f of high) {
    report.add("gamer", `LLM: ${f.item}`, false, { detail: f.evidence, hint: "flagged high-severity by the daily gamer review" });
  }
  for (const f of rest.slice(0, 4)) {
    report.add("gamer", `LLM: ${f.item}`, true, { warn: true, detail: f.evidence });
  }
  if (!fresh.length) {
    report.add("gamer", "LLM review", true, {
      detail: findings.length ? `${findings.length} known finding(s), nothing new` : "nothing to flag today",
    });
  }
}
