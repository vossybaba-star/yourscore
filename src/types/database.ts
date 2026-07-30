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
      admin_chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          role: string
          status: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          role: string
          status?: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
      club_supporters: {
        Row: {
          changed_at: string
          club: string
          created_at: string
          season_id: number
          user_id: string
        }
        Insert: {
          changed_at?: string
          club: string
          created_at?: string
          season_id: number
          user_id: string
        }
        Update: {
          changed_at?: string
          club?: string
          created_at?: string
          season_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_supporters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_supporters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "club_supporters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_id: string | null
          subject_id: string
          subject_type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          subject_id: string
          subject_type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          subject_id?: string
          subject_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_games: {
        Row: {
          created_at: string
          day: string
          game_type: string
          pack_id: string | null
          source: string
        }
        Insert: {
          created_at?: string
          day: string
          game_type: string
          pack_id?: string | null
          source?: string
        }
        Update: {
          created_at?: string
          day?: string
          game_type?: string
          pack_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_games_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "quiz_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      debate_anon_votes: {
        Row: {
          created_at: string
          debate_id: string
          option_idx: number
          voter_key: string
        }
        Insert: {
          created_at?: string
          debate_id: string
          option_idx: number
          voter_key: string
        }
        Update: {
          created_at?: string
          debate_id?: string
          option_idx?: number
          voter_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "debate_anon_votes_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "debates"
            referencedColumns: ["id"]
          },
        ]
      }
      debate_votes: {
        Row: {
          created_at: string
          debate_id: string
          option_idx: number
          user_id: string
        }
        Insert: {
          created_at?: string
          debate_id: string
          option_idx: number
          user_id: string
        }
        Update: {
          created_at?: string
          debate_id?: string
          option_idx?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debate_votes_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "debates"
            referencedColumns: ["id"]
          },
        ]
      }
      debates: {
        Row: {
          active: boolean
          created_at: string
          day: string | null
          id: string
          options: Json
          question: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          day?: string | null
          id?: string
          options: Json
          question: string
        }
        Update: {
          active?: boolean
          created_at?: string
          day?: string | null
          id?: string
          options?: Json
          question?: string
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
          featured: boolean
          id: string
          is_public: boolean
          join_code: string
          name: string
          owner_id: string | null
        }
        Insert: {
          created_at?: string | null
          featured?: boolean
          id?: string
          is_public?: boolean
          join_code: string
          name: string
          owner_id?: string | null
        }
        Update: {
          created_at?: string | null
          featured?: boolean
          id?: string
          is_public?: boolean
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
          p1_kicks: Json
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
          p2_kicks: Json
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
          p1_kicks?: Json
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
          p2_kicks?: Json
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
          p1_kicks?: Json
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
          p2_kicks?: Json
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
      draft_wc_daily_locks: {
        Row: {
          created_at: string
          picks: number
          run_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          picks?: number
          run_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          picks?: number
          run_date?: string
          user_id?: string
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
          pens_state: Json | null
          plan: Json
          quiz_answers: Json | null
          quiz_correct: number | null
          quiz_total: number | null
          ranked: boolean
          resolved_at: string | null
          run_date: string | null
          seed: string
          source: string | null
          squad: Json
          stage: string
          stage_index: number
          status: string
          strength: number
          updated_at: string
          upgrades_left: number
          user_id: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          created_at?: string
          formation: string
          group_played?: number
          group_points?: number
          id?: string
          mode?: string
          nation: string
          pens_state?: Json | null
          plan: Json
          quiz_answers?: Json | null
          quiz_correct?: number | null
          quiz_total?: number | null
          ranked?: boolean
          resolved_at?: string | null
          run_date?: string | null
          seed: string
          source?: string | null
          squad: Json
          stage?: string
          stage_index?: number
          status?: string
          strength?: number
          updated_at?: string
          upgrades_left?: number
          user_id: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          created_at?: string
          formation?: string
          group_played?: number
          group_points?: number
          id?: string
          mode?: string
          nation?: string
          pens_state?: Json | null
          plan?: Json
          quiz_answers?: Json | null
          quiz_correct?: number | null
          quiz_total?: number | null
          ranked?: boolean
          resolved_at?: string | null
          run_date?: string | null
          seed?: string
          source?: string | null
          squad?: Json
          stage?: string
          stage_index?: number
          status?: string
          strength?: number
          updated_at?: string
          upgrades_left?: number
          user_id?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: []
      }
      email_engagement: {
        Row: {
          email: string
          last_clicked_at: string | null
          last_opened_at: string | null
          updated_at: string
        }
        Insert: {
          email: string
          last_clicked_at?: string | null
          last_opened_at?: string | null
          updated_at?: string
        }
        Update: {
          email?: string
          last_clicked_at?: string | null
          last_opened_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          sent_at: string
          template: string
          user_id: string
        }
        Insert: {
          sent_at?: string
          template: string
          user_id: string
        }
        Update: {
          sent_at?: string
          template?: string
          user_id?: string
        }
        Relationships: []
      }
      email_sends: {
        Row: {
          campaign_key: string
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          campaign_key: string
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          campaign_key?: string
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          detail: string | null
          email: string
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          email: string
          id?: string
          reason: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          email?: string
          id?: string
          reason?: string
        }
        Relationships: []
      }
      fantasy_captain_experiment: {
        Row: {
          arm: string
          assigned_at: string
          assigned_gw: number | null
          assignment_version: string
          experiment_id: string
          user_id: string
        }
        Insert: {
          arm: string
          assigned_at?: string
          assigned_gw?: number | null
          assignment_version?: string
          experiment_id?: string
          user_id: string
        }
        Update: {
          arm?: string
          assigned_at?: string
          assigned_gw?: number | null
          assignment_version?: string
          experiment_id?: string
          user_id?: string
        }
        Relationships: []
      }
      fantasy_captain_funnel: {
        Row: {
          blocked_after_deadline: boolean | null
          captain_applied: boolean | null
          confirmation_opened: boolean | null
          dismissed: boolean | null
          eligible: boolean | null
          first_seen_at: string | null
          gameweek: number
          is_rehearsal: boolean
          prepare_clicked: boolean | null
          recommendation_expanded: boolean | null
          recommendation_followed_at_deadline: boolean | null
          recommendation_generated: boolean | null
          recommendation_scored: boolean | null
          recommendation_viewed: boolean | null
          refresh_required: boolean | null
          updated_at: string
          user_id: string
          vice_applied: boolean | null
        }
        Insert: {
          blocked_after_deadline?: boolean | null
          captain_applied?: boolean | null
          confirmation_opened?: boolean | null
          dismissed?: boolean | null
          eligible?: boolean | null
          first_seen_at?: string | null
          gameweek: number
          is_rehearsal?: boolean
          prepare_clicked?: boolean | null
          recommendation_expanded?: boolean | null
          recommendation_followed_at_deadline?: boolean | null
          recommendation_generated?: boolean | null
          recommendation_scored?: boolean | null
          recommendation_viewed?: boolean | null
          refresh_required?: boolean | null
          updated_at?: string
          user_id: string
          vice_applied?: boolean | null
        }
        Update: {
          blocked_after_deadline?: boolean | null
          captain_applied?: boolean | null
          confirmation_opened?: boolean | null
          dismissed?: boolean | null
          eligible?: boolean | null
          first_seen_at?: string | null
          gameweek?: number
          is_rehearsal?: boolean
          prepare_clicked?: boolean | null
          recommendation_expanded?: boolean | null
          recommendation_followed_at_deadline?: boolean | null
          recommendation_generated?: boolean | null
          recommendation_scored?: boolean | null
          recommendation_viewed?: boolean | null
          refresh_required?: boolean | null
          updated_at?: string
          user_id?: string
          vice_applied?: boolean | null
        }
        Relationships: []
      }
      fantasy_captain_recommendation: {
        Row: {
          alternatives: Json | null
          applied_captain: boolean
          applied_vice: boolean
          change_reason: string | null
          confidence: string | null
          confirmed_at: string | null
          created_at: string
          data_cutoff: string
          fixture_context: Json | null
          gameweek: number | null
          id: string
          is_rehearsal: boolean
          model_version: string
          outcome: string | null
          previous_captain: number | null
          previous_vice: number | null
          recommendation_version: number | null
          recommended_captain: number
          recommended_vice: number
          signal: string
          squad_fingerprint: string
          status: string | null
          superseded_at: string | null
          superseded_by_recommendation_id: string | null
          user_id: string
          warnings: Json | null
        }
        Insert: {
          alternatives?: Json | null
          applied_captain?: boolean
          applied_vice?: boolean
          change_reason?: string | null
          confidence?: string | null
          confirmed_at?: string | null
          created_at?: string
          data_cutoff: string
          fixture_context?: Json | null
          gameweek?: number | null
          id?: string
          is_rehearsal?: boolean
          model_version: string
          outcome?: string | null
          previous_captain?: number | null
          previous_vice?: number | null
          recommendation_version?: number | null
          recommended_captain: number
          recommended_vice: number
          signal: string
          squad_fingerprint: string
          status?: string | null
          superseded_at?: string | null
          superseded_by_recommendation_id?: string | null
          user_id: string
          warnings?: Json | null
        }
        Update: {
          alternatives?: Json | null
          applied_captain?: boolean
          applied_vice?: boolean
          change_reason?: string | null
          confidence?: string | null
          confirmed_at?: string | null
          created_at?: string
          data_cutoff?: string
          fixture_context?: Json | null
          gameweek?: number | null
          id?: string
          is_rehearsal?: boolean
          model_version?: string
          outcome?: string | null
          previous_captain?: number | null
          previous_vice?: number | null
          recommendation_version?: number | null
          recommended_captain?: number
          recommended_vice?: number
          signal?: string
          squad_fingerprint?: string
          status?: string | null
          superseded_at?: string | null
          superseded_by_recommendation_id?: string | null
          user_id?: string
          warnings?: Json | null
        }
        Relationships: []
      }
      fantasy_captain_shadow: {
        Row: {
          confidence: string | null
          data_cutoff: string | null
          deadline_captain: number | null
          deadline_vice: number | null
          difference: number | null
          eligible: boolean | null
          excluded_reason: string | null
          exposure: string | null
          feature_version: string | null
          followed: boolean | null
          frozen_at: string
          gameweek: number
          id: number
          is_rehearsal: boolean
          model_identity: string | null
          model_version: string | null
          recommendation_id: string | null
          recommended_appeared: boolean | null
          recommended_captain: number
          recommended_effective_points: number | null
          recommended_points: number | null
          recommended_vice: number | null
          recommended_vice_activated: boolean | null
          recommended_vice_points: number | null
          scored_at: string | null
          scoring_version: string | null
          signal: string | null
          status: string | null
          user_appeared: boolean | null
          user_captain: number | null
          user_effective_points: number | null
          user_id: string
          user_points: number | null
          user_vice: number | null
          user_vice_activated: boolean | null
          user_vice_points: number | null
        }
        Insert: {
          confidence?: string | null
          data_cutoff?: string | null
          deadline_captain?: number | null
          deadline_vice?: number | null
          difference?: number | null
          eligible?: boolean | null
          excluded_reason?: string | null
          exposure?: string | null
          feature_version?: string | null
          followed?: boolean | null
          frozen_at?: string
          gameweek: number
          id?: number
          is_rehearsal?: boolean
          model_identity?: string | null
          model_version?: string | null
          recommendation_id?: string | null
          recommended_appeared?: boolean | null
          recommended_captain: number
          recommended_effective_points?: number | null
          recommended_points?: number | null
          recommended_vice?: number | null
          recommended_vice_activated?: boolean | null
          recommended_vice_points?: number | null
          scored_at?: string | null
          scoring_version?: string | null
          signal?: string | null
          status?: string | null
          user_appeared?: boolean | null
          user_captain?: number | null
          user_effective_points?: number | null
          user_id: string
          user_points?: number | null
          user_vice?: number | null
          user_vice_activated?: boolean | null
          user_vice_points?: number | null
        }
        Update: {
          confidence?: string | null
          data_cutoff?: string | null
          deadline_captain?: number | null
          deadline_vice?: number | null
          difference?: number | null
          eligible?: boolean | null
          excluded_reason?: string | null
          exposure?: string | null
          feature_version?: string | null
          followed?: boolean | null
          frozen_at?: string
          gameweek?: number
          id?: number
          is_rehearsal?: boolean
          model_identity?: string | null
          model_version?: string | null
          recommendation_id?: string | null
          recommended_appeared?: boolean | null
          recommended_captain?: number
          recommended_effective_points?: number | null
          recommended_points?: number | null
          recommended_vice?: number | null
          recommended_vice_activated?: boolean | null
          recommended_vice_points?: number | null
          scored_at?: string | null
          scoring_version?: string | null
          signal?: string | null
          status?: string | null
          user_appeared?: boolean | null
          user_captain?: number | null
          user_effective_points?: number | null
          user_id?: string
          user_points?: number | null
          user_vice?: number | null
          user_vice_activated?: boolean | null
          user_vice_points?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_captain_shadow_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "fantasy_captain_recommendation"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_collection_run: {
        Row: {
          band: string | null
          collected: boolean
          error: string | null
          finished_at: string | null
          fpl_rows: number | null
          hours_to_deadline: number | null
          id: number
          odds_rows: number | null
          ok: boolean
          post_deadline: boolean
          started_at: string
        }
        Insert: {
          band?: string | null
          collected?: boolean
          error?: string | null
          finished_at?: string | null
          fpl_rows?: number | null
          hours_to_deadline?: number | null
          id?: number
          odds_rows?: number | null
          ok?: boolean
          post_deadline?: boolean
          started_at: string
        }
        Update: {
          band?: string | null
          collected?: boolean
          error?: string | null
          finished_at?: string | null
          fpl_rows?: number | null
          hours_to_deadline?: number | null
          id?: number
          odds_rows?: number | null
          ok?: boolean
          post_deadline?: boolean
          started_at?: string
        }
        Relationships: []
      }
      fantasy_deadline_squad: {
        Row: {
          bench: number[] | null
          captain: number | null
          captured_at: string
          gameweek: number
          id: number
          is_rehearsal: boolean
          squad_fingerprint: string | null
          user_id: string
          vice: number | null
          xi: number[]
        }
        Insert: {
          bench?: number[] | null
          captain?: number | null
          captured_at?: string
          gameweek: number
          id?: number
          is_rehearsal?: boolean
          squad_fingerprint?: string | null
          user_id: string
          vice?: number | null
          xi: number[]
        }
        Update: {
          bench?: number[] | null
          captain?: number | null
          captured_at?: string
          gameweek?: number
          id?: number
          is_rehearsal?: boolean
          squad_fingerprint?: string | null
          user_id?: string
          vice?: number | null
          xi?: number[]
        }
        Relationships: []
      }
      fantasy_entries: {
        Row: {
          autosubs: Json | null
          bench: number[] | null
          captain: number | null
          captain_used: number | null
          cash_points: number
          chip: string | null
          gw: number
          hits: number
          locked_at: string | null
          picks: Json | null
          points: number | null
          points_breakdown: Json | null
          round_answers: Json
          round_correct: number
          round_credits: number
          round_done_at: string | null
          round_hint_k: number | null
          round_retry_k: number | null
          round_version: string | null
          scored_at: string | null
          scoring_version: string | null
          status: string
          transfers: Json
          user_id: string
          vice: number | null
          xi: number[] | null
        }
        Insert: {
          autosubs?: Json | null
          bench?: number[] | null
          captain?: number | null
          captain_used?: number | null
          cash_points?: number
          chip?: string | null
          gw: number
          hits?: number
          locked_at?: string | null
          picks?: Json | null
          points?: number | null
          points_breakdown?: Json | null
          round_answers?: Json
          round_correct?: number
          round_credits?: number
          round_done_at?: string | null
          round_hint_k?: number | null
          round_retry_k?: number | null
          round_version?: string | null
          scored_at?: string | null
          scoring_version?: string | null
          status?: string
          transfers?: Json
          user_id: string
          vice?: number | null
          xi?: number[] | null
        }
        Update: {
          autosubs?: Json | null
          bench?: number[] | null
          captain?: number | null
          captain_used?: number | null
          cash_points?: number
          chip?: string | null
          gw?: number
          hits?: number
          locked_at?: string | null
          picks?: Json | null
          points?: number | null
          points_breakdown?: Json | null
          round_answers?: Json
          round_correct?: number
          round_credits?: number
          round_done_at?: string | null
          round_hint_k?: number | null
          round_retry_k?: number | null
          round_version?: string | null
          scored_at?: string | null
          scoring_version?: string | null
          status?: string
          transfers?: Json
          user_id?: string
          vice?: number | null
          xi?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_entries_gw_fkey"
            columns: ["gw"]
            isOneToOne: false
            referencedRelation: "fantasy_gameweeks"
            referencedColumns: ["gw"]
          },
        ]
      }
      fantasy_feed_events: {
        Row: {
          actor_id: string
          created_at: string
          gw: number | null
          id: string
          payload: Json
          type: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          gw?: number | null
          id?: string
          payload?: Json
          type: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          gw?: number | null
          id?: string
          payload?: Json
          type?: string
        }
        Relationships: []
      }
      fantasy_feed_likes: {
        Row: {
          created_at: string
          event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_feed_likes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "fantasy_feed_events"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_fixture_snapshot: {
        Row: {
          captured_at: string
          event: number | null
          finished: boolean | null
          fixture_id: number
          id: number
          is_rehearsal: boolean
          kickoff_time: string | null
          provisional_start_time: boolean | null
          team_a: number | null
          team_a_difficulty: number | null
          team_a_name: string | null
          team_h: number | null
          team_h_difficulty: number | null
          team_h_name: string | null
        }
        Insert: {
          captured_at: string
          event?: number | null
          finished?: boolean | null
          fixture_id: number
          id?: number
          is_rehearsal?: boolean
          kickoff_time?: string | null
          provisional_start_time?: boolean | null
          team_a?: number | null
          team_a_difficulty?: number | null
          team_a_name?: string | null
          team_h?: number | null
          team_h_difficulty?: number | null
          team_h_name?: string | null
        }
        Update: {
          captured_at?: string
          event?: number | null
          finished?: boolean | null
          fixture_id?: number
          id?: number
          is_rehearsal?: boolean
          kickoff_time?: string | null
          provisional_start_time?: boolean | null
          team_a?: number | null
          team_a_difficulty?: number | null
          team_a_name?: string | null
          team_h?: number | null
          team_h_difficulty?: number | null
          team_h_name?: string | null
        }
        Relationships: []
      }
      fantasy_fpl_snapshot: {
        Row: {
          captured_at: string
          chance_of_playing_next_round: number | null
          chance_of_playing_this_round: number | null
          current_event: number | null
          ep_next: number | null
          ep_this: number | null
          form: number | null
          id: number
          is_rehearsal: boolean
          news: string | null
          next_deadline: string | null
          next_event: number | null
          now_cost: number | null
          player_id: number
          position: string | null
          selected_by_percent: number | null
          status: string | null
          team: number | null
          transfers_in_event: number | null
          transfers_out_event: number | null
          web_name: string | null
        }
        Insert: {
          captured_at: string
          chance_of_playing_next_round?: number | null
          chance_of_playing_this_round?: number | null
          current_event?: number | null
          ep_next?: number | null
          ep_this?: number | null
          form?: number | null
          id?: number
          is_rehearsal?: boolean
          news?: string | null
          next_deadline?: string | null
          next_event?: number | null
          now_cost?: number | null
          player_id: number
          position?: string | null
          selected_by_percent?: number | null
          status?: string | null
          team?: number | null
          transfers_in_event?: number | null
          transfers_out_event?: number | null
          web_name?: string | null
        }
        Update: {
          captured_at?: string
          chance_of_playing_next_round?: number | null
          chance_of_playing_this_round?: number | null
          current_event?: number | null
          ep_next?: number | null
          ep_this?: number | null
          form?: number | null
          id?: number
          is_rehearsal?: boolean
          news?: string | null
          next_deadline?: string | null
          next_event?: number | null
          now_cost?: number | null
          player_id?: number
          position?: string | null
          selected_by_percent?: number | null
          status?: string | null
          team?: number | null
          transfers_in_event?: number | null
          transfers_out_event?: number | null
          web_name?: string | null
        }
        Relationships: []
      }
      fantasy_gameweeks: {
        Row: {
          deadline: string | null
          gw: number
          mode: string
          ops_hold: boolean
          season: string
          sm_season_id: number
          status: string
          window_end: string
          window_start: string
        }
        Insert: {
          deadline?: string | null
          gw: number
          mode?: string
          ops_hold?: boolean
          season: string
          sm_season_id: number
          status?: string
          window_end: string
          window_start: string
        }
        Update: {
          deadline?: string | null
          gw?: number
          mode?: string
          ops_hold?: boolean
          season?: string
          sm_season_id?: number
          status?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      fantasy_league_members: {
        Row: {
          joined_at: string
          league_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          league_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          league_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fantasy_league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "fantasy_leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      fantasy_leagues: {
        Row: {
          created_at: string
          id: string
          is_public: boolean
          join_code: string
          name: string
          owner_id: string
          stakes: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_public?: boolean
          join_code: string
          name: string
          owner_id: string
          stakes?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_public?: boolean
          join_code?: string
          name?: string
          owner_id?: string
          stakes?: string | null
        }
        Relationships: []
      }
      fantasy_news_feed: {
        Row: {
          doc: Json
          gw: number
          updated_at: string
        }
        Insert: {
          doc: Json
          gw: number
          updated_at?: string
        }
        Update: {
          doc?: Json
          gw?: number
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_news_items: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          source_key: string | null
          topic: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload: Json
          source_key?: string | null
          topic?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          source_key?: string | null
          topic?: string
        }
        Relationships: []
      }
      fantasy_odds_snapshot: {
        Row: {
          bookmaker_id: number | null
          collected_at: string
          fixture_id: number
          fixture_kickoff: string | null
          handicap: string | null
          id: number
          market_description: string | null
          market_id: number | null
          odds: number | null
          odds_probability_raw: number | null
          selection: string | null
          source_updated_at: string | null
        }
        Insert: {
          bookmaker_id?: number | null
          collected_at: string
          fixture_id: number
          fixture_kickoff?: string | null
          handicap?: string | null
          id?: number
          market_description?: string | null
          market_id?: number | null
          odds?: number | null
          odds_probability_raw?: number | null
          selection?: string | null
          source_updated_at?: string | null
        }
        Update: {
          bookmaker_id?: number | null
          collected_at?: string
          fixture_id?: number
          fixture_kickoff?: string | null
          handicap?: string | null
          id?: number
          market_description?: string | null
          market_id?: number | null
          odds?: number | null
          odds_probability_raw?: number | null
          selection?: string | null
          source_updated_at?: string | null
        }
        Relationships: []
      }
      fantasy_ops_state: {
        Row: {
          alerted_at: string
          fingerprint: string
          guard: string
          gw: number
        }
        Insert: {
          alerted_at?: string
          fingerprint: string
          guard: string
          gw: number
        }
        Update: {
          alerted_at?: string
          fingerprint?: string
          guard?: string
          gw?: number
        }
        Relationships: []
      }
      fantasy_player_prices: {
        Row: {
          gw: number
          player_id: number
          price_tenths: number
          updated_at: string
        }
        Insert: {
          gw: number
          player_id: number
          price_tenths: number
          updated_at?: string
        }
        Update: {
          gw?: number
          player_id?: number
          price_tenths?: number
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_player_scores: {
        Row: {
          facts: Json
          gw: number
          minutes: number
          player_id: number
          points: number
          updated_at: string
        }
        Insert: {
          facts: Json
          gw: number
          minutes?: number
          player_id: number
          points: number
          updated_at?: string
        }
        Update: {
          facts?: Json
          gw?: number
          minutes?: number
          player_id?: number
          points?: number
          updated_at?: string
        }
        Relationships: []
      }
      fantasy_predicted_xi: {
        Row: {
          club_id: number
          fetched_at: string
          gw: number
          xi: Json
        }
        Insert: {
          club_id: number
          fetched_at?: string
          gw: number
          xi: Json
        }
        Update: {
          club_id?: number
          fetched_at?: string
          gw?: number
          xi?: Json
        }
        Relationships: []
      }
      fantasy_scout_picks: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          backups: Json
          category: string
          copy_source: string
          data_cutoff: string
          expires_at: string
          facts: Json
          generated_at: string
          gw: number
          id: string
          player_id: number
          published_at: string | null
          reasons: Json
          rejected_reason: string | null
          risk: string | null
          signal: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          backups?: Json
          category: string
          copy_source?: string
          data_cutoff: string
          expires_at: string
          facts: Json
          generated_at?: string
          gw: number
          id?: string
          player_id: number
          published_at?: string | null
          reasons: Json
          rejected_reason?: string | null
          risk?: string | null
          signal: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          backups?: Json
          category?: string
          copy_source?: string
          data_cutoff?: string
          expires_at?: string
          facts?: Json
          generated_at?: string
          gw?: number
          id?: string
          player_id?: number
          published_at?: string | null
          reasons?: Json
          rejected_reason?: string | null
          risk?: string | null
          signal?: string
          status?: string
        }
        Relationships: []
      }
      fantasy_shortlist: {
        Row: {
          created_at: string
          player_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          player_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          player_id?: number
          user_id?: string
        }
        Relationships: []
      }
      fantasy_squads: {
        Row: {
          bank_tenths: number
          bench: number[]
          captain: number
          chip_log: Json
          created_at: string
          created_gw: number
          credits: number
          pending_credits: number
          pending_gameday_done: boolean
          pending_source: string | null
          picks: Json
          updated_at: string
          user_id: string
          version: number
          vice: number
          xi: number[]
        }
        Insert: {
          bank_tenths: number
          bench: number[]
          captain: number
          chip_log?: Json
          created_at?: string
          created_gw: number
          credits?: number
          pending_credits?: number
          pending_gameday_done?: boolean
          pending_source?: string | null
          picks: Json
          updated_at?: string
          user_id: string
          version?: number
          vice: number
          xi: number[]
        }
        Update: {
          bank_tenths?: number
          bench?: number[]
          captain?: number
          chip_log?: Json
          created_at?: string
          created_gw?: number
          credits?: number
          pending_credits?: number
          pending_gameday_done?: boolean
          pending_source?: string | null
          picks?: Json
          updated_at?: string
          user_id?: string
          version?: number
          vice?: number
          xi?: number[]
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
      game_duels: {
        Row: {
          bar_final: number | null
          challenger_id: string
          challenger_timeline: Json
          code: string | null
          completed_at: string | null
          created_at: string
          game: string
          id: string
          mode: string
          opponent_id: string | null
          opponent_kind: string
          opponent_timeline: Json
          seed: string
          shadow_persona: Json | null
          shadow_run_id: string | null
          status: string
          winner_id: string | null
        }
        Insert: {
          bar_final?: number | null
          challenger_id: string
          challenger_timeline?: Json
          code?: string | null
          completed_at?: string | null
          created_at?: string
          game: string
          id?: string
          mode: string
          opponent_id?: string | null
          opponent_kind?: string
          opponent_timeline?: Json
          seed: string
          shadow_persona?: Json | null
          shadow_run_id?: string | null
          status?: string
          winner_id?: string | null
        }
        Update: {
          bar_final?: number | null
          challenger_id?: string
          challenger_timeline?: Json
          code?: string | null
          completed_at?: string | null
          created_at?: string
          game?: string
          id?: string
          mode?: string
          opponent_id?: string | null
          opponent_kind?: string
          opponent_timeline?: Json
          seed?: string
          shadow_persona?: Json | null
          shadow_run_id?: string | null
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_duels_shadow_run_id_fkey"
            columns: ["shadow_run_id"]
            isOneToOne: false
            referencedRelation: "game_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      game_runs: {
        Row: {
          correct_count: number
          created_at: string
          finished: boolean
          game: string
          id: string
          seed: string
          timeline: Json
          user_id: string | null
        }
        Insert: {
          correct_count?: number
          created_at?: string
          finished?: boolean
          game: string
          id?: string
          seed: string
          timeline?: Json
          user_id?: string | null
        }
        Update: {
          correct_count?: number
          created_at?: string
          finished?: boolean
          game?: string
          id?: string
          seed?: string
          timeline?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      game_scores: {
        Row: {
          correct_count: number
          created_at: string
          fastest_ms: number | null
          game: string
          id: string
          max_score: number
          score: number
          seed: string
          topic: string
          total_questions: number
          user_id: string
        }
        Insert: {
          correct_count: number
          created_at?: string
          fastest_ms?: number | null
          game: string
          id?: string
          max_score: number
          score: number
          seed: string
          topic?: string
          total_questions: number
          user_id: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          fastest_ms?: number | null
          game?: string
          id?: string
          max_score?: number
          score?: number
          seed?: string
          topic?: string
          total_questions?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "game_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      group_challenge_participants: {
        Row: {
          challenge_id: string
          correct: number | null
          created_at: string
          display_name: string
          id: string
          invited: boolean
          played_at: string | null
          score: number | null
          seen: boolean
          user_id: string
        }
        Insert: {
          challenge_id: string
          correct?: number | null
          created_at?: string
          display_name: string
          id?: string
          invited?: boolean
          played_at?: string | null
          score?: number | null
          seen?: boolean
          user_id: string
        }
        Update: {
          challenge_id?: string
          correct?: number | null
          created_at?: string
          display_name?: string
          id?: string
          invited?: boolean
          played_at?: string | null
          score?: number | null
          seen?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "group_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      group_challenges: {
        Row: {
          created_at: string
          creator_id: string
          creator_name: string
          expires_at: string
          id: string
          kind: string
          max_score: number
          quiz_pack_id: string
          quiz_pack_name: string
          status: string
          total_questions: number
        }
        Insert: {
          created_at?: string
          creator_id: string
          creator_name: string
          expires_at?: string
          id?: string
          kind?: string
          max_score: number
          quiz_pack_id: string
          quiz_pack_name: string
          status?: string
          total_questions: number
        }
        Update: {
          created_at?: string
          creator_id?: string
          creator_name?: string
          expires_at?: string
          id?: string
          kind?: string
          max_score?: number
          quiz_pack_id?: string
          quiz_pack_name?: string
          status?: string
          total_questions?: number
        }
        Relationships: []
      }
      h2h_challenges: {
        Row: {
          challenger_answers: Json | null
          challenger_correct: number
          challenger_id: string
          challenger_name: string
          challenger_score: number
          created_at: string | null
          duel_id: string | null
          expires_at: string | null
          game: string
          id: string
          invited_user_id: string | null
          max_score: number
          mode: string
          opponent_answers: Json | null
          opponent_correct: number | null
          opponent_id: string | null
          opponent_score: number | null
          quiz_pack_id: string
          quiz_pack_name: string
          seen_by_opponent: boolean
          status: string
          total_questions: number
        }
        Insert: {
          challenger_answers?: Json | null
          challenger_correct: number
          challenger_id: string
          challenger_name: string
          challenger_score: number
          created_at?: string | null
          duel_id?: string | null
          expires_at?: string | null
          game?: string
          id?: string
          invited_user_id?: string | null
          max_score: number
          mode?: string
          opponent_answers?: Json | null
          opponent_correct?: number | null
          opponent_id?: string | null
          opponent_score?: number | null
          quiz_pack_id: string
          quiz_pack_name: string
          seen_by_opponent?: boolean
          status?: string
          total_questions: number
        }
        Update: {
          challenger_answers?: Json | null
          challenger_correct?: number
          challenger_id?: string
          challenger_name?: string
          challenger_score?: number
          created_at?: string | null
          duel_id?: string | null
          expires_at?: string | null
          game?: string
          id?: string
          invited_user_id?: string | null
          max_score?: number
          mode?: string
          opponent_answers?: Json | null
          opponent_correct?: number | null
          opponent_id?: string | null
          opponent_score?: number | null
          quiz_pack_id?: string
          quiz_pack_name?: string
          seen_by_opponent?: boolean
          status?: string
          total_questions?: number
        }
        Relationships: [
          {
            foreignKeyName: "h2h_challenges_duel_id_fkey"
            columns: ["duel_id"]
            isOneToOne: false
            referencedRelation: "game_duels"
            referencedColumns: ["id"]
          },
        ]
      }
      halftime_control: {
        Row: {
          fresh_kill: boolean
          matchday: string
          updated_at: string
        }
        Insert: {
          fresh_kill?: boolean
          matchday: string
          updated_at?: string
        }
        Update: {
          fresh_kill?: boolean
          matchday?: string
          updated_at?: string
        }
        Relationships: []
      }
      halftime_heartbeat: {
        Row: {
          beat_at: string
          detail: Json | null
          id: string
        }
        Insert: {
          beat_at: string
          detail?: Json | null
          id: string
        }
        Update: {
          beat_at?: string
          detail?: Json | null
          id?: string
        }
        Relationships: []
      }
      halftime_prediction_results: {
        Row: {
          away_goals: number
          fixture_id: number
          home_goals: number
          phase: string
          result: string
          settled_at: string
        }
        Insert: {
          away_goals: number
          fixture_id: number
          home_goals: number
          phase?: string
          result: string
          settled_at?: string
        }
        Update: {
          away_goals?: number
          fixture_id?: number
          home_goals?: number
          phase?: string
          result?: string
          settled_at?: string
        }
        Relationships: []
      }
      halftime_predictions: {
        Row: {
          correct: boolean | null
          created_at: string
          fixture_id: number
          pack_id: string | null
          phase: string
          pick: string
          user_id: string
        }
        Insert: {
          correct?: boolean | null
          created_at?: string
          fixture_id: number
          pack_id?: string | null
          phase?: string
          pick: string
          user_id: string
        }
        Update: {
          correct?: boolean | null
          created_at?: string
          fixture_id?: number
          pack_id?: string | null
          phase?: string
          pick?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "halftime_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "halftime_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "halftime_predictions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      halftime_releases: {
        Row: {
          away: string
          base_questions: Json | null
          created_at: string
          fixture_id: number
          fresh_questions: Json | null
          fresh_state: string
          gameweek: number | null
          home: string
          id: string
          kickoff_at: string
          kind: string
          pack_id: string | null
          pack_questions: Json | null
          publish_at: string | null
          published_at: string | null
          questions: Json | null
          released_at: string | null
          round_name: string | null
          season_id: number | null
          second_half_started_at: string | null
          state: string
          telegram_message_id: number | null
          updated_at: string
          veto_deadline_at: string | null
        }
        Insert: {
          away: string
          base_questions?: Json | null
          created_at?: string
          fixture_id: number
          fresh_questions?: Json | null
          fresh_state?: string
          gameweek?: number | null
          home: string
          id?: string
          kickoff_at: string
          kind?: string
          pack_id?: string | null
          pack_questions?: Json | null
          publish_at?: string | null
          published_at?: string | null
          questions?: Json | null
          released_at?: string | null
          round_name?: string | null
          season_id?: number | null
          second_half_started_at?: string | null
          state?: string
          telegram_message_id?: number | null
          updated_at?: string
          veto_deadline_at?: string | null
        }
        Update: {
          away?: string
          base_questions?: Json | null
          created_at?: string
          fixture_id?: number
          fresh_questions?: Json | null
          fresh_state?: string
          gameweek?: number | null
          home?: string
          id?: string
          kickoff_at?: string
          kind?: string
          pack_id?: string | null
          pack_questions?: Json | null
          publish_at?: string | null
          published_at?: string | null
          questions?: Json | null
          released_at?: string | null
          round_name?: string | null
          season_id?: number | null
          second_half_started_at?: string | null
          state?: string
          telegram_message_id?: number | null
          updated_at?: string
          veto_deadline_at?: string | null
        }
        Relationships: []
      }
      halftime_reminders: {
        Row: {
          created_at: string
          fixture_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          fixture_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          fixture_id?: number
          user_id?: string
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
          featured: boolean
          id: string
          is_public: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          is_public?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          featured?: boolean
          id?: string
          is_public?: boolean
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
      notification_log: {
        Row: {
          key: string
          sent_at: string
          user_id: string
        }
        Insert: {
          key: string
          sent_at?: string
          user_id: string
        }
        Update: {
          key?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          comment_id: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          like_count: number
          subject_id: string | null
          subject_type: string | null
          title: string | null
          type: string
          updated_at: string
          url: string
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          comment_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          like_count?: number
          subject_id?: string | null
          subject_type?: string | null
          title?: string | null
          type: string
          updated_at?: string
          url: string
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          comment_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          like_count?: number
          subject_id?: string | null
          subject_type?: string | null
          title?: string | null
          type?: string
          updated_at?: string
          url?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      p10_attempts: {
        Row: {
          created_at: string
          done: boolean
          found: Json
          hints: Json
          id: string
          list_id: string
          score: number
          share_token: string
          strikes: number
          tokens_left: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          done?: boolean
          found?: Json
          hints?: Json
          id?: string
          list_id: string
          score?: number
          share_token?: string
          strikes?: number
          tokens_left?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          done?: boolean
          found?: Json
          hints?: Json
          id?: string
          list_id?: string
          score?: number
          share_token?: string
          strikes?: number
          tokens_left?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "p10_attempts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "p10_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "p10_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "p10_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "p10_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      p10_lists: {
        Row: {
          created_at: string
          day: string | null
          entries: Json
          id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          day?: string | null
          entries?: Json
          id?: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          day?: string | null
          entries?: Json
          id?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      p10_players: {
        Row: {
          created_at: string
          id: number
          name: string
          normalized: string
          source: string | null
        }
        Insert: {
          created_at?: string
          id: number
          name: string
          normalized: string
          source?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
          normalized?: string
          source?: string | null
        }
        Relationships: []
      }
      pl_briefings: {
        Row: {
          date: string
          doc: Json
          updated_at: string
        }
        Insert: {
          date: string
          doc: Json
          updated_at?: string
        }
        Update: {
          date?: string
          doc?: Json
          updated_at?: string
        }
        Relationships: []
      }
      pl_news_feed: {
        Row: {
          doc: Json
          id: number
          updated_at: string
        }
        Insert: {
          doc?: Json
          id?: number
          updated_at?: string
        }
        Update: {
          doc?: Json
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      player_game_counts: {
        Row: {
          games: number
          updated_at: string
          user_id: string
        }
        Insert: {
          games?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          games?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_game_counts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_game_counts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_game_counts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      product_feedback: {
        Row: {
          body: string
          created_at: string
          id: string
          source: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          source?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_hour_utc: number | null
          avatar_url: string | null
          country: string | null
          created_at: string | null
          device_id: string | null
          display_name: string | null
          first_play_at: string | null
          games_played: number | null
          id: string
          is_seed: boolean
          notifications_opt_in: boolean
          notifications_read_at: string | null
          referrer: string | null
          social_handle: string | null
          social_platform: string | null
          source: string | null
          timezone: string | null
          total_score: number | null
          username: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          active_hour_utc?: number | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          device_id?: string | null
          display_name?: string | null
          first_play_at?: string | null
          games_played?: number | null
          id: string
          is_seed?: boolean
          notifications_opt_in?: boolean
          notifications_read_at?: string | null
          referrer?: string | null
          social_handle?: string | null
          social_platform?: string | null
          source?: string | null
          timezone?: string | null
          total_score?: number | null
          username?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          active_hour_utc?: number | null
          avatar_url?: string | null
          country?: string | null
          created_at?: string | null
          device_id?: string | null
          display_name?: string | null
          first_play_at?: string | null
          games_played?: number | null
          id?: string
          is_seed?: boolean
          notifications_opt_in?: boolean
          notifications_read_at?: string | null
          referrer?: string | null
          social_handle?: string | null
          social_platform?: string | null
          source?: string | null
          timezone?: string | null
          total_score?: number | null
          username?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
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
          fact_key: string | null
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
          fact_key?: string | null
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
          fact_key?: string | null
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
          source: string | null
          user_id: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          id?: string
          max_score?: number
          pack_id: string
          score?: number
          source?: string | null
          user_id: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          answers?: Json | null
          completed_at?: string
          correct_count?: number
          id?: string
          max_score?: number
          pack_id?: string
          score?: number
          source?: string | null
          user_id?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
      quiz_highlights: {
        Row: {
          doc: Json
          id: number
          updated_at: string
        }
        Insert: {
          doc?: Json
          id?: number
          updated_at?: string
        }
        Update: {
          doc?: Json
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      quiz_packs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
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
          release_at: string | null
          rotation_active: boolean | null
          rotation_order: number | null
          source: string
          status: string
          tags: string[] | null
          theme: string | null
          title: string | null
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
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
          release_at?: string | null
          rotation_active?: boolean | null
          rotation_order?: number | null
          source?: string
          status?: string
          tags?: string[] | null
          theme?: string | null
          title?: string | null
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
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
          release_at?: string | null
          rotation_active?: boolean | null
          rotation_order?: number | null
          source?: string
          status?: string
          tags?: string[] | null
          theme?: string | null
          title?: string | null
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      quiz_queue: {
        Row: {
          enqueued_at: string
          user_id: string
        }
        Insert: {
          enqueued_at?: string
          user_id: string
        }
        Update: {
          enqueued_at?: string
          user_id?: string
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
      review_prompts: {
        Row: {
          created_at: string
          games_at: number | null
          id: string
          outcome: string | null
          surface: string
          user_id: string
          variant: string
        }
        Insert: {
          created_at?: string
          games_at?: number | null
          id?: string
          outcome?: string | null
          surface: string
          user_id: string
          variant: string
        }
        Update: {
          created_at?: string
          games_at?: number | null
          id?: string
          outcome?: string | null
          surface?: string
          user_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "review_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
      room_answers: {
        Row: {
          answers: Json
          created_at: string
          room_id: string
        }
        Insert: {
          answers: Json
          created_at?: string
          room_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_answers_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
          answers_json: Json | null
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
          shadow: Json | null
          sponsor_logo_url: string | null
          sponsor_name: string | null
          status: string | null
          type: string | null
          whatsapp_channel_id: string | null
        }
        Insert: {
          answers_json?: Json | null
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
          shadow?: Json | null
          sponsor_logo_url?: string | null
          sponsor_name?: string | null
          status?: string | null
          type?: string | null
          whatsapp_channel_id?: string | null
        }
        Update: {
          answers_json?: Json | null
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
          shadow?: Json | null
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
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
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
      user_follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
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
      waitlist_emails: {
        Row: {
          created_at: string
          email: string
          source: string
          synced_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          source?: string
          synced_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          source?: string
          synced_at?: string | null
        }
        Relationships: []
      }
      wc_ranked_edition: {
        Row: {
          edition: string
          id: boolean
          prev_edition: string | null
          published_at: string
        }
        Insert: {
          edition: string
          id?: boolean
          prev_edition?: string | null
          published_at?: string
        }
        Update: {
          edition?: string
          id?: boolean
          prev_edition?: string | null
          published_at?: string
        }
        Relationships: []
      }
      wc_run_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          run_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          run_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wc_run_comments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "draft_wc_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      wc_thanks_prompts: {
        Row: {
          cohort: string
          created_at: string
          feedback_done_at: string | null
          review_done_at: string | null
          user_id: string
        }
        Insert: {
          cohort?: string
          created_at?: string
          feedback_done_at?: string | null
          review_done_at?: string | null
          user_id: string
        }
        Update: {
          cohort?: string
          created_at?: string
          feedback_done_at?: string | null
          review_done_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wc_thanks_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wc_thanks_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_email_segments"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wc_thanks_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "yourscore_user_ratings"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      fantasy_captain_exclusions: {
        Row: {
          excluded_reason: string | null
          gameweek: number | null
          rows: number | null
        }
        Relationships: []
      }
      fantasy_captain_rehearsal: {
        Row: {
          confidence: string | null
          deadline_captain: number | null
          deadline_vice: number | null
          difference: number | null
          eligible: boolean | null
          excluded_reason: string | null
          exposure: string | null
          gameweek: number | null
          model_identity: string | null
          recommended_captain: number | null
          recommended_effective_points: number | null
          recommended_vice: number | null
          recommended_vice_activated: boolean | null
          status: string | null
          user_effective_points: number | null
          user_vice_activated: boolean | null
        }
        Insert: {
          confidence?: string | null
          deadline_captain?: number | null
          deadline_vice?: number | null
          difference?: number | null
          eligible?: boolean | null
          excluded_reason?: string | null
          exposure?: string | null
          gameweek?: number | null
          model_identity?: string | null
          recommended_captain?: number | null
          recommended_effective_points?: number | null
          recommended_vice?: number | null
          recommended_vice_activated?: boolean | null
          status?: string | null
          user_effective_points?: number | null
          user_vice_activated?: boolean | null
        }
        Update: {
          confidence?: string | null
          deadline_captain?: number | null
          deadline_vice?: number | null
          difference?: number | null
          eligible?: boolean | null
          excluded_reason?: string | null
          exposure?: string | null
          gameweek?: number | null
          model_identity?: string | null
          recommended_captain?: number | null
          recommended_effective_points?: number | null
          recommended_vice?: number | null
          recommended_vice_activated?: boolean | null
          status?: string | null
          user_effective_points?: number | null
          user_vice_activated?: boolean | null
        }
        Relationships: []
      }
      fantasy_captain_shadow_summary: {
        Row: {
          confidence: string | null
          eligible: number | null
          eligible_pct: number | null
          exposure: string | null
          followed_pct: number | null
          gameweek: number | null
          mean_uplift: number | null
          model_identity: string | null
          rec_appeared_pct: number | null
          rec_vice_activations: number | null
          recommendations: number | null
          total_uplift: number | null
          user_appeared_pct: number | null
          user_vice_activations: number | null
          weeks_better: number | null
          weeks_same: number | null
          weeks_worse: number | null
        }
        Relationships: []
      }
      user_email_segments: {
        Row: {
          active_hour_utc: number | null
          country: string | null
          days_since_active: number | null
          engagement_tier: string | null
          first_game: string | null
          first_game_at: string | null
          g38_games: number | null
          has_friends: boolean | null
          in_league: boolean | null
          is_new: boolean | null
          last_active_at: string | null
          multi_game: boolean | null
          name: string | null
          notifications_opt_in: boolean | null
          played_wc_ranked: boolean | null
          plays_38: boolean | null
          plays_quiz: boolean | null
          plays_wc: boolean | null
          primary_game: string | null
          quiz_games: number | null
          signed_up_at: string | null
          timezone: string | null
          total_games: number | null
          total_score: number | null
          user_id: string | null
          wc_games: number | null
        }
        Relationships: []
      }
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
      bump_player_games: { Args: { p_user: string }; Returns: number }
      check_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      delete_bounced_user: { Args: { p_email: string }; Returns: string }
      delete_user_account: { Args: { p_user: string }; Returns: undefined }
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
      draft_live_kick: {
        Args: {
          p_match: string
          p_round: number
          p1_kick?: Json
          p2_kick?: Json
        }
        Returns: {
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
          p1_kicks: Json
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
          p2_kicks: Json
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
        }[]
        SetofOptions: {
          from: "*"
          to: "draft_live_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      draft_live_pair: {
        Args: {
          p_competition?: string
          p_league: string
          p_ranked: boolean
          p_user: string
        }
        Returns: {
          opp_competition: string
          opp_user: string
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
      fantasy_collect_tick: { Args: never; Returns: undefined }
      fantasy_global_standings: {
        Args: { p_gws: number[]; p_limit?: number; p_viewer: string }
        Returns: {
          is_viewer: boolean
          knowledge: number
          last_gw_points: number
          played: number
          points: number
          rank: number
          total_players: number
          user_id: string
        }[]
      }
      fantasy_rank_jumps: {
        Args: { p_gw: number; p_min_jump: number }
        Returns: {
          after_rank: number
          jump: number
          user_id: string
        }[]
      }
      game_board: {
        Args: { p_game: string; p_limit?: number }
        Returns: {
          avatar_url: string
          best: number
          best_at: string
          plays: number
          user_id: string
          username: string
        }[]
      }
      game_my_standing: {
        Args: { p_game: string; p_user: string }
        Returns: {
          best: number
          plays: number
          rank: number
        }[]
      }
      game_rank: { Args: { p_game: string; p_score: number }; Returns: number }
      get_best_quiz: {
        Args: { p_user_id: string }
        Returns: {
          correct: number
          title: string
          total: number
        }[]
      }
      get_best_wc_run: {
        Args: { p_user_id: string }
        Returns: {
          champion: boolean
          games: number
          nation: string
          wins: number
        }[]
      }
      get_club_league_feed: {
        Args: { p_league_id: string; p_limit?: number }
        Returns: {
          avatar_url: string
          created_at: string
          detail: Json
          display_name: string
          kind: string
          user_id: string
        }[]
      }
      get_daily_p10_stats: {
        Args: { p_list_id: string }
        Returns: {
          avg_score: number
          hardest_correct_pct: number
          hardest_rank: number
          players: number
        }[]
      }
      get_daily_pack_stats: {
        Args: { p_pack_id: string }
        Returns: {
          avg_score: number
          hardest_correct_pct: number
          hardest_idx: number
          players: number
        }[]
      }
      get_email_segments: { Args: never; Returns: Json }
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
      get_profile_accuracy: {
        Args: { p_user_id: string }
        Returns: {
          correct: number
          total: number
        }[]
      }
      get_segment_all_sendable: {
        Args: never
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_both_active: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_classic_active: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_engaged: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_lapsed: {
        Args: { p_max_days?: number; p_min_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_never_played: {
        Args: { p_min_signup_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_new_users: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_quiz_active: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_quiz_only: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_wc_active: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_wc_lapsed: {
        Args: { p_max_days?: number; p_min_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_wc_only: {
        Args: { p_days?: number }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_segment_wc_streak: {
        Args: { p_days?: number; p_min_streak?: number }
        Returns: {
          days_played: number
          email: string
          user_id: string
        }[]
      }
      get_wc_comment_counts: {
        Args: { p_end: string; p_start: string }
        Returns: {
          comments: number
          user_id: string
        }[]
      }
      get_wc_daily_leaderboard: {
        Args: { p_end: string; p_limit?: number; p_start: string }
        Returns: {
          avatar_url: string
          days: number
          display_name: string
          draws: number
          losses: number
          points: number
          rank: number
          user_id: string
          wins: number
        }[]
      }
      get_wc_lapsed_players: {
        Args: { p_played_date: string; p_today_date: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      get_wc_player_history: {
        Args: { p_end: string; p_start: string; p_user: string }
        Returns: {
          avatar_url: string
          display_name: string
          draws: number
          formation: string
          losses: number
          matches: Json
          points: number
          quiz_correct: number
          quiz_total: number
          run_date: string
          run_id: string
          squad: Json
          stage: string
          status: string
          strength: number
          wins: number
        }[]
      }
      get_wc_run_comments: {
        Args: { p_user: string }
        Returns: {
          author_avatar: string
          author_id: string
          author_name: string
          body: string
          created_at: string
          id: string
          run_id: string
        }[]
      }
      get_yourscore_ladder: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          is_me: boolean
          overall_rank: number
          overall_score: number
          user_id: string
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
      quiz_pair: { Args: { p_user: string }; Returns: string }
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
