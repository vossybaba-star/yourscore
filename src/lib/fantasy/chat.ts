import "server-only";
/**
 * League chat — the banter layer, the design's launch commitment (D:105-107).
 *
 * Messages ride the existing polymorphic comments table (subject_type
 * 'fantasy_league'), so moderation, soft-delete and the 280-char discipline are
 * inherited, and migration 85's RLS guard makes a league's thread member-only
 * all the way down to raw REST.
 *
 * The auto-generated moments ("X took a -4 and it paid off", regret receipts)
 * are NOT stored messages: they're derived on read from the latest scored
 * gameweek's entries. No fake system user, nothing to go stale on a re-score,
 * and a fresh conversation-starter set appears the moment a gameweek lands.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { commentRejection } from "@/lib/moderation";
import { HttpError } from "./server";
import { enginePool, clientPool } from "./pool";
import { pitchName, type BoardPlayer } from "./board";
import { loadLeagueFeed, loadFeedEvent, isPostMediaUrl, isPostVideoUrl, MAX_POST_VIDEO_MS_SERVER, type FeedEvent } from "./feed";
import { notifyFantasy } from "./notify";
import { hiddenActorIds, blockedActorIds } from "@/lib/social/safety";
import { extractMentions, resolveUsernames, resolveMentionEntities, type MentionEntity } from "@/lib/mentions";
import { challengeCardsFor, type ChallengeCardData } from "./challenges";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;
/** Loose result shape for a probe/fallback query pair whose two `.select()`
 *  column lists differ (AC1) — TS would otherwise refuse to let the same `let`
 *  hold both shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProbeResult = { data: any; error: any };

/** The reaction set (founder's pick). Kept small and validated so the column
 *  never fills with arbitrary strings. */
export const CHAT_EMOJI = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;
export type ChatEmoji = (typeof CHAT_EMOJI)[number];
export interface ChatReaction { emoji: string; count: number; mine: boolean }

/** A shared player card (Phase 1b) — resolved from the pool, never trusted from
 *  the payload beyond the id. */
export interface PlayerCard {
  id: number; name: string; club: string; pos: string; price: number;
  avatarUrl: string | null; note: string | null;
}
/** A poll card — the definition lives in the message payload, the tallies in
 *  comment_poll_votes. */
export interface PollCard {
  question: string;
  options: { text: string; votes: number }[];
  totalVotes: number;
  myVote: number | null;
}
/** A shared squad card — the sharer's XI + bench as a pitch board (snapshotted at
 *  share time; resolved to markers from the pool). */
export interface SquadCard {
  players: BoardPlayer[];
  xi: number[]; bench: number[];
  captain: number | null; vice: number | null;
}
/** A shared news article — self-contained (the fields are stored in the payload,
 *  nothing to resolve). */
export interface NewsCard { title: string; source: string; url: string; image: string | null; internal: boolean }
/** A shared player comparison — two pool players side by side. */
export interface CompareCard { a: PlayerCard; b: PlayerCard }
/** A GIF (from the Tenor picker) — the media URL, a lighter preview, and the
 *  natural dimensions so the bubble reserves the right space (no layout shift). */
export interface GifCard { url: string; preview: string; width: number; height: number }
/** One photo dropped straight into the chat (Phase 4a, AC4) — uploaded via the
 *  same post-media pipeline the feed composer uses, one per message. */
export interface ImageCard { url: string; width: number; height: number }
/** One video dropped straight into the chat (Phase 2c) — uploaded via the
 *  same lib/postVideo.ts pipeline the feed composer uses, one per message.
 *  Never autoplays in chat — the client always renders it tap-to-play. */
export interface VideoCard { url: string; posterUrl: string | null; width: number; height: number; durationMs: number }
/** A feed post shared into the chat (Phase 4a, AC5) — a compact pointer card,
 *  resolved server-side each read so it always reflects the post's current
 *  state (edited/deleted/still there). `available: false` renders the muted
 *  stub instead of trusting stale text baked in at share time. */
export interface FeedShareCard {
  eventId: string; available: boolean;
  actorName: string | null; actorAvatarUrl: string | null;
  /** Up to 3 lines of the post's own text, when it has any. */
  text: string | null;
  /** A one-line kind marker ("shared a photo"/"a GIF"/"a poll") when the post
   *  has no text of its own to show. */
  summary: string | null;
  /** A thumbnail for the shared post (Phase 2c) — the first image, the GIF's
   *  still, or a video post's poster, in that order. Null for a text/poll-
   *  only post, or when the target's unavailable. Never re-uploaded — this
   *  is always a reference to the post's own existing asset. */
  image: string | null;
}
/** "system" (Phase 4b, AC3) — an auto-posted line (gw live / member joined /
 *  lead change). Never authored by a member; user_id is just whoever the FK
 *  needs (the joiner for a join line, the league owner otherwise) — the UI
 *  never shows a system row's author. */
export type ChatKind = "text" | "player" | "poll" | "captain" | "squad" | "news" | "compare" | "gif" | "image" | "video" | "feed" | "system" | "challenge" | "challenge_result";

export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean;
  reactions: ChatReaction[];
  kind: ChatKind;
  /** player + captain both carry a PlayerCard (captain is labelled by the UI). */
  player?: PlayerCard | null;
  poll?: PollCard | null;
  squad?: SquadCard | null;
  news?: NewsCard | null;
  compare?: CompareCard | null;
  gif?: GifCard | null;
  image?: ImageCard | null;
  video?: VideoCard | null;
  feed?: FeedShareCard | null;
  /** A league-mate challenge card (Phase 1C) — hydrated fresh on every read
   *  (challenges.ts's challengeCardsFor), same "never trust the payload
   *  beyond an id" idiom as feed/player/etc. */
  challenge?: ChallengeCardData | null;
  /** Replies (Phase 4a, AC2) — the message this one is quoting, and a resolved
   *  {name, summary} for the quoted-context strip. Both null for a non-reply,
   *  and parentId/replyTo both come back null wholesale when the underlying
   *  parent_id column isn't migrated yet (ChatData.capabilities.replies). */
  parentId?: string | null;
  replyTo?: { name: string; summary: string } | null;
  /** Real, resolved @username mentions in a "text"-kind message (Phase 1A) —
   *  prefers this message's own stored payload.mentions, falls back to the
   *  legacy regex+resolve for a message with none. Null for every other
   *  kind (system/poll/player/etc. don't carry user-authored free text worth
   *  linkifying here) or a message with no mentions at all. */
  mentionedUsers?: { username: string; userId: string }[] | null;
}
export interface ChatMoment { emoji: string; text: string; gw: number }
/** What this environment's schema currently supports (Phase 4a, AC1) — false
 *  when migration 252 hasn't landed yet, so the UI can hide the reply/pin
 *  affordances outright rather than offer a control that silently no-ops. */
export interface ChatCapabilities { replies: boolean; pin: boolean }

const MAX_POLL_OPTIONS = 4;

/** One-line, emoji-free summary of a league message for a card/tile — kind-aware
 *  so a shared card never leaks its raw internal body ("shared their captain").
 *  The tile draws its own SVG icon, so unlike the home feed's previewOf this
 *  returns plain words (no leading emoji), per the no-emoji-as-UI-chrome rule. */
export function summariseLeagueMessage(kind: string | null, body: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "player": return "shared a player";
    case "captain": return "shared their captain";
    case "squad": return "shared their squad";
    case "news": return typeof p.title === "string" ? p.title : "shared some news";
    case "compare": return "shared a comparison";
    case "gif": return "sent a GIF";
    case "image": return "sent a photo";
    case "video": return "shared a video";
    case "feed": return "shared a post";
    case "poll": return typeof p.question === "string" ? p.question : "started a poll";
    case "challenge": return "sent a challenge";
    case "system": return body;
    default: return body;
  }
}

