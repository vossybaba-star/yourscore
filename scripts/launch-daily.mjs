/**
 * launch-daily.mjs — the full daily quiz launch, gated by Telegram.
 *
 * Pure node (no browser, no Claude) so it can run unattended on a schedule.
 * Flow:
 *   1. pick this morning's draft (newest file) and force its date to TODAY (UK)
 *   2. publish it
 *   3. 📲 GATE 1 — approve the quiz (Telegram). Reject → stop.
 *   4. generate the two cards (gpt-image-1 hybrid) + attach them
 *   5. 📲 GATE 2a — approve the tweet → post it (skips gracefully if X needs credits)
 *   6. 📲 GATE 2b — approve the email → send to all users
 *   7. final Telegram summary
 *
 * Env (.env.local): SUPABASE_*, OPENAI_API_KEY, X_*, RESEND_API_KEY, TELEGRAM_*.
 * Children inherit this process's env, so run the whole thing with --env-file:
 *   node --env-file=.env.local scripts/launch-daily.mjs            # live (real gates + sends)
 *   node --env-file=.env.local scripts/launch-daily.mjs --dry      # build + gates, but never post/send
 */

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadQuiz, urls, deriveDay, slugify } from "./lib/quiz-launch.mjs";
import { sendMessage } from "./tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const QUIZ_DIR = join(ROOT, "content", "daily-quizzes");
const DRY = process.argv.includes("--dry");

const node = process.execPath;
const run = (script, args, opts = {}) =>
  execFileSync(node, [join(__dirname, script), ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
// A gate returns true on approve (exit 0), false on reject/skip (exit 1).
function gate(args) {
  try { run("tg-gates.mjs", args, { stdio: ["ignore", "inherit", "inherit"] }); return true; }
  catch (e) { if (e.status === 1 || e.status === 3) return false; throw e; } // 1=reject/skip, 3=regenerate
}

const todayUK = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD

async function main() {
  // 1. newest draft = this morning's generation
  const files = readdirSync(QUIZ_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, m: statSync(join(QUIZ_DIR, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  if (!files.length) throw new Error("no draft quizzes found");
  const quizPath = join(QUIZ_DIR, files[0].f);
  const quiz = loadQuiz(quizPath);

  // Safety: the newest draft must be from TODAY. If the 6:57am draft routine didn't
  // run (Mac asleep, error), refuse to publish a stale quiz as today's.
  const fileDateUK = new Date(files[0].m).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (fileDateUK !== todayUK) {
    await sendMessage(`⚠️ <b>Launch halted</b> — no fresh quiz for ${todayUK} (newest draft is from ${fileDateUK}). The morning draft routine may not have run. No quiz was published.`);
    return;
  }

  // force date to today (we send same-day; streak deadline = tonight)
  if (quiz.date !== todayUK) {
    quiz.date = todayUK; quiz.series = quiz.series || "wc2026";
    writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
  }
  const { slug, challenge } = urls(quiz);
  await sendMessage(`☀️ <b>Daily quiz launch</b> — ${quiz.date}\nDraft: <b>${quiz.name}</b>\nStarting the approval flow…`);

  // 2. publish
  if (!DRY) run("seed-daily-quiz.mjs", [quizPath, "--order", "0", "--commit"]);

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const DAY = String((await deriveDay(supabase, quiz)) ?? "?");

  // 3. GATE 1 — quiz
  if (!gate(["gate1", "--quiz", quizPath, "--day", DAY])) {
    await sendMessage("🛑 Quiz rejected — nothing published further. Launch stopped.");
    return;
  }

  // 3b. Roll the ranked WC Mastermind edition to the quiz's date. THIS is the step that
  //     makes the daily go live for everyone and resets the one-go — without it the ranked
  //     daily freezes on the last edition (exactly what happened 18–21 Jun). Idempotent:
  //     re-rolling the same date is a no-op, and the 08:00 launchd backstop re-rolls if this
  //     run is skipped. Keyed to quiz.date (not UTC-now) so a pre-midnight-UTC launch still rolls.
  if (!DRY) {
    try {
      run("draft/roll-wc-edition.mjs", [quiz.date]);
      await sendMessage(`🟢 Ranked WC Mastermind rolled to <b>${quiz.date}</b> — today's daily is live for everyone (one-go reset).`);
    } catch (e) {
      await sendMessage(`⚠️ Edition roll failed: ${e.message}. The 08:00 backstop will retry — daily may lag until then.`);
    }
  } else {
    await sendMessage(`🧪 (dry) would roll the ranked edition to ${quiz.date}.`);
  }

  // 4. GATE 2a — cards (regenerate loop). gate() returns true on Approve, false on
  //    exit 3 (Regenerate); first gen is real art, reuse cache only in --dry.
  let share, cover, first = true;
  while (true) {
    await sendMessage(first ? "🎨 Generating the two cards…" : "🔄 Regenerating the cards…");
    const reuse = DRY && first ? ["--reuse-bg"] : []; // dry: free first pass; regen always fresh
    const out = run("gen-quiz-images.mjs", ["--quiz", quizPath, "--out", "/tmp", ...reuse]);
    share = out.match(/SHARE=(.+)/)?.[1]?.trim();
    cover = out.match(/COVER=(.+)/)?.[1]?.trim();
    if (!share || !cover) throw new Error("image generation did not return paths");
    first = false;
    if (gate(["images", "--share", share, "--cover", cover])) break; // Approve
    // else exit 3 → loop and regenerate
  }
  if (!DRY) {
    run("set-quiz-share-image.mjs", ["--slug", slug, "--image", share, "--commit"]);
    run("set-quiz-share-image.mjs", ["--slug", slug, "--image", cover, "--type", "cover", "--commit"]);
  }

  // 5. GATE 2b — tweet (editable). Final text written to a file, then posted.
  const tweetFile = `/tmp/launch-tweet-${slug}.txt`;
  if (gate(["tweet", "--quiz", quizPath, "--day", DAY, "--out", tweetFile])) {
    if (DRY) { await sendMessage("🧪 (dry) would post the approved tweet."); }
    else {
      try { run("post-tweet.mjs", ["--text-file", tweetFile, "--quiz", quizPath]); await sendMessage("✅ Tweet posted."); }
      catch { await sendMessage("⚠️ Tweet failed to post (check X API credits at console.x.com). Email step continues."); }
    }
  } else { await sendMessage("⏭ Tweet skipped."); }

  // 6. GATE 2c — email
  if (gate(["email", "--quiz", quizPath, "--day", DAY])) {
    if (DRY) { await sendMessage("🧪 (dry) would send the email to all users."); }
    else {
      // Detached so the ~34-min staggered blast outlives this orchestrator run.
      const log = openSync(`/tmp/launch-email-day${DAY}.log`, "a");
      const child = spawn(node, [join(__dirname, "send-wc-quiz-daily.mjs"), "--quiz", quizPath, "--day", DAY, "--send"],
        { cwd: ROOT, detached: true, stdio: ["ignore", log, log] });
      child.unref();
      await sendMessage(`📤 Email Day ${DAY} send started → all users (~34 min). Log: /tmp/launch-email-day${DAY}.log`);
    }
  } else { await sendMessage("⏭ Email skipped."); }

  await sendMessage(`🏁 <b>Done</b> — ${quiz.name} (Day ${DAY}) is live: ${challenge}`);
}

main().catch(async (e) => { try { await sendMessage(`❌ Launch error: ${e.message}`); } catch {} console.error(e); process.exit(1); });
