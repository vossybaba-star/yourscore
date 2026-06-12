export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      answers: {
        Row: {
          answered_at: string | null
          id: string
          is_correct: boolean
          match_id: string | null
          points_awarded: number
          question_event_id: string | null
          room_id: string | null
          selected_answer: string
          time_taken_ms: number
          user_id: string | null
        }
        Insert: {
          answered_at?: string | null
          id?: string
          is_correct: boolean
          match_id?: string | null
          points_awarded: number
          question_event_id?: string | null
          room_id?: string | null
          selected_answer: string
          time_taken_ms: number
          user_id?: string | null
        }
        Update: {
          answered_at?: string | null
          id?: string
          is_correct?: boolean
          match_id?: string | null
          points_awarded?: number
          question_event_id?: string | null
          room_id?: string | null
          selected_answer?: string
          time_taken_ms?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "answers_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_question_event_id_fkey"
            columns: ["question_event_id"]
            isOneToOne: false
            referencedRelation: "question_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      challenge_attempts: {
        Row: {
          answers: Json | null
          challenge_id: string
          completed_at: string | null
          created_at: string
          id: string
          max_score: number
          score: number
          user_id: string
        }
        Insert: {
          answers?: Json | null
          challenge_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id: string
        }
        Update: {
          answers?: Json | null
          challenge_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_attempts_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      challenge_questions: {
        Row: {
          category: string | null
          challenge_id: string
          correct_answer: string
          created_at: string
          difficulty: string
          id: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          question_number: number
          question_text: string
        }
        Insert: {
          category?: string | null
          challenge_id: string
          correct_answer: string
          created_at?: string
          difficulty: string
          id?: string
          option_a: string
          option_b: string
          option_c: string
          option_d: string
          question_number: number
          question_text: string
        }
        Update: {
          category?: string | null
          challenge_id?: string
          correct_answer?: string
          created_at?: string
          difficulty?: string
          id?: string
          option_a?: string
          option_b?: string
          option_c?: string
          option_d?: string
          question_number?: number
          question_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_questions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          league: string
          question_count: number
          season: string
          slug: string
          team_name: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          league?: string
          question_count?: number
          season?: string
          slug: string
          team_name: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          league?: string
          question_count?: number
          season?: string
          slug?: string
          team_name?: string
          title?: string
        }
        Relationships: []
      }
      club_event_attempts: {
        Row: {
          answers: Json | null
          completed_at: string
          correct_count: number
          event_id: string
          id: string
          max_score: number
          score: number
          user_id: string
        }
        Insert: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          event_id: string
          id?: string
          max_score?: number
          score?: number
          user_id: string
        }
        Update: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          event_id?: string
          id?: string
          max_score?: number
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_event_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "club_league_events"
            referencedColumns: ["id"]
          },
        ]
      }
      club_league_events: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          ends_at: string
          id: string
          league_id: string
          pack_id: string | null
          prize_text: string | null
          questions: Json
          starts_at: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          ends_at: string
          id?: string
          league_id: string
          pack_id?: string | null
          prize_text?: string | null
          questions: Json
          starts_at: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string
          id?: string
          league_id?: string
          pack_id?: string | null
          prize_text?: string | null
          questions?: Json
          starts_at?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_league_events_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "club_leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_league_events_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "quiz_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      club_league_members: {
        Row: {
          joined_at: string
          league_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          league_id: string
          role?: string
          user_id: string
        }
        Update: {
          joined_at?: string
          league_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "club_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      club_leagues: {
        Row: {
          announcement: string | null
          brand_color: string | null
          cover_url: string | null
          created_at: string
          id: string
          is_active: boolean
          join_code: string
          logo_url: string | null
          name: string
          owner_id: string
          prize_text: string | null
          slug: string
          tier: string
          welcome_text: string | null
        }
        Insert: {
          announcement?: string | null
          brand_color?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          join_code: string
          logo_url?: string | null
          name: string
          owner_id: string
          prize_text?: string | null
          slug: string
          tier?: string
          welcome_text?: string | null
        }
        Update: {
          announcement?: string | null
          brand_color?: string | null
          cover_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          join_code?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          prize_text?: string | null
          slug?: string
          tier?: string
          welcome_text?: string | null
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string | null
          id: string
          platform: string
          token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          platform: string
          token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      draft_challenges: {
        Row: {
          challenger_id: string | null
          challenger_name: string
          challenger_strength: number
          challenger_team: Json
          code: string
          competition: string
          created_at: string | null
          expires_at: string | null
          id: string
          league_id: string | null
          match_id: string | null
          status: string
        }
        Insert: {
          challenger_id?: string | null
          challenger_name: string
          challenger_strength: number
          challenger_team: Json
          code: string
          competition?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          league_id?: string | null
          match_id?: string | null
          status?: string
        }
        Update: {
          challenger_id?: string | null
          challenger_name?: string
          challenger_strength?: number
          challenger_team?: Json
          code?: string
          competition?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          league_id?: string | null
          match_id?: string | null
          status?: string
        }
        Relationships: []
      }
      draft_league_members: {
        Row: {
          joined_at: string | null
          last_seen_at: string | null
          league_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string | null
          last_seen_at?: string | null
          league_id: string
          user_id: string
        }
        Update: {
          joined_at?: string | null
          last_seen_at?: string | null
          league_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "draft_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_leagues: {
        Row: {
          created_at: string | null
          id: string
          join_code: string
          name: string
          owner_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          join_code: string
          name: string
          owner_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          join_code?: string
          name?: string
          owner_id?: string | null
        }
        Relationships: []
      }
      draft_live_matches: {
        Row: {
          competition: string
          created_at: string
          h1_p1: number | null
          h1_p2: number | null
          h2_p1: number | null
          h2_p2: number | null
          id: string
          invited_id: string | null
          is_bot: boolean
          join_code: string | null
          league_id: string | null
          p1_competition: string
          p1_formation: string | null
          p1_half_left: number
          p1_id: string | null
          p1_name: string | null
          p1_pregame_left: number
          p1_ready: boolean
          p1_squad: Json | null
          p1_strength: number | null
          p1_sub_ids: Json
          p1_wants_pens: boolean | null
          p2_competition: string
          p2_formation: string | null
          p2_half_left: number
          p2_id: string | null
          p2_name: string | null
          p2_pregame_left: number
          p2_ready: boolean
          p2_squad: Json | null
          p2_strength: number | null
          p2_sub_ids: Json
          p2_wants_pens: boolean | null
          pens_p1: number | null
          pens_p2: number | null
          phase: string
          phase_deadline: string | null
          ranked: boolean
          resolved_at: string | null
          sim: Json | null
          updated_at: string
          winner_id: string | null
        }
        Insert: {
          competition?: string
          created_at?: string
          h1_p1?: number | null
          h1_p2?: number | null
          h2_p1?: number | null
          h2_p2?: number | null
          id?: string
          invited_id?: string | null
          is_bot?: boolean
          join_code?: string | null
          league_id?: string | null
          p1_competition?: string
          p1_formation?: string | null
          p1_half_left?: number
          p1_id?: string | null
          p1_name?: string | null
          p1_pregame_left?: number
          p1_ready?: boolean
          p1_squad?: Json | null
          p1_strength?: number | null
          p1_sub_ids?: Json
          p1_wants_pens?: boolean | null
          p2_competition?: string
          p2_formation?: string | null
          p2_half_left?: number
          p2_id?: string | null
          p2_name?: string | null
          p2_pregame_left?: number
          p2_ready?: boolean
          p2_squad?: Json | null
          p2_strength?: number | null
          p2_sub_ids?: Json
          p2_wants_pens?: boolean | null
          pens_p1?: number | null
          pens_p2?: number | null
          phase?: string
          phase_deadline?: string | null
          ranked?: boolean
          resolved_at?: string | null
          sim?: Json | null
          updated_at?: string
          winner_id?: string | null
        }
        Update: {
          competition?: string
          created_at?: string
          h1_p1?: number | null
          h1_p2?: number | null
          h2_p1?: number | null
          h2_p2?: number | null
          id?: string
          invited_id?: string | null
          is_bot?: boolean
          join_code?: string | null
          league_id?: string | null
          p1_competition?: string
          p1_formation?: string | null
          p1_half_left?: number
          p1_id?: string | null
          p1_name?: string | null
          p1_pregame_left?: number
          p1_ready?: boolean
          p1_squad?: Json | null
          p1_strength?: number | null
          p1_sub_ids?: Json
          p1_wants_pens?: boolean | null
          p2_competition?: string
          p2_formation?: string | null
          p2_half_left?: number
          p2_id?: string | null
          p2_name?: string | null
          p2_pregame_left?: number
          p2_ready?: boolean
          p2_squad?: Json | null
          p2_strength?: number | null
          p2_sub_ids?: Json
          p2_wants_pens?: boolean | null
          pens_p1?: number | null
          pens_p2?: number | null
          phase?: string
          phase_deadline?: string | null
          ranked?: boolean
          resolved_at?: string | null
          sim?: Json | null
          updated_at?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_live_matches_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "draft_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_live_queue: {
        Row: {
          competition: string
          enqueued_at: string
          league_id: string | null
          ranked: boolean
          user_id: string
        }
        Insert: {
          competition?: string
          enqueued_at?: string
          league_id?: string | null
          ranked?: boolean
          user_id: string
        }
        Update: {
          competition?: string
          enqueued_at?: string
          league_id?: string | null
          ranked?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_live_queue_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "draft_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_matches: {
        Row: {
          challenger_goals: number | null
          challenger_id: string | null
          challenger_strength: number
          challenger_team: Json
          competition: string
          detail: Json | null
          id: string
          league_id: string | null
          opponent_goals: number | null
          opponent_id: string | null
          opponent_strength: number
          opponent_team: Json
          played_at: string | null
          winner_id: string | null
        }
        Insert: {
          challenger_goals?: number | null
          challenger_id?: string | null
          challenger_strength: number
          challenger_team: Json
          competition?: string
          detail?: Json | null
          id?: string
          league_id?: string | null
          opponent_goals?: number | null
          opponent_id?: string | null
          opponent_strength: number
          opponent_team: Json
          played_at?: string | null
          winner_id?: string | null
        }
        Update: {
          challenger_goals?: number | null
          challenger_id?: string | null
          challenger_strength?: number
          challenger_team?: Json
          competition?: string
          detail?: Json | null
          id?: string
          league_id?: string | null
          opponent_goals?: number | null
          opponent_id?: string | null
          opponent_strength?: number
          opponent_team?: Json
          played_at?: string | null
          winner_id?: string | null
        }
        Relationships: []
      }
      draft_saved_teams: {
        Row: {
          competition: string
          created_at: string | null
          formation: string
          id: string
          name: string
          projected: Json | null
          squad: Json
          strength_rating: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          competition?: string
          created_at?: string | null
          formation: string
          id?: string
          name: string
          projected?: Json | null
          squad: Json
          strength_rating: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          competition?: string
          created_at?: string | null
          formation?: string
          id?: string
          name?: string
          projected?: Json | null
          squad?: Json
          strength_rating?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      draft_season_records: {
        Row: {
          competition: string
          created_at: string
          display_name: string
          draws: number
          formation: string | null
          ga: number
          gf: number
          id: string
          invincible: boolean
          league_pos: number
          losses: number
          points: number
          seed: string
          strength: number
          user_id: string
          wins: number
        }
        Insert: {
          competition?: string
          created_at?: string
          display_name?: string
          draws: number
          formation?: string | null
          ga?: number
          gf?: number
          id?: string
          invincible?: boolean
          league_pos: number
          losses: number
          points: number
          seed: string
          strength?: number
          user_id: string
          wins: number
        }
        Update: {
          competition?: string
          created_at?: string
          display_name?: string
          draws?: number
          formation?: string | null
          ga?: number
          gf?: number
          id?: string
          invincible?: boolean
          league_pos?: number
          losses?: number
          points?: number
          seed?: string
          strength?: number
          user_id?: string
          wins?: number
        }
        Relationships: []
      }
      draft_shares: {
        Row: {
          created_at: string | null
          id: string
          payload: Json
        }
        Insert: {
          created_at?: string | null
          id: string
          payload: Json
        }
        Update: {
          created_at?: string | null
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      draft_standings: {
        Row: {
          competition: string
          display_name: string
          draws_all_time: number
          draws_today: number
          last_played_date: string | null
          last_win_date: string | null
          league_id: string
          losses_all_time: number
          losses_today: number
          updated_at: string | null
          user_id: string
          wins_all_time: number
          wins_today: number
        }
        Insert: {
          competition?: string
          display_name: string
          draws_all_time?: number
          draws_today?: number
          last_played_date?: string | null
          last_win_date?: string | null
          league_id?: string
          losses_all_time?: number
          losses_today?: number
          updated_at?: string | null
          user_id: string
          wins_all_time?: number
          wins_today?: number
        }
        Update: {
          competition?: string
          display_name?: string
          draws_all_time?: number
          draws_today?: number
          last_played_date?: string | null
          last_win_date?: string | null
          league_id?: string
          losses_all_time?: number
          losses_today?: number
          updated_at?: string | null
          user_id?: string
          wins_all_time?: number
          wins_today?: number
        }
        Relationships: []
      }
      draft_teams: {
        Row: {
          competition: string
          created_at: string | null
          display_name: string | null
          formation: string
          id: string
          projected: Json
          squad: Json
          status: string
          strength_rating: number
          updated_at: string | null
          user_id: string | null
          win_streak: number
        }
        Insert: {
          competition?: string
          created_at?: string | null
          display_name?: string | null
          formation: string
          id?: string
          projected: Json
          squad: Json
          status?: string
          strength_rating: number
          updated_at?: string | null
          user_id?: string | null
          win_streak?: number
        }
        Update: {
          competition?: string
          created_at?: string | null
          display_name?: string | null
          formation?: string
          id?: string
          projected?: Json
          squad?: Json
          status?: string
          strength_rating?: number
          updated_at?: string | null
          user_id?: string | null
          win_streak?: number
        }
        Relationships: []
      }
      draft_wc_matches: {
        Row: {
          detail: Json | null
          id: string
          idx: number
          opp_goals: number
          opponent_crest: string | null
          opponent_nation: string
          opponent_strength: number
          pens_opp: number | null
          pens_you: number | null
          played_at: string
          run_id: string
          stage: string
          won: boolean | null
          you_goals: number
        }
        Insert: {
          detail?: Json | null
          id?: string
          idx?: number
          opp_goals: number
          opponent_crest?: string | null
          opponent_nation: string
          opponent_strength: number
          pens_opp?: number | null
          pens_you?: number | null
          played_at?: string
          run_id: string
          stage: string
          won?: boolean | null
          you_goals: number
        }
        Update: {
          detail?: Json | null
          id?: string
          idx?: number
          opp_goals?: number
          opponent_crest?: string | null
          opponent_nation?: string
          opponent_strength?: number
          pens_opp?: number | null
          pens_you?: number | null
          played_at?: string
          run_id?: string
          stage?: string
          won?: boolean | null
          you_goals?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_wc_matches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "draft_wc_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_wc_runs: {
        Row: {
          created_at: string
          formation: string
          group_played: number
          group_points: number
          id: string
          mode: string
          nation: string
          plan: Json
          resolved_at: string | null
          seed: string
          squad: Json
          stage: string
          stage_index: number
          status: string
          strength: number
          updated_at: string
          upgrades_left: number
          user_id: string
        }
        Insert: {
          created_at?: string
          formation: string
          group_played?: number
          group_points?: number
          id?: string
          mode?: string
          nation: string
          plan: Json
          resolved_at?: string | null
          seed: string
          squad: Json
          stage?: string
          stage_index?: number
          status?: string
          strength?: number
          updated_at?: string
          upgrades_left?: number
          user_id: string
        }
        Update: {
          created_at?: string
          formation?: string
          group_played?: number
          group_points?: number
          id?: string
          mode?: string
          nation?: string
          plan?: Json
          resolved_at?: string | null
          seed?: string
          squad?: Json
          stage?: string
          stage_index?: number
          status?: string
          strength?: number
          updated_at?: string
          upgrades_left?: number
          user_id?: string
        }
        Relationships: []
      }
      fire_queues: {
        Row: {
          created_at: string | null
          id: string
          match_id: string
          position: number
          question_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_id: string
          position?: number
          question_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_id?: string
          position?: number
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fire_queues_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fire_queues_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string | null
          friend_id: string
          id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          friend_id: string
          id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          friend_id?: string
          id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      h2h_challenges: {
        Row: {
          challenger_correct: number
          challenger_id: string
          challenger_name: string
          challenger_score: number
          created_at: string | null
          expires_at: string | null
          id: string
          max_score: number
          opponent_correct: number | null
          opponent_id: string | null
          opponent_score: number | null
          quiz_pack_id: string
          quiz_pack_name: string
          total_questions: number
        }
        Insert: {
          challenger_correct: number
          challenger_id: string
          challenger_name: string
          challenger_score: number
          created_at?: string | null
          expires_at?: string | null
          id?: string
          max_score: number
          opponent_correct?: number | null
          opponent_id?: string | null
          opponent_score?: number | null
          quiz_pack_id: string
          quiz_pack_name: string
          total_questions: number
        }
        Update: {
          challenger_correct?: number
          challenger_id?: string
          challenger_name?: string
          challenger_score?: number
          created_at?: string | null
          expires_at?: string | null
          id?: string
          max_score?: number
          opponent_correct?: number | null
          opponent_id?: string | null
          opponent_score?: number | null
          quiz_pack_id?: string
          quiz_pack_name?: string
          total_questions?: number
        }
        Relationships: []
      }
      health_logs: {
        Row: {
          checked_at: string | null
          checks: Json
          duration_ms: number | null
          id: string
          overall: string
        }
        Insert: {
          checked_at?: string | null
          checks: Json
          duration_ms?: number | null
          id?: string
          overall: string
        }
        Update: {
          checked_at?: string | null
          checks?: Json
          duration_ms?: number | null
          id?: string
          overall?: string
        }
        Relationships: []
      }
      league_members: {
        Row: {
          best_streak: number | null
          current_streak: number | null
          games_played: number | null
          joined_at: string | null
          league_id: string
          questions_attempted: number | null
          questions_correct: number | null
          total_score: number | null
          user_id: string
        }
        Insert: {
          best_streak?: number | null
          current_streak?: number | null
          games_played?: number | null
          joined_at?: string | null
          league_id: string
          questions_attempted?: number | null
          questions_correct?: number | null
          total_score?: number | null
          user_id: string
        }
        Update: {
          best_streak?: number | null
          current_streak?: number | null
          games_played?: number | null
          joined_at?: string | null
          league_id?: string
          questions_attempted?: number | null
          questions_correct?: number | null
          total_score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      match_interests: {
        Row: {
          created_at: string | null
          id: string
          match_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_interests_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_notifications: {
        Row: {
          created_at: string | null
          id: string
          match_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          match_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          match_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_notifications_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_scores: {
        Row: {
          best_streak: number
          correct_answers: number
          current_streak: number
          match_id: string
          rank: number | null
          total_answers: number
          total_score: number
          updated_at: string | null
          user_id: string
          wrong_streak: number
        }
        Insert: {
          best_streak?: number
          correct_answers?: number
          current_streak?: number
          match_id: string
          rank?: number | null
          total_answers?: number
          total_score?: number
          updated_at?: string | null
          user_id: string
          wrong_streak?: number
        }
        Update: {
          best_streak?: number
          correct_answers?: number
          current_streak?: number
          match_id?: string
          rank?: number | null
          total_answers?: number
          total_score?: number
          updated_at?: string | null
          user_id?: string
          wrong_streak?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_scores_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          api_match_id: string | null
          away_score: number | null
          away_team: string
          created_at: string | null
          home_score: number | null
          home_team: string
          id: string
          match_date: string
          status: string | null
          tournament: string | null
        }
        Insert: {
          api_match_id?: string | null
          away_score?: number | null
          away_team: string
          created_at?: string | null
          home_score?: number | null
          home_team: string
          id?: string
          match_date: string
          status?: string | null
          tournament?: string | null
        }
        Update: {
          api_match_id?: string | null
          away_score?: number | null
          away_team?: string
          created_at?: string | null
          home_score?: number | null
          home_team?: string
          id?: string
          match_date?: string
          status?: string | null
          tournament?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          recipient_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          recipient_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          games_played: number | null
          id: string
          social_handle: string | null
          social_platform: string | null
          total_score: number | null
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          games_played?: number | null
          id: string
          social_handle?: string | null
          social_platform?: string | null
          total_score?: number | null
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          games_played?: number | null
          id?: string
          social_handle?: string | null
          social_platform?: string | null
          total_score?: number | null
          username?: string | null
        }
        Relationships: []
      }
      question_events: {
        Row: {
          closes_at: string
          fired_at: string | null
          id: string
          match_id: string | null
          question_id: string | null
          room_id: string | null
          sequence_number: number | null
          status: string | null
        }
        Insert: {
          closes_at: string
          fired_at?: string | null
          id?: string
          match_id?: string | null
          question_id?: string | null
          room_id?: string | null
          sequence_number?: number | null
          status?: string | null
        }
        Update: {
          closes_at?: string
          fired_at?: string | null
          id?: string
          match_id?: string | null
          question_id?: string | null
          room_id?: string | null
          sequence_number?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          answer: string
          category: string
          created_at: string | null
          difficulty: string
          entity: string
          entity_type: string
          era: string | null
          id: string
          options: Json
          question: string
          source: string | null
          source_pack_id: string | null
          status: string | null
          tags: string[] | null
          times_answered: number
          times_correct: number
          verification_note: string | null
        }
        Insert: {
          answer: string
          category: string
          created_at?: string | null
          difficulty: string
          entity: string
          entity_type: string
          era?: string | null
          id?: string
          options: Json
          question: string
          source?: string | null
          source_pack_id?: string | null
          status?: string | null
          tags?: string[] | null
          times_answered?: number
          times_correct?: number
          verification_note?: string | null
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string | null
          difficulty?: string
          entity?: string
          entity_type?: string
          era?: string | null
          id?: string
          options?: Json
          question?: string
          source?: string | null
          source_pack_id?: string | null
          status?: string | null
          tags?: string[] | null
          times_answered?: number
          times_correct?: number
          verification_note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_source_pack_id_fkey"
            columns: ["source_pack_id"]
            isOneToOne: false
            referencedRelation: "quiz_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          answers: Json | null
          completed_at: string
          correct_count: number
          id: string
          max_score: number
          pack_id: string
          score: number
          user_id: string
        }
        Insert: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          id?: string
          max_score?: number
          pack_id: string
          score?: number
          user_id: string
        }
        Update: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          id?: string
          max_score?: number
          pack_id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "quiz_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      quiz_packs: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          difficulty_focus: string | null
          featured: boolean
          featured_order: number | null
          id: string
          is_custom: boolean
          metadata: Json | null
          name: string
          parameter: string
          play_count: number
          question_count: number | null
          questions: Json
          rotation_active: boolean | null
          rotation_order: number | null
          source: string
          status: string
          tags: string[] | null
          title: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty_focus?: string | null
          featured?: boolean
          featured_order?: number | null
          id?: string
          is_custom?: boolean
          metadata?: Json | null
          name: string
          parameter: string
          play_count?: number
          question_count?: number | null
          questions: Json
          rotation_active?: boolean | null
          rotation_order?: number | null
          source?: string
          status?: string
          tags?: string[] | null
          title?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          difficulty_focus?: string | null
          featured?: boolean
          featured_order?: number | null
          id?: string
          is_custom?: boolean
          metadata?: Json | null
          name?: string
          parameter?: string
          play_count?: number
          question_count?: number | null
          questions?: Json
          rotation_active?: boolean | null
          rotation_order?: number | null
          source?: string
          status?: string
          tags?: string[] | null
          title?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start?: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      room_members: {
        Row: {
          id: string
          joined_at: string | null
          last_seen_at: string | null
          notification_consent: boolean | null
          room_id: string | null
          user_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          id?: string
          joined_at?: string | null
          last_seen_at?: string | null
          notification_consent?: boolean | null
          room_id?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          id?: string
          joined_at?: string | null
          last_seen_at?: string | null
          notification_consent?: boolean | null
          room_id?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      room_scores: {
        Row: {
          avg_answer_speed_ms: number | null
          best_streak: number | null
          correct_answers: number | null
          current_streak: number | null
          fastest_answer_ms: number | null
          id: string
          rank: number | null
          room_id: string | null
          total_answers: number | null
          total_score: number | null
          updated_at: string | null
          user_id: string | null
          wrong_streak: number
        }
        Insert: {
          avg_answer_speed_ms?: number | null
          best_streak?: number | null
          correct_answers?: number | null
          current_streak?: number | null
          fastest_answer_ms?: number | null
          id?: string
          rank?: number | null
          room_id?: string | null
          total_answers?: number | null
          total_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          wrong_streak?: number
        }
        Update: {
          avg_answer_speed_ms?: number | null
          best_streak?: number | null
          correct_answers?: number | null
          current_streak?: number | null
          fastest_answer_ms?: number | null
          id?: string
          rank?: number | null
          room_id?: string | null
          total_answers?: number | null
          total_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          wrong_streak?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_scores_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      rooms: {
        Row: {
          category_filter: string | null
          code: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          current_question_idx: number
          difficulty_filter: string
          id: string
          is_public: boolean | null
          match_id: string | null
          max_players: number | null
          name: string
          pack_id: string | null
          prize_description: string | null
          question_count: number
          question_started_at: string | null
          questions_json: Json | null
          room_mode: string
          sponsor_logo_url: string | null
          sponsor_name: string | null
          status: string | null
          type: string | null
          whatsapp_channel_id: string | null
        }
        Insert: {
          category_filter?: string | null
          code: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_question_idx?: number
          difficulty_filter?: string
          id?: string
          is_public?: boolean | null
          match_id?: string | null
          max_players?: number | null
          name: string
          pack_id?: string | null
          prize_description?: string | null
          question_count?: number
          question_started_at?: string | null
          questions_json?: Json | null
          room_mode?: string
          sponsor_logo_url?: string | null
          sponsor_name?: string | null
          status?: string | null
          type?: string | null
          whatsapp_channel_id?: string | null
        }
        Update: {
          category_filter?: string | null
          code?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          current_question_idx?: number
          difficulty_filter?: string
          id?: string
          is_public?: boolean | null
          match_id?: string | null
          max_players?: number | null
          name?: string
          pack_id?: string | null
          prize_description?: string | null
          question_count?: number
          question_started_at?: string | null
          questions_json?: Json | null
          room_mode?: string
          sponsor_logo_url?: string | null
          sponsor_name?: string | null
          status?: string | null
          type?: string | null
          whatsapp_channel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rooms_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      spend_logs: {
        Row: {
          amount_gbp: number
          created_at: string | null
          date: string
          id: string
          notes: string | null
          platform: string
        }
        Insert: {
          amount_gbp: number
          created_at?: string | null
          date: string
          id?: string
          notes?: string | null
          platform: string
        }
        Update: {
          amount_gbp?: number
          created_at?: string | null
          date?: string
          id?: string
          notes?: string | null
          platform?: string
        }
        Relationships: []
      }
      user_question_history: {
        Row: {
          correct: boolean | null
          entity: string
          id: string
          played_at: string | null
          question_id: string
          user_id: string
        }
        Insert: {
          correct?: boolean | null
          entity: string
          id?: string
          played_at?: string | null
          question_id: string
          user_id: string
        }
        Update: {
          correct?: boolean | null
          entity?: string
          id?: string
          played_at?: string | null
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_question_history_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      yourscore_user_ratings: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          draws: number | null
          knowledge_score: number | null
          losses: number | null
          match_score: number | null
          overall_rank: number | null
          overall_score: number | null
          user_id: string | null
          wins: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_timeout_penalty: {
        Args: { p_penalty: number; p_room_id: string; p_user_ids: string[] }
        Returns: undefined
      }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      draft_credit_result: {
        Args: {
          p_competition?: string
          p_league?: string
          p_name: string
          p_result: string
          p_user: string
        }
        Returns: undefined
      }
      draft_leaderboard: {
        Args: { p_league_id: string; p_limit?: number; p_metric: string }
        Returns: {
          display_name: string
          rank: number
          user_id: string
          wins_all_time: number
          wins_today: number
        }[]
      }
      draft_leaderboard_points: {
        Args: {
          p_competition?: string
          p_league_id: string
          p_limit?: number
          p_metric: string
        }
        Returns: {
          display_name: string
          draws: number
          losses: number
          points: number
          rank: number
          user_id: string
          wins: number
        }[]
      }
      draft_live_pair: {
        Args: {
          p_competition?: string
          p_league: string
          p_ranked: boolean
          p_user: string
        }
        Returns: {
          opp_user: string
          opp_competition: string
        }[]
      }
      draft_live_reap: { Args: never; Returns: undefined }
      draft_reset_daily: { Args: never; Returns: undefined }
      draft_season_leaderboard: {
        Args: { p_competition?: string; p_limit?: number }
        Returns: {
          created_at: string
          display_name: string
          draws: number
          invincible: boolean
          league_pos: number
          losses: number
          points: number
          strength: number
          user_id: string
          wins: number
        }[]
      }
      draft_wc_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          display_name: string
          games: number
          nation: string
          status: string
          user_id: string
          wins: number
        }[]
      }
      get_club_league_feed: {
        Args: { p_league_id: string; p_limit?: number }
        Returns: {
          kind: string
          user_id: string
          display_name: string
          avatar_url: string | null
          detail: Json
          created_at: string
        }[]
      }
      get_my_league_standings: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          display_name: string
          league_id: string
          league_name: string
          total_score: number
          user_id: string
        }[]
      }
      get_my_leagues: {
        Args: { p_user_id: string }
        Returns: {
          code: string
          description: string
          id: string
          member_count: number
          my_rank: number
          my_score: number
          name: string
        }[]
      }
      get_yourscore_leaderboard: {
        Args: { p_limit?: number; p_user_ids?: string[] }
        Returns: {
          avatar_url: string
          display_name: string
          draws: number
          knowledge_score: number
          losses: number
          match_score: number
          overall_rank: number
          overall_score: number
          user_id: string
          wins: number
        }[]
      }
      get_yourscore_rank: {
        Args: { p_user_id: string }
        Returns: {
          ahead_name: string
          ahead_points: number
          avatar_url: string
          display_name: string
          draws: number
          knowledge_score: number
          losses: number
          match_score: number
          overall_rank: number
          overall_score: number
          user_id: string
          wins: number
        }[]
      }
      increment_profile_score: {
        Args: { p_points: number; p_user_id: string }
        Returns: undefined
      }
      increment_question_stats: {
        Args: { correct_ids: string[]; question_ids: string[] }
        Returns: undefined
      }
      record_quiz_results: {
        Args: { p_correct: string[]; p_qids: string[]; p_user: string }
        Returns: undefined
      }
      update_league_member_stats: {
        Args: { p_is_correct: boolean; p_points: number; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
