/** Client-side shapes for the private-league hub. Mirror the API responses from
 *  lib/fantasy/leagues.ts + chat.ts, re-declared here so client components don't
 *  import the `server-only` libs. */

import type { BoardPlayer } from "@/lib/fantasy/board";

export const CHAT_EMOJI = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;

export interface LeagueRow {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; points: number; played: number; lastGwPoints: number | null;
  isMe: boolean; movement: number | null;
}

export interface LeagueDetail {
  league: {
    id: string; name: string; code: string; memberCount: number;
    isPublic: boolean; isMember: boolean; isOwner: boolean; stakes: string | null; imageUrl: string | null;
    kind: string; club: string | null; official: boolean; canContribute: boolean;
  };
  gw: { number: number; phase: "pre" | "live" | "final"; deadline: string | null };
  season: LeagueRow[];
  month: { key: string; label: string; gws: number[]; rows: LeagueRow[] };
  lastMonth: {
    key: string; label: string;
    winner: { userId: string; username: string | null; displayName: string | null; points: number };
  } | null;
  /** Pre-deadline readiness (Phase 4b, AC1) — how many members have a squad in,
   *  and who's still to build one. Server-computed only in the "pre" phase
   *  (one extra query); null hides the block outright — either the phase isn't
   *  "pre" or the query came back empty-handed. */
  readiness: {
    squadsIn: number; totalMembers: number;
    /** Members with no squad yet — the count is the true total (for "+k more"
     *  math), `avatars` is capped at 5 for the rail. */
    waitingCount: number;
    waitingAvatars: { userId: string; name: string; avatarUrl: string | null }[];
  } | null;
  /** Post-gameweek recap (Phase 4b, AC2) — final phase only, derived from the
   *  season table already computed for this response (no extra query). `riser`
   *  is null when nobody's movement was positive (e.g. gw1, nothing to compare
   *  against) — the card then shows the winner alone. */
  gwRecap: {
    gw: number;
    winner: { userId: string; name: string; avatarUrl: string | null; points: number };
    riser: { userId: string; name: string; avatarUrl: string | null; places: number } | null;
  } | null;
}

export interface ChatReaction { emoji: string; count: number; mine: boolean }
export interface PlayerCard {
  id: number; name: string; club: string; pos: string; price: number;
  avatarUrl: string | null; note: string | null;
}
export interface PollCard {
  question: string;
  options: { text: string; votes: number }[];
  totalVotes: number;
  myVote: number | null;
}
export interface SquadCard {
  players: BoardPlayer[];
  xi: number[]; bench: number[];
  captain: number | null; vice: number | null;
}
export interface NewsCard { title: string; source: string; url: string; image: string | null; internal: boolean }
export interface CompareCard { a: PlayerCard; b: PlayerCard }
export interface GifCard { url: string; preview: string; width: number; height: number }
/** One photo dropped straight into the chat (Phase 4a, AC4). */
export interface ImageCard { url: string; width: number; height: number }
/** A feed post shared into the chat (Phase 4a, AC5) — resolved fresh server-side
 *  on every read; `available: false` renders the muted stub. */
export interface FeedShareCard {
  eventId: string; available: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
  text: string | null; summary: string | null;
}
/** "system" (Phase 4b, AC3) — an auto-posted line (gw live / member joined /
 *  lead change), never authored by a member. Rendered centred and muted, no
 *  avatar or bubble, and excluded from unread badges (see leagues.ts/home.ts). */
export type ChatKind = "text" | "player" | "poll" | "captain" | "squad" | "news" | "compare" | "gif" | "image" | "feed" | "system";
export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean; reactions: ChatReaction[];
  kind: ChatKind; player?: PlayerCard | null; poll?: PollCard | null; squad?: SquadCard | null;
  news?: NewsCard | null; compare?: CompareCard | null; gif?: GifCard | null;
  image?: ImageCard | null; feed?: FeedShareCard | null;
  /** Replies (Phase 4a, AC2) — the parent message's id and a resolved
   *  {name, summary} for the quoted-context strip. Both null/undefined when
   *  this isn't a reply, or when the schema doesn't support replies yet. */
  parentId?: string | null;
  replyTo?: { name: string; summary: string } | null;
}
export interface ChatMoment { emoji: string; text: string; gw: number }
/** What this environment's schema currently supports (Phase 4a, AC1) — false
 *  hides the reply/pin affordances outright rather than offering a control
 *  that would silently no-op pre-migration. */
export interface ChatCapabilities { replies: boolean; pin: boolean }
export interface ChatData {
  league: { name: string; stakes: string | null; isOwner: boolean };
  /** The gameweek this thread is for, the current one, and whether it's a
   *  read-only archive (a past gameweek). `gameweeks` drives the selector. */
  gw: number;
  currentGw: number;
  readOnly: boolean;
  /** Why the thread is read-only for this viewer (browsing a club/founder league
   *  you're not a member of). Null when it's your own live thread or a gw archive. */
  notice?: string | null;
  gameweeks: number[];
  messages: ChatMessage[];
  moments: ChatMoment[];
  capabilities: ChatCapabilities;
  /** The pinned message banner (Phase 4a, AC6) — null when nothing's pinned,
   *  pinning isn't supported yet, or the pinned message no longer resolves. */
  pinned: { id: string; name: string; summary: string } | null;
}

/** Client-safe mirror of lib/fantasy/chat.ts's summariseLeagueMessage — used
 *  for the reply composer's quoted-context preview, working off the already-
 *  resolved card fields (no server-only payload access needed on the client).
 *  Mirrors CHAT_EMOJI above in being duplicated rather than imported, since
 *  chat.ts is `server-only`. */
export function summariseChatMessage(m: Pick<ChatMessage, "kind" | "body" | "news" | "poll">): string {
  switch (m.kind) {
    case "player": return "shared a player";
    case "captain": return "shared their captain";
    case "squad": return "shared their squad";
    case "news": return m.news?.title || "shared some news";
    case "compare": return "shared a comparison";
    case "gif": return "sent a GIF";
    case "image": return "sent a photo";
    case "feed": return "shared a post";
    case "poll": return m.poll?.question || "started a poll";
    case "system": return m.body;
    default: return m.body;
  }
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
