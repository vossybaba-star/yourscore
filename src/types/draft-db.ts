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
  winner_id: string | null;          // null = draw (15_draft_live.sql)
  league_id: string | null;
  played_at: Ts;
  challenger_goals: number | null;   // two-half record
  opponent_goals: number | null;
  detail: Json | null;               // per-half + penalties breakdown
};

export type DraftStandingRow = {
  user_id: string;
  display_name: string;
  league_id: string | null;
  wins_today: number;
  wins_all_time: number;
  last_win_date: Ts;
  updated_at: Ts;
  draws_today: number;               // points ladder (15_draft_live.sql)
  draws_all_time: number;
  losses_today: number;
  losses_all_time: number;
  last_played_date: Ts;
};

// Live, simultaneous two-half H2H working state (15_draft_live.sql).
export type DraftLiveMatchRow = {
  id: string;
  phase: string;
  phase_deadline: Ts;
  join_code: string | null;
  ranked: boolean;
  league_id: string | null;
  is_bot: boolean;
  p1_id: string | null;
  p2_id: string | null;
  p1_ready: boolean;
  p2_ready: boolean;
  p1_squad: Json | null;
  p1_formation: string | null;
  p1_strength: number | null;
  p2_squad: Json | null;
  p2_formation: string | null;
  p2_strength: number | null;
  p1_name: string | null;
  p2_name: string | null;
  p1_pregame_left: number;
  p1_half_left: number;
  p2_pregame_left: number;
  p2_half_left: number;
  p1_wants_pens: boolean | null;
  p2_wants_pens: boolean | null;
  h1_p1: number | null;
  h1_p2: number | null;
  h2_p1: number | null;
  h2_p2: number | null;
  pens_p1: number | null;
  pens_p2: number | null;
  winner_id: string | null;
  created_at: Ts;
  updated_at: Ts;
  resolved_at: Ts;
};

export type DraftLiveQueueRow = {
  user_id: string;
  enqueued_at: Ts;
  ranked: boolean;
  league_id: string | null;
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

export type DraftSavedTeamRow = {
  id: string;
  user_id: string;
  name: string;
  formation: string;
  squad: Json;
  strength_rating: number;
  projected: Json | null;
  created_at: Ts;
  updated_at: Ts;
};

export type DraftShareRow = {
  id: string;
  payload: Json;
  created_at: Ts;
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
      draft_saved_teams: Tbl<DraftSavedTeamRow>;
      draft_shares: Tbl<DraftShareRow>;
      draft_matches: Tbl<DraftMatchRow>;
      draft_standings: Tbl<DraftStandingRow>;
      draft_leagues: Tbl<DraftLeagueRow>;
      draft_league_members: Tbl<DraftLeagueMemberRow>;
      draft_challenges: Tbl<DraftChallengeRow>;
      draft_live_matches: Tbl<DraftLiveMatchRow>;
      draft_live_queue: Tbl<DraftLiveQueueRow>;
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
      draft_leaderboard_points: {
        Args: { p_league_id: string | null; p_metric: string; p_limit?: number };
        Returns: {
          user_id: string;
          display_name: string;
          wins: number;
          draws: number;
          losses: number;
          points: number;
          rank: number;
        }[];
      };
      draft_live_pair: {
        Args: { p_user: string; p_ranked: boolean; p_league: string | null };
        Returns: string | null;
      };
      draft_live_reap: { Args: Record<string, never>; Returns: undefined };
      draft_reset_daily: { Args: Record<string, never>; Returns: undefined };
    };
  };
};
