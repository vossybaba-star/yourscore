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
/** One video dropped straight into the chat (Phase 2c) — never autoplays;
 *  the client always renders it tap-to-play. */
export interface VideoCard { url: string; posterUrl: string | null; width: number; height: number; durationMs: number }
/** A feed post shared into the chat (Phase 4a, AC5) — resolved fresh server-side
 *  on every read; `available: false` renders the muted stub. `image` (Phase 2c)
 *  is a thumbnail fallback — first image, GIF still, or a video post's poster. */
export interface FeedShareCard {
  eventId: string; available: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
  text: string | null; summary: string | null;
  image: string | null;
}
/** A league-mate challenge card (Phase 1C) — mirrors challenges.ts's
 *  ChallengeCardData. Hydrated fresh on every read; the viewer compares their
 *  own id against opponentId/challengerId to decide what's actionable. */
export interface ChallengeCard {
  challengeId: string;
  status: string;
  gameName: string;
  quizName: string;
  challengerId: string; challengerName: string; challengerAvatarUrl: string | null;
  opponentId: string; opponentName: string; opponentAvatarUrl: string | null;
  expiresAt: string;
  h2hId: string | null;
  winnerId: string | null;
  /** Phase 3A — the challenger's optional line, quoted under the header. */
  message: string | null;
  createdAt: string;
  /** Phase 3B — "duel" for Quiz Duel, "scorecard" for Quiz Battle/Gameday
   *  Quiz. Drives ChallengeCardMsg's duel-aware pending/active/awaiting_opponent
   *  copy without hard-coding game_type strings into the component. */
  gameMode: "duel" | "scorecard";
  /** Phase 3B, duel only — has each side finished THEIR OWN attempt yet.
   *  Always false (and unused) for a scorecard card — never render a score
   *  off these, only whether someone's played. */
  challengerDone: boolean;
  opponentDone: boolean;
  /** Phase 3C — the raw game_type ("quiz_battle" / "quiz_duel" /
   *  "gameday_quiz"). gameMode above only tells duel from scorecard (one
   *  bit); a Rematch tap needs the actual game to preselect in
   *  ChallengePrepSheet, which quiz_battle and gameday_quiz can't be told
   *  apart by via gameMode alone (both are "scorecard"). */
  gameType: string;
  /** Phase 4A (Games tab) — when this row completed, null until it does. */
  completedAt: string | null;
  /** Phase 4A (Games tab, recent results) — the two sides' final scores,
   *  ONLY EVER set once status is "completed" (null otherwise, always). */
  challengerScore: number | null;
  opponentScore: number | null;
}

// ── Games tab (Phase 4A) ──────────────────────────────────────────────────
// Mirrors lib/fantasy/games.ts's own return shapes, same duplication idiom
// as everything else in this file (games.ts is `server-only`).

export interface GamesActionCard extends ChallengeCard {
  action: "decline_or_play" | "play" | "resume";
}
export interface GamesLeaderboardRow {
  userId: string; name: string; avatarUrl: string | null;
  played: number; wins: number; draws: number; losses: number; points: number;
}
export interface GamesSummary {
  open: number; wins: number; losses: number; draws: number;
  streakType: "win" | "draw" | "loss" | null; streakCount: number;
}
/** `howItWorks` (Phase 4D) — the 2-3 line breakdown the game detail sheet
 *  renders verbatim, mirroring games.ts's own GamesAvailableGame. */
export interface GamesAvailableGame { id: string; name: string; shortDesc: string; typicalDuration: string; howItWorks: string[] }
export interface GamesOverview {
  actionRequired: GamesActionCard[];
  open: ChallengeCard[];
  recentResults: ChallengeCard[];
  leaderboard: GamesLeaderboardRow[];
  mySummary: GamesSummary | null;
  availableGames: GamesAvailableGame[];
}

// ── Hub Games module pulse (Phase 4B) / History "GAMES" block ────────────
// Mirror games.ts's GamesPulse / GamesHistoryEntry, same duplication idiom
// as the rest of this file (games.ts is `server-only`).

export interface GamesPulse {
  openCount: number;
  myActionCount: number;
  lastResultLine: string | null;
}

export interface GamesHistoryEntry {
  challengeId: string;
  h2hId: string | null;
  gameId: string; gameName: string;
  challengerId: string; challengerName: string; challengerAvatarUrl: string | null;
  opponentId: string; opponentName: string; opponentAvatarUrl: string | null;
  winnerId: string | null;
  challengerScore: number | null; opponentScore: number | null;
  completedAt: string;
}
/** "system" (Phase 4b, AC3) — an auto-posted line (gw live / member joined /
 *  lead change), never authored by a member. Rendered centred and muted, no
 *  avatar or bubble, and excluded from unread badges (see leagues.ts/home.ts). */
/** "challenge_result" (Phase 3A) — the separate, compact "ping" posted once
 *  when a challenge completes, on top of the original "challenge" card
 *  updating in place (see challenges.ts's postCompletedResult). Carries the
 *  same `challenge` card payload as "challenge", just rendered smaller. */
export type ChatKind = "text" | "player" | "poll" | "captain" | "squad" | "news" | "compare" | "gif" | "image" | "video" | "feed" | "system" | "challenge" | "challenge_result";
export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean; reactions: ChatReaction[];
  kind: ChatKind; player?: PlayerCard | null; poll?: PollCard | null; squad?: SquadCard | null;
  news?: NewsCard | null; compare?: CompareCard | null; gif?: GifCard | null;
  image?: ImageCard | null; video?: VideoCard | null; feed?: FeedShareCard | null; challenge?: ChallengeCard | null;
  /** Replies (Phase 4a, AC2) — the parent message's id and a resolved
   *  {name, summary} for the quoted-context strip. Both null/undefined when
   *  this isn't a reply, or when the schema doesn't support replies yet. */
  parentId?: string | null;
  replyTo?: { name: string; summary: string } | null;
  /** Real, resolved @username mentions in a "text"-kind message (Phase 1A) —
   *  server-preferred from stored payload.mentions, regex+resolve fallback
   *  for a legacy message with none. Null for every other kind, or a
   *  message with no mentions. */
  mentionedUsers?: { username: string; userId: string }[] | null;
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
    case "video": return "shared a video";
    case "feed": return "shared a post";
    case "poll": return m.poll?.question || "started a poll";
    case "challenge": return "sent a challenge";
    case "challenge_result": return "posted a challenge result";
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
