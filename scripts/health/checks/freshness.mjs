/**
 * freshness.mjs — Layer 2: data invariants that must hold every day.
 *
 * Service-role reads only. Also infers Vercel cron health from effects
 * (no Vercel API): if cleanup-lobbies / expire-challenges stopped running,
 * their backlog shows up here within an hour or two.
 */

import { supa, todayUK, hourUK } from "../lib/db.mjs";

const BOT_ID = process.env.HEALTH_BOT_USER_ID || "00000000-0000-0000-0000-000000000000";

export async function run(report, ctx) {
  const today = todayUK();
  const hour = hourUK();

  // ── Today's WC Mastermind daily pack ────────────────────────────────────────
  // launch-daily fires ~07:06 but sits behind Telegram approval gates, so before
  // 09:30 we accept yesterday's pack with a warn instead of a red.
  try {
    const { data, error } = await supa
      .from("quiz_packs")
      .select("id, name, questions, metadata, status, created_at")
      .eq("status", "published")
      .filter("metadata->>daily", "eq", "true")
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) throw new Error(error.message);

    const packs = data ?? [];
    const todays = packs.find((p) => p.metadata?.date === today);
    if (todays) {
      report.add("fresh", "daily pack", true, { detail: `"${todays.name}"` });
      ctx.todayPack = todays;
      ctx.recentDailyPacks = packs;
    } else {
      const lenient = hour < 9 || (hour === 9 && new Date().getMinutes() < 30);
      report.add("fresh", "daily pack", lenient, {
        warn: lenient,
        detail: `no published daily pack dated ${today}${lenient ? " yet (pre-09:30, gates pending)" : ""}`,
        hint: "run: node --env-file=.env.local scripts/launch-daily.mjs",
      });
      ctx.recentDailyPacks = packs;
    }
  } catch (e) {
    report.add("fresh", "daily pack", false, { detail: e.message, hint: "quiz_packs query failed — check Supabase" });
  }

  // ── WC Mastermind ranked edition rolled ─────────────────────────────────────
  // wc-roll launchd job fires 08:00; give it until 08:15.
  try {
    const { data, error } = await supa.from("wc_ranked_edition").select("edition, published_at").single();
    if (error) throw new Error(error.message);
    const ok = data.edition === today || hour < 8 || (hour === 8 && new Date().getMinutes() < 15);
    report.add("fresh", "wc edition", ok, {
      warn: ok && data.edition !== today,
      detail: data.edition === today ? "" : `edition still ${data.edition}`,
      hint: "run: bash scripts/wc-roll.sh (edition didn't roll)",
    });
    ctx.edition = data.edition;
  } catch (e) {
    report.add("fresh", "wc edition", false, { detail: e.message, hint: "wc_ranked_edition unreadable" });
  }

  // ── Vercel cron inference: stale lobbies ────────────────────────────────────
  // cleanup-lobbies (hourly) expires player lobbies older than 3h; anything
  // older than 4h still in 'lobby' means the cron stopped.
  try {
    const cutoff = new Date(Date.now() - 4 * 3600_000).toISOString();
    const { count, error } = await supa
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("type", "player")
      .eq("status", "lobby")
      .lt("created_at", cutoff);
    if (error) throw new Error(error.message);
    report.add("fresh", "lobby cleanup cron", (count ?? 0) === 0, {
      detail: count ? `${count} lobbies stuck >4h` : "",
      hint: "Vercel cron /api/cron/cleanup-lobbies likely not running — check Vercel crons",
    });
  } catch (e) {
    report.add("fresh", "lobby cleanup cron", false, { detail: e.message });
  }

  // ── Vercel cron inference: challenge expiry ─────────────────────────────────
  // expire-challenges runs 03:00 daily; a challenge still 'awaiting_opponent'
  // 27h past its expires_at means the cron missed at least one cycle.
  try {
    const cutoff = new Date(Date.now() - 27 * 3600_000).toISOString();
    const { count, error } = await supa
      .from("h2h_challenges")
      .select("id", { count: "exact", head: true })
      .eq("status", "awaiting_opponent")
      .lt("expires_at", cutoff);
    if (error) throw new Error(error.message);
    report.add("fresh", "challenge expiry cron", (count ?? 0) === 0, {
      detail: count ? `${count} challenges unexpired >27h past deadline` : "",
      hint: "Vercel cron /api/cron/expire-challenges likely not running",
    });
  } catch (e) {
    report.add("fresh", "challenge expiry cron", false, { detail: e.message });
  }

  // ── Product pulse (warn-only): are real users actually playing today? ──────
  // Not a system failure, but the founder wants to know if today's content is
  // getting zero engagement by afternoon — often the smell of a silent breakage.
  if (hour >= 12) {
    try {
      // UTC midnight is close enough for a warn-only pulse check (UK is UTC+0/+1).
      const startOfDayUK = `${today}T00:00:00Z`;
      const [runs, attempts] = await Promise.all([
        supa.from("draft_wc_runs").select("id", { count: "exact", head: true })
          .eq("ranked", true).neq("user_id", BOT_ID).gte("created_at", startOfDayUK),
        ctx.todayPack
          ? supa.from("quiz_attempts").select("id", { count: "exact", head: true })
              .eq("pack_id", ctx.todayPack.id).neq("user_id", BOT_ID).gte("completed_at", startOfDayUK)
          : Promise.resolve({ count: null }),
      ]);
      const r = runs.count ?? 0;
      const a = attempts.count;
      const quiet = r === 0 || a === 0;
      report.add("fresh", "player pulse", true, {
        warn: quiet,
        detail: `ranked WC runs today: ${r}${a !== null ? `, daily-quiz attempts: ${a}` : ""}${quiet ? " — unusually quiet for the afternoon" : ""}`,
      });
    } catch (e) {
      report.add("fresh", "player pulse", true, { warn: true, detail: `unreadable: ${e.message}` });
    }
  }

  // ── Email volume this month (Resend has no usage API; our logs are truth) ──
  try {
    const monthStart = today.slice(0, 8) + "01";
    const [log, sends] = await Promise.all([
      supa.from("email_log").select("*", { count: "exact", head: true }).gte("sent_at", monthStart),
      supa.from("email_sends").select("id", { count: "exact", head: true }).gte("sent_at", monthStart),
    ]);
    const total = (log.count ?? 0) + (sends.count ?? 0);
    const ok = total < 48_000;
    report.add("fresh", "email volume", ok, {
      warn: ok && total > 40_000,
      detail: total > 40_000 ? `${(total / 1000).toFixed(1)}k sends this month (quota 50k)` : "",
      hint: "approaching Resend quota — throttle campaigns or upgrade plan",
    });
  } catch (e) {
    // Column names differ per table generation — warn, don't fail the run.
    report.add("fresh", "email volume", true, { warn: true, detail: `unreadable: ${e.message}` });
  }
}
