/**
 * post-debate-evening.mjs — nightly debate results post.
 *
 * Generates yesterday's debate card PNG, sends it to Telegram for approval,
 * then posts to X (@Yourscore_App_) with the results image.
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/post-debate-evening.mjs
 *   node --env-file=.env.local scripts/social/post-debate-evening.mjs --date 2026-07-05
 *   node --env-file=.env.local scripts/social/post-debate-evening.mjs --dry
 *
 * Scheduled: 19:00 UK daily via launchd.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendMessage, sendPhoto } from "../tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const dateArg = args[args.indexOf("--date") + 1] ?? undefined;

// ── 1. Generate card ─────────────────────────────────────────────────────────
console.log("Generating debate card…");
const genArgs = ["--env-file=.env.local", "scripts/social/debate-card-gen.mjs"];
if (dateArg) genArgs.push("--date", dateArg);

let pngPath;
try {
  pngPath = execFileSync("node", genArgs, { cwd: ROOT, encoding: "utf8" }).trim();
} catch (e) {
  await sendMessage(`⚠️ <b>Debate evening post failed</b> — card generation error:\n<code>${e.message.slice(0, 400)}</code>`);
  process.exit(1);
}
console.log("Card:", pngPath);

// ── 2. Derive metadata from filename (date is in path) ───────────────────────
const dateMatch = pngPath.match(/debate-card-(\d{4}-\d{2}-\d{2})\.png$/);
const cardDate = dateMatch?.[1] ?? "unknown date";
const displayDate = new Date(cardDate + "T12:00:00Z").toLocaleDateString("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

// ── 3. Read debate metadata to build tweet copy ──────────────────────────────
// Re-read the card context by importing the gen module output — we use a simpler
// approach: parse from the PNG path and re-query DB here.
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: debate } = await db.from("debates").select("id, question, options").eq("day", cardDate).single();
const { data: votes } = await db.from("debate_votes").select("option_idx").eq("debate_id", debate.id);
const total = votes?.length ?? 0;
const pctA = total > 0 ? Math.round((votes.filter((v) => v.option_idx === 0).length / total) * 100) : 50;
const pctB = 100 - pctA;
const aWins = pctA >= pctB;
const winner = aWins ? debate.options[0] : debate.options[1];
const winnerPct = aWins ? pctA : pctB;

const tweetText = `Yesterday's debate result 🗳️

"${debate.question}"

${debate.options[0]}: ${pctA}%
${debate.options[1]}: ${pctB}%

${total} fans voted. The people have spoken.

Today's debate is live 👉 https://yourscore.app/debate?d=${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })}`;

// ── 4. No gate — results cards auto-post (founder decision, Jul 8). FYI only.
const caption = `\u{1F4CA} <b>Debate result \u2014 ${displayDate}</b> (auto-posting)\n\n"${debate.question}"\n\n${debate.options[0]}: <b>${pctA}%</b>\n${debate.options[1]}: <b>${pctB}%</b>\n\n${total} fans voted`;
await sendPhoto(pngPath, caption);
if (DRY) { console.log("--dry: would post"); process.exit(0); }

// ── 5. Post to X ─────────────────────────────────────────────────────────────
console.log("Posting to X…");
try {
  execFileSync("node", [
    "--env-file=.env.local",
    "scripts/post-tweet.mjs",
    "--text", tweetText,
    "--image", pngPath,
  ], { cwd: ROOT, stdio: "inherit" });
  await sendMessage(`✅ Debate results card posted to X — ${displayDate}`);
  console.log("Done.");
} catch (e) {
  await sendMessage(`⚠️ Tweet failed:\n<code>${e.message.slice(0, 400)}</code>`);
  process.exit(1);
}