async function requireMemberLeague(db: Db, code: string, userId: string) {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id, name, owner_id, stakes").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!member) throw new HttpError(403, "not in this league");
  return league as { id: string; name: string; owner_id: string; stakes: string | null };
}

/** The league's activity feed — the same manager moves the global feed shows, but
 *  filtered to THIS league's members. Powers the Hub's "Recent activity" rail and
 *  the full league feed page. Member-only. */
export async function leagueFeed(db: Db, userId: string, code: string, limit = 20): Promise<{ events: FeedEvent[] }> {
  const league = await requireMemberLeague(db, code, userId);
  const { data: members } = await db.from("fantasy_league_members").select("user_id").eq("league_id", league.id);
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  return { events: await loadLeagueFeed(db, userId, memberIds, limit) };
}

/** The league's member roster — id/username/display_name/avatar_url only, no
 *  points/tables/anything leagueDetail() computes (Phase 1A). Powers the
 *  league chat's @mention autocomplete: fetched ONCE on mount so members can
 *  be matched instantly, client-side, on every keystroke, rather than paying
 *  a network round trip (let alone leagueDetail's season/month table cost)
 *  just to populate a dropdown. Blocked accounts (bidirectional) never
 *  appear — same "never appears, anywhere" rule the global mention search
 *  applies (users/search route.ts). Member-only, same gate as the rest of
 *  the chat surface. */
export async function leagueMembers(
  db: Db, userId: string, code: string,
): Promise<{
  ownerId: string;
  members: { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null }[];
}> {
  const league = await requireMemberLeague(db, code, userId);
  const { data: members } = await db.from("fantasy_league_members").select("user_id").eq("league_id", league.id).range(0, 9999);
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== userId);
  if (!memberIds.length) return { ownerId: league.owner_id, members: [] };
  const blocked = await blockedActorIds(db, userId);
  const visibleIds = memberIds.filter((id) => !blocked.has(id));
  if (!visibleIds.length) return { ownerId: league.owner_id, members: [] };
  // No `.not("username", "is", null)` here anymore: handle-less members are
  // real league members too — the CALLER decides what needs a handle (mention
  // autocomplete filters client-side; the chat tray's challenge picker must
  // see everyone, or a league of handle-less members reads as empty).
  const { data: profs } = await db.from("profiles")
    .select("id, username, display_name, avatar_url").in("id", visibleIds);
  return {
    ownerId: league.owner_id,
    members: ((profs ?? []) as { id: string; username: string | null; display_name: string | null; avatar_url: string | null }[])
      .map((p) => ({ userId: p.id, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url })),
  };
}

/** The latest gameweek any member has a scored entry for, or null. */
async function latestScoredGw(db: Db, memberIds: string[]): Promise<number | null> {
  const { data: latest } = await db.from("fantasy_entries")
    .select("gw").in("user_id", memberIds).not("scored_at", "is", null)
    .order("gw", { ascending: false }).limit(1).maybeSingle();
  return latest ? (latest.gw as number) : null;
}

/** The talking points for ONE scored gameweek — the chat rail (latest gw) and a
 *  History recap (a specific past gw) are the same derivation. */
export async function momentsForGw(db: Db, memberIds: string[], gw: number): Promise<ChatMoment[]> {
  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, points, hits, cash_points, chip, captain, captain_used, round_done_at, round_correct, transfers, points_breakdown")
    .eq("gw", gw).in("user_id", memberIds).not("scored_at", "is", null).range(0, 9999);
  const rows = (entries ?? []) as {
    user_id: string; points: number | null; hits: number; cash_points: number;
    chip: string | null; captain: number | null; captain_used: number | null;
    round_done_at: string | null; round_correct: number;
    transfers: { out: number; in: number }[] | null;
    points_breakdown: { id: number; points: number }[] | null;
  }[];
  if (rows.length < 2) return []; // a league of one has nobody to rib

  const { data: profs } = await db.from("profiles")
    .select("id, display_name, username").in("id", rows.map((r) => r.user_id));
  const nameOf = (id: string) => {
    const p = (profs ?? []).find((x) => x.id === id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "Someone");
  };
  const playerName = new Map(enginePool().map((p) => [p.id, p.name]));

  const moments: ChatMoment[] = [];
  const top = [...rows].sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  if (top?.points != null) {
    moments.push({
      emoji: "👑",
      text: top.hits > 0
        ? `${nameOf(top.user_id)} took a −${top.hits * 4} and STILL topped the week with ${top.points}. It paid off.`
        : `${nameOf(top.user_id)} topped the week with ${top.points}.`,
      gw,
    });
  }
  for (const r of rows) {
    if (r.captain != null && r.captain_used != null && r.captain !== r.captain_used) {
      moments.push({
        emoji: "🎖️",
        text: `${nameOf(r.user_id)}'s captain ${playerName.get(r.captain) ?? ""} blanked — ${playerName.get(r.captain_used) ?? "the vice"} took the armband instead.`.replace("  ", " "),
        gw,
      });
    }
    if (r.chip === "triple_captain") moments.push({ emoji: "©️", text: `${nameOf(r.user_id)} went Triple Captain this week.`, gw });
    if (r.cash_points > 0) moments.push({ emoji: "🧠", text: `${nameOf(r.user_id)}'s quiz bank overflowed — +${r.cash_points} points straight from knowledge.`, gw });
    if (!r.round_done_at) moments.push({ emoji: "😴", text: `${nameOf(r.user_id)} forgot the round this week. The team played itself.`, gw });

    // TRANSFER EVENTS — derived from the entry's own transfer log + point
    // breakdown, so they only exist when a real move was made.
    const transfers = (r.transfers ?? []).filter((t) => t && typeof t.in === "number");
    if (transfers.length) {
      const ptOf = new Map((r.points_breakdown ?? []).map((b) => [b.id, b.points]));
      // The move that landed: the incoming player who returned the most, if he hauled.
      let bestIn: number | null = null, bestPts = -1;
      for (const t of transfers) {
        const p = ptOf.get(t.in) ?? 0;
        if (p > bestPts) { bestPts = p; bestIn = t.in; }
      }
      if (bestIn != null && bestPts >= 8) {
        moments.push({ emoji: "🔁", text: `${nameOf(r.user_id)} brought in ${playerName.get(bestIn) ?? "a player"} and he returned ${bestPts}.`, gw });
      }
      // A points hit — did the incomings out-earn the −4s? (Skip the topper: the
      // 👑 line already tells that story.)
      if (r.hits > 0 && r.user_id !== top?.user_id) {
        const cost = r.hits * 4;
        const inPts = transfers.reduce((s, t) => s + (ptOf.get(t.in) ?? 0), 0);
        moments.push({
          emoji: "💸",
          text: `${nameOf(r.user_id)} took a −${cost} hit for extra transfers${inPts >= cost ? ` and it paid off (+${inPts} from them)` : ""}.`,
          gw,
        });
      }
    }
  }
  return moments.slice(0, 6);
}

