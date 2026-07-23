// "Today's Game" — the ONE featured game shown on the home hero, identical
// for every player on a given Europe/London calendar day so scores are
// comparable. Content is recycled from existing packs/lists; nothing here
// generates anything.
//
// Week shape (founder-locked):
//   Mon / Tue / Thu / Sat / Sun -> quiz
//   Wed                         -> perfect-10
//   Fri                         -> alternates by ISO-week parity:
//                                  even week -> higher-lower
//                                  odd week  -> guess-the-player
//
// Scheduling itself (which quiz pack plays which day) lives in the
// `daily_games` table, filled ahead of time by
// scripts/daily-game/fill-schedule.mjs. This module just RESOLVES what plays
// today: read the schedule row for today; if there isn't one, fall back to
// the current featured pack so the hero is never empty or broken.

import { londonDateISO, loadListForDay, loadLatestServed } from "@/lib/games/perfect10";
import { slugify } from "@/lib/utils";

export { londonDateISO };

export type DailyGameType = "quiz" | "perfect-10" | "higher-lower" | "guess-the-player";

/** Crowd stats for the hero tile's lower half. All three come from one SQL
 * aggregate (migration 102) so the home render stays a single round trip. */
export interface TodaysGameStats {
  /** How many players have finished it. */
  players: number;
  /** Mean score, rounded. null until anyone has played. */
  avgScore: number | null;
  /** % who got the single hardest question/rung right. null until anyone has played. */
  hardestPct: number | null;
}

export interface TodaysGame {
  day: string;
  gameType: DailyGameType;
  href: string;
  title: string;
  sub: string;
  coverImage: string | null;
  packId: string | null;
  packName: string | null;
  questionCount: number | null;
  /** Series tag from quiz_packs.metadata.series (e.g. "wc2026") — quiz only. */
  series: string | null;
  /** Perfect 10 only: today's list id — the subject the stats aggregate over. */
  listId: string | null;
  /** Crowd stats for the tile. null when the game type keeps no per-day record
   * (Higher or Lower, Guess the Player) or when the aggregate is unavailable. */
  stats: TodaysGameStats | null;
  /** true when today had no `daily_games` row and we fell back to the
   *  featured pack (schedule not filled yet, or fill-schedule hasn't run). */
  isFallback: boolean;
}

// ── Week shape + Friday-parity helper ───────────────────────────────────────

/** ISO-8601 week number for a `YYYY-MM-DD` London calendar date. */
export function isoWeekNumber(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const isoDay = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - isoDay); // Thursday of the same ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Deterministic week-shape resolver — the single source of truth for which
 * game type plays on a given London calendar date. Pure function, no I/O. */
export function gameTypeForDay(dateISO: string = londonDateISO()): DailyGameType {
  const weekday = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  if (weekday === 3) return "perfect-10"; // Wed
  if (weekday === 5) {
    // Fri — alternate by ISO-week parity.
    return isoWeekNumber(dateISO) % 2 === 0 ? "higher-lower" : "guess-the-player";
  }
  return "quiz"; // Mon, Tue, Thu, Sat, Sun
}

// ── Non-quiz game metadata (fixed routes, no per-day pack) ──────────────────

// Higher or Lower / Guess the Player generate a fresh random round on every
// load by default (replay variety) — the `?daily=1` flag tells the game page
// to draw the pinned round instead, seeded from today's London date so it's
// byte-identical for every player (src/lib/games/serve.ts `dailySeed`,
// src/app/api/games/[type]/route.ts). Perfect 10 and quiz are already pinned
// by date via their own tables, so no flag needed there.
const FIXED_GAME_META: Record<Exclude<DailyGameType, "quiz">, { href: string; title: string; sub: string }> = {
  "perfect-10": { href: "/play/game/perfect-10", title: "Perfect 10", sub: "Name the ranked top 10 — today's list" },
  "higher-lower": { href: "/play/game/higher-lower?daily=1", title: "Higher or Lower", sub: "Two players, one stat — pick the bigger number" },
  "guess-the-player": { href: "/play/game/guess-the-player?daily=1", title: "Guess the Player", sub: "Clues drip in — name the mystery footballer" },
};

// `daily_games` isn't in the generated Database types (see src/types/database.ts
// note at the top of this repo's other untyped-table call-sites, e.g.
// src/app/page.tsx's `sb`) — accept any Supabase client, typed or not.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function packToGame(day: string, gameType: "quiz", pack: any, isFallback: boolean): TodaysGame {
  return {
    day,
    gameType,
    href: `/challenges/${slugify(String(pack.name))}`,
    title: String(pack.name),
    sub: `${pack.question_count ?? 10} questions`,
    coverImage: pack.metadata?.cover_image ? String(pack.metadata.cover_image) : null,
    packId: String(pack.id),
    packName: String(pack.name),
    questionCount: Number(pack.question_count ?? 10),
    series: pack.metadata?.series ? String(pack.metadata.series) : null,
    listId: null,
    stats: null,
    isFallback,
  };
}

function fixedGame(day: string, gameType: Exclude<DailyGameType, "quiz">, isFallback: boolean): TodaysGame {
  const meta = FIXED_GAME_META[gameType];
  return {
    day,
    gameType,
    href: meta.href,
    title: meta.title,
    sub: meta.sub,
    coverImage: null,
    packId: null,
    packName: null,
    questionCount: null,
    series: null,
    listId: null,
    stats: null,
    isFallback,
  };
}

