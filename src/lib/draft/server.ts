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
import { scoreTeam, projectSeason, canPlay, playerIdentity } from "./score";
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

// Win/loss/draw crediting + the team streak loop now live in one place — see
// `creditResult` and `applyTeamStreak` in live-server.ts (atomic W/D/L via the
// `draft_credit_result` RPC). The async/challenge routes use those too, so quick,
// async, challenge and live all share one standings path.

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
    // The same player appears across FIFA editions under different ids AND different
    // name strings ("Cristiano Ronaldo" vs "C. Ronaldo"), so de-dupe by canonical
    // identity, not exact name. Authoritative gate for every write path: team save,
    // live swap, and match.
    const identity = playerIdentity(player.name);
    if (usedNames.has(identity)) throw new Error(`Can't pick two of ${player.name}`);
    if (!canPlay(player.position, slot.pos)) {
      throw new Error(`${player.name} cannot play ${slot.pos}`);
    }

    usedSlots.add(slot.id);
    usedPlayers.add(player.id);
    usedNames.add(identity);
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