export async function leagueChat(db: Db, userId: string, code: string, gwParam?: number | null) {
  // Club and Founder leagues are OPEN to read (founder, 3 Aug — "go into other
  // clubs' leagues to see what they talk about"). A non-member gets the chat in
  // read-only mode with a notice; every other league stays members-only.
  // pinned_message_id is probed with a fallback (AC1/AC6): pre-migration the
  // column doesn't exist yet, and PostgREST fails the WHOLE select if an unknown
  // column is named, so a first-try-then-fallback is the only way to keep the
  // rest of the league loading while the column is absent.
  let pinSupported = true;
  let leagueQuery = await db.from("fantasy_leagues")
    .select("id, name, owner_id, stakes, kind, club, pinned_message_id").eq("join_code", code.toUpperCase()).maybeSingle() as ProbeResult;
  if (leagueQuery.error) {
    pinSupported = false;
    leagueQuery = await db.from("fantasy_leagues")
      .select("id, name, owner_id, stakes, kind, club").eq("join_code", code.toUpperCase()).maybeSingle() as ProbeResult;
  }
  const leagueRow = leagueQuery.data;
  if (!leagueRow) throw new HttpError(404, "league not found");
  const league = leagueRow as {
    id: string; name: string; owner_id: string; stakes: string | null; kind: string | null; club: string | null;
    pinned_message_id?: string | null;
  };

  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  const isMember = !!member;
  const openToRead = league.kind === "club" || league.kind === "founder";
  if (!isMember && !openToRead) throw new HttpError(403, "not in this league");

  // A non-member is browsing — tell them why they can't post. Members get the
  // normal live thread.
  const notice = isMember ? null
    : league.kind === "club"
      ? `Viewing the ${league.club ?? "club"} fans' league. Only ${league.club ?? "its"} fans can post here.`
      : "Viewing the Founder League. The first 1,000 managers to build a squad post here.";

  // Opening the chat marks it read — advance this member's last_read_at so the
  // league's unread badge clears. AWAITED (not fire-and-forget): a serverless
  // handler can be frozen the moment it returns, dropping an un-awaited write, so
  // the read would never persist. A failed write just leaves the badge up. Only
  // members have a read cursor — skip it for a browsing non-member.
  if (isMember) {
    await db.from("fantasy_league_reads").upsert(
      { league_id: league.id, user_id: userId, last_read_at: new Date().toISOString() },
      { onConflict: "league_id,user_id" },
    );
  }
  const { data: members } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).range(0, 9999);
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);

  // Per-gameweek chat: a message belongs to the gameweek that was underway when it
  // was sent (bucketed by created_at against the gameweek windows — no per-message
  // stamp, so this works for messages posted before this feature existed). The
  // CURRENT gameweek's thread is live; a past gameweek's is a read-only archive.
  const { data: gwRows } = await db.from("fantasy_gameweeks")
    .select("gw, window_start, status, mode").order("gw", { ascending: true });
  const allGws = (gwRows ?? []) as { gw: number; window_start: string; status: string; mode: string }[];
  const live = allGws.filter((g) => g.mode === "live");
  const gws = live.length ? live : allGws;
  const currentGw = (gws.find((g) => g.status !== "final") ?? gws[gws.length - 1])?.gw ?? 1;
  const viewGw = gwParam != null && gws.some((g) => g.gw === gwParam) ? gwParam : currentGw;
  // Read-only when browsing an archived gameweek OR browsing as a non-member.
  const readOnly = viewGw !== currentGw || !isMember;
  // The gameweeks worth offering in the selector: up to and including the current.
  const gameweeks = gws.filter((g) => g.gw <= currentGw).map((g) => g.gw);

  // Time bounds for the viewed gameweek. GW1 (index 0) has no lower bound so it
  // scoops up pre-season banter; the last/current gw has no upper bound.
  const vi = gws.findIndex((g) => g.gw === viewGw);
  const lower = vi > 0 ? gws[vi].window_start : null;
  const upper = vi >= 0 && vi < gws.length - 1 ? gws[vi + 1].window_start : null;

  let q = db.from("comments")
    .select("id, user_id, body, created_at, kind, payload, parent_id")
    .eq("subject_type", "fantasy_league").eq("subject_id", league.id)
    .is("deleted_at", null);
  if (lower) q = q.gte("created_at", lower);
  if (upper) q = q.lt("created_at", upper);
  let rowsQuery = await q.order("created_at", { ascending: false }).limit(50) as ProbeResult;
  // Same probe/fallback as pinned_message_id above: parent_id may not exist yet
  // (AC1) — retry the identical query minus that one column rather than let a
  // reply feature that hasn't shipped take the whole thread down with it.
  let repliesSupported = true;
  if (rowsQuery.error) {
    repliesSupported = false;
    let q2 = db.from("comments")
      .select("id, user_id, body, created_at, kind, payload")
      .eq("subject_type", "fantasy_league").eq("subject_id", league.id)
      .is("deleted_at", null);
    if (lower) q2 = q2.gte("created_at", lower);
    if (upper) q2 = q2.lt("created_at", upper);
    rowsQuery = await q2.order("created_at", { ascending: false }).limit(50) as ProbeResult;
  }
  const rows = rowsQuery.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs = (rows ?? []) as { id: string; user_id: string; body: string; created_at: string; kind: string | null; payload: any; parent_id?: string | null }[];

  const msgIds = msgs.map((m) => m.id);
  const loadedIds = new Set(msgIds);

  // Replies (AC2) — msgId → its parent's id, for the messages actually loaded
  // in this window.
  const parentIdOf = new Map<string, string>();
  if (repliesSupported) {
    for (const m of msgs) if (m.parent_id) parentIdOf.set(m.id, m.parent_id);
  }
  // Parents that fell OUTSIDE this window (an older gw, or just off the 50-cap)
  // still need resolving for the quoted-context strip, plus the pinned message
  // (AC6) if it isn't one of the messages already loaded — ONE extra batched
  // comments query covers both.
  const pinnedId = pinSupported && league.pinned_message_id ? league.pinned_message_id : null;
  const extraCommentIds = Array.from(new Set([
    ...Array.from(parentIdOf.values()).filter((id) => !loadedIds.has(id)),
    ...(pinnedId && !loadedIds.has(pinnedId) ? [pinnedId] : []),
  ]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let extraRows: { id: string; user_id: string; body: string; kind: string | null; payload: any }[] = [];
  if (extraCommentIds.length) {
    const { data } = await db.from("comments")
      .select("id, user_id, body, kind, payload").in("id", extraCommentIds).is("deleted_at", null);
    extraRows = (data ?? []) as typeof extraRows;
  }
  const commentById = new Map<string, { id: string; user_id: string; body: string; kind: string | null; payload: unknown }>();
  for (const m of msgs) commentById.set(m.id, m);
  for (const r of extraRows) commentById.set(r.id, r);

  const authorIds = Array.from(new Set([...msgs.map((m) => m.user_id), ...extraRows.map((r) => r.user_id)]));
  const [{ data: profs }, { data: reactRows }, { data: voteRows }] = await Promise.all([
    authorIds.length
      ? db.from("profiles").select("id, display_name, username, avatar_url").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[] }),
    msgIds.length
      ? db.from("comment_reactions").select("comment_id, user_id, emoji").in("comment_id", msgIds)
      : Promise.resolve({ data: [] as { comment_id: string; user_id: string; emoji: string }[] }),
    msgIds.length
      ? db.from("comment_poll_votes").select("comment_id, user_id, option_index").in("comment_id", msgIds)
      : Promise.resolve({ data: [] as { comment_id: string; user_id: string; option_index: number }[] }),
  ]);
  const profOf = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[])
    .map((p) => [p.id, p]));
  const nameOfAuthor = (uid: string) => {
    const p = profOf.get(uid);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "Player");
  };

  // Aggregate reactions per message: emoji → count, and whether I'm in it.
  const reactOf = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of (reactRows ?? []) as { comment_id: string; user_id: string; emoji: string }[]) {
    const per = reactOf.get(r.comment_id) ?? new Map();
    const cur = per.get(r.emoji) ?? { count: 0, mine: false };
    cur.count += 1; if (r.user_id === userId) cur.mine = true;
    per.set(r.emoji, cur); reactOf.set(r.comment_id, per);
  }
  const reactionsFor = (id: string): ChatReaction[] => {
    const per = reactOf.get(id);
    if (!per) return [];
    return CHAT_EMOJI.filter((e) => per.has(e)).map((e) => ({ emoji: e, count: per.get(e)!.count, mine: per.get(e)!.mine }));
  };

  // Poll tallies per message: option index → count, plus my own vote.
  const votesOf = new Map<string, { counts: Map<number, number>; mine: number | null }>();
  for (const v of (voteRows ?? []) as { comment_id: string; user_id: string; option_index: number }[]) {
    const rec = votesOf.get(v.comment_id) ?? { counts: new Map<number, number>(), mine: null };
    rec.counts.set(v.option_index, (rec.counts.get(v.option_index) ?? 0) + 1);
    if (v.user_id === userId) rec.mine = v.option_index;
    votesOf.set(v.comment_id, rec);
  }

  // The pool, for resolving shared player cards (identity is never trusted from
  // the payload beyond the id).
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));

  const markerOf = (id: number): BoardPlayer => {
    const p = poolById.get(id);
    return { id, name: p?.name ?? `#${id}`, label: pitchName(p?.name ?? `#${id}`), pos: (p?.pos ?? "MID") as BoardPlayer["pos"], club: p?.club, avatarUrl: p?.avatarUrl ?? null };
  };

  const playerCard = (pid: number, note: string | null): PlayerCard | null => {
    const p = poolById.get(pid);
    return p ? { id: p.id, name: p.name, club: p.club, pos: p.pos, price: p.price, avatarUrl: p.avatarUrl ?? null, note } : null;
  };

  // Feed-share cards (AC5) — resolved async, before cardFor (which stays sync)
  // so a re-render never triggers an extra round of loadFeedEvent calls per
  // message. Each shared post is re-hydrated fresh on every read (never
  // trusting anything baked into the payload at share time beyond the id), so
  // an edited/deleted post's card reflects reality immediately.
  const feedEventIds = Array.from(new Set(
    msgs.filter((m) => m.kind === "feed" && m.payload && typeof m.payload === "object")
      .map((m) => { const id = (m.payload as { eventId?: unknown }).eventId; return typeof id === "string" ? id : ""; })
      .filter(Boolean),
  ));
  const feedCardById = new Map<string, FeedShareCard>();
  if (feedEventIds.length) {
    const resolved = await Promise.all(feedEventIds.map(async (id) => {
      try { return [id, await loadFeedEvent(db, userId, id)] as const; }
      catch { return [id, null] as const; }
    }));
    for (const [id, ev] of resolved) {
      if (!ev || ev.unavailable) { feedCardById.set(id, { eventId: id, available: false, actorName: null, actorAvatarUrl: null, text: null, summary: null, image: null }); continue; }
      const summary = ev.text ? null
        : ev.poll ? "shared a poll"
        : ev.gif ? "shared a GIF"
        : (ev.images?.length || ev.image) ? "shared a photo"
        : ev.video ? "shared a video"
        : "shared a post";
      // Thumbnail fallback chain (Phase 2c): first image, then the legacy
      // single-image field, then the GIF's still, then — new — a video
      // post's own poster. Never re-uploads anything; always a reference to
      // an asset the post already has.
      const image = (ev.images && ev.images[0]) ?? ev.image ?? ev.gif?.webp ?? ev.gif?.gifUrl ?? ev.video?.posterUrl ?? null;
      feedCardById.set(id, {
        eventId: id, available: true, actorName: ev.actorName, actorAvatarUrl: ev.actorAvatar,
        text: ev.text ? ev.text.slice(0, 300) : null, summary, image,
      });
    }
  }

  // Challenge cards (Phase 1C) — batched exactly like feedCardById above, one
  // query set for every challenge referenced in this window rather than N+1.
  // Covers both "challenge" (the original card) and "challenge_result" (Phase
  // 3A's compact result ping) — same payload shape, same card data.
  const challengeIds = Array.from(new Set(
    msgs.filter((m) => (m.kind === "challenge" || m.kind === "challenge_result") && m.payload && typeof m.payload === "object")
      .map((m) => { const id = (m.payload as { challengeId?: unknown }).challengeId; return typeof id === "string" ? id : ""; })
      .filter(Boolean),
  ));
  const challengeCardById = challengeIds.length ? await challengeCardsFor(db, challengeIds) : new Map<string, ChallengeCardData>();

  const cardFor = (m: { id: string; kind: string | null; payload: unknown }): { kind: ChatKind; player?: PlayerCard | null; poll?: PollCard | null; squad?: SquadCard | null; news?: NewsCard | null; compare?: CompareCard | null; gif?: GifCard | null; image?: ImageCard | null; video?: VideoCard | null; feed?: FeedShareCard | null; challenge?: ChallengeCardData | null } => {
    // System rows (Phase 4b, AC3) carry no card — just the kind, so the client
    // renders the plain centred/muted line instead of falling through to "text".
    if (m.kind === "system") return { kind: "system" };
    if (m.kind === "image" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { url?: unknown; width?: unknown; height?: unknown };
      const url = typeof pl.url === "string" ? pl.url : "";
      if (!isPostMediaUrl(url)) return { kind: "text" };
      return { kind: "image", image: { url, width: Number(pl.width) || 0, height: Number(pl.height) || 0 } };
    }
    if (m.kind === "video" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { url?: unknown; posterUrl?: unknown; width?: unknown; height?: unknown; durationMs?: unknown };
      const url = typeof pl.url === "string" ? pl.url : "";
      if (!isPostVideoUrl(url)) return { kind: "text" };
      const posterUrl = typeof pl.posterUrl === "string" && isPostMediaUrl(pl.posterUrl) ? pl.posterUrl : null;
      return {
        kind: "video",
        video: { url, posterUrl, width: Number(pl.width) || 0, height: Number(pl.height) || 0, durationMs: Number(pl.durationMs) || 0 },
      };
    }
    if (m.kind === "feed" && m.payload && typeof m.payload === "object") {
      const id = (m.payload as { eventId?: unknown }).eventId;
      const eventId = typeof id === "string" ? id : "";
      if (!eventId) return { kind: "text" };
      return { kind: "feed", feed: feedCardById.get(eventId) ?? { eventId, available: false, actorName: null, actorAvatarUrl: null, text: null, summary: null, image: null } };
    }
    if ((m.kind === "challenge" || m.kind === "challenge_result") && m.payload && typeof m.payload === "object") {
      const id = (m.payload as { challengeId?: unknown }).challengeId;
      const challengeId = typeof id === "string" ? id : "";
      const card = challengeId ? challengeCardById.get(challengeId) : undefined;
      return card ? { kind: m.kind as ChatKind, challenge: card } : { kind: "text" };
    }
    if (m.kind === "gif" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { url?: unknown; preview?: unknown; width?: unknown; height?: unknown };
      const url = typeof pl.url === "string" ? pl.url : "";
      if (!isAllowedGifUrl(url)) return { kind: "text" };
      const preview = typeof pl.preview === "string" && isAllowedGifUrl(pl.preview) ? pl.preview : url;
      return { kind: "gif", gif: { url, preview, width: Number(pl.width) || 0, height: Number(pl.height) || 0 } };
    }
    // player + captain both resolve one pool player (captain is labelled by the UI).
    if ((m.kind === "player" || m.kind === "captain") && m.payload && typeof m.payload === "object") {
      const pid = Number((m.payload as { playerId?: unknown }).playerId);
      const note = typeof (m.payload as { note?: unknown }).note === "string" ? (m.payload as { note: string }).note : null;
      const card = playerCard(pid, note);
      return card ? { kind: m.kind as ChatKind, player: card } : { kind: "text" };
    }
    if (m.kind === "compare" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { a?: unknown; b?: unknown };
      const a = playerCard(Number(pl.a), null), b = playerCard(Number(pl.b), null);
      return a && b ? { kind: "compare", compare: { a, b } } : { kind: "text" };
    }
    if (m.kind === "news" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { title?: unknown; source?: unknown; url?: unknown; image?: unknown; internal?: unknown };
      const title = String(pl.title ?? "").slice(0, 300);
      if (!title) return { kind: "text" };
      return { kind: "news", news: { title, source: String(pl.source ?? "").slice(0, 80), url: String(pl.url ?? ""), image: pl.image ? String(pl.image) : null, internal: pl.internal === true } };
    }
    if (m.kind === "squad" && m.payload && typeof m.payload === "object") {
      const pl = m.payload as { xi?: unknown; bench?: unknown; captain?: unknown; vice?: unknown };
      const xi = Array.isArray(pl.xi) ? pl.xi.map(Number) : [];
      if (!xi.length) return { kind: "text" };
      const bench = Array.isArray(pl.bench) ? pl.bench.map(Number) : [];
      return {
        kind: "squad",
        squad: {
          players: [...xi, ...bench].map(markerOf), xi, bench,
          captain: pl.captain != null ? Number(pl.captain) : null,
          vice: pl.vice != null ? Number(pl.vice) : null,
        },
      };
    }
    if (m.kind === "poll" && m.payload && typeof m.payload === "object") {
      const q = String((m.payload as { question?: unknown }).question ?? "");
      const rawOpts = Array.isArray((m.payload as { options?: unknown }).options) ? (m.payload as { options: unknown[] }).options : [];
      const rec = votesOf.get(m.id);
      const options = rawOpts.slice(0, MAX_POLL_OPTIONS).map((o, i) => ({ text: String(o), votes: rec?.counts.get(i) ?? 0 }));
      const totalVotes = options.reduce((s, o) => s + o.votes, 0);
      return { kind: "poll", poll: { question: q, options, totalVotes, myVote: rec?.mine ?? null } };
    }
    return { kind: "text" };
  };

  // Moments: an archived thread shows THAT gameweek's talking points; the live
  // thread shows the most recent scored week's.
  const momentGw = readOnly ? viewGw : await latestScoredGw(db, memberIds);

  // The quoted-context strip for a reply — the parent's author + a one-line
  // summary, via the SAME summariser a shared card uses elsewhere (AC2). Null
  // when the parent's gone missing (soft-deleted after the reply was sent) —
  // the reply still renders, just without the quote strip.
  const replyToFor = (parentId: string | undefined): { name: string; summary: string } | null => {
    if (!parentId) return null;
    const parent = commentById.get(parentId);
    if (!parent) return null;
    return { name: nameOfAuthor(parent.user_id), summary: summariseLeagueMessage(parent.kind, parent.body, parent.payload) };
  };

  // The pinned-message banner (AC6) — same shape as a reply's quote strip.
  const pinned = pinnedId ? (() => {
    const row = commentById.get(pinnedId);
    if (!row) return null;
    return { id: pinnedId, name: nameOfAuthor(row.user_id), summary: summariseLeagueMessage(row.kind, row.body, row.payload) };
  })() : null;

  // Blocked/muted members (Phase 5a, AC3/AC4) — their message BUBBLES are
  // hidden from this viewer only, filtered in below at the very end (never
  // upstream, so parent/pinned resolution above still sees the real row —
  // a reply's quoted-context strip or the pinned banner shouldn't 404 just
  // because the parent happens to be from someone this viewer blocked).
  // Member lists and tables (memberIds, `members` above) are untouched —
  // leagues are shared spaces, so who's IN the league still shows everyone
  // (documented for the PR: a blocked member's messages disappear from your
  // view of the thread, but they're still a member you can see in rosters).
  const hidden = await hiddenActorIds(db, userId);

  // Mentions (Phase 1A) — prefer each "text"-kind message's own stored
  // payload.mentions (no resolve needed); only a LEGACY row (no stored
  // entities) falls back to the batch regex+resolve. Structured kinds
  // (poll/player/squad/etc.) never carry user-authored free text worth
  // linkifying here, so they're skipped entirely.
  const storedChatMentionsOf = (payload: unknown): MentionEntity[] | null => {
    const raw = (payload as { mentions?: unknown } | null)?.mentions;
    if (!Array.isArray(raw) || !raw.length) return null;
    const out: MentionEntity[] = [];
    for (const r of raw as unknown[]) {
      const e = r as { userId?: unknown; usernameSnapshot?: unknown };
      if (typeof e?.userId === "string" && typeof e?.usernameSnapshot === "string") {
        out.push({ userId: e.userId, usernameSnapshot: e.usernameSnapshot });
      }
    }
    return out.length ? out : null;
  };
  const legacyMentionHandles = Array.from(new Set(
    msgs.filter((m) => (m.kind ?? "text") === "text" && !storedChatMentionsOf(m.payload))
      .flatMap((m) => extractMentions(m.body)),
  ));
  const legacyChatMentionMap = legacyMentionHandles.length
    ? await resolveUsernames(db, legacyMentionHandles)
    : new Map<string, { id: string; username: string }>();
  const mentionedUsersFor = (m: { kind: string | null; body: string; payload: unknown }): { username: string; userId: string }[] | null => {
    if ((m.kind ?? "text") !== "text") return null;
    const stored = storedChatMentionsOf(m.payload);
    if (stored) return stored.map((e) => ({ username: e.usernameSnapshot, userId: e.userId }));
    const handles = extractMentions(m.body);
    if (!handles.length) return null;
    const out = handles
      .map((h) => legacyChatMentionMap.get(h))
      .filter((u): u is { id: string; username: string } => !!u)
      .map((u) => ({ username: u.username, userId: u.id }));
    return out.length ? out : null;
  };

  return {
    league: { name: league.name, stakes: league.stakes, isOwner: league.owner_id === userId },
    gw: viewGw, currentGw, readOnly, notice, gameweeks,
    capabilities: { replies: repliesSupported, pin: pinSupported } as ChatCapabilities,
    pinned,
    // oldest-first for a chat read
    messages: msgs.reverse().map((m): ChatMessage => {
      const p = profOf.get(m.user_id);
      const card = cardFor(m);
      const parentId = parentIdOf.get(m.id) ?? null;
      return {
        id: m.id, userId: m.user_id,
        name: p?.display_name ?? (p?.username ? `@${p.username}` : "Player"),
        avatarUrl: p?.avatar_url ?? null,
        body: m.body, createdAt: m.created_at, isMe: m.user_id === userId,
        reactions: reactionsFor(m.id),
        kind: card.kind, player: card.player ?? null, poll: card.poll ?? null, squad: card.squad ?? null,
        news: card.news ?? null, compare: card.compare ?? null, gif: card.gif ?? null,
        image: card.image ?? null, video: card.video ?? null, feed: card.feed ?? null, challenge: card.challenge ?? null,
        parentId, replyTo: replyToFor(parentId ?? undefined),
        mentionedUsers: mentionedUsersFor(m),
      };
    }).filter((m) => m.kind === "system" || !hidden.has(m.userId)),
    moments: momentGw != null ? await momentsForGw(db, memberIds, momentGw) : [],
  };
}

