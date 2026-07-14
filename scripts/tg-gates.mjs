/**
 * tg-gates.mjs — the Telegram approval gates for the daily launch.
 *
 *   gate1  — APPROVE THE QUIZ: title, day, news hook, difficulty, all 15 Q&A, link.
 *   images — APPROVE THE CARDS: the two card images.            [Approve / Regenerate]
 *   tweet  — APPROVE THE TWEET: editable draft.                 [Post / Edit / Skip]
 *   email  — APPROVE THE EMAIL: Day/subject/recipients summary. [Send / Skip]
 * (Cards, tweet and email are each approved independently.)
 *
 * Exit codes (non-preview): 0 = approve/post/send, 1 = reject/skip, 3 = regenerate.
 * The tweet gate is editable — tap Edit or just reply with new text; the final
 * approved text is written to --out <path> for the orchestrator to post.
 * --preview just shows the message so you can eyeball the format.
 *
 * Usage:
 *   tg-gates.mjs gate1  --quiz <file> --day N [--preview]
 *   tg-gates.mjs images --share <png> --cover <png> [--preview]
 *   tg-gates.mjs tweet  --quiz <file> --out <path> [--preview]
 *   tg-gates.mjs email  --quiz <file> --day N [--preview]
 */

import { writeFileSync } from "node:fs";
import { loadQuiz, urls, composeTweet, shortDescription } from "./lib/quiz-launch.mjs";
import { sendMessage, sendPhotos, awaitApproval, awaitButtonsOrText, awaitText } from "./tg.mjs";

const args = process.argv.slice(2);
const mode = args[0];
const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const PREVIEW = args.includes("--preview");
const quizArg = flag("--quiz") || args.find((a) => a.endsWith(".json"));
const quiz = quizArg ? loadQuiz(quizArg) : null;
const DAY = flag("--day") || "?";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DIFF_ICON = { easy: "🟢", medium: "🟡", hard: "🟠", expert: "🔴", master: "🟣" };
const done = (ok) => process.exit(ok ? 0 : 1);

function gate1Text() {
  const { challenge } = urls(quiz);
  const spread = {};
  for (const q of quiz.questions) spread[q.difficulty] = (spread[q.difficulty] || 0) + 1;
  const spreadStr = Object.entries(spread).map(([k, v]) => `${v} ${k}`).join(" · ");
  const qLines = quiz.questions.map((q, i) => {
    const stem = q.question.length > 110 ? q.question.slice(0, 108) + "…" : q.question;
    return `${DIFF_ICON[q.difficulty] || "•"} <b>${i + 1}.</b> ${esc(stem)}\n   ✅ ${esc(q.options[q.answer])}`;
  }).join("\n");
  return [
    `${PREVIEW ? "🧪 <b>PREVIEW</b> · " : ""}📋 <b>GATE 1 — Approve today's quiz</b>`, ``,
    `🏆 WC Quiz Series · <b>Day ${DAY}</b>`, `<b>${esc(quiz.name)}</b>`,
    `🗓 ${quiz.date} · 🎯 ${spreadStr}`, ``,
    `📰 ${esc(quiz.angle || "")}`, ``,
    `<b>Questions</b> (✅ = correct answer):`, qLines, ``,
    `▶️ Preview: ${challenge}`,
  ].join("\n");
}