/** Perfect 10's tile used to read "Perfect 10 · Name the ranked top 10" — the
 * mode, never the subject, so it looked like a menu entry rather than a game
 * you could start. Lead with today's actual list title (founder, Jul 23); the
 * mode drops to the sub-line where the quiz tile carries its question count. */
async function perfect10Game(day: string, isFallback: boolean): Promise<TodaysGame> {
  const game = fixedGame(day, "perfect-10", isFallback);
  // Mirror EXACTLY what /api/games/perfect-10 serves: lists are released in
  // batches, not daily, so most Perfect 10 days have no list of their own and
  // the newest released one plays instead. Reading only `day` here is why the
  // tile fell back to the bare mode name.
  const list = await loadListForDay(day).catch(() => null) ?? await loadLatestServed().catch(() => null);
  if (!list) return game; // nothing released yet — keep the generic mode copy
  return {
    ...game,
    title: list.title,
    sub: "Perfect 10 · Name the top 10 in order",
    listId: list.id,
    questionCount: 10,
  };
}

/** Attach the crowd stats to a resolved game. Kept separate so every exit path
 * in the resolver picks them up without repeating the null-handling. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withStats(sb: any, game: TodaysGame): Promise<TodaysGame> {
  return { ...game, stats: await loadStats(sb, game) };
}

/** One aggregate call for the tile's stats half. Never throws and never blocks
 * the hero: any failure (including the RPC not being deployed yet) degrades to
 * `null`, which renders the tile without its stats strip. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadStats(sb: any, game: TodaysGame): Promise<TodaysGameStats | null> {
  // NB: a PostgREST builder is a thenable, not a Promise — it has no `.catch`.
  // Await it inside try/catch instead of chaining off the builder.
  let data: unknown = null;
  try {
    const res =
      game.gameType === "quiz" && game.packId
        ? await sb.rpc("get_daily_pack_stats", { p_pack_id: game.packId })
        : game.gameType === "perfect-10" && game.listId
        ? await sb.rpc("get_daily_p10_stats", { p_list_id: game.listId })
        : null;
    if (!res || res.error) return null;
    data = res.data;
  } catch {
    return null;
  }
  if (!data) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    players: Number(row.players ?? 0),
    avgScore: num(row.avg_score),
    hardestPct: num(row.hardest_correct_pct),
  };
}

/** The featured pack currently in rotation — the same fallback the old
 * `featuredPacks[0]` hero used, so "no schedule row" degrades to exactly
 * what shipped before this feature. `type != 'club'` is a belt-and-braces
 * guard, not a behaviour change: no club pack is featured today, but "no
 * club pack can ever be selected" is a hard rule, so the fallback path
 * enforces it too rather than relying on featuring never picking one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFeaturedFallback(sb: any, day: string): Promise<TodaysGame | null> {
  const { data } = await sb
    .from("quiz_packs")
    .select("id, name, question_count, metadata")
    .eq("featured", true)
    .eq("status", "published")
    .neq("type", "club")
    .order("featured_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return packToGame(day, "quiz", data, true);
}

/**
 * Resolve today's game for the home hero. Works for both signed-in and
 * signed-out visitors — `daily_games` and `quiz_packs` (published) are both
 * public-read, so any Supabase client (cookie-scoped or anon) can call this.
 *
 * Never throws on a missing schedule row or a missing pack — falls all the
 * way through to the featured pack, and if even that comes up empty, to a
 * generic link into the quiz hub, so the hero is never empty or broken.
 */
export async function resolveTodaysGame(sb: AnySupabase, day: string = londonDateISO()): Promise<TodaysGame> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = sb as any;

  const { data: row } = await client
    .from("daily_games")
    .select("day, game_type, pack_id, source")
    .eq("day", day)
    .maybeSingle();

  if (row) {
    if (row.game_type === "quiz") {
      if (row.pack_id) {
        const { data: pack } = await client
          .from("quiz_packs")
          .select("id, name, question_count, metadata, status")
          .eq("id", row.pack_id)
          .maybeSingle();
        if (pack && pack.status === "published") return withStats(client, packToGame(day, "quiz", pack, false));
      }
      // Scheduled as a quiz day but the pack is missing/unpublished — degrade
      // to the featured fallback rather than serving a broken link.
    } else if (row.game_type === "perfect-10") {
      return withStats(client, await perfect10Game(day, false));
    } else {
      return fixedGame(day, row.game_type as Exclude<DailyGameType, "quiz">, false);
    }
  }

  const fallback = await loadFeaturedFallback(client, day);
  if (fallback) return withStats(client, fallback);

  // Last resort — no schedule row AND no featured pack (e.g. empty DB).
  // Still never empty: point at the quiz hub instead of a dead hero.
  return {
    day,
    gameType: "quiz",
    href: "/play",
    title: "Today's Game",
    sub: "Jump into a quiz",
    coverImage: null,
    packId: null,
    packName: null,
    questionCount: null,
    series: null,
    listId: null,
    stats: null,
    isFallback: true,
  };
}