/** Toggle a reaction on a league message. Member-gated (the RLS backs this up on
 *  raw REST); the emoji must be one of the allowed set. */
export async function reactChat(
  db: Db, userId: string, code: string, commentId: unknown, emoji: unknown, on: boolean,
) {
  const league = await requireMemberLeague(db, code, userId);
  const id = typeof commentId === "string" ? commentId : "";
  const e = typeof emoji === "string" ? emoji : "";
  if (!id || !(CHAT_EMOJI as readonly string[]).includes(e)) throw new HttpError(400, "bad reaction");
  // The message must belong to THIS league's thread.
  const { data: c } = await db.from("comments")
    .select("id").eq("id", id).eq("subject_type", "fantasy_league").eq("subject_id", league.id).maybeSingle();
  if (!c) throw new HttpError(404, "message not found");
  if (on) {
    const { error } = await db.from("comment_reactions")
      .upsert({ comment_id: id, user_id: userId, emoji: e }, { onConflict: "comment_id,user_id,emoji" });
    if (error) throw new HttpError(500, error.message);
  } else {
    await db.from("comment_reactions").delete()
      .eq("comment_id", id).eq("user_id", userId).eq("emoji", e);
  }
  return { ok: true };
}

/** True for a PostgREST "column doesn't exist" failure specifically (error
 *  code 42703 undefined_column, or PGRST204 when the schema cache doesn't
 *  know the column) — the ONE case insertChatMessage should degrade quietly
 *  from, since it means migration 252 hasn't landed yet (AC1). Any other
 *  error (a constraint violation, RLS, etc.) is a real failure and should
 *  surface, not get swallowed as if the column were merely absent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isMissingColumnError(error: any): boolean {
  return error?.code === "42703" || error?.code === "PGRST204" || /column .* does not exist/i.test(String(error?.message ?? ""));
}

/** Insert one league-chat message, threading it under `parentId` when given
 *  (AC2 — works for every ChatKind, so every posting function below routes
 *  through here). The parent must exist, be undeleted, and belong to THIS
 *  SAME league — a hand-crafted parentId pointing at another league's message
 *  400s rather than quietly cross-linking threads.
 *
 *  comments.parent_id already exists (migration 221, for pack/debate replies)
 *  with a trigger enforcing ONE level of depth — replying to a message that's
 *  itself a reply raises a Postgres exception rather than nesting further.
 *  Rather than let that exception surface as a raw 500, a reply to a reply is
 *  flattened here to thread under the ORIGINAL top-level message (the same
 *  IG-style flattening the trigger's own model assumes) — the UI additionally
 *  hides the Reply control on an already-a-reply message, so this is a
 *  belt-and-braces backstop, not the primary UX.
 *
 *  Degrades hidden (AC1): if the insert fails specifically because parent_id
 *  isn't a real column (a hypothetical environment that reached this code
 *  without migration 221), it retries once WITHOUT the column so the message
 *  still sends — just without threading — rather than losing the send
 *  entirely over a column that isn't there. Any other insert error (the
 *  depth/subject trigger, RLS, a bad id) still fails loudly. */
