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
          user_id: string
        }
        Insert: {
          created_at?: string | null
          friend_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          friend_id?: string
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
        ]
      }
      quiz_packs: {
        Row: {
          created_at: string | null
          created_by: string | null
          difficulty_focus: string | null
          id: string
          is_custom: boolean
          metadata: Json | null
          name: string
          parameter: string
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
          difficulty_focus?: string | null
          id?: string
          is_custom?: boolean
          metadata?: Json | null
          name: string
          parameter: string
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
          difficulty_focus?: string | null
          id?: string
          is_custom?: boolean
          metadata?: Json | null
          name?: string
          parameter?: string
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
        ]
      }
      rooms: {
        Row: {
          category_filter: string | null
          code: string
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
            foreignKeyName: "rooms_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
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
      [_ in never]: never
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
      increment_profile_score: {
        Args: { p_points: number; p_user_id: string }
        Returns: undefined
      }
      increment_question_stats: {
        Args: { correct_ids: string[]; question_ids: string[] }
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