if (mode === "gate1") {
  if (PREVIEW) { await sendMessage(gate1Text(), { buttons: ["Approve", "Reject"] }); console.log("preview sent"); }
  else done((await awaitApproval(gate1Text(), { buttons: ["Approve", "Reject"] })) === "APPROVE");

} else if (mode === "images") {
  const share = flag("--share"), cover = flag("--cover");
  const cap = `${PREVIEW ? "🧪 PREVIEW · " : ""}🖼 GATE 2a — Approve the cards\nShare card (16:9) + in-app cover (1:1). The share card is what the tweet link unfurls to.`;
  await sendPhotos([share, cover].filter(Boolean), cap);
  if (PREVIEW) { await sendMessage("Use these cards?", { buttons: ["Approve", "Regenerate"] }); console.log("preview sent"); }
  else {
    const d = await awaitApproval("Use these cards?", { buttons: ["Approve", "Regenerate"] });
    process.exit(d === "APPROVE" ? 0 : 3); // 3 = regenerate
  }

} else if (mode === "tweet") {
  const out = flag("--out");
  let text = composeTweet(quiz).text;
  if (PREVIEW) {
    await sendMessage(`🧪 PREVIEW · 🐦 GATE 2b — Approve the tweet (tap Edit or reply with new text):`);
    await sendMessage(text, { buttons: ["Post", "Edit", "Skip"] });
    console.log("preview sent"); process.exit(0);
  }
  await sendMessage(`🐦 <b>GATE 2b — Approve the tweet</b>\nTap <b>Post</b>, tap <b>Edit</b>, or just reply with your edited tweet.`);
  while (true) {
    const r = await awaitButtonsOrText(text, { buttons: ["Post", "Edit", "Skip"] });
    if (r.kind === "text") { text = r.value; await sendMessage("✏️ Updated, review again:"); continue; }
    if (r.value === "Post") { if (out) writeFileSync(out, text); done(true); }
    if (r.value === "Skip") done(false);
    if (r.value === "Edit") { await sendMessage("Reply with your edited tweet text:"); text = await awaitText(); await sendMessage("✏️ Updated, review again:"); continue; }
  }

} else if (mode === "email") {
  const { challenge } = urls(quiz);

  // Compute the EXACT recipient counts so the card matches what actually sends
  // (mirrors send-wc-quiz-daily.mjs: engaged = active+cooling, split by primary_game,
  // minus suppressions/unsendable). Wrapped so a query hiccup degrades to a plain
  // description instead of blocking the gate.
  let counts = null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const { loadSuppressions } = await import("./load-suppressions.mjs");
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const suppressed = await loadSuppressions();
    const emailById = new Map();
    for (let page = 1; ; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
      if (error) throw error;
      for (const u of data?.users ?? []) if (u.email) emailById.set(u.id, u.email.trim().toLowerCase());
      if ((data?.users ?? []).length < 1000) break;
    }
    const sendable = (e) => e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !suppressed.has(e);
    const { data: segRows, error: segErr } = await supabase.rpc("get_email_segments");
    if (segErr) throw segErr;
    let quiz = 0, mm = 0;
    for (const r of segRows ?? []) {
      if (r.engagement_tier !== "active" && r.engagement_tier !== "cooling") continue;
      if (!sendable(emailById.get(r.user_id))) continue;
      if (r.primary_game === "quiz") quiz++; else mm++;
    }
    counts = { quiz, mm, total: quiz + mm };
  } catch { counts = null; }

  const rows = counts
    ? [`🧠 Quiz daily → <b>${counts.quiz}</b> engaged quiz players`, `⚽ Mastermind daily → <b>${counts.mm}</b> engaged WC/38 players`]
    : [`🧠 Quiz daily → engaged <b>quiz</b> players`, `⚽ Mastermind daily → engaged <b>WC/38</b> players`];

  const summary = [
    `${PREVIEW ? "🧪 <b>PREVIEW</b> · " : ""}📧 <b>GATE 2c — Approve the emails</b>`, ``,
    `Day ${DAY} · <b>TWO segmented broadcasts</b>${counts ? ` · <b>${counts.total}</b> recipients` : ""} (engaged = active + cooling):`,
    ...rows, ``,
    `Marketing broadcasts (no transactional burn) · relay + suppressed excluded. NOT an all-users blast.`,
    `Blurb: ${esc(shortDescription(quiz))}`, `▶️ ${challenge}`,
  ].join("\n");
  if (PREVIEW) { await sendMessage(summary, { buttons: ["Send", "Skip"] }); console.log("preview sent"); }
  else {
    // VETO, not approval (founder, Jul 10: "the email for the quizzes is one of the most
    // important parts of the day that needs to go out"). The quiz content was already
    // approved at Gate 1, so silence here means SEND. Only an explicit Skip stops it —
    // an unanswered gate used to kill the day's most important send outright.
    const veto = `${summary}\n\n⏳ <b>Sends automatically in 45 minutes.</b> Tap <b>Skip</b> to stop it.`;
    try {
      done((await awaitApproval(veto, { buttons: ["Send", "Skip"], timeoutSec: 2700 })).startsWith("SEND"));
    } catch {
      await sendMessage("📧 No reply within the veto window — <b>sending the daily quiz emails now</b> as planned.");
      done(true);
    }
  }

} else {
  console.error("usage: tg-gates.mjs gate1|images|tweet|email ...");
  process.exit(1);
}