async function insertChatMessage(
  db: Db, league: { id: string }, userId: string,
  fields: { body: string; kind?: string; payload?: Record<string, unknown> },
  parentId?: unknown,
): Promise<{ id: string }> {
  const base = { subject_type: "fantasy_league", subject_id: league.id, user_id: userId, ...fields };
  const pid = typeof parentId === "string" && parentId ? parentId : null;
  if (pid) {
    const { data: parent } = await db.from("comments").select("id, parent_id")
      .eq("id", pid).eq("subject_type", "fantasy_league").eq("subject_id", league.id).is("deleted_at", null).maybeSingle();
    if (!parent) throw new HttpError(400, "That message isn't here anymore");
    // Flatten a reply-to-a-reply to the thread's top-level message.
    const threadRoot = (parent as { id: string; parent_id?: string | null }).parent_id || pid;
    const withParent = await db.from("comments").insert({ ...base, parent_id: threadRoot }).select("id").single();
    if (!withParent.error) return withParent.data as { id: string };
    if (!isMissingColumnError(withParent.error)) throw new HttpError(500, withParent.error.message);
    console.error("[fantasy:chat] parent_id column missing, degrading to unthreaded:", withParent.error.message);
  }
  const { data: inserted, error } = await db.from("comments").insert(base).select("id").single();
  if (error) throw new HttpError(500, error.message);
  return inserted as { id: string };
}

