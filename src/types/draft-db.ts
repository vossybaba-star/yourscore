/**
 * Typed Supabase access for the Draft XI tables.
 *
 * These tables + functions now exist in the generated `database.ts` (migrations
 * 14–22 applied + types regenerated Jun 2026), so this file is just a thin set of
 * row-type aliases derived from the generated types — kept so existing imports
 * (`DraftLiveMatchRow`, `DraftDatabase`, …) keep working. The earlier hand-written
 * shim has been retired now that the real generated types are the source of truth.
 */

import type { Database } from "./database";

type T = Database["public"]["Tables"];

export type DraftDatabase = Database;

export type DraftTeamRow = T["draft_teams"]["Row"];
export type DraftMatchRow = T["draft_matches"]["Row"];
export type DraftStandingRow = T["draft_standings"]["Row"];
export type DraftLiveMatchRow = T["draft_live_matches"]["Row"];
export type DraftLiveQueueRow = T["draft_live_queue"]["Row"];
export type DraftLeagueRow = T["draft_leagues"]["Row"];
export type DraftLeagueMemberRow = T["draft_league_members"]["Row"];
export type DraftChallengeRow = T["draft_challenges"]["Row"];
export type DraftSavedTeamRow = T["draft_saved_teams"]["Row"];
export type DraftShareRow = T["draft_shares"]["Row"];
