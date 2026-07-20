/**
 * Club-Fan Leaderboard — the DB reads. Kept separate from table.ts (which stays
 * pure/DB-free, mirroring src/lib/halftime/shared.ts) so the tally logic can be
 * unit-tested with zero DB and zero bundler.
 *
 * Uses the same `createServiceClient() as unknown as SupabaseClient` cast as the
 * rest of the halftime workstream (src/lib/halftime/release.ts,
 * src/app/api/halftime/*): club_supporters and halftime_releases are additive
 * tables not yet in the generated src/types/database.ts, so the generic
 * Database-typed client can't see them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { ClubSupporterRow, HalftimeAttemptRow } from "./table";

function db(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

interface ReleaseRow {
  season_id: number | null;
  round_name: string | null;
  home: string;
  away: string;
  kickoff_at: string;
  pack_id: string | null;
}

async function fetchReleaseRows(): Promise<ReleaseRow[]> {
  const { data, error } = await db()
    .from("halftime_releases")
    .select("season_id, round_name, home, away, kickoff_at, pack_id");
  if (error) throw error;
  return (data ?? []) as ReleaseRow[];
}

/**
 * Distinct home/away club names for a season — the self-maintaining club roster
 * (LOCKED DECISION #3: never hardcoded). Used both to validate a declared club
 * and to drive the full gameweek-table roster.
 */
export async function clubsForSeason(seasonId: number): Promise<string[]> {
  const rows = await fetchReleaseRows();
  const set = new Set<string>();
  for (const r of rows) {
    if (r.season_id !== seasonId) continue;
    set.add(r.home);
    set.add(r.away);
  }
  return Array.from(set).sort();
}

/** The most recent season_id with any halftime data, or null if none exists yet. */
export async function currentSeasonId(): Promise<number | null> {
  const rows = await fetchReleaseRows();
  const seasons = rows.map((r) => r.season_id).filter((s): s is number => s != null);
  return seasons.length > 0 ? Math.max(...seasons) : null;
}

/**
 * Resolves the season for an explicit ?gw=<round_name> query param. round_name
 * values are not guaranteed unique across seasons (e.g. "1" recurs every year),
 * so this picks the most recent season that used that round name. Known
 * simplification: a caller asking for a stale round name from an old season by
 * label alone will get the newest season's data for that label instead.
 */
export async function seasonForRound(roundName: string): Promise<number | null> {
  const rows = await fetchReleaseRows();
  const seasons = rows
    .filter((r) => r.round_name === roundName)
    .map((r) => r.season_id)
    .filter((s): s is number => s != null);
  return seasons.length > 0 ? Math.max(...seasons) : null;
}

/**
 * The most recent gameweek that has fully kicked off — i.e. no fixture in that
 * round is still upcoming. "Completed" is interpreted as kicked-off rather than
 * full-time: halftime_releases has no full-time state to check against (its
 * state machine stops at 'released'/'released_late', the halftime whistle), and
 * by the time a gameweek's last kickoff has passed, its halftime packs have long
 * been playable. This is a deliberate interpretation of an underspecified brief
 * term — flagged in the session report.
 */
export async function defaultGameweek(): Promise<{ seasonId: number; roundName: string } | null> {
  const rows = await fetchReleaseRows();
  const now = Date.now();

  const maxKickoffByRound = new Map<string, number>();
  const meta = new Map<string, { seasonId: number; roundName: string }>();
  for (const r of rows) {
    if (r.season_id == null || !r.round_name) continue;
    const key = `${r.season_id}::${r.round_name}`;
    const kickoff = new Date(r.kickoff_at).getTime();
    maxKickoffByRound.set(key, Math.max(maxKickoffByRound.get(key) ?? -Infinity, kickoff));
    meta.set(key, { seasonId: r.season_id, roundName: r.round_name });
  }

  const completed = Array.from(maxKickoffByRound.entries())
    .filter(([, maxKickoff]) => maxKickoff <= now)
    .map(([key, maxKickoff]) => ({ ...meta.get(key)!, maxKickoff }))
    .sort((a, b) => b.maxKickoff - a.maxKickoff);

  return completed.length > 0 ? { seasonId: completed[0].seasonId, roundName: completed[0].roundName } : null;
}