/**
 * Post one auto-generated system line into a league's chat (Phase 4b, AC3) —
 * "Gameweek N is live", "X joined the league", "X moved into first". Never
 * threaded, never moderated (it isn't user input). Deduped by `event` plus
 * whatever's in `dedupe` already existing as an undeleted system row in this
 * SAME league, so this is safe to call more than once for the same happening
 * (a retried join, a re-run tick) — it only ever lands the row once.
 *
 * Single-league, single-row — used by the join path. The gw-live and
 * lead-change broadcasts touch every league at once and batch their own
 * dedupe-check + insert in leagues.ts instead, so a season-wide tick isn't
 * one query pair per league.
 */
export async function postSystemMessage(
  db: Db, leagueId: string, actorUserId: string, body: string,
  event: string, dedupe: Record<string, string | number> = {},
): Promise<void> {
  let q = db.from("comments").select("id")
    .eq("subject_type", "fantasy_league").eq("subject_id", leagueId)
    .eq("kind", "system").eq("payload->>event", event).is("deleted_at", null);
  for (const [k, v] of Object.entries(dedupe)) q = q.eq(`payload->>${k}`, String(v));
  const { data: existing } = await q.limit(1);
  if (existing && existing.length) return; // already posted — never a duplicate
  await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: leagueId, user_id: actorUserId,
    body: body.slice(0, 280), kind: "system", payload: { event, ...dedupe },
  });
}

export async function postChat(db: Db, userId: string, code: string, body: unknown, parentId?: unknown, mentions?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text || text.length > 280) throw new HttpError(400, "1-280 characters");
  const why = commentRejection(text);
  if (why) throw new HttpError(400, why);
  // Structured mentions (Phase 1A) — validate whatever the composer tagged
  // against the text + current DB ownership, merged with any hand-typed
  // handle. One batch query.
  const entities = await resolveMentionEntities(db, text, mentions);
  const inserted = await insertChatMessage(
    db, league, userId, { body: text, ...(entities.length ? { payload: { mentions: entities } } : {}) }, parentId,
  );
  // @mentions only — never a push for every message (the spam trap). Fire-and-forget.
  void notifyChatMentions(db, league.id, code, league.name, userId, text, inserted.id, entities);
  return { ok: true };
}

/** Parse (or, when `entities` is already known, DRIVE OFF) the @handles in a
 *  chat message and notify the mentioned league members — league-scoped, so
 *  a mention only ever reaches someone actually IN this league, even if the
 *  validated entity list carries a handle that resolves outside it. */
async function notifyChatMentions(
  db: Db, leagueId: string, code: string, leagueName: string, actorId: string, text: string, commentId: string | null,
  entities?: MentionEntity[],
) {
  try {
    if (!commentId) return;
    const { data: members } = await db.from("fantasy_league_members").select("user_id").eq("league_id", leagueId);
    const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== actorId);
    if (!memberIds.length) return;

    let mentioned: { id: string; username: string | null; display_name: string | null }[];
    if (entities && entities.length) {
      // Drive off the already-validated entities — scope down to league
      // members only (a chat mention never notifies someone outside it).
      const memberSet = new Set(memberIds);
      const ids = Array.from(new Set(entities.map((e) => e.userId))).filter((uid) => memberSet.has(uid));
      if (!ids.length) return;
      const { data: profs } = await db.from("profiles").select("id, username, display_name").in("id", ids);
      mentioned = (profs ?? []) as typeof mentioned;
    } else {
      const handles = Array.from(new Set((text.match(/@([a-zA-Z0-9_]{2,30})/g) ?? []).map((h) => h.slice(1).toLowerCase())));
      if (!handles.length) return;
      const { data: profs } = await db.from("profiles").select("id, username, display_name").in("id", memberIds);
      mentioned = ((profs ?? []) as { id: string; username: string | null; display_name: string | null }[])
        .filter((p) => p.username && handles.includes(p.username.toLowerCase()));
    }
    if (!mentioned.length) return;
    const { data: actor } = await db.from("profiles").select("display_name, username").eq("id", actorId).maybeSingle();
    const who = actor?.display_name ?? (actor?.username ? `@${actor.username}` : "A manager");
    await notifyFantasy({
      userIds: mentioned.map((p) => p.id),
      title: `${who} mentioned you in ${leagueName}`,
      body: text.slice(0, 140),
      url: `/fantasy/leagues/${code}?t=chat`,
      dedupeKey: `fantasy-mention:${commentId}`,
      type: "fantasy_chat_mention",
      actorId,
      subjectType: "fantasy_league",
      subjectId: leagueId,
    });
  } catch (e) { console.error("[fantasy:chat] mention notify failed:", e); }
}

