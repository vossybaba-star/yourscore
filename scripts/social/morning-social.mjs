/**
 * morning-social.mjs — consolidated morning approval + posting session.
 *
 * Fires at 08:00 UK daily. Chains three approvals sequentially in Telegram:
 *   1. Guru card    — yesterday's hardest question + top player → posts X + email
 *   2. Debate post  — today's debate question → posts X
 *   3. Debate results — yesterday's debate results card → posts X
 *
 * Fires at 10:30 — after quiz-launch gates (09:30) have already run and cleared.
 * Quiz launch always has priority; this session picks up the remaining social posts.
 * Hard session limit: 50 min from start. Any unanswered item auto-skips.
 *
 * Replaces: post-guru.mjs (19:30), post-debate-morning.mjs (08:00),
 *           post-debate-evening.mjs (19:00) as separate approval-gated jobs.
 *
 * Usage:
 *   node --env-file=.env.local scripts/social/morning-social.mjs
 *   node --env-file=.env.local scripts/social/morning-social.mjs --dry
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { sendMessage, sendPhoto, awaitButtonsOrText, awaitText } from "../tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const DRY = process.argv.includes("--dry");

// ── Hard session deadline: 50 min from start (10:30 → clears by 11:20) ──────
const SESSION_DEADLINE_MS = Date.now() + 50 * 60 * 1000;
function remainingSec() {
  return Math.max(0, Math.floor((SESSION_DEADLINE_MS - Date.now()) / 1000));
}
function deadlineExpired() { return remainingSec() < 15; }

const ukDate = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
};
const ukToday     = ukDate(0);
const ukYesterday = ukDate(-1);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const resend = new Resend(process.env.RESEND_API_KEY);

// ── helpers ──────────────────────────────────────────────────────────────────
async function postToX(text, imagePath) {
  const tweetArgs = ["--env-file=.env.local", "scripts/post-tweet.mjs", "--text", text];
  if (imagePath) tweetArgs.push("--image", imagePath);
  const r = spawnSync("node", tweetArgs, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr?.trim() || "tweet failed");
  const match = r.stdout.match(/https:\/\/(?:twitter|x)\.com\S+/);
  return match ? match[0] : "https://x.com/Yourscore_App_";
}

/**
 * Show content, wait for Post / Edit / Skip.
 * Every await call uses `remainingSec()` — if the deadline passes, the await
 * throws and we auto-skip, guaranteeing the process exits on time.
 * Returns { action: "post"|"skip", tweetText }.
 */
