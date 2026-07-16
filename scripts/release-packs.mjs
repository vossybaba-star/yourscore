/**
 * The release job. Runs daily on the VPS (~09:00 UK).
 *
 *   node --env-file=.env.local scripts/release-packs.mjs            # DRY RUN
 *   node --env-file=.env.local scripts/release-packs.mjs --commit   # release + notify
 *   node --env-file=.env.local scripts/release-packs.mjs --commit --no-email
 *
 * Publishes every pack the founder has APPROVED whose release_at has come round, then
 * fires the push and (optionally) the email for each one.
 *
 * ── Two rules it will not break ───────────────────────────────────────────────
 * 1. A pack with approved_at IS NULL is NEVER released. If the founder approved nothing,
 *    NOTHING ships — we do not fall back to publishing an unapproved pack, and we do not
 *    backfill a missed day as if it were fresh (content is date-locked). Instead the job
 *    Telegrams that it released nothing and how many drafts are waiting, so a silent
 *    content drought is impossible.
 * 2. It is idempotent. The UPDATE is its own guard: it matches only
 *    status='draft' AND approved_at IS NOT NULL AND release_at <= now(), and it sets
 *    status='published' — so a second run in the same day matches nothing. Push is
 *    additionally deduped per-pack by notifyUsers' notification_log.
 *
 * ── Why this lives on the VPS and not in a Vercel cron ────────────────────────
 * Campaign email only works here. RESEND_CAMPAIGNS_API_KEY is used exclusively by
 * scripts/lib/broadcast.mjs and is referenced nowhere in src/ — and transactional email
 * (which Vercel CAN send) burns one credit per recipient and is already over quota.
 * Push still lives in the app, in notifyUsers(), which owns the opt-in filter and the
 * log-before-deliver dedupe — so we call it over HTTP rather than keeping a second copy
 * of that logic here.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { slugify } from "./lib/quiz-launch.mjs";
import { sendMessage } from "./tg.mjs";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const NO_EMAIL = args.includes("--no-email");
const NO_PUSH = args.includes("--no-push");
const NO_TELEGRAM = args.includes("--no-telegram");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://yourscore.app";
const CRON_SECRET = process.env.CRON_SECRET;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Email cadence. Releasing every other day would mean ~3.5 campaign emails a week to the
// same people, which burns a list fast. We do NOT solve that by hand-picking which packs
// email — segments.mjs already has a per-person frequency cap, and it does the job better:
// with a 4-day cap and an every-other-day release, each person receives AT MOST ~1.75
// emails a week no matter how many packs go out, and the cap picks whichever release they
// haven't been mailed about. Push carries every release; email self-throttles.
const EMAIL_SEGMENT = "quiz-players";
const EMAIL_CAP_DAYS = 4;

const nowIso = new Date().toISOString();

// ── Find what's due ──────────────────────────────────────────────────────────
const { data: due, error } = await supabase
  .from("quiz_packs")
  .select("id, name, theme, questions, release_at, approved_at")
  .eq("status", "draft")
  .not("approved_at", "is", null)
  .lte("release_at", nowIso)
  .order("release_at", { ascending: true });

if (error) { console.error(`Query failed: ${error.message}`); process.exit(1); }

// How many are waiting but not yet approved — this is what makes a drought visible.
const { count: awaiting } = await supabase
  .from("quiz_packs")
  .select("id", { count: "exact", head: true })
  .eq("status", "draft")
  .is("approved_at", null);

console.log(`\n📦 Release job — ${nowIso}${COMMIT ? "" : "  (DRY RUN)"}`);
console.log(`   due now: ${due?.length ?? 0}   ·   awaiting approval: ${awaiting ?? 0}\n`);

// ── Nothing to ship ──────────────────────────────────────────────────────────
if (!due?.length) {
  console.log("Nothing approved and due. Releasing nothing — by design.");
  if (COMMIT && !NO_TELEGRAM) {
    // Fail loudly, not silently. A content drought must never be invisible.
    await sendMessage(
      awaiting
        ? `📦 <b>No quiz released today.</b>\n\n${awaiting} pack${awaiting === 1 ? "" : "s"} waiting on your approval.\n\nhttps://yourscore.app/admin/quiz`
        : `📦 <b>No quiz released today</b> — and there are no drafts queued either.\n\nThe factory may not have run. Check the Monday job.`
    ).catch((e) => console.error("Telegram failed:", e.message));
  }
  process.exit(0);
}

// ── Release each pack ────────────────────────────────────────────────────────
const released = [];

for (const pack of due) {
  const slug = slugify(pack.name);
  const url = `${APP_URL}/challenges/${slug}`;
  console.log(`━━ ${pack.name}`);

  if (!COMMIT) {
    console.log(`   would publish → ${url}`);
    console.log(`   would push, and ${NO_EMAIL ? "skip email" : `email segment "${EMAIL_SEGMENT}"`}`);
    continue;
  }

  // 1. Go live. The WHERE clause is the idempotency guard — a concurrent or repeated run
  //    matches nothing once status has flipped.
  const { data: flipped, error: upErr } = await supabase
    .from("quiz_packs")
    .update({ status: "published", rotation_active: true, featured: true, updated_at: new Date().toISOString() })
    .eq("id", pack.id)
    .eq("status", "draft")            // ← guard: only a still-draft row flips
    .not("approved_at", "is", null)   // ← guard: never publish an unapproved pack
    .select("id")
    .maybeSingle();

  if (upErr) { console.error(`   ✗ publish failed: ${upErr.message}`); continue; }
  if (!flipped) { console.log(`   ⊘ already released by another run — skipping`); continue; }
  console.log(`   ✓ live → ${url}`);

  // 2. Push. notifyUsers (in the app) owns opt-in + dedupe; we call it rather than
  //    reimplementing that here and letting the two copies drift.
  if (!NO_PUSH) {
    if (!CRON_SECRET) {
      console.error("   ⚠️  CRON_SECRET not set — skipping push");
    } else {
      try {
        const res = await fetch(`${APP_URL}/api/internal/notify-release`, {
          method: "POST",
          headers: { authorization: `Bearer ${CRON_SECRET}`, "content-type": "application/json" },
          body: JSON.stringify({
            packId: pack.id,
            title: `New quiz: ${pack.theme ?? pack.name}`,
            body: "15 questions. See how many you get.",
            url: `/challenges/${slug}`,
          }),
        });
        const j = await res.json().catch(() => ({}));
        console.log(res.ok ? `   ✓ pushed to ${j.targeted ?? 0}` : `   ⚠️  push failed (${res.status}): ${j.error ?? ""}`);
      } catch (e) {
        console.error(`   ⚠️  push failed: ${e.message}`); // never fatal — the pack is live
      }
    }
  }

  // 3. Email. Rendered from the template, then handed to segments.mjs, which owns
  //    suppression, the frequency cap, the audience cleanup and the send log.
  if (!NO_EMAIL) {
    try {
      await emailRelease(pack, url);
    } catch (e) {
      console.error(`   ⚠️  email failed: ${e.message}`); // never fatal — the pack is live
    }
  }

  released.push({ ...pack, url });
}

// ── Report ───────────────────────────────────────────────────────────────────
if (!COMMIT) {
  console.log(`\nDRY RUN — nothing published. Re-run with --commit.`);
  process.exit(0);
}

console.log(`\n✓ released ${released.length} pack(s)`);

if (released.length && !NO_TELEGRAM) {
  const lines = released.map((p) => `• <a href="${p.url}">${p.theme ?? p.name}</a>`).join("\n");
  await sendMessage(`📦 <b>Live now</b>\n\n${lines}`).catch((e) => console.error("Telegram failed:", e.message));
}

// ─────────────────────────────────────────────────────────────────────────────

async function emailRelease(pack, url) {
  if (!process.env.RESEND_CAMPAIGNS_API_KEY) {
    console.log(`   ⊘ email skipped — RESEND_CAMPAIGNS_API_KEY not set`);
    return;
  }
  const theme = pack.theme ?? pack.name;

  // The taster: lead with an actual question from the pack. It's the strongest hook we
  // have — a fan who reads it wants to know if they're right. Pick an easy one, so the
  // email doesn't open by making them feel thick.
  const qs = Array.isArray(pack.questions) ? pack.questions : [];
  const sample = qs.find((q) => q.difficulty === "easy") ?? qs.find((q) => q.difficulty === "medium") ?? qs[0];

  const html = readFileSync("emails/lifecycle/28-themed-pack-release.html", "utf8")
    .replaceAll("{{SUBJECT}}", `New quiz: ${theme}`)
    .replaceAll("{{PREHEADER}}", `15 questions on ${theme}. See how many you get.`)
    .replaceAll("{{THEME}}", theme)
    .replaceAll("{{TEASER}}", `A new quiz just went up — 15 questions on ${theme.toLowerCase()}. See how you do.`)
    .replaceAll("{{SAMPLE_Q}}", sample?.question ?? `15 questions on ${theme}.`)
    .replaceAll("{{PACK_URL}}", url);

  const tmp = join(tmpdir(), `pack-release-${pack.id}.html`);
  writeFileSync(tmp, html, "utf8");

  console.log(`   → emailing segment "${EMAIL_SEGMENT}"…`);
  const out = execFileSync(
    "node",
    [
      "--env-file=.env.local", "scripts/segments.mjs", "send", EMAIL_SEGMENT,
      "--template", tmp,
      "--subject", `New quiz: ${theme}`,
      "--preview-text", `15 questions on ${theme}. See how many you get.`,
      "--key", `pack:${pack.id}`,          // per-pack cap key — a retry can't double-send
      "--cap-days", String(EMAIL_CAP_DAYS),
      "--send",
    ],
    { encoding: "utf8", cwd: process.cwd() }
  );
  console.log(out.split("\n").filter((l) => l.trim()).slice(-3).map((l) => `     ${l.trim()}`).join("\n"));
}