/** Notify the other league members that someone shared their squad/captain — the
 *  two deliberate "here's my team" moments. Rate-limited to one per sharer per
 *  league per day so a chatty sharer can't spam the league. */
async function notifyLeagueShare(db: Db, leagueId: string, code: string, leagueName: string, actorId: string, what: string) {
  try {
    const { data: members } = await db.from("fantasy_league_members").select("user_id").eq("league_id", leagueId);
    const others = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== actorId);
    if (!others.length) return;
    const { data: actor } = await db.from("profiles").select("display_name, username").eq("id", actorId).maybeSingle();
    const who = actor?.display_name ?? (actor?.username ? `@${actor.username}` : "A manager");
    const dayBucket = Math.floor(Date.now() / 86_400_000);
    await notifyFantasy({
      userIds: others,
      title: `${who} ${what} in ${leagueName}`,
      body: "Take a look and weigh in.",
      url: `/fantasy/leagues/${code}?t=chat`,
      dedupeKey: `fantasy-share:${leagueId}:${actorId}:${dayBucket}`,
      type: "fantasy_league_share",
      actorId,
      subjectType: "fantasy_league",
      subjectId: leagueId,
    });
  } catch (e) { console.error("[fantasy:chat] share notify failed:", e); }
}

export async function setStakes(db: Db, userId: string, code: string, stakes: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  if (league.owner_id !== userId) throw new HttpError(403, "only the league owner sets the stakes");
  const text = typeof stakes === "string" ? stakes.trim().slice(0, 120) : "";
  const why = text ? commentRejection(text) : null;
  if (why) throw new HttpError(400, why);
  const { error } = await db.from("fantasy_leagues")
    .update({ stakes: text || null }).eq("id", league.id);
  if (error) throw new HttpError(500, error.message);
  return { ok: true, stakes: text || null };
}

// ── Phase 1b: structured messages ────────────────────────────────────────────

/** GIFs may only point at Tenor (the picker's source), over https. This is the
 *  trust boundary: the payload is validated here on the way IN, and again in
 *  cardFor on the way OUT, so a hand-crafted REST insert can't smuggle an
 *  arbitrary image/tracker URL into a league's thread. */
export function isAllowedGifUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "tenor.com" || u.hostname.endsWith(".tenor.com"));
  } catch { return false; }
}

/** Post a GIF into the league chat. Body is empty; the media lives in the payload. */
export async function postGif(db: Db, userId: string, code: string, gif: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const g = (gif ?? {}) as { url?: unknown; preview?: unknown; width?: unknown; height?: unknown };
  const url = typeof g.url === "string" ? g.url : "";
  if (!isAllowedGifUrl(url)) throw new HttpError(400, "That GIF isn't from a source we allow");
  const preview = typeof g.preview === "string" && isAllowedGifUrl(g.preview) ? g.preview : url;
  const width = Math.min(2000, Math.max(0, Math.round(Number(g.width) || 0)));
  const height = Math.min(2000, Math.max(0, Math.round(Number(g.height) || 0)));
  // Non-empty body: the comments table's body check rejects "" (and it's the
  // graceful fallback anywhere a GIF can't render). The UI shows the media, not this.
  await insertChatMessage(db, league, userId, { body: "GIF", kind: "gif", payload: { url, preview, width, height } }, parentId);
  return { ok: true };
}

/** Post one image straight into the league chat (Phase 4a, AC4) — uploaded
 *  client-side to the post-media bucket via the same lib/postMedia.ts pipeline
 *  the feed composer uses; re-validated here as belonging to that bucket
 *  (isPostMediaUrl, shared with postToFeed) so a hand-crafted insert can't
 *  smuggle an arbitrary external image into the thread. One per message. */
export async function postImage(db: Db, userId: string, code: string, image: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const im = (image ?? {}) as { url?: unknown; width?: unknown; height?: unknown };
  const url = typeof im.url === "string" ? im.url.trim() : "";
  if (!isPostMediaUrl(url)) throw new HttpError(400, "bad image");
  const width = Math.min(4000, Math.max(0, Math.round(Number(im.width) || 0)));
  const height = Math.min(4000, Math.max(0, Math.round(Number(im.height) || 0)));
  await insertChatMessage(db, league, userId, { body: "Photo", kind: "image", payload: { url: url.slice(0, 500), width, height } }, parentId);
  return { ok: true };
}

/** Post one video straight into the league chat (Phase 2c) — uploaded
 *  client-side via lib/postVideo.ts's uploadPostVideo (the same pipeline the
 *  feed composer's video attach uses); re-validated here EXACTLY like a
 *  post's own video (isPostVideoUrl for the clip, isPostMediaUrl for the
 *  poster, MAX_POST_VIDEO_MS_SERVER for the duration cap) so a hand-crafted
 *  insert can't smuggle an arbitrary external video into the thread. One per
 *  message; the client never autoplays it — chat is always tap-to-play. */
export async function postVideoMessage(db: Db, userId: string, code: string, video: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const v = (video ?? {}) as { url?: unknown; posterUrl?: unknown; width?: unknown; height?: unknown; durationMs?: unknown };
  const url = typeof v.url === "string" ? v.url.trim() : "";
  if (!isPostVideoUrl(url)) throw new HttpError(400, "bad video");
  let posterUrl: string | null = null;
  if (v.posterUrl != null) {
    const p = typeof v.posterUrl === "string" ? v.posterUrl.trim() : "";
    if (p) {
      if (!isPostMediaUrl(p)) throw new HttpError(400, "bad video");
      posterUrl = p.slice(0, 500);
    }
  }
  const width = Math.min(4000, Math.max(0, Math.round(Number(v.width) || 0)));
  const height = Math.min(4000, Math.max(0, Math.round(Number(v.height) || 0)));
  const durationMs = Number(v.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_POST_VIDEO_MS_SERVER) throw new HttpError(400, "bad video");
  // Non-empty body: the comments table's body check rejects "" (same
  // graceful fallback the GIF/Photo kinds already rely on). The UI shows the
  // media, not this.
  await insertChatMessage(
    db, league, userId,
    { body: "Video", kind: "video", payload: { url: url.slice(0, 500), posterUrl, width, height, durationMs: Math.round(durationMs) } },
    parentId,
  );
  return { ok: true };
}

/** Share a feed post into the league chat (Phase 4a, AC5) — from the Social
 *  feed's existing "Share to a league" sheet. The card is resolved fresh on
 *  every read (see leagueChat's feedCardById), so only the id is stored here;
 *  validated up front against loadFeedEvent so a dead/unavailable/non-post id
 *  can't be shared in the first place. */
export async function shareFeedToLeague(db: Db, userId: string, code: string, eventId: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "nothing to share");
  const event = await loadFeedEvent(db, userId, id);
  if (!event || event.unavailable || event.type !== "post") throw new HttpError(404, "That post isn't available");
  await insertChatMessage(db, league, userId, { body: "shared a post", kind: "feed", payload: { eventId: id } }, parentId);
  return { ok: true };
}