/** The distinct clubs that had a fixture in ONE round — not the whole season. */
export async function clubsForRound(seasonId: number, roundName: string): Promise<string[]> {
  const rows = await fetchReleaseRows();
  const set = new Set<string>();
  for (const r of rows) {
    if (r.season_id !== seasonId || r.round_name !== roundName) continue;
    set.add(r.home);
    set.add(r.away);
  }
  return Array.from(set).sort();
}

const HOUR = 3_600_000;
const MATCH_SETTLE_MS = 135 * 60_000; // a match ~115 min + cushion for stoppages

/** The next 08:00 UTC strictly after t (~09:00 UK in summer, 08:00 in winter — "morning"). */
function nextMorningAfter(t: number): number {
  const d = new Date(t);
  const at8 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8);
  return at8 > t ? at8 : at8 + 24 * HOUR;
}
/** 08:00 UTC on the calendar day of t (football never kicks off before 08:00, so "day one, morning"). */
function morningOfDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8);
}

export interface GameweekBeat {
  seasonId: number;
  roundName: string;
  /** The 'results are in' send is due (gameweek finished + it's the morning after). */
  resultsDue: boolean;
  /** The 'new gameweek' re-engagement send is due (the next round's day one has arrived). */
  newweekDue: boolean;
}

/**
 * Which club-gameweek sends are due right now. Two beats, per the founder's timing
 * (2026-07-15): don't fire the instant the last match ends — hold to a high-attention
 * moment. Beat 1 ('results') = the morning after the gameweek's final fixture, when
 * fans are checking how their team ended in the league. Beat 2 ('newweek') = day one
 * of the FOLLOWING gameweek, riding the fresh wave of football to pull non-players in.
 *
 * A round is only ever considered once its last fixture is fully played (last kickoff
 * + settle) — a message is irreversible, so it must never land mid-match. Exactly-once
 * across channels and re-runs is notification_log's PK, not this function; the lookback
 * just stops us re-walking ancient rounds forever.
 */
export async function clubGameweekBeats(opts: { lookbackHours: number }): Promise<GameweekBeat[]> {
  const rows = await fetchReleaseRows();
  const now = Date.now();
  const lookbackMs = opts.lookbackHours * HOUR;

  // First + last kickoff per (season, round).
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const meta = new Map<string, { seasonId: number; roundName: string }>();
  for (const r of rows) {
    if (r.season_id == null || !r.round_name) continue;
    const ko = new Date(r.kickoff_at).getTime();
    if (Number.isNaN(ko)) continue;
    const key = `${r.season_id}::${r.round_name}`;
    first.set(key, Math.min(first.get(key) ?? Infinity, ko));
    last.set(key, Math.max(last.get(key) ?? -Infinity, ko));
    meta.set(key, { seasonId: r.season_id, roundName: r.round_name });
  }

  const beats: GameweekBeat[] = [];
  for (const [key, lastKo] of Array.from(last.entries())) {
    const { seasonId, roundName } = meta.get(key)!;
    const settledAt = lastKo + MATCH_SETTLE_MS;
    if (settledAt > now) continue; // gameweek not finished — never message into a live match

    const resultsAt = nextMorningAfter(settledAt);

    // The next round in the SAME season = the round whose first kickoff is the
    // smallest one still after this round's last kickoff.
    let nextFirst = Infinity;
    for (const [k2, f2] of Array.from(first.entries())) {
      const m2 = meta.get(k2)!;
      if (m2.seasonId !== seasonId) continue;
      if (f2 > lastKo && f2 < nextFirst) nextFirst = f2;
    }
    const hasNext = nextFirst !== Infinity;
    const newweekAt = hasNext ? morningOfDay(nextFirst) : Infinity;

    const resultsDue = now >= resultsAt && now - resultsAt <= lookbackMs;
    const newweekDue = hasNext && now >= newweekAt && now - newweekAt <= lookbackMs;
    if (resultsDue || newweekDue) beats.push({ seasonId, roundName, resultsDue, newweekDue });
  }

  return beats.sort((a, b) => a.roundName.localeCompare(b.roundName));
}

/**
 * quiz_attempts JOIN halftime_releases ON pack_id, scoped to one gameweek — the
 * ONLY correct way to identify a halftime attempt (per brief; do not sniff
 * quiz_packs.metadata). Done as two queries (Supabase JS has no declared FK
 * between halftime_releases.pack_id and quiz_packs.id to join through) rather
 * than one SQL join.
 */
