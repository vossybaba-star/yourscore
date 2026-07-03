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
import { readFileSync, writeFileSync, readdirSync, statSync, openSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadQuiz, urls, deriveDay, slugify } from "./lib/quiz-launch.mjs";
import { sendMessage } from "./tg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const QUIZ_DIR = join(ROOT, "content", "daily-quizzes");
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
// Per-day idempotency: the draft routine kicks this on completion, so guard against a second
// kick re-publishing/re-sending. Records the last date we actually published. --force overrides.
const LOCK = join(ROOT, "scripts", "data", "launch-daily.ran");

const node = process.execPath;
const run = (script, args, opts = {}) =>
  execFileSync(node, [join(__dirname, script), ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
// Plain git in the repo root (for the build-time draft-pool bundle, which must be committed +
// pushed to deploy — unlike the DB-published Featured quiz). Throws on non-zero exit like run().
const git = (args, opts = {}) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...opts });
// A gate returns true on approve (exit 0), false on reject/skip (exit 1).
function gate(args) {
  try { run("tg-gates.mjs", args, { stdio: ["ignore", "inherit", "inherit"] }); return true; }
  catch (e) {
    if (e.status === 1 || e.status === 3) return false; // 1=reject/skip/timeout, 3=regenerate
    console.error(`gate error (${args[0]}): ${e.message}`); // unexpected — skip this step, never crash the launch
    return false;
  }
}
// Tri-state gate for the images step so we can tell Regenerate (exit 3, loop) apart from a
// timeout/no-response (exit 1 — keep the cards and move on, NOT loop and re-generate).
function gateAction(args) {
  try { run("tg-gates.mjs", args, { stdio: ["ignore", "inherit", "inherit"] }); return "approve"; }
  catch (e) {
    if (e.status === 3) return "regenerate";
    if (e.status !== 1) console.error(`gate error (${args[0]}): ${e.message}`);
    return "skip"; // reject / skip / timeout / unexpected
  }
}

const todayUK = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for THIS MORNING's draft. The draft routine (Claude + web research) can take ~80 min and
// may finish AFTER this launchd job fires, so poll for a quiz dated today instead of halting on
// the first look (the 07:08-vs-08:10 race that broke 29 Jun). Match on the quiz's own `date`,
// not file mtime, and return as soon as it's there (no waiting when it already exists).
async function waitForTodaysDraft(maxWaitMin = 100, stepMin = 5) {
  const deadline = Date.now() + maxWaitMin * 60000;
  let announced = false;
  for (;;) {
    let best = null, bestM = -1;
    for (const f of readdirSync(QUIZ_DIR).filter((x) => x.endsWith(".json"))) {
      try {
        const p = join(QUIZ_DIR, f);
        const q = loadQuiz(p);
        const m = statSync(p).mtimeMs;
        if (q.date === todayUK && m > bestM) { best = { quizPath: p, quiz: q }; bestM = m; }
      } catch { /* skip unreadable */ }
    }
    if (best) return best;
    if (Date.now() >= deadline) return null;
    if (!announced) { announced = true; try { await sendMessage(`⏳ Waiting for today's quiz draft to finish (up to ${maxWaitMin} min)…`); } catch {} }
    await sleep(stepMin * 60000);
  }
}

// Idempotency: the draft routine triggers this on completion; never publish/send twice in a day.
const launchedToday = () => { try { return readFileSync(LOCK, "utf8").trim() === todayUK; } catch { return false; } };
const markLaunched = () => { try { mkdirSync(dirname(LOCK), { recursive: true }); writeFileSync(LOCK, todayUK + "\n"); } catch {} };

