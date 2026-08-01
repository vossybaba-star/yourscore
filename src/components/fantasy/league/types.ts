/** Client-side shapes for the private-league hub. Mirror the API responses from
 *  lib/fantasy/leagues.ts + chat.ts, re-declared here so client components don't
 *  import the `server-only` libs. */

export const CHAT_EMOJI = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;

export interface LeagueRow {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; points: number; played: number; lastGwPoints: number | null;
  isMe: boolean; movement: number | null;
}

export interface LeagueDetail {
  league: {
    id: string; name: string; code: string; memberCount: number;
    isPublic: boolean; isMember: boolean; isOwner: boolean; stakes: string | null;
  };
  gw: { number: number; phase: "pre" | "live" | "final"; deadline: string | null };
  season: LeagueRow[];
  month: { key: string; label: string; gws: number[]; rows: LeagueRow[] };
  lastMonth: {
    key: string; label: string;
    winner: { userId: string; username: string | null; displayName: string | null; points: number };
  } | null;
}

export interface ChatReaction { emoji: string; count: number; mine: boolean }
export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean; reactions: ChatReaction[];
}
export interface ChatMoment { emoji: string; text: string; gw: number }
export interface ChatData {
  league: { name: string; stakes: string | null; isOwner: boolean };
  messages: ChatMessage[];
  moments: ChatMoment[];
}

export interface HistoryGw {
  gw: number;
  winner: { userId: string; name: string; points: number } | null;
  yourGwRank: number | null;
  yourGwPoints: number | null;
  table: LeagueRow[];
  highlights: ChatMoment[];
}
export interface LeagueHistoryData {
  league: { name: string; code: string; isMember: boolean };
  gameweeks: HistoryGw[];
}

export const nameOf = (r: { username: string | null; displayName: string | null }) =>
  r.displayName ?? (r.username ? `@${r.username}` : "Player");
