export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
          social_handle: string | null;
          social_platform: "google" | "instagram" | "tiktok" | null;
          total_score: number;
          games_played: number;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          social_handle?: string | null;
          social_platform?: "google" | "instagram" | "tiktok" | null;
          total_score?: number;
          games_played?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          social_handle?: string | null;
          social_platform?: "google" | "instagram" | "tiktok" | null;
          total_score?: number;
          games_played?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          home_team: string;
          away_team: string;
          match_date: string;
          tournament: string;
          status: "upcoming" | "live" | "half_time" | "completed";
          api_match_id: string | null;
          created_at: string;
        };
        Insert: {
          home_team: string;
          away_team: string;
          match_date: string;
          id?: string;
          tournament?: string;
          status?: "upcoming" | "live" | "half_time" | "completed";
          api_match_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          home_team?: string;
          away_team?: string;
          match_date?: string;
          tournament?: string;
          status?: "upcoming" | "live" | "half_time" | "completed";
          api_match_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          code: string;
          name: string;
          match_id: string | null;
          type: "private" | "sponsored";
          sponsor_name: string | null;
          sponsor_logo_url: string | null;
          prize_description: string | null;
          created_by: string | null;
          status: "lobby" | "live" | "completed";
          whatsapp_channel_id: string | null;
          max_players: number;
          created_at: string;
        };
        Insert: {
          code: string;
          name: string;
          id?: string;
          match_id?: string | null;
          type?: "private" | "sponsored";
          sponsor_name?: string | null;
          sponsor_logo_url?: string | null;
          prize_description?: string | null;
          created_by?: string | null;
          status?: "lobby" | "live" | "completed";
          whatsapp_channel_id?: string | null;
          max_players?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          match_id?: string | null;
          type?: "private" | "sponsored";
          sponsor_name?: string | null;
          sponsor_logo_url?: string | null;
          prize_description?: string | null;
          created_by?: string | null;
          status?: "lobby" | "live" | "completed";
          whatsapp_channel_id?: string | null;
          max_players?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          joined_at: string;
          whatsapp_number: string | null;
          notification_consent: boolean;
        };
        Insert: {
          room_id: string;
          user_id: string;
          id?: string;
          joined_at?: string;
          whatsapp_number?: string | null;
          notification_consent?: boolean;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          joined_at?: string;
          whatsapp_number?: string | null;
          notification_consent?: boolean;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          match_id: string | null;
          question_text: string;
          option_a: string;
          option_b: string;
          option_c: string;
          option_d: string;
          correct_answer: "a" | "b" | "c" | "d";
          explanation: string | null;
          difficulty: "easy" | "medium" | "hard";
          category: "player_fact" | "match_history" | "tournament" | "half_time" | null;
          timing_hint: "pre_match" | "first_half" | "half_time" | "second_half" | null;
          approved: boolean;
          created_at: string;
        };
        Insert: {
          question_text: string;
          option_a: string;
          option_b: string;
          option_c: string;
          option_d: string;
          correct_answer: "a" | "b" | "c" | "d";
          id?: string;
          match_id?: string | null;
          explanation?: string | null;
          difficulty?: "easy" | "medium" | "hard";
          category?: "player_fact" | "match_history" | "tournament" | "half_time" | null;
          timing_hint?: "pre_match" | "first_half" | "half_time" | "second_half" | null;
          approved?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          match_id?: string | null;
          question_text?: string;
          option_a?: string;
          option_b?: string;
          option_c?: string;
          option_d?: string;
          correct_answer?: "a" | "b" | "c" | "d";
          explanation?: string | null;
          difficulty?: "easy" | "medium" | "hard";
          category?: "player_fact" | "match_history" | "tournament" | "half_time" | null;
          timing_hint?: "pre_match" | "first_half" | "half_time" | "second_half" | null;
          approved?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      question_events: {
        Row: {
          id: string;
          room_id: string;
          question_id: string;
          fired_at: string;
          closes_at: string;
          status: "live" | "closed";
          sequence_number: number | null;
        };
        Insert: {
          room_id: string;
          question_id: string;
          closes_at: string;
          id?: string;
          fired_at?: string;
          status?: "live" | "closed";
          sequence_number?: number | null;
        };
        Update: {
          id?: string;
          room_id?: string;
          question_id?: string;
          fired_at?: string;
          closes_at?: string;
          status?: "live" | "closed";
          sequence_number?: number | null;
        };
        Relationships: [];
      };
      answers: {
        Row: {
          id: string;
          question_event_id: string;
          user_id: string;
          room_id: string;
          selected_answer: "a" | "b" | "c" | "d";
          is_correct: boolean;
          time_taken_ms: number;
          points_awarded: number;
          answered_at: string;
        };
        Insert: {
          question_event_id: string;
          user_id: string;
          room_id: string;
          selected_answer: "a" | "b" | "c" | "d";
          is_correct: boolean;
          time_taken_ms: number;
          points_awarded: number;
          id?: string;
          answered_at?: string;
        };
        Update: {
          id?: string;
          question_event_id?: string;
          user_id?: string;
          room_id?: string;
          selected_answer?: "a" | "b" | "c" | "d";
          is_correct?: boolean;
          time_taken_ms?: number;
          points_awarded?: number;
          answered_at?: string;
        };
        Relationships: [];
      };
      room_scores: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          total_score: number;
          correct_answers: number;
          total_answers: number;
          current_streak: number;
          best_streak: number;
          rank: number | null;
          updated_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          id?: string;
          total_score?: number;
          correct_answers?: number;
          total_answers?: number;
          current_streak?: number;
          best_streak?: number;
          rank?: number | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          total_score?: number;
          correct_answers?: number;
          total_answers?: number;
          current_streak?: number;
          best_streak?: number;
          rank?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
