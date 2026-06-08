/**
 * Draft XI — server-side helpers (authoritative). Used by the API routes.
 *
 * Security model (mirrors src/app/api/h2h/play): the client is never trusted for
 * anything competitive. We re-resolve every drafted player from the shipped pool
 * (true overall/position), validate the XI against the formation, and recompute
 * Strength + projection here. Any client-sent rating is ignored.
 */

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftDatabase } from "@/types/draft-db";
import { slotsFor } from "./formations";
import { getPlayer } from "./pool";
import { scoreTeam, projectSeason, canPlay } from "./score";
import type { Formation, PlacedPlayer, Projected } from "./types";
import { FORMATIONS } from "./types";

/** Service-role client typed to the Draft XI tables (bypasses RLS — server only). */
export function createDraftDb(): SupabaseClient<DraftDatabase> {
  return createServiceClient() as unknown as SupabaseClient<DraftDatabase>;
}

/** "Global" board sentinel — matches the migration default (league_id is part of
 *  the standings PK, so it can't be NULL). Real leagues never use this id. */
export const GLOBAL_LEAGUE = "00000000-0000-0000-0000-000000000000";

// Join-code alphabet excludes ambiguous chars (0/O/1/I). Uniqueness is enforced by
// the unique constraint on draft_leagues.join_code; callers retry on collision.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function genJoinCode(len = 6): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/** A side of an H2H, snapshotted into draft_matches / draft_challenges. */
export type TeamSnapshot = {
  name: string;
  formation: import("./types").Formation;
  squad: import("./types").PlacedPlayer[];
  strength: number;
  projected: import("./types").Projected | null;
};

/** Apply the win/loss loop to a user's live team: win → streak up; loss → reset
 *  streak. The team always stays active (no rebuild penalty — "stale" is retired).
 *  No-op if they have no saved team. */
export async function applyTeamResult(
  db: SupabaseClient<DraftDatabase>,
  userId: string,
  won: boolean
): Promise<void> {
  const { data: t } = await db.from("draft_teams").select("win_streak").eq("user_id", userId).maybeSingle();
  if (!t) return;
  await db
    .from("draft_teams")
    .update({
      win_streak: won ? (t.win_streak ?? 0) + 1 : 0,
      status: "active", // teams stay playable (no rebuild-on-loss penalty)
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/**
 * Credit one H2H win to a player's standings (daily + all-time) for a board.
 * Read-modify-write upsert: resets wins_today when the last win was on a prior
 * day. Low write contention per user, so a transaction isn't warranted for v1.
 */
export async function creditWin(
  db: SupabaseClient<DraftDatabase>,
  winnerId: string,
  displayName: string,
  leagueId: string = GLOBAL_LEAGUE
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: cur } = await db
    .from("draft_standings")
    .select("wins_today, wins_all_time, last_win_date")
    .eq("user_id", winnerId)
    .eq("league_id", leagueId)
    .maybeSingle();

  const winsToday = cur && cur.last_win_date === today ? cur.wins_today + 1 : 1;
  const winsAllTime = (cur?.wins_all_time ?? 0) + 1;

  await db.from("draft_standings").upsert(
    {
      user_id: winnerId,
      display_name: displayName,
      league_id: leagueId,
      wins_today: winsToday,
      wins_all_time: winsAllTime,
      last_win_date: today,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,league_id" }
  );
}

export type SquadInput = { slot: string; player_season_id: string };

export type ValidatedTeam = {
  formation: Formation;
  squad: PlacedPlayer[];
  strength: number;
  projected: Projected;
};

/**
 * Validate a submitted XI and recompute its rating authoritatively. Throws on any
 * tampering (unknown formation/slot/player, duplicate slot or player, illegal
 * position fit, or an incomplete XI).
 */
export function validateAndScore(formationRaw: unknown, squadRaw: unknown): ValidatedTeam {
  const formation = formationRaw as Formation;
  if (!FORMATIONS.includes(formation)) throw new Error("Invalid formation");

  if (!Array.isArray(squadRaw)) throw new Error("Invalid squad");
  const slots = slotsFor(formation);
  if (squadRaw.length !== slots.length) throw new Error("Incomplete XI");

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const usedSlots = new Set<string>();
  const usedPlayers = new Set<string>();
  const usedNames = new Set<string>();
  const squad: PlacedPlayer[] = [];

  for (const entry of squadRaw as SquadInput[]) {
    if (!entry || typeof entry.slot !== "string" || typeof entry.player_season_id !== "string") {
      throw new Error("Invalid squad entry");
    }
    const slot = slotById.get(entry.slot);
    if (!slot) throw new Error(`Unknown slot ${entry.slot}`);
    if (usedSlots.has(slot.id)) throw new Error(`Duplicate slot ${slot.id}`);
    if (usedPlayers.has(entry.player_season_id)) throw new Error("Duplicate player");

    const player = getPlayer(entry.player_season_id);
    if (!player) throw new Error(`Unknown player ${entry.player_season_id}`);
    // The same player exists across FIFA editions under different player_season_ids
    // but the SAME name — reject by name so an XI can never field two of one player
    // (e.g. Ronaldo 06/07 + Ronaldo 09/10). This is the authoritative gate for every
    // write path: team save, live swap, and match.
    if (usedNames.has(player.name)) throw new Error(`Can't pick two of ${player.name}`);
    if (!canPlay(player.position, slot.pos)) {
      throw new Error(`${player.name} cannot play ${slot.pos}`);
    }

    usedSlots.add(slot.id);
    usedPlayers.add(player.id);
    usedNames.add(player.name);
    squad.push({
      slot: slot.id,
      slotPos: slot.pos,
      player_season_id: player.id,
      name: player.name,
      club: player.club,
      season: player.season,
      overall: player.overall,
      position: player.position,
    });
  }

  const strength = scoreTeam(squad, formation);
  const projected = projectSeason(strength);
  return { formation, squad, strength, projected };
}