/** Post a poll into the league chat: a question and 2–4 options. */
export async function postPoll(db: Db, userId: string, code: string, question: unknown, options: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const q = typeof question === "string" ? question.trim().slice(0, 120) : "";
  const opts = Array.isArray(options)
    ? options.map((o) => (typeof o === "string" ? o.trim().slice(0, 60) : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
    : [];
  if (!q) throw new HttpError(400, "A poll needs a question");
  if (opts.length < 2) throw new HttpError(400, "A poll needs at least two options");
  const why = commentRejection([q, ...opts].join(" "));
  if (why) throw new HttpError(400, why);
  await insertChatMessage(db, league, userId, { body: q, kind: "poll", payload: { question: q, options: opts } }, parentId);
  return { ok: true };
}

/** Cast or change a vote on a league poll. */
export async function votePoll(db: Db, userId: string, code: string, commentId: unknown, optionIndex: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const id = typeof commentId === "string" ? commentId : "";
  const idx = Number(optionIndex);
  if (!id || !Number.isInteger(idx) || idx < 0 || idx >= MAX_POLL_OPTIONS) throw new HttpError(400, "bad vote");
  const { data: c } = await db.from("comments")
    .select("id, kind, payload").eq("id", id).eq("subject_type", "fantasy_league").eq("subject_id", league.id).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poll = c as { kind: string; payload: any } | null;
  if (!poll || poll.kind !== "poll") throw new HttpError(404, "poll not found");
  const optCount = Array.isArray(poll.payload?.options) ? poll.payload.options.length : 0;
  if (idx >= optCount) throw new HttpError(400, "no such option");
  const { error } = await db.from("comment_poll_votes")
    .upsert({ comment_id: id, user_id: userId, option_index: idx }, { onConflict: "comment_id,user_id" });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Share a player card into a league's chat (invoked from the player's profile). */
export async function sharePlayerToLeague(db: Db, userId: string, code: string, playerId: unknown, note: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || !enginePool().some((p) => p.id === pid)) throw new HttpError(400, "unknown player");
  const n = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const why = n ? commentRejection(n) : null;
  if (why) throw new HttpError(400, why);
  await insertChatMessage(db, league, userId, { body: n || "shared a player", kind: "player", payload: { playerId: pid, note: n || null } }, parentId);
  return { ok: true };
}

/** Share a squad into the league chat. Defaults to the sharer's OWN squad (from
 *  the composer); pass `ofUserId` to share ANOTHER manager's squad (from a Social
 *  feed post). Snapshot at share time — the card shows the eleven they had when it
 *  was posted. The comment is authored by the sharer; the payload carries the
 *  original manager so the card can name and link back to them. */
export async function shareSquad(db: Db, userId: string, code: string, ofUserId?: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const targetId = (typeof ofUserId === "string" && ofUserId) ? ofUserId : userId;
  const own = targetId === userId;
  const { data: squad } = await db.from("fantasy_squads")
    .select("xi, bench, captain, vice").eq("user_id", targetId).maybeSingle();
  const xi = squad && Array.isArray(squad.xi) ? (squad.xi as number[]) : [];
  if (!xi.length) throw new HttpError(409, own ? "build a squad first" : "that manager hasn't built a squad yet");

  // Resolve the original manager's name server-side (never trust a client name).
  let ofName: string | null = null;
  if (!own) {
    const { data: prof } = await db.from("profiles").select("display_name, username").eq("id", targetId).maybeSingle();
    ofName = (prof?.display_name ?? prof?.username ?? "a manager");
  }
  const action = own ? "shared their squad" : `shared ${ofName}'s squad`;
  await insertChatMessage(db, league, userId, {
    body: action, kind: "squad",
    payload: {
      xi, bench: (squad!.bench as number[]) ?? [], captain: squad!.captain ?? null, vice: squad!.vice ?? null,
      ...(own ? {} : { ofUserId: targetId, ofName }),
    },
  }, parentId);
  void notifyLeagueShare(db, league.id, code, league.name, userId, action);
  return { ok: true };
}

/** Share the sharer's current captain into the league chat (from the composer). */
export async function shareCaptain(db: Db, userId: string, code: string, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const { data: squad } = await db.from("fantasy_squads")
    .select("captain").eq("user_id", userId).maybeSingle();
  if (!squad || squad.captain == null) throw new HttpError(409, "pick a captain first");
  await insertChatMessage(db, league, userId, { body: "shared their captain", kind: "captain", payload: { playerId: squad.captain } }, parentId);
  void notifyLeagueShare(db, league.id, code, league.name, userId, "shared their captain");
  return { ok: true };
}

/** Share a news article into the league chat (from the news reader). Self-contained
 *  — the article fields are stored on the payload, nothing to resolve. */
export async function shareNews(db: Db, userId: string, code: string, article: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const a = (article ?? {}) as { title?: unknown; source?: unknown; url?: unknown; image?: unknown; internal?: unknown };
  const title = typeof a.title === "string" ? a.title.trim().slice(0, 300) : "";
  if (!title) throw new HttpError(400, "nothing to share");
  const why = commentRejection(title);
  if (why) throw new HttpError(400, why);
  await insertChatMessage(db, league, userId, {
    body: title, kind: "news",
    payload: {
      title,
      source: typeof a.source === "string" ? a.source.slice(0, 80) : "",
      url: typeof a.url === "string" ? a.url.slice(0, 500) : "",
      image: typeof a.image === "string" ? a.image.slice(0, 500) : null,
      internal: a.internal === true,
    },
  }, parentId);
  return { ok: true };
}

/** Share a two-player comparison into the league chat (from the compare screen). */
export async function shareComparison(db: Db, userId: string, code: string, aId: unknown, bId: unknown, parentId?: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const a = Number(aId), b = Number(bId);
  const pool = enginePool();
  const known = (id: number) => Number.isInteger(id) && pool.some((p) => p.id === id);
  if (!known(a) || !known(b) || a === b) throw new HttpError(400, "pick two different players");
  await insertChatMessage(db, league, userId, { body: "shared a comparison", kind: "compare", payload: { a, b } }, parentId);
  return { ok: true };
}

// ── Phase 4a: pinned message (AC6) ───────────────────────────────────────────

/** Pin a message to the top of the league chat. Owner-only; the message must
 *  belong to THIS league. Tolerates a missing fantasy_leagues.pinned_message_id
 *  column pre-migration (503, AC1) — same graceful-absent discipline as
 *  feed.ts's pinPost. */
export async function pinChatMessage(db: Db, userId: string, code: string, commentId: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  if (league.owner_id !== userId) throw new HttpError(403, "only the league owner can pin a message");
  const id = typeof commentId === "string" ? commentId : "";
  if (!id) throw new HttpError(400, "bad pin");
  const { data: c } = await db.from("comments")
    .select("id").eq("id", id).eq("subject_type", "fantasy_league").eq("subject_id", league.id).is("deleted_at", null).maybeSingle();
  if (!c) throw new HttpError(404, "message not found");
  const { error } = await db.from("fantasy_leagues").update({ pinned_message_id: id }).eq("id", league.id);
  if (error) throw new HttpError(503, "Pinning isn't available right now");
  return { ok: true };
}

/** Unpin whatever's currently pinned (no-op if nothing was). Owner-only. */
export async function unpinChatMessage(db: Db, userId: string, code: string) {
  const league = await requireMemberLeague(db, code, userId);
  if (league.owner_id !== userId) throw new HttpError(403, "only the league owner can unpin");
  const { error } = await db.from("fantasy_leagues").update({ pinned_message_id: null }).eq("id", league.id);
  if (error) throw new HttpError(503, "Pinning isn't available right now");
  return { ok: true };
}
