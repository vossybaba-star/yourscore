/**
 * post-guru.mjs — daily Question Guru pipeline.
 *
 * 1. Generates the Guru card PNG (calls guru-card-gen.mjs)
 * 2. Posts card to X with tweet copy (no gate — founder decision Jul 8; Telegram gets FYIs)
 * 4. Sends congratulatory email to the Guru (28-question-guru.html)
 * 5. Reminds founder to post the card to IG manually
 *
 * The Guru day is YESTERDAY (the last COMPLETED quiz day) so the pick is final
 * from the morning: --prepare (08:45 cron) generates the card + FYIs Telegram and
 * the Studio dash; the plain run (19:00 cron) posts the prepared card + emails the guru.
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/post-guru.mjs --prepare   # morning: pick + card, no post
 *   node --env-file=.env.local scripts/social/post-guru.mjs             # evening: post prepared card
 *   node --env-file=.env.local scripts/social/post-guru.mjs --date 2026-07-07 [--dry]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";
import { sendMessage, sendPhoto } from "../tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const PREPARE = args.includes("--prepare");
const dateArg = args.includes("--date") ? args[args.indexOf("--date") + 1] : undefined;
// Guru day = the most recent COMPLETED quiz day with a qualifying question
// (yesterday or nothing — quiet days simply have no Guru post; never re-celebrates a day).
// The morning --prepare writes guru-next.json so the 19:00 run posts the same pick.
const ukDateBack = (off) => new Date(Date.now() - off * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");

// ── 1. Pick the Guru day + generate the card ────────────────────────────────
const NEXT_PTR = join(ROOT, "scripts/data/guru-next.json");
const POSTED_DAYS_FILE = join(ROOT, "scripts/data/guru-posted.json");
const postedDays = existsSync(POSTED_DAYS_FILE) ? JSON.parse(readFileSync(POSTED_DAYS_FILE, "utf8")) : [];
const pathsFor = (day) => ({
  json: join(ROOT, "scripts/data", `guru-${day}.json`),
  png: join(ROOT, "scripts/data", `guru-card-${day}.png`),
});
function generateFor(day) {
  console.log(`Generating Guru card for ${day}…`);
  const r = spawnSync("node", ["--env-file=.env.local", "scripts/social/guru-card-gen.mjs", "--date", day], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

let guruDay = dateArg;
if (!guruDay && !PREPARE && existsSync(NEXT_PTR)) {
  guruDay = JSON.parse(readFileSync(NEXT_PTR, "utf8")).day; // evening: post the morning's pick
}
if (guruDay) {
  const f = pathsFor(guruDay);
  if ((PREPARE || !existsSync(f.png) || !existsSync(f.json)) && !generateFor(guruDay)) {
    await sendMessage(`⚠️ <b>Guru card gen failed</b> — ${guruDay}`);
    process.exit(1);
  }
} else {
  // Freshness rule (founder, Jul 8): the Guru is YESTERDAY's completed day or nothing.
  // A quiet day means no Guru post that day — never reach back for stale content.
  const day = ukDateBack(1);
  if (postedDays.includes(day)) { console.log(`Guru for ${day} already posted — nothing to do.`); process.exit(0); }
  const f = pathsFor(day);
  if ((existsSync(f.png) && existsSync(f.json)) || generateFor(day)) guruDay = day;
  if (!guruDay) {
    await sendMessage(`🧠 <b>Guru</b> — ${day} didn't have a question answered enough times, so there's no Guru post today.`);
    console.log("Yesterday doesn't qualify — skipping.");
    process.exit(0);
  }
}
const { json: jsonPath, png: pngPath } = pathsFor(guruDay);
const meta = JSON.parse(readFileSync(jsonPath, "utf8"));
const { guru, question } = meta;

// ── 2. Draft tweet copy ──────────────────────────────────────────────────────
// NO "@" before the username in tweet copy (founder, Jul 10): X turns it into a
// mention of whoever owns that handle on X, who is almost never our player.
let tweetText = `Today's Question Guru 🧠

Only ${question.correctPct}% of players got this right.

${guru.username} did.

Think you know more? 👉 yourscore.app`;

// WC Mastermind context for the FYIs (selection already leads with WC players).
const wcLine = guru.wcPlayer ? ` · WC Mastermind player${guru.gatePct != null ? ` (gate ${Math.round(guru.gatePct * 100)}%)` : ''}` : '';

// ── 3. Build email preview summary ──────────────────────────────────────────
const emailPreview = guru.email
  ? `📧 Email → ${guru.email}\n"${guru.name}, you're today's Guru. Only ${question.correctPct}% got that."`
  : `📧 No email found for @${guru.username} — email will be skipped.`;

// ── 4. Morning prepare: card + FYI only; the 19:00 run posts it ─────────────
if (PREPARE) {
  writeFileSync(NEXT_PTR, JSON.stringify({ day: guruDay, preparedAt: new Date().toISOString() }));
  await sendPhoto(pngPath, `🧠 <b>Today's Question Guru — set for ${meta.displayDate}</b>\n\n<b>Guru:</b> @${guru.username}${wcLine} · <b>correct rate:</b> ${question.correctPct}%\n\nAuto-posts at 19:00 with this card. ${emailPreview}\n\nAlso visible now in Studio → Planner.`);
  console.log("Prepared — card + JSON ready, posting at 19:00.");
  process.exit(0);
}

// No gate — the Guru card auto-posts (founder decision, Jul 8). FYI only.
await sendPhoto(pngPath, `🧠 <b>Question Guru — ${meta.displayDate}</b> (auto-posting now)\n\n<i>${tweetText}</i>\n\n${emailPreview}`);
if (DRY) { console.log("--dry: would post"); process.exit(0); }

// ── 5. Post to X ─────────────────────────────────────────────────────────────
console.log("Posting to X…");
let xUrl = null;
try {
  const tweetResult = spawnSync("node", [
    "--env-file=.env.local",
    "scripts/post-tweet.mjs",
    "--text", tweetText,
    "--image", pngPath,
  ], { cwd: ROOT, encoding: "utf8" });

  if (tweetResult.status !== 0) throw new Error(tweetResult.stderr || "tweet failed");

  // Try to parse tweet URL from stdout
  const match = tweetResult.stdout.match(/https:\/\/twitter\.com\S+|https:\/\/x\.com\S+/);
  xUrl = match ? match[0] : "https://x.com/Yourscore_App_";

  console.log("X post done:", xUrl);
} catch (e) {
  await sendMessage(`⚠️ Tweet failed:\n<code>${e.message.slice(0, 400)}</code>\n\nEmail will still send if guru email is known.`);
  xUrl = "https://x.com/Yourscore_App_";
}

// ── 6. Send congratulatory email ─────────────────────────────────────────────
if (guru.email) {
  console.log(`Sending Guru email to ${guru.email}…`);
  try {
    const emailTemplate = readFileSync(join(ROOT, "emails/lifecycle/28-question-guru.html"), "utf8");
    const unsubUrl = `https://yourscore.app/settings/email?email=${encodeURIComponent(guru.email)}`;
    const playUrl = "https://yourscore.app/play";

    const emailHtml = emailTemplate
      .replace(/\{\{display_name\}\}/g, guru.name)
      .replace(/\{\{question_text\}\}/g, question.text)
      .replace(/\{\{correct_answer\}\}/g, question.correctAnswer)
      .replace(/\{\{correct_pct\}\}/g, String(question.correctPct))
      .replace(/\{\{category\}\}/g, question.category)
      .replace(/\{\{date\}\}/g, meta.displayDate)
      .replace(/\{\{x_url\}\}/g, xUrl)
      .replace(/\{\{play_url\}\}/g, playUrl)
      .replace(/\{\{unsub_url\}\}/g, unsubUrl);

    const resend = new Resend(RESEND_API_KEY);
    const { data, error: emailErr } = await resend.emails.send({
      from: "YourScore <noreply@yourscore.app>",
      to: guru.email,
      subject: "You're today's Question Guru 🧠",
      html: emailHtml,
    });

    if (emailErr) throw new Error(emailErr.message);
    console.log("Email sent:", data?.id);
  } catch (e) {
    await sendMessage(`⚠️ Guru email failed:\n<code>${e.message.slice(0, 300)}</code>`);
  }
} else {
  console.log("No email for guru — skipping email step.");
}

// ── 6b. Push notification to the Guru (app installed + opted in) ─────────────
// Same rules as every YourScore push: notifications_opt_in gate, device token
// required, notification_log dedupe so a retry can never double-notify.
let pushStatus = "skipped";
try {
  const { createClient } = await import("@supabase/supabase-js");
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const dedupeKey = `guru:${guruDay}`;
  const { data: prof } = await db.from("profiles").select("notifications_opt_in").eq("id", guru.userId).single();
  const { data: tokens } = await db.from("device_tokens").select("platform").eq("user_id", guru.userId);
  const { data: already } = await db.from("notification_log").select("user_id").eq("key", dedupeKey).eq("user_id", guru.userId);
  if (!tokens?.length) pushStatus = "no app installed";
  else if (!prof?.notifications_opt_in) pushStatus = "not opted in";
  else if (already?.length) pushStatus = "already sent";
  else {
    await db.from("notification_log").insert({ user_id: guru.userId, key: dedupeKey });
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        userIds: [guru.userId],
        title: `${guru.name}, you're today's Question Guru 🧠`,
        body: `Only ${question.correctPct}% got that question right. You did. Your card is live.`,
        url: "/play",
      }),
    });
    pushStatus = res.ok ? "sent" : `failed (${res.status})`;
  }
  console.log(`Guru push: ${pushStatus}`);
} catch (e) {
  pushStatus = "failed";
  console.error("Guru push failed:", e.message);
}

// ── 7. Summary + IG reminder ─────────────────────────────────────────────────
await sendMessage(`✅ <b>Guru post done — ${meta.displayDate}</b>

🧠 Guru: @${guru.username}
📊 Correct rate: ${question.correctPct}%
🐦 X: ${xUrl}
📧 Email: ${guru.email ? "sent" : "no email found"}
📲 Push: ${pushStatus}

📱 <b>Post the card to IG manually</b> — image saved at:
<code>${pngPath}</code>`);

postedDays.push(guruDay);
writeFileSync(POSTED_DAYS_FILE, JSON.stringify([...new Set(postedDays)].slice(-90)));
if (existsSync(NEXT_PTR)) { try { (await import("node:fs")).unlinkSync(NEXT_PTR); } catch {} }

console.log("Done.");