async function main() {
  // 1. Wait for today's draft (returns at once when it already exists — the normal case now
  //    that the draft's COMPLETION triggers this run, not a fixed clock time).
  const found = await waitForTodaysDraft();
  if (!found) {
    await sendMessage(`⚠️ <b>Launch halted</b> — no quiz dated ${todayUK} appeared within the wait window. The morning draft routine may not have run. Nothing was published. (The 08:00 edition roll still keeps the in-app daily live.)`);
    return;
  }
  const { quizPath, quiz } = found;

  // Already done today? A second trigger must not re-publish or re-send.
  if (launchedToday() && !FORCE) {
    await sendMessage(`✅ Today's quiz (${todayUK}) was already launched. Skipping to avoid a double publish/send. Use --force to re-run.`);
    return;
  }

  {
    // Quiz already dated today (we matched on it); just ensure the series is set.
    quiz.series = quiz.series || "wc2026";
    writeFileSync(quizPath, JSON.stringify(quiz, null, 2));
  }
  const { slug, challenge } = urls(quiz);
  await sendMessage(`☀️ <b>Daily quiz launch</b> — ${quiz.date}\nDraft: <b>${quiz.name}</b>\nStarting the approval flow…`);

  // 2. publish — claim the day's lock FIRST so a concurrent/late trigger sees it and skips,
  //    then publish. (Belt-and-braces with the guard above.)
  if (!DRY) { markLaunched(); run("seed-daily-quiz.mjs", [quizPath, "--order", "0", "--commit"]); }

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

  // 3c. Refresh the 38-0 WC Mastermind DRAFT question pool. The ranked draft gates every pick
  //     from a BUILD-TIME bundle (src/data/draft/wc-quiz.json, imported by the app), so a new
  //     daily quiz only reaches the draft after that bundle is rebuilt AND redeployed. This was
  //     historically a manual step and got forgotten — the pool froze on 11–16 Jun questions
  //     from 17 Jun–2 Jul. Now automated: rebuild from every daily pack, then commit + push JUST
  //     that one file so Vercel redeploys. Runs only after Gate 1 approval (a rejected quiz must
  //     not enter the draft pool). Best-effort and fully isolated — any failure warns and
  //     continues; it must never take down the tweet/email sends.
  if (!DRY) {
    try {
      const rel = "src/data/draft/wc-quiz.json";
      const summary = run("draft/build-wc-quiz.mjs", []).trim().replace(/\s+/g, " ");
      // STALENESS GUARD — the freshly-built pool MUST contain a question dated today. If it
      // doesn't, the pool has silently frozen (exactly the 16 Jun–2 Jul freeze that ran for 17
      // days unnoticed). Alert LOUDLY on staleness, and emit a positive "fresh through" heartbeat
      // on success, so a missing message can never be mistaken for a healthy pool.
      let poolNewest = "?";
      try {
        const bundle = JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
        poolNewest = "0000-00-00";
        for (const q of bundle.questions || []) { const d = (q.id || "").slice(0, 10); if (d > poolNewest) poolNewest = d; }
      } catch { poolNewest = "?"; }
      const stale = poolNewest === "?" || poolNewest < quiz.date; // string compare on YYYY-MM-DD
      if (stale) {
        await sendMessage(`🔴 <b>DRAFT POOL STALE</b> — newest question in the rebuilt pool is <b>${poolNewest}</b>, not today (${quiz.date}). Today's pack didn't make it into the bundle, so the ranked draft may recycle old questions. Check content/daily-quizzes/ + scripts/draft/build-wc-quiz.mjs.`);
      }
      // exit 1 from `diff --quiet` = the bundle changed; exit 0 = identical (nothing to do).
      let changed = false;
      try { git(["diff", "--quiet", "HEAD", "--", rel]); } catch (e) { changed = e.status === 1; }
      if (!changed) {
        await sendMessage(`🧩 Draft pool ${stale ? "unchanged" : "already current"} — ${stale ? "⚠️" : "✅ fresh through"} <b>${poolNewest}</b>, nothing to deploy.`);
      } else {
        const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
        // Commit ONLY this pathspec, so a dirty working tree never leaks other files into it.
        git(["commit", "-q", "-m", `Refresh WC Mastermind draft pool — ${quiz.date}`, "--", rel]);
        if (branch === "main") {
          git(["push", "origin", "main"]);
          await sendMessage(`🧩 Draft pool rebuilt + pushed — ✅ fresh through <b>${poolNewest}</b> (${summary.slice(0, 70)}). Vercel redeploying so today's questions reach the ranked draft.`);
        } else {
          await sendMessage(`🧩 Draft pool rebuilt + committed on <b>${branch}</b> (not main) — NOT pushed. Merge to main to activate.`);
        }
      }
    } catch (e) {
      await sendMessage(`⚠️ Draft-pool refresh failed: ${e.message.slice(0, 140)}. The draft keeps the previous pool; rebuild manually via scripts/draft/build-wc-quiz.mjs + push.`);
    }
  } else {
    try { run("draft/build-wc-quiz.mjs", []); await sendMessage("🧪 (dry) rebuilt the draft pool locally; would commit + push src/data/draft/wc-quiz.json."); }
    catch (e) { await sendMessage(`🧪 (dry) draft-pool rebuild errored: ${e.message.slice(0, 120)}`); }
  }

  // 4. GATE 2a — cards (regenerate loop, capped). Isolated: if image gen or the gate fails
  //    (e.g. OpenAI billing cap, a Telegram blip) we WARN and continue without new cards —
  //    the tweet unfurls the page's existing image and the email still sends. An image
  //    failure must never take down the public sends. gate() returns true on Approve, false
  //    on exit 3 (Regenerate). Cap regenerations so a gate error can't infinite-loop.
  let share = null, cover = null;
  try {
    let first = true;
    for (let regen = 0; regen < 4; regen++) {
      await sendMessage(first ? "🎨 Generating the two cards…" : "🔄 Regenerating the cards…");
      const reuse = DRY && first ? ["--reuse-bg"] : []; // dry: free first pass; regen always fresh
      const out = run("gen-quiz-images.mjs", ["--quiz", quizPath, "--out", "/tmp", ...reuse]);
      share = out.match(/SHARE=(.+)/)?.[1]?.trim();
      cover = out.match(/COVER=(.+)/)?.[1]?.trim();
      if (!share || !cover) throw new Error("image generation did not return paths");
      first = false;
      const act = gateAction(["images", "--share", share, "--cover", cover]);
      if (act === "approve") break;                 // keep these
      if (act === "skip") { await sendMessage("ℹ️ No response on the cards — keeping them and continuing."); break; } // timeout/skip: do NOT regenerate
      if (regen === 3) await sendMessage("ℹ️ Keeping the last cards (regenerate limit reached)."); // act === regenerate → loop
    }
    if (!DRY) {
      run("set-quiz-share-image.mjs", ["--slug", slug, "--image", share, "--commit"]);
      run("set-quiz-share-image.mjs", ["--slug", slug, "--image", cover, "--type", "cover", "--commit"]);
    }
  } catch (e) {
    share = cover = null;
    const hint = /billing|quota|limit/i.test(e.message) ? " (OpenAI billing cap — top up at platform.openai.com)" : "";
    await sendMessage(`⚠️ Cards failed${hint}: ${e.message.slice(0, 140)}\nContinuing — tweet uses the page's unfurl image, email still sends.`);
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

  // 6. GATE 2c — email. Two segment-aware BROADCASTS (engaged = active + cooling,
  //    i.e. anyone who played in the last 14 days): quiz-primary players get the WC
  //    Quiz daily; wc/38 players get the Mastermind draft daily. The sender splits
  //    by primary_game so the two cohorts are mutually exclusive (nobody gets both),
  //    and both go out as marketing broadcasts — no transactional-quota burn.
  //    Dormant / never-played users are intentionally excluded.
  if (gate(["email", "--quiz", quizPath, "--day", DAY])) {
    if (DRY) { await sendMessage("🧪 (dry) would send two engaged-only broadcasts: Quiz daily → quiz players, Mastermind daily → WC/38 players."); }
    else {
      for (const { mode, label } of [
        { mode: "quiz", label: "Quiz daily → engaged quiz players" },
        { mode: "mastermind", label: "Mastermind daily → engaged WC/38 players" },
      ]) {
        try {
          // Detached so each staggered blast outlives this orchestrator run.
          const log = openSync(`/tmp/launch-email-day${DAY}-${mode}.log`, "a");
          const child = spawn(node, [join(__dirname, "send-wc-quiz-daily.mjs"), "--quiz", quizPath, "--day", DAY, "--mode", mode, "--segment", "engaged", "--send"],
            { cwd: ROOT, detached: true, stdio: ["ignore", log, log] });
          child.unref();
          await sendMessage(`📤 Email Day ${DAY}: ${label} started (engaged only · broadcast). Log: /tmp/launch-email-day${DAY}-${mode}.log`);
        } catch (e) {
          await sendMessage(`⚠️ Email (${mode}) failed to start: ${e.message.slice(0, 140)}`);
        }
      }
    }
  } else { await sendMessage("⏭ Email skipped."); }

  await sendMessage(`🏁 <b>Done</b> — ${quiz.name} (Day ${DAY}) is live: ${challenge}`);
}

main().catch(async (e) => { try { await sendMessage(`❌ Launch error: ${e.message}`); } catch {} console.error(e); process.exit(1); });
