import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import { upsertBroadcastNotification } from "@/lib/notifications";
import { resolveTodaysGame, londonDateISO, type TodaysGame } from "@/lib/daily-game";

// Service-role reads must never be pinned by Vercel's data cache — see CLAUDE.md §4.
export const fetchCache = "force-no-store";

/**
 * Daily push: "Today's Game" to everyone opted in, at 12:30 Europe/London.
 *
 * Mirrors the Home hero's Today's Game EXACTLY (`resolveTodaysGame`) so the push
 * can never drift from what a player sees on Home: the game mode + that day's
 * theme (quiz pack name / Perfect 10 list title). Higher or Lower & Guess the
 * Player keep no per-day theme, so those days show the mode + its one-liner.
 *
 * Delivery: `notifyUsers()` handles the opt-in filter (iOS device tokens) and a
 * per-(user, key) dedupe via notification_log, so a retry or a double cron fire
 * can never double-send. `dedupeKey` is date-scoped → at most one per user/day.
 *
 * Timing / DST: Vercel crons are UTC with no DST. vercel.json fires this at BOTH
 * 11:30 and 12:30 UTC and the route only proceeds when London local time is the
 * 12:00 hour — that lands 12:30 London year-round (BST and GMT) with no seasonal
 * edit. The off-hour fire returns early having sent nothing.
 *
 * Safety: active by default; set `DAILY_GAME_PUSH_ENABLED=false` in Vercel to
 * kill it without a code change. Authenticated with Bearer `CRON_SECRET`.
 */

// Root-relative so the native tap handler (src/lib/push.ts — navigates only when
// url.startsWith("/")) opens it in-app. Lands on the Home tab and the Dashboard
// scrolls Today's Game into view (see the `focus` effect in Dashboard.tsx).
const HOME_TODAY_URL = "/?focus=today";

/** Hour (0–23) in Europe/London right now, DST-correct via Intl. */
function londonHour(): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(h);
}

/** Push copy from the resolved Today's Game — game mode + today's theme. */
function buildDailyGameCopy(game: TodaysGame): { title: string; body: string; url: string } {
  const url = HOME_TODAY_URL;
  switch (game.gameType) {
    case "quiz":
      return {
        title: `Today's Quiz: ${game.title} 🧠`,
        body: `${game.questionCount ?? 10} questions against the clock. See where you rank.`,
        url,
      };
    case "perfect-10":
      // listId present → game.title is today's list (the theme); else mode only.
      return game.listId
        ? {
            title: `Today's Perfect 10: ${game.title} 🔟`,
            body: "Name the whole top ten in order. How many can you get?",
            url,
          }
        : {
            title: "Today's game: Perfect 10 🔟",
            body: "Name the ranked top ten. How many can you get?",
            url,
          };
    case "higher-lower":
      return {
        title: "Today's game: Higher or Lower",
        body: "Two players, one stat. Pick the bigger number.",
        url,
      };
    case "guess-the-player":
      return {
        title: "Today's game: Guess the Player ⚽",
        body: "Clues drip in one by one. Name the mystery footballer.",
        url,
      };
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Active by default; the kill switch is DAILY_GAME_PUSH_ENABLED=false.
  if (process.env.DAILY_GAME_PUSH_ENABLED === "false") {
    return NextResponse.json({ enabled: false, note: "Disabled via DAILY_GAME_PUSH_ENABLED=false" });
  }
  // Only the 12:30 London slot proceeds (see DST note above).
  const hour = londonHour();
  if (hour !== 12) {
    return NextResponse.json({ skipped: "off-hour", londonHour: hour });
  }

  const svc = createServiceClient();
  const day = londonDateISO();

  // Resolve today's game exactly as the Home hero does, then build the copy.
  const game = await resolveTodaysGame(svc, day);
  const { title, body, url } = buildDailyGameCopy(game);

  // Inbox row for EVERYONE (stage 2), including web users with zero push
  // targets — so this must land before the opted-in early-return below.
  // Upserted against the dedupe_key unique index: a DST double-fire or retry
  // for the same day still leaves exactly one row. Wrapped so push always
  // proceeds regardless of this succeeding.
  try {
    await upsertBroadcastNotification({
      type: "daily_game",
      title,
      body,
      url,
      dedupeKey: `daily-game-push:${day}`,
    });
  } catch (err) {
    console.error("[daily-game-push] inbox broadcast failed:", err);
  }

  // Everyone opted in. notifyUsers re-confirms opt-in, narrows to iOS device
  // tokens, and dedupes per (user, key) — so this is safe to fire twice.
  const { data: optedIn } = await svc
    .from("profiles")
    .select("id")
    .eq("notifications_opt_in", true);
  const userIds = (optedIn ?? []).map((r) => r.id);
  if (!userIds.length) {
    return NextResponse.json({ enabled: true, day, gameType: game.gameType, targeted: 0, note: "no opted-in users" });
  }

  const { targeted } = await notifyUsers({
    userIds,
    title,
    body,
    url,
    dedupeKey: `daily-game-push:${day}`,
  });

  return NextResponse.json({
    enabled: true,
    day,
    gameType: game.gameType,
    theme: game.title,
    title,
    targeted,
  });
}
