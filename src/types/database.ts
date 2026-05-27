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
          entity: string;
          entity_type: string;
          question: string;
          options: { A: string; B: string; C: string; D: string };
          answer: "A" | "B" | "C" | "D";
          difficulty: "easy" | "medium" | "hard";
          category: string;
          era: string | null;
          tags: string[];
          status: "active" | "review" | "retired";
          source_pack_id: string | null;
          times_answered: number;
          times_correct: number;
          created_at: string;
        };
        Insert: {
          entity: string;
          entity_type: string;
          question: string;
          options: Record<string, string>;
          answer: string;
          difficulty?: string;
          category?: string;
          era?: string | null;
          tags?: string[];
          status?: string;
          source_pack_id?: string | null;
          times_answered?: number;
          times_correct?: number;
          id?: string;
          created_at?: string;
        };
        Update: {
          entity?: string;
          entity_type?: string;
          question?: string;
          options?: Record<string, string>;
          answer?: string;
          difficulty?: string;
          category?: string;
          era?: string | null;
          tags?: string[];
          status?: string;
          source_pack_id?: string | null;
          times_answered?: number;
          times_correct?: number;
          id?: string;
        };
        Relationships: [];
      };
      user_question_history: {
        Row: {
          id: string;
          user_id: string;
          question_id: string;
          entity: string;
          correct: boolean | null;
          played_at: string;
        };
        Insert: {
          user_id: string;
          question_id: string;
          entity: string;
          correct?: boolean | null;
          id?: string;
          played_at?: string;
        };
        Update: {
          user_id?: string;
          question_id?: string;
          entity?: string;
          correct?: boolean | null;
          id?: string;
          played_at?: string;
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