export async function halftimeAttemptsForGameweek(
  seasonId: number,
  roundName: string,
): Promise<HalftimeAttemptRow[]> {
  const { data: releases, error: relErr } = await db()
    .from("halftime_releases")
    .select("pack_id, home, away")
    .eq("season_id", seasonId)
    .eq("round_name", roundName)
    .not("pack_id", "is", null);
  if (relErr) throw relErr;

  // pack -> the fixture it belongs to. The own-club scoring rule needs the two
  // clubs behind every attempt, so carry them through with each row.
  const fixtureByPack = new Map<string, { home: string; away: string }>();
  for (const r of (releases ?? []) as { pack_id: string | null; home: string; away: string }[]) {
    if (r.pack_id) fixtureByPack.set(r.pack_id, { home: r.home, away: r.away });
  }
  const packIds = Array.from(fixtureByPack.keys());
  if (packIds.length === 0) return [];

  const { data: attempts, error: attErr } = await db()
    .from("quiz_attempts")
    .select("user_id, score, pack_id")
    .in("pack_id", packIds);
  if (attErr) throw attErr;

  return ((attempts ?? []) as { user_id: string; score: number | null; pack_id: string }[]).flatMap((a) => {
    const fx = fixtureByPack.get(a.pack_id);
    if (!fx) return []; // pack vanished between the two reads — can't attribute it
    return [{ userId: a.user_id, score: a.score ?? 0, home: fx.home, away: fx.away }];
  });
}

/** Every declared supporter for a season. */
export async function supportersForSeason(seasonId: number): Promise<ClubSupporterRow[]> {
  const { data, error } = await db()
    .from("club_supporters")
    .select("user_id, club")
    .eq("season_id", seasonId);
  if (error) throw error;
  return ((data ?? []) as { user_id: string; club: string }[]).map((s) => ({
    userId: s.user_id,
    club: s.club,
  }));
}

/** This user's own declared club for a season, or null if not yet set. */
export async function supporterRow(userId: string, seasonId: number): Promise<{ club: string } | null> {
  const { data, error } = await db()
    .from("club_supporters")
    .select("club")
    .eq("user_id", userId)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (error) throw error;
  return (data as { club: string } | null) ?? null;
}

/**
 * Every season this user has declared in, newest first. NOT used to decide the
 * lock — the lock is per-season (supporterRow above). A user legitimately has one
 * row PER SEASON, so any lookup that ignores season_id must never use
 * .maybeSingle(): it would throw for a returning fan.
 */
export async function supporterHistory(
  userId: string,
): Promise<{ club: string; season_id: number }[]> {
  const { data, error } = await db()
    .from("club_supporters")
    .select("club, season_id")
    .eq("user_id", userId)
    .order("season_id", { ascending: false });
  if (error) throw error;
  return (data ?? []) as { club: string; season_id: number }[];
}

/**
 * Pre-fill suggestion: the club whose quiz_packs.type='club' pack this user has
 * played most. Maps pack → club via quiz_packs.parameter, which is the exact
 * club name for a 'club' pack (e.g. "Arsenal") — cleaner and less error-prone
 * than substring-matching quiz_packs.name, which the brief suggested but which
 * carries suffixes like "· All Time · Expert". Restricted to `validClubs` so the
 * suggestion can never point at a club that isn't actually playable this season.
 */
export async function suggestClubForUser(userId: string, validClubs: string[]): Promise<string | null> {
  const { data: clubPacks, error: packErr } = await db()
    .from("quiz_packs")
    .select("id, parameter")
    .eq("type", "club");
  if (packErr) throw packErr;

  const clubByPackId = new Map<string, string>();
  for (const p of (clubPacks ?? []) as { id: string; parameter: string | null }[]) {
    if (p.parameter) clubByPackId.set(p.id, p.parameter);
  }
  if (clubByPackId.size === 0) return null;

  const { data: userAttempts, error: attErr } = await db()
    .from("quiz_attempts")
    .select("pack_id")
    .eq("user_id", userId);
  if (attErr) throw attErr;

  const validSet = new Set(validClubs);
  const counts = new Map<string, number>();
  for (const a of (userAttempts ?? []) as { pack_id: string | null }[]) {
    if (!a.pack_id) continue;
    const club = clubByPackId.get(a.pack_id);
    if (!club || !validSet.has(club)) continue;
    counts.set(club, (counts.get(club) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let best: string | null = null;
  let bestCount = 0;
  for (const [club, count] of Array.from(counts.entries())) {
    if (count > bestCount) {
      best = club;
      bestCount = count;
    }
  }
  return best;
}
