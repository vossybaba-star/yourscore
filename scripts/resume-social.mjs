/**
 * resume-social.mjs — one-time resume of the daily-quiz launch's social steps only.
 *
 * The quiz pack + ranked WC edition for today are already published/rolled (and are
 * idempotent), so this skips gate1/cards and runs ONLY:
 *   - GATE 2b — tweet (editable) → post-tweet.mjs
 *   - GATE 2c — email → detached send-wc-quiz-daily.mjs blast
 *
 * Wiring copied verbatim from launch-daily.mjs steps 5–6 so behaviour is identical.
 *   node --env-file=.env.local scripts/resume-social.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadQuiz, urls, deriveDay } from "./lib/quiz-launch.mjs";
import { sendMessage } from "./tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const node = process.execPath;
const run = (script, args, opts = {}) =>
  execFileSync(node, [join(__dirname, script), ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
function gate(args) {
  try { run("tg-gates.mjs", args, { stdio: ["ignore", "inherit", "inherit"] }); return true; }
  catch { return false; }
}

const quizPath = join(ROOT, "content", "daily-quizzes", "2026-06-23-messi-makes-history.json");

async function main() {
  const quiz = loadQuiz(quizPath);
  const { slug, challenge } = urls(quiz);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const DAY = String((await deriveDay(supabase, quiz)) ?? "?");

  await sendMessage(`🔁 <b>Resuming social push</b> — ${quiz.name} (Day ${DAY}). Quiz + edition already live; tweet + email only.`);

  // 5. GATE 2b — tweet (editable). Final text written to a file, then posted.
  const tweetFile = `/tmp/launch-tweet-${slug}.txt`;
  if (gate(["tweet", "--quiz", quizPath, "--day", DAY, "--out", tweetFile])) {
    try { run("post-tweet.mjs", ["--text-file", tweetFile, "--quiz", quizPath]); await sendMessage("✅ Tweet posted."); }
    catch { await sendMessage("⚠️ Tweet failed to post (check X API credits at console.x.com). Email step continues."); }
  } else { await sendMessage("⏭ Tweet skipped."); }

  // 6. GATE 2c — email
  if (gate(["email", "--quiz", quizPath, "--day", DAY])) {
    const log = openSync(`/tmp/launch-email-day${DAY}.log`, "a");
    const child = spawn(node, [join(__dirname, "send-wc-quiz-daily.mjs"), "--quiz", quizPath, "--day", DAY, "--send"],
      { cwd: ROOT, detached: true, stdio: ["ignore", log, log] });
    child.unref();
    await sendMessage(`📤 Email Day ${DAY} send started → all users (~34 min). Log: /tmp/launch-email-day${DAY}.log`);
  } else { await sendMessage("⏭ Email skipped."); }

  await sendMessage(`🏁 <b>Done</b> — ${quiz.name} (Day ${DAY}) is live: ${challenge}`);
}

main().catch(async (e) => { try { await sendMessage(`❌ Resume error: ${e.message}`); } catch {} console.error(e); process.exit(1); });
