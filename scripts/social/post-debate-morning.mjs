/**
 * post-debate-morning.mjs — morning "today's debate" post on X.
 *
 * Fetches today's active debate, drafts a tweet with the debate question and
 * a link to yourscore.app/versus, posts it automatically (Telegram gets an FYI).
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/post-debate-morning.mjs
 *   node --env-file=.env.local scripts/social/post-debate-morning.mjs --dry
 *
 * Scheduled: 08:00 UK daily via launchd.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { sendMessage } from "../tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── 1. Get today's debate ────────────────────────────────────────────────────
const ukToday = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const { data: debate, error } = await db
  .from("debates")
  .select("id, question, options")
  .eq("day", ukToday)
  .single();

if (error || !debate) {
  await sendMessage(`⚠️ <b>Debate morning post</b> — no debate found for ${ukToday}`);
  process.exit(1);
}

// ── 2. Draft tweet ───────────────────────────────────────────────────────────
let tweetText = `Today's debate 🔥

${debate.question}

${debate.options[0]} or ${debate.options[1]}?

Vote now 👉 https://yourscore.app/debate?d=${ukToday}`;

// ── 3. No gate — debate posts are simple cards straight from the app, so they
//      auto-post (founder decision, Jul 8). Telegram gets an FYI, not a question.
//      (The old awaitButtonsOrText gate also 409'd on the VPS: x-telegram-poll
//      owns this bot's getUpdates, so a second consumer always conflicts.)
await sendMessage(`\u{1F5F3}\uFE0F <b>Debate morning post \u2014 ${ukToday}</b> (auto-posting)\n\n<i>${tweetText}</i>\n\nEdit future debates in Studio \u2192 Planner.`);
if (DRY) { console.log("--dry: would post"); process.exit(0); }

// ── 4. Post to X ─────────────────────────────────────────────────────────────
console.log("Posting to X…");
try {
  execFileSync("node", [
    "--env-file=.env.local",
    "scripts/post-tweet.mjs",
    "--text", tweetText,
  ], { cwd: ROOT, stdio: "inherit" });
  await sendMessage(`✅ Debate morning post live on X — ${ukToday}`);
  console.log("Done.");
} catch (e) {
  await sendMessage(`⚠️ Tweet failed:\n<code>${e.message.slice(0, 400)}</code>`);
  process.exit(1);
}