async function approveLoop(imagePathOrNull, captionHtml, initialTweetText) {
  if (deadlineExpired()) {
    await sendMessage("⏰ Session time limit reached — auto-skipping remaining items.");
    return { action: "skip", tweetText: initialTweetText };
  }

  if (imagePathOrNull) {
    await sendPhoto(imagePathOrNull, captionHtml);
  } else {
    await sendMessage(captionHtml);
  }

  if (DRY) return { action: "skip", tweetText: initialTweetText };

  let tweetText = initialTweetText;

  await sendMessage(
    `Post, edit the tweet, or skip? ⏱ ~${Math.ceil(remainingSec() / 60)} min left.`,
    { buttons: ["Post", "Edit", "Skip"] }
  );

  let decision;
  try {
    decision = await awaitButtonsOrText("", { buttons: ["Post", "Edit", "Skip"], timeoutSec: remainingSec() });
  } catch {
    await sendMessage("⏰ No response — auto-skipping to next item.");
    return { action: "skip", tweetText };
  }

  while (true) {
    if (decision.kind === "button" && decision.value === "Skip") {
      return { action: "skip", tweetText };
    }

    if (decision.kind === "button" && decision.value === "Edit") {
      await sendMessage("Reply with the new tweet text:");
      try {
        tweetText = await awaitText({ timeoutSec: remainingSec() });
      } catch {
        await sendMessage("⏰ No reply received — keeping original tweet.");
      }
      await sendMessage(`✏️ Updated:\n<i>${tweetText}</i>`, { buttons: ["Post", "Edit", "Skip"] });
      if (deadlineExpired()) {
        await sendMessage("⏰ Session deadline — auto-skipping.");
        return { action: "skip", tweetText };
      }
      try {
        decision = await awaitButtonsOrText("", { buttons: ["Post", "Edit", "Skip"], timeoutSec: remainingSec() });
      } catch {
        await sendMessage("⏰ No response — auto-skipping.");
        return { action: "skip", tweetText };
      }
      continue;
    }

    if (decision.kind === "text") {
      tweetText = decision.value;
      await sendMessage(`✏️ Updated:\n<i>${tweetText}</i>`, { buttons: ["Post", "Edit", "Skip"] });
      if (deadlineExpired()) {
        await sendMessage("⏰ Session deadline — auto-skipping.");
        return { action: "skip", tweetText };
      }
      try {
        decision = await awaitButtonsOrText("", { buttons: ["Post", "Edit", "Skip"], timeoutSec: remainingSec() });
      } catch {
        await sendMessage("⏰ No response — auto-skipping.");
        return { action: "skip", tweetText };
      }
      continue;
    }

    return { action: "post", tweetText }; // "Post" button
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════════════════════

await sendMessage(
  `☀️ <b>Morning approvals — ${ukToday}</b>\n\n` +
  `3 items · session closes ~08:50 then quiz gates take over at 09:30\n\n` +
  `1️⃣ Guru card  2️⃣ Today's debate  3️⃣ Yesterday's results`
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: GURU CARD
// ═══════════════════════════════════════════════════════════════════════════════

{
  await sendMessage("🧠 <b>1 / 3 — Guru Card</b>  Generating…");

  const genResult = spawnSync("node", [
    "--env-file=.env.local",
    "scripts/social/guru-card-gen.mjs",
    "--date", ukYesterday,
  ], { cwd: ROOT, encoding: "utf8" });

  if (genResult.status !== 0) {
    const msg = (genResult.stderr?.trim() || genResult.stdout?.trim() || "unknown error").slice(0, 300);
    await sendMessage(`⚠️ Guru card skipped — ${msg}`);
  } else {
    const pngPath  = genResult.stdout.trim();
    const jsonPath = join(ROOT, "scripts/data", `guru-${ukYesterday}.json`);
    const meta     = JSON.parse(readFileSync(jsonPath, "utf8"));
    const { guru, question } = meta;

    const tweetDraft =
      `Yesterday's Question Guru 🧠\n\n` +
      `Only ${question.correctPct}% of players got this right.\n\n` +
      `@${guru.username} did.\n\n` +
      `Think you know more? 👉 yourscore.app`;

    const emailLine = guru.email
      ? `📧 Will email ${guru.email}`
      : `📧 No email found for @${guru.username}`;

    const caption =
      `🧠 <b>Guru — ${meta.displayDate}</b>\n\n` +
      `Guru: <b>@${guru.username}</b>\n` +
      `Q: ${question.text.slice(0, 90)}…\n` +
      `Correct rate: <b>${question.correctPct}%</b>\n\n` +
      `Tweet:\n<i>${tweetDraft}</i>\n\n${emailLine}`;

    const { action, tweetText } = await approveLoop(pngPath, caption, tweetDraft);

    if (action === "post") {
      try {
        const xUrl = await postToX(tweetText, pngPath);

        if (guru.email) {
          const emailTpl = readFileSync(join(ROOT, "emails/lifecycle/28-question-guru.html"), "utf8");
          const emailHtml = emailTpl
            .replace(/\{\{display_name\}\}/g, guru.name)
            .replace(/\{\{question_text\}\}/g, question.text)
            .replace(/\{\{correct_answer\}\}/g, question.correctAnswer)
            .replace(/\{\{correct_pct\}\}/g, String(question.correctPct))
            .replace(/\{\{category\}\}/g, question.category)
            .replace(/\{\{date\}\}/g, meta.displayDate)
            .replace(/\{\{x_url\}\}/g, xUrl)
            .replace(/\{\{play_url\}\}/g, "https://yourscore.app/play")
            .replace(/\{\{unsub_url\}\}/g, `https://yourscore.app/settings/email?email=${encodeURIComponent(guru.email)}`);

          await resend.emails.send({
            from: "YourScore <noreply@yourscore.app>",
            to: guru.email,
            subject: "You're today's Question Guru 🧠",
            html: emailHtml,
          });
        }

        await sendMessage(
          `✅ Guru posted · ${xUrl}\n` +
          `📧 Email: ${guru.email ? "sent" : "no email"}\n` +
          `📱 Post card to IG: <code>${pngPath}</code>`
        );
      } catch (e) {
        await sendMessage(`⚠️ Guru post failed:\n<code>${e.message.slice(0, 300)}</code>`);
      }
    } else {
      await sendMessage("⏭ Guru skipped.");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: TODAY'S DEBATE QUESTION
// ═══════════════════════════════════════════════════════════════════════════════

{
  await sendMessage("🗳️ <b>2 / 3 — Today's Debate</b>");

  const { data: debate, error } = await db
    .from("debates").select("id, question, options").eq("day", ukToday).single();

  if (error || !debate) {
    await sendMessage(`⚠️ No debate found for ${ukToday} — skipping.`);
  } else {
    const tweetDraft =
      `Today's debate 🔥\n\n` +
      `${debate.question}\n\n` +
      `${debate.options[0]} or ${debate.options[1]}?\n\n` +
      `Vote now 👉 yourscore.app/debate`;

    const caption =
      `🗳️ <b>Today's debate — ${ukToday}</b>\n\n` +
      `"${debate.question}"\n\n` +
      `Tweet:\n<i>${tweetDraft}</i>`;

    const { action, tweetText } = await approveLoop(null, caption, tweetDraft);

    if (action === "post") {
      try {
        const url = await postToX(tweetText);
        await sendMessage(`✅ Debate morning posted · ${url}`);
      } catch (e) {
        await sendMessage(`⚠️ Debate morning post failed:\n<code>${e.message.slice(0, 300)}</code>`);
      }
    } else {
      await sendMessage("⏭ Debate morning skipped.");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: YESTERDAY'S DEBATE RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

{
  await sendMessage("📊 <b>3 / 3 — Yesterday's Debate Results</b>  Generating card…");

  const genResult = spawnSync("node", [
    "--env-file=.env.local",
    "scripts/social/debate-card-gen.mjs",
    "--date", ukYesterday,
  ], { cwd: ROOT, encoding: "utf8" });

  if (genResult.status !== 0) {
    const msg = (genResult.stderr?.trim() || "unknown error").slice(0, 300);
    await sendMessage(`⚠️ Debate results skipped — ${msg}`);
  } else {
    const pngPath = genResult.stdout.trim();

    const { data: debate } = await db
      .from("debates").select("id, question, options").eq("day", ukYesterday).single();
    const { data: votes } = await db
      .from("debate_votes").select("option_idx").eq("debate_id", debate?.id);

    const total = votes?.length ?? 0;
    const pctA  = total > 0 ? Math.round((votes.filter(v => v.option_idx === 0).length / total) * 100) : 50;
    const pctB  = 100 - pctA;
    const displayDate = new Date(ukYesterday + "T12:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    });

    const tweetDraft =
      `Yesterday's debate result 🗳️\n\n` +
      `"${debate?.question}"\n\n` +
      `${debate?.options[0]}: ${pctA}%\n` +
      `${debate?.options[1]}: ${pctB}%\n\n` +
      `${total} fans voted. Today's debate is live 👉 yourscore.app/debate`;

    const caption =
      `📊 <b>Debate results — ${displayDate}</b>\n\n` +
      `"${debate?.question}"\n\n` +
      `${debate?.options[0]}: <b>${pctA}%</b>\n` +
      `${debate?.options[1]}: <b>${pctB}%</b>\n` +
      `${total} votes\n\n` +
      `Tweet:\n<i>${tweetDraft}</i>`;

    const { action, tweetText } = await approveLoop(pngPath, caption, tweetDraft);

    if (action === "post") {
      try {
        const url = await postToX(tweetText, pngPath);
        await sendMessage(`✅ Debate results posted · ${url}`);
      } catch (e) {
        await sendMessage(`⚠️ Debate results post failed:\n<code>${e.message.slice(0, 300)}</code>`);
      }
    } else {
      await sendMessage("⏭ Debate results skipped.");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DONE — process exits cleanly, Telegram poll released before quiz-launch
// ═══════════════════════════════════════════════════════════════════════════════

await sendMessage(`✅ <b>Morning approvals done.</b>  Quiz launch gates follow at 09:30.`);
if (DRY) console.log("--dry run complete");
