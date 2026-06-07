/**
 * Typed Supabase access for the Draft XI tables (supabase/migrations/14_draft_xi.sql).
 *
 * The generated `database.ts` is regenerated from the live DB and won't include
 * these tables until the migration is applied + types regenerated. This file
 * augments the base Database so the draft API routes typecheck today; once the
 * migration is live you can regenerate database.ts and delete this shim.
 */

import type { Database, Json } from "./database";

type Ts = string | null;

export type DraftTeamRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  formation: string;
  squad: Json;
  strength_rating: number;
  projected: Json;
  status: string;
  win_streak: number;
  updated_at: Ts;
  created_at: Ts;
};

export type DraftMatchRow = {
  id: string;
  challenger_id: string | null;
  opponent_id: string | null;
  challenger_team: Json;
  opponent_team: Json;
  challenger_strength: number;
  opponent_strength: number;
  winner_id: string;
  league_id: string | null;
  played_at: Ts;
};

export type DraftStandingRow = {
  user_id: string;
  display_name: string;
  league_id: string | null;
  wins_today: number;
  wins_all_time: number;
  last_win_date: Ts;
  updated_at: Ts;
};

export type DraftLeagueRow = {
  id: string;
  owner_id: string | null;
  name: string;
  join_code: string;
  created_at: Ts;
};

export type DraftLeagueMemberRow = {
  league_id: string;
  user_id: string;
  joined_at: Ts;
};

export type DraftChallengeRow = {
  id: string;
  code: string;
  challenger_id: string | null;
  challenger_name: string;
  challenger_team: Json;
  challenger_strength: number;
  league_id: string | null;
  status: string;
  match_id: string | null;
  created_at: Ts;
  expires_at: Ts;
};

type Tbl<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type DraftDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      draft_teams: Tbl<DraftTeamRow>;
      draft_matches: Tbl<DraftMatchRow>;
      draft_standings: Tbl<DraftStandingRow>;
      draft_leagues: Tbl<DraftLeagueRow>;
      draft_league_members: Tbl<DraftLeagueMemberRow>;
      draft_challenges: Tbl<DraftChallengeRow>;
    };
    Functions: Database["public"]["Functions"] & {
      draft_leaderboard: {
        Args: { p_league_id: string | null; p_metric: string; p_limit?: number };
        Returns: {
          user_id: string;
          display_name: string;
          wins_today: number;
          wins_all_time: number;
          rank: number;
        }[];
      };
      draft_reset_daily: { Args: Record<string, never>; Returns: undefined };
    };
  };
};
