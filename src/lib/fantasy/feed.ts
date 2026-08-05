/**
 * The fantasy activity feed — interesting moves by other managers, the data
 * behind the Following / Global tabs and their like/comment/reply reactions.
 *
 * Events are EMITTED server-side when a move happens (transfer, chip) or settles
 * (haul, rank jump); LOADED with the actor's identity, a human sentence, and
 * reaction counts. `server-only`: writes via the service role, reads resolve
 * profiles + the follow graph.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientPool } from "./pool";
import { fantasyContext } from "./context";
import { fetchFplBootstrapCached } from "@/lib/gates/fpl";
import { pitchName, type BoardPlayer } from "./board";
import { notifyFantasy } from "./notify";
import { notifyMentions } from "./mentions";
import { extractMentions, resolveUsernames, resolveMentionEntities, type MentionEntity } from "@/lib/mentions";
import { commentRejection } from "@/lib/moderation";
import { hiddenActorIds } from "@/lib/social/safety";
import { HttpError } from "./server";
import { rankTop, rawEngagement, scoreFeedEvent } from "./feedRank";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type FeedType =
  | "transfer" | "captain" | "chip" | "haul" | "rank_jump"
  | "squad_complete" | "squad_update" | "shortlist_add"
  | "post" // a user-authored text/poll/image/player post (Social → Live)
  | "quiz_result"; // a finished quiz pack or knowledge round worth shouting about
export type FeedScope = "following" | "global";
export type FeedSort = "recent" | "top";
export interface FeedResult {
  events: FeedEvent[]; followingCount: number;
  /** ISO cursor for the next page (Phase 5a, AC7) — pass as `before` to fetch
   *  older events. Null once the underlying query returned fewer rows than it
   *  asked for (the true end of the table), so the client can stop cleanly. */
  nextCursor: string | null;
}

export interface FeedFixtureCell { gw: number; oppShort: string; home: boolean; difficulty: "kind" | "medium" | "tough" }
export interface FeedFace {
  name: string; avatarUrl: string | null; captain?: boolean;
  /** Stats for the tagged-player tile (fixture-forward). Present on player tiles;
   *  absent on board markers, which only need name + face. */
  pos?: string;
  price?: number;
  ownership?: number | null;
  lastSeasonPts?: number | null;
  fixtures?: FeedFixtureCell[];
}

/** A squad_complete tile renders as the real pitch board — positions + crests. */
export interface FeedBoard {
  players: BoardPlayer[];
  xi: number[];
  bench: number[];
  captain?: number;
  vice?: number;
}

/** The reaction set for the feed — the same six the league chat uses, so the
 *  reaction language is consistent across the app. ❤️ is the old "like". */
export const FEED_REACTIONS = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;
export interface FeedReaction { emoji: string; count: number }

/** A poll attached to a user post: options with running tallies, the viewer's
 *  own choice (if voted), and the total votes. `endsAt` is null for legacy
 *  polls (written before Phase 2b) — those stay open forever, unchanged. */
export interface FeedPoll {
  question: string;
  options: { text: string; votes: number }[];
  myChoice: number | null;
  total: number;
  endsAt: string | null;
}
export const MAX_POLL_OPTIONS = 4;
export const POST_MAX = 500;
/** Poll durations offered in the composer (Phase 2b), in hours. Default 24h. */
export const POLL_DURATION_HOURS = [1, 6, 24, 72] as const;
export type PollDurationHours = typeof POLL_DURATION_HOURS[number];
const DEFAULT_POLL_DURATION_HOURS: PollDurationHours = 24;
/** Up to this many images on one post (Phase 2a multi-image composer). Kept in
 *  sync with MAX_POST_IMAGES in lib/postMedia.ts (that module is client-side). */
export const MAX_POST_IMAGES = 4;

/** A GIF attached to a post (Phase 2a). mp4 renders as a looping muted video where
 *  present; webp/gifUrl are the image fallbacks. All three may be null if the
 *  provider only returned some variants — the renderer picks whichever exists. */
export interface FeedGif {
  mp4: string | null;
  webp: string | null;
  gifUrl: string | null;
  width: number;
  height: number;
}

/** Hosts a post.payload.gif URL is allowed to point at. Klipy's real CDN host is
 *  unverified (no API key at build time) — widen this once the live response
 *  shape is confirmed. */
export const ALLOWED_GIF_HOSTS = ["klipy.com"];

/** A link preview attached to a post (Phase 2b) — the composer unfurls the
 *  first URL in the post text via /api/unfurl; this is what got saved. */
export interface FeedLink {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  domain: string;
}

/** A fixture card attached to a post (Phase 2b) — picked from the current
 *  gameweek's fixture list in the composer. */
export interface FeedFixture {
  homeClub: string;
  awayClub: string;
  kickoffIso: string;
  gw: number;
}

/** A quiz_result tile: the score line plus where the game lives, so the tile
 *  can send a reader off to play the same thing. */
export interface FeedQuiz {
  correct: number;
  total: number;
  title: string | null;
  game: "quiz" | "round";
}

/** A repost/quote target's compact summary — what a mini-embed or a repost's
 *  full card needs. `available: false` means the target row is missing or by
 *  a bot/health-check account: render a muted stub, never crash. Capped at
 *  EMBED_TEXT_MAX chars. `isQuoteOfQuote` is true when the target is ITSELF a
 *  quote post — the embed then renders as a plain link to its detail page,
 *  never a nested card (Phase 3a rule: embeds are always one level deep). */
export interface EmbeddedPost {
  id: string;
  available: boolean;
  actorId?: string;
  actorName?: string;
  actorAvatar?: string | null;
  createdAt?: string;
  text?: string | null;
  image?: string | null;
  isQuoteOfQuote?: boolean;
  /** True when the embedded target carries a video — the compact embed shows
   *  the video's poster (as `image`) with a play glyph, and never inline-plays
   *  it; tap goes to the post's own detail page instead. */
  hasVideo?: boolean;
}
const EMBED_TEXT_MAX = 280;

/** An image must live in OUR post-media bucket — never an arbitrary external URL.
 *  Shared with league chat's image messages (Social Phase 4a), which reuses the
 *  same composer upload (lib/postMedia.ts) and needs the identical trust check. */
export function isPostMediaUrl(u: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return !!base && !!u && u.startsWith(`${base}/storage/v1/object/public/post-media/`);
}

/** Same shape as isPostMediaUrl, but for the `post-videos` bucket (native
 *  video upload, 5 Aug) — a post's video URL must live there, never an
 *  arbitrary external host. */
export function isPostVideoUrl(u: string): boolean {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return !!base && !!u && u.startsWith(`${base}/storage/v1/object/public/post-videos/`);
}

/** A video attached to a post (native video upload, 5 Aug). Direct-to-storage,
 *  no transcoding — the URL is playable as soon as the upload finishes.
 *  `posterUrl` is best-effort (client-captured frame, post-media bucket) and
 *  may be null; the player falls back to a dark placeholder. Mutually
 *  exclusive with gif/images at both the composer and this server's level. */
export interface FeedVideo {
  url: string;
  posterUrl: string | null;
  width: number;
  height: number;
  durationMs: number;
}
/** Kept in sync with MAX_POST_VIDEO_MS in lib/postVideo.ts (that module is
 *  client-side); a little slack for rounding between the client's probed
 *  duration and what actually lands here. */
const MAX_POST_VIDEO_MS_SERVER = 60_000 + 2_000;

export interface FeedEvent {
  id: string;
  /** React-list identity for this FEED ROW. Equal to `id` for every event
   *  except a repost pointer row, where the row itself has its own place in
   *  the timeline (this) but its content — and everything reactions/comments/
   *  poll-votes key off — is the ORIGINAL post (`id`). Never sent to an API;
   *  purely for the client's list rendering. */
  rowKey: string;
  actorId: string;
  /** display_name — the headline, shown above the handle. */
  actorName: string;
  /** @username — the handle, shown under the name. Null if they've not set one. */
  actorUsername: string | null;
  actorAvatar: string | null;
  /** The crest of the club they SUPPORT (club_supporters — the same club the quiz
   *  shows beside them), falling back to their captain's club if they've not
   *  picked one. Null → no crest. */
  actorClub: string | null;
  type: FeedType;
  gw: number | null;
  sentence: string;
  createdAt: string;
  /** Emoji reaction tallies (only emojis with at least one reaction), and the
   *  viewer's own reaction if any. One reaction per user per event. */
  reactions: FeedReaction[];
  myEmoji: string | null;
  commentCount: number;
  /** The squad, as a pitch board, for a squad_complete tile. */
  board?: FeedBoard | null;
  /** A single player's portrait for shortlist/squad_update tiles. */
  player?: FeedFace | null;
  /** The shortlisted/added player's pool id, so the tile can open their profile. */
  playerId?: number | null;
  /** A user post's body (type === "post"). */
  text?: string | null;
  /** An optional poll attached to a post. */
  poll?: FeedPoll | null;
  /** An optional image attached to a post (public post-media URL). Legacy single
   *  image field — still populated for posts written before Phase 2a and always
   *  rendered exactly as it always has been. */
  image?: string | null;
  /** Up to MAX_POST_IMAGES public post-media URLs (Phase 2a). */
  images?: string[] | null;
  /** An optional GIF attached to a post (Phase 2a). Mutually exclusive with
   *  image/images at the composer level, but the server doesn't enforce that. */
  gif?: FeedGif | null;
  /** An optional video attached to a post (native video upload, 5 Aug).
   *  Mutually exclusive with image/images/gif — enforced server-side in
   *  postToFeed, unlike the gif/image pairing above. */
  video?: FeedVideo | null;
  /** An optional link preview attached to a post (Phase 2b) — unfurled from
   *  the first URL in the text. */
  link?: FeedLink | null;
  /** An optional fixture card attached to a post (Phase 2b). Mutually
   *  exclusive with player/gif at the composer level (not server-enforced). */
  fixture?: FeedFixture | null;
  /** A quiz_result's score card. */
  quiz?: FeedQuiz | null;
  /** Set when this row is a REPOST: who reposted it, rendered as a compact
   *  "Reposted by {name}" line above the original's full card (which is what
   *  the rest of this event's fields already carry — see `id`/`rowKey`). */
  repostedBy?: { id: string; name: string } | null;
  /** True when this row is a repost/quote whose target no longer resolves
   *  (missing, or by a bot/health-check account). The card renders a muted
   *  "This post is unavailable" stub instead of crashing. */
  unavailable?: boolean;
  /** Reposts of THIS post's content (`id`) — combined across every reposter,
   *  plus whether the viewer is one of them. 0/false for non-post events. */
  repostCount: number;
  myReposted: boolean;
  /** A quote post's embedded quoted post. Null when this post isn't a quote. */
  quoteOf?: EmbeddedPost | null;
  /** Whether the viewer has bookmarked this post (Phase 3b, AC2). Always
   *  false for a guest (no viewer) and false when fantasy_feed_bookmarks
   *  isn't there yet — see hydrateEvents. */
  myBookmarked: boolean;
  /** Real, resolved @username mentions in this post's text (Phase 3b, AC3) —
   *  only handles that matched an actual profile; an unknown/typo'd handle
   *  just isn't in this list and renders as plain text. Null for a non-post
   *  event or a post with no text. */
  mentionedUsers?: { username: string; userId: string }[] | null;
}

const CHIP_LABEL: Record<string, string> = {
  triple_captain: "Triple Captain",
  bench_boost: "Bench Boost",
  insight: "Insight",
};

// The health-check QA accounts (hc, hc2) — synthetic drills, never feed-worthy.
// Hardcoded for the same reason versus/shadow.ts hardcodes them: HEALTH_BOT_USER_ID
// isn't guaranteed to be set in every deploy environment, and a missing env var
// silently put the bot's squad reveal in the real global feed (2 Aug).
const QA_ACCOUNT_IDS = [
  "cf78de0e-da93-4fb8-b3cd-8865ae0a0814", // hc
  "aa6542bc-ea1d-480c-9070-4a6b79c87381", // hc2
];
export const syntheticActors = () =>
  new Set([...QA_ACCOUNT_IDS, process.env.HEALTH_BOT_USER_ID ?? ""].filter(Boolean));

/** Emit one feed event. No-throw by default at the call site — a feed write must
 *  never fail the user's actual move (see the route wrappers). */
export async function emitFeedEvent(
  db: Db, actorId: string, type: FeedType, gw: number | null, payload: Record<string, unknown>,
): Promise<void> {
  if (syntheticActors().has(actorId)) return; // bot drills stay out of the feed
  await db.from("fantasy_feed_events").insert({ actor_id: actorId, type, gw, payload });
  // Only the two moves worth a ping to your followers — a squad reveal and a big
  // haul — never every transfer (the spam trap). Fire-and-forget.
  if (type === "squad_complete" || type === "haul") void notifyFollowersOfMove(db, actorId, type, gw, payload);
}

/** Ping a manager's followers when they reveal a squad or post a big haul. Deduped
 *  per (follower, type, actor, gw) inside notifyFantasy, so at most one of each per
 *  gameweek. */
async function notifyFollowersOfMove(
  db: Db, actorId: string, type: FeedType, gw: number | null, payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: fRows } = await db.from("user_follows").select("follower_id").eq("followee_id", actorId);
    const followers = ((fRows ?? []) as { follower_id: string }[]).map((f) => f.follower_id);
    if (!followers.length) return;
    const { data: prof } = await db.from("profiles").select("display_name, username").eq("id", actorId).maybeSingle();
    const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "A manager");
    const [title, body] = type === "squad_complete"
      ? [`${who} picked their squad`, "See who they're backing this gameweek."]
      : [`${who} hauled ${Number(payload.points ?? 0)} points`, "Big gameweek — see how they did it."];
    await notifyFantasy({
      userIds: followers,
      title, body,
      url: `/profile/${actorId}#fantasy-xi`,
      dedupeKey: `fantasy-follow-move:${type}:${actorId}:${gw ?? "x"}`,
      type: `fantasy_follow_${type}`,
      actorId,
    });
  } catch (e) { console.error("[fantasy:feed] follower notify failed:", e); }
}

/** Best-effort emit — swallows errors so a feed hiccup can't break a transfer. */
export async function tryEmitFeedEvent(
  db: Db, actorId: string, type: FeedType, gw: number | null, payload: Record<string, unknown>,
): Promise<void> {
  try { await emitFeedEvent(db, actorId, type, gw, payload); } catch { /* feed is best-effort */ }
}

// Thresholds for the settled-gameweek events. Deliberately conservative and
// TUNABLE — calibrate against the real spread once GW1 has scored (a haul floor
// that fires for a third of managers, or a jump floor no one clears, is noise).
const HAUL_THRESHOLD = 80;       // a standout gameweek total
const RANK_JUMP_MIN = 100;       // places climbed on the global table
const MAX_PER_TYPE = 25;         // cap events per type per gw, so a feed isn't a wall

/**
 * Emit the settle-time feed events for a scored gameweek: big hauls (a standout
 * total) and big rank jumps (climbed the global table). Idempotent — it emits at
 * most once per gameweek, so a re-run of finalise (which batches and re-enters)
 * never duplicates. Rank jumps need a prior gameweek, so none fire at GW1.
 */
export async function emitScoringFeedEvents(db: Db, gw: number): Promise<{ hauls: number; jumps: number }> {
  // Emit-once guard: if this gw already has settle-time events, do nothing.
  const { data: existing } = await db.from("fantasy_feed_events")
    .select("id").eq("gw", gw).in("type", ["haul", "rank_jump"]).limit(1);
  if (existing && existing.length) return { hauls: 0, jumps: 0 };

  // Hauls — a filtered read, so the result set is only the managers who hauled.
  const { data: hauls } = await db.from("fantasy_entries")
    .select("user_id, points").eq("gw", gw).gte("points", HAUL_THRESHOLD)
    .order("points", { ascending: false }).limit(MAX_PER_TYPE);
  const haulRows = ((hauls ?? []) as { user_id: string; points: number }[])
    .map((h) => ({ actor_id: h.user_id, type: "haul", gw, payload: { points: h.points } }));

  // Rank jumps — SQL RPC returns only the climbers (>= floor); none before GW2.
  let jumpRows: { actor_id: string; type: string; gw: number; payload: Record<string, unknown> }[] = [];
  if (gw >= 2) {
    const { data: jumps } = await db.rpc("fantasy_rank_jumps", { p_gw: gw, p_min_jump: RANK_JUMP_MIN });
    jumpRows = ((jumps ?? []) as { user_id: string; jump: number; after_rank: number }[])
      .slice(0, MAX_PER_TYPE)
      .map((j) => ({ actor_id: j.user_id, type: "rank_jump", gw, payload: { places: Number(j.jump), rank: Number(j.after_rank) } }));
  }

  const bots = syntheticActors();
  const all = [...haulRows, ...jumpRows].filter((r) => !bots.has(r.actor_id));
  if (all.length) await db.from("fantasy_feed_events").insert(all);
  return { hauls: haulRows.length, jumps: jumpRows.length };
}

/** Best-effort settle-time emit — never breaks the finalise it hangs off. */
export async function tryEmitScoringFeed(db: Db, gw: number): Promise<void> {
  try { await emitScoringFeedEvents(db, gw); }
  catch (e) { console.error(`[feed:scoring] gw ${gw}`, e); }
}

function sentenceFor(type: FeedType, payload: Record<string, unknown>, gw: number | null, nameOf: (id: number) => string): string {
  switch (type) {
    case "transfer": {
      const inName = nameOf(Number(payload.in));
      const outName = nameOf(Number(payload.out));
      return `brought in ${inName} for ${outName}`;
    }
    case "captain":
      return `made ${nameOf(Number(payload.player))} captain`;
    case "chip":
      return `played ${CHIP_LABEL[String(payload.chip)] ?? "a chip"}`;
    case "haul":
      return `hauled ${Number(payload.points)} points${gw ? ` in GW${gw}` : ""}`;
    case "rank_jump":
      return `climbed ${Number(payload.places).toLocaleString()} places${gw ? ` in GW${gw}` : ""}`;
    case "squad_complete":
      return "selected their squad";
    case "squad_update":
      return payload.player != null ? `brought ${nameOf(Number(payload.player))} into their squad` : "changed their squad around";
    case "shortlist_add":
      return `shortlisted ${nameOf(Number(payload.player))}`;
    case "post":
      return "posted";
    case "quiz_result": {
      const correct = Number(payload.correct);
      const total = Number(payload.total);
      if (payload.game === "round") return `went ${correct}/${total} in the GW${gw ?? "?"} knowledge round`;
      const title = typeof payload.title === "string" && payload.title ? payload.title : "the Football Quiz";
      return `scored ${correct}/${total} on ${title}`;
    }
    default:
      return "made a move";
  }
}

/** Create a user post in the public feed — a text body and/or a poll. Same
 *  moderation as comments. Renders in Live like any other event, and gets
 *  reactions + comments for free (they key off the event id). */
export async function postToFeed(db: Db, userId: string, body: unknown): Promise<{ id: string }> {
  const b = (body ?? {}) as {
    text?: unknown; poll?: unknown; image?: unknown; images?: unknown; gif?: unknown; video?: unknown; playerId?: unknown;
    link?: unknown; fixture?: unknown; quoteOf?: unknown;
    /** Mentions picked from the composer's autocomplete (Phase 1A) — untrusted
     *  client shape, validated below via resolveMentionEntities before it
     *  ever reaches the payload. */
    mentions?: unknown;
  };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, POST_MAX) : "";

  // An attached player card — must be a real pool id (the tile links to their
  // profile, so a junk id would mint a dead link).
  let playerId: number | null = null;
  if (b.playerId != null) {
    const pid = Number(b.playerId);
    if (!Number.isInteger(pid) || !clientPool().players.some((p) => p.id === pid)) throw new HttpError(400, "bad player");
    playerId = pid;
  }

  let poll: { question: string; options: string[]; endsAt: string } | null = null;
  const rawPoll = b.poll as { question?: unknown; options?: unknown; durationHours?: unknown } | undefined;
  if (rawPoll && (rawPoll.question != null || Array.isArray(rawPoll.options))) {
    const question = typeof rawPoll.question === "string" ? rawPoll.question.trim().slice(0, 120) : "";
    const options = Array.isArray(rawPoll.options)
      ? rawPoll.options.map((o) => (typeof o === "string" ? o.trim().slice(0, 60) : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
      : [];
    if (!question) throw new HttpError(400, "A poll needs a question");
    if (options.length < 2) throw new HttpError(400, "A poll needs at least two options");
    // Duration is picked in the composer; anything unrecognised falls back to
    // the default rather than rejecting the whole post over one bad field.
    const askedHours = Number(rawPoll.durationHours);
    const durationHours: PollDurationHours = (POLL_DURATION_HOURS as readonly number[]).includes(askedHours)
      ? (askedHours as PollDurationHours) : DEFAULT_POLL_DURATION_HOURS;
    const endsAt = new Date(Date.now() + durationHours * 3_600_000).toISOString();
    poll = { question, options, endsAt };
  }

  let image = typeof b.image === "string" ? b.image.trim() : "";
  if (image) {
    if (!isPostMediaUrl(image)) throw new HttpError(400, "bad image");
    image = image.slice(0, 500);
  }

  // Up to MAX_POST_IMAGES images (Phase 2a) — same bucket check as the legacy
  // single-image field, just applied per URL.
  let images: string[] = [];
  if (b.images !== undefined) {
    if (!Array.isArray(b.images) || b.images.length > MAX_POST_IMAGES) throw new HttpError(400, "Up to four images per post");
    images = b.images.map((u) => (typeof u === "string" ? u.trim() : ""));
    if (images.some((u) => !u || !isPostMediaUrl(u))) throw new HttpError(400, "bad image");
    images = images.map((u) => u.slice(0, 500));
  }

  // A GIF (Phase 2a) — https URLs on an allowed host only. At least one of the
  // three variants must survive the check, or the attachment is rejected outright.
  let gif: FeedGif | null = null;
  const rawGif = b.gif as { mp4?: unknown; webp?: unknown; gifUrl?: unknown; width?: unknown; height?: unknown } | undefined;
  if (rawGif && (rawGif.mp4 || rawGif.webp || rawGif.gifUrl)) {
    const checkUrl = (u: unknown): string | null => {
      if (typeof u !== "string" || !u) return null;
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== "https:") return null;
        if (!ALLOWED_GIF_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) return null;
        return u.slice(0, 700);
      } catch { return null; }
    };
    const mp4 = checkUrl(rawGif.mp4);
    const webp = checkUrl(rawGif.webp);
    const gifUrl = checkUrl(rawGif.gifUrl);
    if (!mp4 && !webp && !gifUrl) throw new HttpError(400, "bad gif");
    gif = { mp4, webp, gifUrl, width: Number(rawGif.width) || 0, height: Number(rawGif.height) || 0 };
  }

  // A video (native video upload, 5 Aug) — url must live in OUR post-videos
  // bucket, posterUrl (if present) in OUR post-media bucket. One video per
  // post; mutually exclusive with gif/images (checked just below, once both
  // are parsed).
  let video: FeedVideo | null = null;
  const rawVideo = b.video as { url?: unknown; posterUrl?: unknown; width?: unknown; height?: unknown; durationMs?: unknown } | undefined;
  if (rawVideo && typeof rawVideo.url === "string" && rawVideo.url) {
    const url = rawVideo.url.trim();
    if (!isPostVideoUrl(url)) throw new HttpError(400, "bad video");
    let posterUrl: string | null = null;
    if (rawVideo.posterUrl != null) {
      const p = typeof rawVideo.posterUrl === "string" ? rawVideo.posterUrl.trim() : "";
      if (p) {
        if (!isPostMediaUrl(p)) throw new HttpError(400, "bad video");
        posterUrl = p.slice(0, 500);
      }
    }
    const durationMs = Number(rawVideo.durationMs);
    const width = Number(rawVideo.width);
    const height = Number(rawVideo.height);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_POST_VIDEO_MS_SERVER) throw new HttpError(400, "bad video");
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new HttpError(400, "bad video");
    video = { url: url.slice(0, 500), posterUrl, width, height, durationMs: Math.round(durationMs) };
  }
  if (video && (gif || images.length || image)) throw new HttpError(400, "A post can carry only one type of media");

  // A link preview (Phase 2b) — the composer already unfurled it via
  // /api/unfurl; re-sanitised here rather than trusted, since the client sent
  // it. og:image must itself be http(s) — same rule the unfurler applies.
  let link: FeedLink | null = null;
  const rawLink = b.link as { url?: unknown; title?: unknown; description?: unknown; siteName?: unknown; image?: unknown } | undefined;
  if (rawLink && typeof rawLink.url === "string" && rawLink.url) {
    let linkUrl: URL;
    try { linkUrl = new URL(rawLink.url.trim()); } catch { throw new HttpError(400, "bad link"); }
    if (linkUrl.protocol !== "http:" && linkUrl.protocol !== "https:") throw new HttpError(400, "bad link");
    let image: string | null = null;
    if (typeof rawLink.image === "string" && rawLink.image) {
      try {
        const imgUrl = new URL(rawLink.image);
        if (imgUrl.protocol === "http:" || imgUrl.protocol === "https:") image = imgUrl.toString().slice(0, 600);
      } catch { /* drop a bad image url, keep the rest of the card */ }
    }
    link = {
      url: linkUrl.toString().slice(0, 600),
      title: typeof rawLink.title === "string" && rawLink.title ? rawLink.title.trim().slice(0, 200) : null,
      description: typeof rawLink.description === "string" && rawLink.description ? rawLink.description.trim().slice(0, 300) : null,
      siteName: typeof rawLink.siteName === "string" && rawLink.siteName ? rawLink.siteName.trim().slice(0, 100) : null,
      image,
      domain: linkUrl.hostname.replace(/^www\./, ""),
    };
  }

  // A fixture card (Phase 2b) — picked from the current gameweek's fixture
  // list in the composer. Club names and kickoff are display-only (no ids to
  // validate against), so the check is just shape + sane bounds.
  let fixture: FeedFixture | null = null;
  const rawFixture = b.fixture as { homeClub?: unknown; awayClub?: unknown; kickoffIso?: unknown; gw?: unknown } | undefined;
  if (rawFixture && (rawFixture.homeClub != null || rawFixture.awayClub != null)) {
    const homeClub = typeof rawFixture.homeClub === "string" ? rawFixture.homeClub.trim().slice(0, 40) : "";
    const awayClub = typeof rawFixture.awayClub === "string" ? rawFixture.awayClub.trim().slice(0, 40) : "";
    const kickoffMs = typeof rawFixture.kickoffIso === "string" ? Date.parse(rawFixture.kickoffIso) : NaN;
    const gw = Number(rawFixture.gw);
    if (!homeClub || !awayClub) throw new HttpError(400, "bad fixture");
    if (Number.isNaN(kickoffMs)) throw new HttpError(400, "bad fixture");
    if (!Number.isInteger(gw) || gw < 1 || gw > 38) throw new HttpError(400, "bad fixture");
    fixture = { homeClub, awayClub, kickoffIso: new Date(kickoffMs).toISOString(), gw };
  }

  // A quote (Phase 3a) — payload.quoteOf points at another user's post. The
  // target must exist and render (not a bot/health-check drill); a quote OF a
  // quote is allowed (the embed just renders one level deep — see EmbeddedPost).
  // Unlike a plain post, a quote always needs its own text or media: an empty
  // "quote" would be indistinguishable from a repost, which has its own action.
  let quoteOf: string | null = null;
  if (b.quoteOf != null) {
    const qid = typeof b.quoteOf === "string" ? b.quoteOf.trim() : "";
    if (!qid) throw new HttpError(400, "bad quote");
    const { data: qRow } = await db.from("fantasy_feed_events").select("id, actor_id, type").eq("id", qid).maybeSingle();
    const bots = syntheticActors();
    if (!qRow || (qRow as { type: string }).type !== "post" || bots.has((qRow as { actor_id: string }).actor_id))
      throw new HttpError(400, "That post is no longer available");
    quoteOf = qid;
  }
  if (quoteOf && !text && !image && !images.length && !gif && !video)
    throw new HttpError(400, "Add a comment or some media to your quote");

  if (!text && !poll && !image && !images.length && !gif && !video && playerId == null && !link && !fixture && !quoteOf)
    throw new HttpError(400, "Write something, add a poll or some media");
  const why = commentRejection(
    [text, poll?.question ?? "", ...(poll?.options ?? [])].filter(Boolean).join(" "),
    { allowLinks: true }, // posts carry deliberate link previews now (Phase 2b)
  );
  if (why) throw new HttpError(400, why);

  // Structured mentions (Phase 1A) — validate whatever the composer tagged
  // against the text + current DB ownership, merged with any handle the
  // user hand-typed without picking from autocomplete. One batch query.
  const mentionEntities = text ? await resolveMentionEntities(db, text, b.mentions) : [];

  const payload: Record<string, unknown> = {};
  if (text) payload.text = text;
  if (poll) payload.poll = poll;
  if (image) payload.image = image;
  if (images.length) payload.images = images;
  if (gif) payload.gif = gif;
  if (video) payload.video = video;
  if (playerId != null) payload.player = playerId;
  if (link) payload.link = link;
  if (fixture) payload.fixture = fixture;
  if (quoteOf) payload.quoteOf = quoteOf;
  if (mentionEntities.length) payload.mentions = mentionEntities;
  const { data, error } = await db.from("fantasy_feed_events")
    .insert({ actor_id: userId, type: "post", gw: null, payload })
    .select("id").single();
  if (error) throw new HttpError(500, error.message);
  const postId = (data as { id: string }).id;
  // Mention notifications (Phase 3b, AC4) — fire-and-forget, never blocks the post.
  if (text) {
    void notifyMentions({
      db, text, actorId: userId, dedupeSubjectId: postId,
      url: `/fantasy/social/post/${postId}`,
      entities: mentionEntities,
    });
  }
  return { id: postId };
}

/** Delete your own post (Phase 5a, AC5) — soft-delete via `payload.deleted`,
 *  never a hard row delete: a repost/quote pointing at this id resolves it
 *  through `targetById`/`targetRenderable` above, which already renders the
 *  existing "This post is unavailable" stub for anything not renderable —
 *  the same path a bot-authored or block-hidden target takes, no new UI
 *  needed. A bookmark of it (fantasy_feed_bookmarks) simply stops resolving
 *  in loadBookmarkedFeed's second query and drops out silently. Ownership is
 *  enforced here, not just in the UI — a 403 for anyone else's post id. */
export async function deleteFeedPost(db: Db, userId: string, eventId: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad delete");
  const { data: row } = await db.from("fantasy_feed_events").select("id, actor_id, type, payload").eq("id", id).maybeSingle();
  const target = row as { id: string; actor_id: string; type: string; payload: Record<string, unknown> | null } | null;
  if (!target || target.type !== "post") throw new HttpError(404, "Post not found");
  if (target.actor_id !== userId) throw new HttpError(403, "You can only delete your own posts");
  const nextPayload = { ...(target.payload ?? {}), deleted: true };
  const { error } = await db.from("fantasy_feed_events").update({ payload: nextPayload }).eq("id", id);
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Vote on a post's poll — one choice per user, switchable. Rejects once the
 *  poll's endsAt has passed; legacy polls (no endsAt) stay open forever. */
export async function voteFeedPoll(db: Db, userId: string, eventId: unknown, optionIndex: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  const idx = Number(optionIndex);
  if (!id || !Number.isInteger(idx) || idx < 0 || idx >= MAX_POLL_OPTIONS) throw new HttpError(400, "bad vote");
  const { data: ev } = await db.from("fantasy_feed_events").select("type, payload").eq("id", id).maybeSingle();
  const post = ev as { type: string; payload: { poll?: { options?: unknown[]; endsAt?: string } } } | null;
  if (!post || post.type !== "post" || !Array.isArray(post.payload?.poll?.options)) throw new HttpError(404, "poll not found");
  if (idx >= post.payload.poll.options.length) throw new HttpError(400, "no such option");
  const endsAt = post.payload.poll.endsAt;
  if (endsAt && Date.now() > Date.parse(endsAt)) throw new HttpError(400, "Poll closed");
  const { error } = await db.from("fantasy_feed_poll_votes")
    .upsert({ event_id: id, user_id: userId, option_index: idx }, { onConflict: "event_id,user_id" });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Repost an existing post — a pointer row (`payload.repostOf`), never a copy.
 *  If the target is ITSELF a repost, resolves to its original server-side (so
 *  reposts never chain — repost-of-a-repost repost-of-the-original). Rejects a
 *  missing/unrenderable target (gone, or by a bot/health-check account) and a
 *  duplicate (one repost per user per original). */
export async function repostFeedEvent(db: Db, userId: string, eventId: unknown): Promise<{ id: string }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad repost");
  const bots = syntheticActors();

  const { data: row } = await db.from("fantasy_feed_events").select("id, actor_id, type, payload").eq("id", id).maybeSingle();
  const target = row as { id: string; actor_id: string; type: string; payload: Record<string, unknown> | null } | null;
  if (!target || target.type !== "post" || bots.has(target.actor_id)) throw new HttpError(404, "Post not found");

  let targetId = id;
  let originalAuthorId = target.actor_id;
  const chainedRepostOf = target.payload?.repostOf;
  if (typeof chainedRepostOf === "string" && chainedRepostOf) {
    const { data: originalRow } = await db.from("fantasy_feed_events").select("id, actor_id, type").eq("id", chainedRepostOf).maybeSingle();
    const original = originalRow as { id: string; actor_id: string; type: string } | null;
    if (!original || original.type !== "post" || bots.has(original.actor_id)) throw new HttpError(404, "Post not found");
    targetId = chainedRepostOf;
    originalAuthorId = original.actor_id;
  }

  const { data: already } = await db.from("fantasy_feed_events")
    .select("id").eq("type", "post").eq("actor_id", userId).eq("payload->>repostOf", targetId).maybeSingle();
  if (already) throw new HttpError(400, "Already reposted");

  const { data, error } = await db.from("fantasy_feed_events")
    .insert({ actor_id: userId, type: "post", gw: null, payload: { repostOf: targetId } })
    .select("id").single();
  if (error) throw new HttpError(500, error.message);
  // Repost notification (Phase 3b, AC5) — never self, never a synthetic reposter.
  if (originalAuthorId !== userId && !bots.has(userId)) void notifyRepostAuthor(db, targetId, originalAuthorId, userId);
  return { id: (data as { id: string }).id };
}

/** Ping the original author that their post got reposted (AC5). Best-effort —
 *  never throws, so a notify hiccup can't fail the repost itself. */
async function notifyRepostAuthor(db: Db, originalId: string, originalAuthorId: string, reposterId: string): Promise<void> {
  try {
    const { data: prof } = await db.from("profiles").select("display_name, username").eq("id", reposterId).maybeSingle();
    const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "A manager");
    await notifyFantasy({
      userIds: [originalAuthorId],
      title: `${who} reposted your post`,
      body: "See it on your profile.",
      url: `/fantasy/social/post/${originalId}`,
      dedupeKey: `repost:${originalId}:${reposterId}`,
      type: "social_repost",
      actorId: reposterId,
    });
  } catch (e) { console.error("[fantasy:feed] repost notify failed:", e); }
}

/** Undo a repost. `eventId` here is always the CONTENT id (the original post's
 *  id) — the client only ever sees that one, per the `repostOf`-resolution
 *  above, so this just deletes the viewer's own pointer row for it. */
export async function undoRepost(db: Db, userId: string, eventId: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad repost");
  const { error } = await db.from("fantasy_feed_events")
    .delete().eq("type", "post").eq("actor_id", userId).eq("payload->>repostOf", id);
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Load a single feed event for the post-detail route — reuses `hydrateEvents`
 *  on a one-row batch, so a post gets the exact same identity/reactions/repost/
 *  quote resolution as it would inline in the feed. Null for a missing row or
 *  one by a bot/health-check account (hydrateEvents' own filter) — the caller
 *  turns that into a 404. */
export async function loadFeedEvent(db: Db, viewerId: string | null, id: string): Promise<FeedEvent | null> {
  if (!id) return null;
  const { data: row } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at").eq("id", id).maybeSingle();
  if (!row) return null;
  const [event] = await hydrateEvents(db, viewerId, [row], "recent", 1);
  return event ?? null;
}

export async function loadFeed(
  db: Db, viewerId: string | null, scope: FeedScope, sort: FeedSort = "recent", limit = 30,
  /** ISO cursor (Phase 5a, AC7) — only events strictly older than this. */
  before?: string | null,
): Promise<FeedResult> {
  // Who the viewer follows — drives the "Following" filter AND whether the
  // Following tab should exist at all (no follows → global only).
  let followeeIds: string[] = [];
  if (viewerId) {
    const { data: follows } = await db.from("user_follows").select("followee_id").eq("follower_id", viewerId);
    followeeIds = ((follows ?? []) as { followee_id: string }[]).map((f) => f.followee_id);
  }
  const followingCount = followeeIds.length;
  if (scope === "following" && followingCount === 0) return { events: [], followingCount, nextCursor: null };

  // "Top" ranks by engagement, so pull a wider recent window then sort in memory.
  // Pagination (AC7): the cursor always advances past this WHOLE fetched
  // window (fetchLimit rows), not just the `limit` events actually returned —
  // for "top" sort this means Top ranks only WITHIN each fetched recency
  // window, never globally across pages. A lower-engagement event that misses
  // the cut on one page's window is simply never revisited on the next page,
  // same as it would be if it just kept scrolling off a "recent" feed.
  const fetchLimit = sort === "top" ? Math.min(200, limit * 6) : limit;
  let q = db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .order("created_at", { ascending: false }).limit(fetchLimit);
  if (scope === "following") q = q.in("actor_id", followeeIds);
  if (before) q = q.lt("created_at", before);
  const { data: rows } = await q;
  const rawRows = rows ?? [];
  // Followed ids (AC1) — already fetched above for the "following" scope
  // filter; reused here for Top's 1.25x follow boost so a second query isn't
  // needed. Only meaningful with a viewer.
  const events = await hydrateEvents(db, viewerId, rawRows, sort, limit, viewerId ? new Set(followeeIds) : undefined);
  const oldest = rawRows.length ? (rawRows[rawRows.length - 1] as { created_at: string }).created_at : null;
  const nextCursor = rawRows.length === fetchLimit ? oldest : null;
  return { events, followingCount, nextCursor };
}

/** The league-scoped feed: the SAME activity, filtered to this league's members.
 *  A flat list (no follow graph) — everyone in the league is "yours" by default,
 *  which is the whole point of a private league. Newest first. */
export async function loadLeagueFeed(
  db: Db, viewerId: string | null, memberIds: string[], limit = 20,
): Promise<FeedEvent[]> {
  if (!memberIds.length) return [];
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .in("actor_id", memberIds)
    .order("created_at", { ascending: false }).limit(limit);
  return hydrateEvents(db, viewerId, rows ?? [], "recent", limit);
}

/** Turn raw feed rows into resolved FeedEvents: identities, sentences, boards,
 *  reaction counts. Shared by the global/following feed and the league feed. */
async function hydrateEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: Db, viewerId: string | null, events: any[], sort: FeedSort, limit: number,
  /** Ids the viewer follows (Phase 5b, AC1) — drives Top's 1.25x follow boost.
   *  Undefined/empty for a guest or when the caller has no viewer context. */
  followedIds?: Set<string>,
): Promise<FeedEvent[]> {
  // Read-time belt to the emit-time braces: rows a bot wrote under an older
  // deploy (or one missing HEALTH_BOT_USER_ID) still never render.
  const bots = syntheticActors();
  // Blocked/muted actors (Phase 5a, AC3/AC4) — hidden from THIS viewer only;
  // a block is bidirectional (hiddenActorIds folds in both directions), a
  // mute only ever hides the muted user's content from the muter. Also drop
  // a post the actor soft-deleted themselves (AC5's payload.deleted flag) —
  // same "never render" treatment as a bot row, right here at the source so
  // every caller of hydrateEvents (feed, league feed, profile tabs, post
  // detail) gets it for free.
  const hidden = await hiddenActorIds(db, viewerId);
  events = events.filter((e) =>
    !bots.has(e.actor_id as string) &&
    !hidden.has(e.actor_id as string) &&
    !(e.type === "post" && e.payload && (e.payload as Record<string, unknown>).deleted === true),
  );
  if (!events.length) return [];

  // Everything a manager does is public feed content right up until the gameweek
  // starts (founder, 3 Aug — the feed needs content, and a squad/transfer/captain
  // is worth talking about before kick-off). No pre-deadline hiding: once the
  // gameweek is under way the moves are locked and simply historical anyway.

  const eventIds = events.map((e) => e.id as string);

  // Repost/quote targets (Phase 3a) — resolved BEFORE the main batch below, in
  // ONE extra query (AC6), so their authors can ride the SAME profiles fetch
  // rather than a second one. A repost pointer row's own payload carries only
  // `{ repostOf }`; everything the card shows (author, text, media, poll) comes
  // from the TARGET row instead — resolved here.
  const repostTargetIds = Array.from(new Set(
    events.filter((e) => e.type === "post" && typeof e.payload?.repostOf === "string").map((e) => e.payload.repostOf as string),
  ));
  const quoteTargetIds = Array.from(new Set(
    events.filter((e) => e.type === "post" && typeof e.payload?.quoteOf === "string").map((e) => e.payload.quoteOf as string),
  ));
  const embedTargetIds = Array.from(new Set([...repostTargetIds, ...quoteTargetIds]));
  const { data: targetRows } = embedTargetIds.length
    ? await db.from("fantasy_feed_events").select("id, actor_id, type, payload, created_at").in("id", embedTargetIds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : { data: [] as any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetById = new Map<string, any>((targetRows ?? []).map((t: any) => [t.id, t]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetRenderable = (t: { type: string; actor_id: string; payload?: any } | undefined) =>
    !!t && t.type === "post" && !bots.has(t.actor_id) && !hidden.has(t.actor_id) && t.payload?.deleted !== true;

  // Mentions (Phase 3b AC3 / Phase 1A structured entities) — a post written
  // by the new composer carries its own validated `payload.mentions`
  // (MentionEntity[]) — trust that directly, no lookup needed. A LEGACY post
  // (written before Phase 1A, or a hand-typed handle with no stored
  // entities) has none, so its handles still need the batch regex+resolve
  // this always did. A repost's text/mentions come from its resolved TARGET
  // (same rule the rest of this function follows for a repost pointer row).
  const storedMentionsOf = (p: Record<string, unknown> | undefined): MentionEntity[] | null => {
    const raw = p?.mentions;
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
  const mentionHandles = Array.from(new Set(
    events
      .filter((e) => e.type === "post")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((e: any) => {
        const repostOfId = typeof e.payload?.repostOf === "string" ? (e.payload.repostOf as string) : null;
        const p = repostOfId ? targetById.get(repostOfId)?.payload : e.payload;
        if (storedMentionsOf(p)) return []; // already covered — no resolve needed
        return typeof p?.text === "string" ? extractMentions(p.text) : [];
      }),
  ));

  const actorIds = Array.from(new Set([
    ...events.map((e) => e.actor_id as string),
    ...(targetRows ?? []).map((t: { actor_id: string }) => t.actor_id),
  ]));

  // Player resolver — name for the sentence, face for the portrait, board marker
  // (pos + club + face) for the squad_complete pitch.
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  const nameOf = (id: number) => poolById.get(id)?.name ?? `#${id}`;
  // Tagged-player tiles carry fixture-forward stats (pos · price · next fixture,
  // with more behind an expand). Fetch the fixture ticker + FPL ownership /
  // last-season ONCE, and only when the batch actually has a player tile — a
  // text-only feed pays nothing for it.
  const hasPlayerTiles = events.some((e) => {
    const t = e.type as string;
    return (t === "shortlist_add" || t === "squad_update" || t === "post")
      && (e.payload as Record<string, unknown> | null)?.player != null;
  });
  const fixturesByClub = hasPlayerTiles ? (await fantasyContext(db)).fixtures : {};
  const boot = hasPlayerTiles ? await fetchFplBootstrapCached() : null;
  const bootEl = new Map((boot?.elements ?? []).map((el) => [el.id, el]));
  const faceOf = (id: number): FeedFace => {
    const p = poolById.get(id);
    const el = bootEl.get(id);
    return {
      name: p?.name ?? `#${id}`,
      avatarUrl: p?.avatarUrl ?? null,
      pos: p?.pos,
      price: p?.price,
      ownership: el?.selected_by_percent != null ? Number(el.selected_by_percent) : null,
      lastSeasonPts: el?.total_points ?? null,
      fixtures: (fixturesByClub[p?.clubId ?? -1] ?? []).slice(0, 3).map((c) => ({
        gw: c.gw, oppShort: c.oppShort, home: c.home, difficulty: c.difficulty,
      })),
    };
  };
  const markerOf = (id: number): BoardPlayer => {
    const p = poolById.get(id);
    return { id, name: p?.name ?? `#${id}`, label: pitchName(p?.name ?? `#${id}`), pos: p?.pos ?? "MID", club: p?.club, avatarUrl: p?.avatarUrl ?? null };
  };

  // Reactions/comments key off the CONTENT id — for a repost pointer row
  // that's the original, which may not itself be in this page's batch, so it
  // has to be folded into these ids too. Same for poll votes.
  const postEventIds = Array.from(new Set([
    ...events.filter((e) => e.type === "post").map((e) => e.id as string),
    ...repostTargetIds,
  ]));
  const reactionCommentIds = Array.from(new Set([...eventIds, ...repostTargetIds]));

  const [
    { data: profs }, { data: reactionRows }, { data: commentRows }, { data: squadRows }, { data: pollVoteRows }, { data: supporterRows },
    { data: repostRows }, { data: bookmarkRows }, mentionMap,
  ] = await Promise.all([
    db.from("profiles").select("id, display_name, avatar_url, username").in("id", actorIds),
    db.from("fantasy_feed_likes").select("event_id, user_id, emoji").in("event_id", reactionCommentIds),
    db.from("comments").select("subject_id").eq("subject_type", "fantasy_feed").in("subject_id", reactionCommentIds).is("deleted_at", null),
    db.from("fantasy_squads").select("user_id, captain").in("user_id", actorIds),
    postEventIds.length
      ? db.from("fantasy_feed_poll_votes").select("event_id, user_id, option_index").in("event_id", postEventIds)
      : Promise.resolve({ data: [] as { event_id: string; user_id: string; option_index: number }[] }),
    // The club each manager SUPPORTS — the crest the quiz shows beside them.
    db.from("club_supporters").select("user_id, club, season_id").in("user_id", actorIds).order("season_id", { ascending: false }),
    // Repost counts (AC7) — one grouped query over payload->>'repostOf' for
    // every content id this batch could need a count for: the page's own post
    // ids (covers an original rendered directly) plus every resolved repost
    // target (covers a repost row rendered through its original). Verified
    // against the live Supabase instance: supabase-js's `.in()` over a jsonb
    // `->>`-extracted path filters correctly via PostgREST (same pattern
    // already used in lib/fantasy/bots.ts for `.eq("payload->>k", ...)`).
    postEventIds.length
      ? db.from("fantasy_feed_events").select("actor_id, payload").eq("type", "post").in("payload->>repostOf", postEventIds)
      : Promise.resolve({ data: [] as { actor_id: string; payload: { repostOf?: string } }[] }),
    // Bookmarks (Phase 3b, AC2) — the viewer's own saves among this batch's
    // content ids. No viewer, or fantasy_feed_bookmarks not migrated yet, both
    // resolve to the same empty result — see myBookmarked below.
    viewerId
      ? db.from("fantasy_feed_bookmarks").select("event_id").eq("user_id", viewerId).in("event_id", reactionCommentIds)
      : Promise.resolve({ data: [] as { event_id: string }[] }),
    mentionHandles.length ? resolveUsernames(db, mentionHandles) : Promise.resolve(new Map<string, { id: string; username: string }>()),
  ]);

  const myBookmarkedSet = new Set<string>(((bookmarkRows ?? []) as { event_id: string }[]).map((r) => r.event_id));

  const profById = new Map<string, { display_name: string | null; avatar_url: string | null; username: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));

  // Repost tallies per content id, plus whether the viewer is one of the reposters.
  const repostCountByTarget = new Map<string, number>();
  const myRepostedTargets = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (repostRows ?? []).forEach((r: any) => {
    const targetId = r.payload?.repostOf;
    if (typeof targetId !== "string" || !targetId) return;
    repostCountByTarget.set(targetId, (repostCountByTarget.get(targetId) ?? 0) + 1);
    if (viewerId && r.actor_id === viewerId) myRepostedTargets.add(targetId);
  });

  /** A repost/quote target's compact summary for the embed — capped text,
   *  one level deep (never resolves the target's OWN quoteOf further). */
  const embedFor = (targetId: string): EmbeddedPost => {
    const t = targetById.get(targetId);
    if (!targetRenderable(t)) return { id: targetId, available: false };
    const p = (t.payload ?? {}) as Record<string, unknown>;
    const rawText = typeof p.text === "string" ? p.text : null;
    const rawVideo = p.video as { posterUrl?: unknown } | undefined;
    const videoPoster = rawVideo && typeof rawVideo.posterUrl === "string" ? rawVideo.posterUrl : null;
    const thumb =
      (Array.isArray(p.images) && typeof p.images[0] === "string" ? (p.images[0] as string) : null) ??
      (typeof p.image === "string" ? p.image : null) ??
      (p.gif && typeof (p.gif as { webp?: unknown }).webp === "string" ? (p.gif as { webp: string }).webp : null) ??
      (p.gif && typeof (p.gif as { gifUrl?: unknown }).gifUrl === "string" ? (p.gif as { gifUrl: string }).gifUrl : null) ??
      videoPoster;
    return {
      id: targetId,
      available: true,
      actorId: t.actor_id,
      actorName: profById.get(t.actor_id)?.display_name ?? (profById.get(t.actor_id)?.username ? `@${profById.get(t.actor_id)!.username}` : "A manager"),
      actorAvatar: profById.get(t.actor_id)?.avatar_url ?? null,
      createdAt: t.created_at,
      text: rawText ? rawText.slice(0, EMBED_TEXT_MAX) : null,
      image: thumb,
      isQuoteOfQuote: typeof p.quoteOf === "string" && !!p.quoteOf,
      hasVideo: !!rawVideo,
    };
  };

  // The crest beside each manager = the club they support (newest season on file),
  // matching the quiz. If they've never picked one, their captain's club stands in.
  const supportedByActor = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supporterRows ?? []).forEach((s: any) => { if (s.club && !supportedByActor.has(s.user_id)) supportedByActor.set(s.user_id, s.club); });
  const captainClubByActor = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (squadRows ?? []).forEach((s: any) => captainClubByActor.set(s.user_id, s.captain != null ? (poolById.get(s.captain)?.club ?? null) : null));
  const clubByActor = new Map<string, string | null>();
  actorIds.forEach((id) => clubByActor.set(id, supportedByActor.get(id) ?? captainClubByActor.get(id) ?? null));

  // Per-event emoji tallies (map emoji -> count), plus the viewer's own reaction.
  const reactionTally = new Map<string, Map<string, number>>();
  const myEmojiByEvent = new Map<string, string>();
  const allowedEmoji = new Set<string>(FEED_REACTIONS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (reactionRows ?? []).forEach((r: any) => {
    const emoji = typeof r.emoji === "string" && allowedEmoji.has(r.emoji) ? r.emoji : "❤️";
    const byEmoji = reactionTally.get(r.event_id) ?? new Map<string, number>();
    byEmoji.set(emoji, (byEmoji.get(emoji) ?? 0) + 1);
    reactionTally.set(r.event_id, byEmoji);
    if (viewerId && r.user_id === viewerId) myEmojiByEvent.set(r.event_id, emoji);
  });
  // Ordered by the canonical set so the bar is stable, then only non-zero shown.
  const reactionsFor = (eventId: string): FeedReaction[] => {
    const byEmoji = reactionTally.get(eventId);
    if (!byEmoji) return [];
    return FEED_REACTIONS.filter((e) => byEmoji.has(e)).map((emoji) => ({ emoji, count: byEmoji.get(emoji)! }));
  };

  const commentCount = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (commentRows ?? []).forEach((c: any) => commentCount.set(c.subject_id, (commentCount.get(c.subject_id) ?? 0) + 1));

  // Poll vote tallies per post event: count by option index + the viewer's choice.
  const pollCounts = new Map<string, Map<number, number>>();
  const myPollChoice = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pollVoteRows ?? []).forEach((v: any) => {
    const byOpt = pollCounts.get(v.event_id) ?? new Map<number, number>();
    byOpt.set(v.option_index, (byOpt.get(v.option_index) ?? 0) + 1);
    pollCounts.set(v.event_id, byOpt);
    if (viewerId && v.user_id === viewerId) myPollChoice.set(v.event_id, v.option_index);
  });

  const mapped: FeedEvent[] = events.map((e) => {
    const type = e.type as FeedType;
    const rawPayload = (e.payload ?? {}) as Record<string, unknown>;

    // Repost pointer row (Phase 3a): everything the card shows comes from the
    // ORIGINAL, not this row — resolve it here, once, before the rest of the
    // per-event parsing below (which then just reads `payload`/`actorId`/
    // `createdAt`/`contentId` as if this WERE the original).
    const repostOfId = type === "post" && typeof rawPayload.repostOf === "string" ? (rawPayload.repostOf as string) : null;
    const repostTarget = repostOfId ? targetById.get(repostOfId) : undefined;
    const repostAvailable = repostOfId ? targetRenderable(repostTarget) : false;

    if (repostOfId && !repostAvailable) {
      // Muted stub (AC6) — no crash, no reactions/comments to fetch for
      // content that no longer resolves.
      return {
        id: e.id, rowKey: e.id, actorId: e.actor_id,
        actorName: profById.get(e.actor_id)?.display_name ?? "A manager",
        actorUsername: profById.get(e.actor_id)?.username ?? null,
        actorAvatar: profById.get(e.actor_id)?.avatar_url ?? null,
        actorClub: clubByActor.get(e.actor_id) ?? null,
        type, gw: e.gw ?? null, sentence: "posted", createdAt: e.created_at,
        reactions: [], myEmoji: null, commentCount: 0,
        repostedBy: { id: e.actor_id, name: profById.get(e.actor_id)?.display_name ?? "A manager" },
        unavailable: true, repostCount: 0, myReposted: false,
        myBookmarked: false, mentionedUsers: null,
      } satisfies FeedEvent;
    }

    const payload = repostOfId && repostTarget ? (repostTarget.payload ?? {}) as Record<string, unknown> : rawPayload;
    const contentActorId: string = repostOfId && repostTarget ? repostTarget.actor_id : e.actor_id;
    const contentCreatedAt: string = repostOfId && repostTarget ? repostTarget.created_at : e.created_at;
    const contentId: string = repostOfId ?? e.id;
    const repostedBy = repostOfId
      ? { id: e.actor_id, name: profById.get(e.actor_id)?.display_name ?? (profById.get(e.actor_id)?.username ? `@${profById.get(e.actor_id)!.username}` : "A manager") }
      : null;

    // squad_complete tiles render the real pitch board; shortlist/squad_update
    // tiles show the one player's portrait.
    let board: FeedBoard | undefined;
    let player: FeedFace | null | undefined;
    let playerId: number | undefined;
    if (type === "squad_complete" && Array.isArray(payload.xi)) {
      const xi = payload.xi as number[];
      const bench = Array.isArray(payload.bench) ? (payload.bench as number[]) : [];
      board = {
        players: [...xi, ...bench].map(markerOf),
        xi, bench,
        captain: payload.captain != null ? Number(payload.captain) : undefined,
        vice: payload.vice != null ? Number(payload.vice) : undefined,
      };
    } else if ((type === "shortlist_add" || type === "squad_update" || type === "post") && payload.player != null) {
      // A post can carry an attached player card too — same tile as shortlist.
      playerId = Number(payload.player);
      player = faceOf(playerId);
    }
    // A quiz_result carries its score line.
    let quiz: FeedQuiz | null | undefined;
    if (type === "quiz_result") {
      quiz = {
        correct: Number(payload.correct ?? 0),
        total: Number(payload.total ?? 0),
        title: typeof payload.title === "string" ? payload.title : null,
        game: payload.game === "round" ? "round" : "quiz",
      };
    }
    // A user post carries its text, an optional image (or images / gif / link
    // / fixture), and (optionally) a poll.
    let text: string | null | undefined;
    let poll: FeedPoll | null | undefined;
    let image: string | null | undefined;
    let images: string[] | null | undefined;
    let gif: FeedGif | null | undefined;
    let video: FeedVideo | null | undefined;
    let link: FeedLink | null | undefined;
    let fixture: FeedFixture | null | undefined;
    if (type === "post") {
      text = typeof payload.text === "string" ? payload.text : null;
      image = typeof payload.image === "string" ? payload.image : null;
      images = Array.isArray(payload.images)
        ? (payload.images as unknown[]).filter((u): u is string => typeof u === "string").slice(0, MAX_POST_IMAGES)
        : null;
      const rawGif = payload.gif as { mp4?: unknown; webp?: unknown; gifUrl?: unknown; width?: unknown; height?: unknown } | undefined;
      gif = rawGif
        ? {
            mp4: typeof rawGif.mp4 === "string" ? rawGif.mp4 : null,
            webp: typeof rawGif.webp === "string" ? rawGif.webp : null,
            gifUrl: typeof rawGif.gifUrl === "string" ? rawGif.gifUrl : null,
            width: Number(rawGif.width) || 0,
            height: Number(rawGif.height) || 0,
          }
        : null;
      const rawVideo = payload.video as { url?: unknown; posterUrl?: unknown; width?: unknown; height?: unknown; durationMs?: unknown } | undefined;
      video = rawVideo && typeof rawVideo.url === "string"
        ? {
            url: rawVideo.url,
            posterUrl: typeof rawVideo.posterUrl === "string" ? rawVideo.posterUrl : null,
            width: Number(rawVideo.width) || 0,
            height: Number(rawVideo.height) || 0,
            durationMs: Number(rawVideo.durationMs) || 0,
          }
        : null;
      const rawLink = payload.link as { url?: unknown; title?: unknown; description?: unknown; siteName?: unknown; image?: unknown; domain?: unknown } | undefined;
      link = rawLink && typeof rawLink.url === "string"
        ? {
            url: rawLink.url,
            title: typeof rawLink.title === "string" ? rawLink.title : null,
            description: typeof rawLink.description === "string" ? rawLink.description : null,
            siteName: typeof rawLink.siteName === "string" ? rawLink.siteName : null,
            image: typeof rawLink.image === "string" ? rawLink.image : null,
            domain: typeof rawLink.domain === "string" ? rawLink.domain : "",
          }
        : null;
      const rawFixture = payload.fixture as { homeClub?: unknown; awayClub?: unknown; kickoffIso?: unknown; gw?: unknown } | undefined;
      fixture = rawFixture && typeof rawFixture.homeClub === "string" && typeof rawFixture.awayClub === "string"
        ? {
            homeClub: rawFixture.homeClub,
            awayClub: rawFixture.awayClub,
            kickoffIso: typeof rawFixture.kickoffIso === "string" ? rawFixture.kickoffIso : "",
            gw: Number(rawFixture.gw) || 0,
          }
        : null;
      const p = payload.poll as { question?: unknown; options?: unknown; endsAt?: unknown } | undefined;
      if (p && Array.isArray(p.options)) {
        const opts = (p.options as unknown[]).map((o) => (typeof o === "string" ? o : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS);
        const byOpt = pollCounts.get(contentId);
        let total = 0;
        const options = opts.map((t, i) => { const c = byOpt?.get(i) ?? 0; total += c; return { text: t, votes: c }; });
        poll = {
          question: typeof p.question === "string" ? p.question : "", options,
          myChoice: myPollChoice.has(contentId) ? myPollChoice.get(contentId)! : null, total,
          endsAt: typeof p.endsAt === "string" ? p.endsAt : null,
        };
      }
    }

    // A quote post's embedded quoted post (Phase 3a) — one level deep, capped
    // text, muted stub if the target no longer resolves.
    const quoteOfId = type === "post" && typeof payload.quoteOf === "string" ? (payload.quoteOf as string) : null;
    const quoteOf = quoteOfId ? embedFor(quoteOfId) : null;

    // Mentions (Phase 3b regex fallback / Phase 1A stored entities) — prefer
    // this post's own validated payload.mentions; fall back to the legacy
    // regex+resolve batch for a post with none (all legacy rows). Either
    // way, an unknown/unresolved handle is simply absent, so it stays plain
    // text on render.
    const stored = type === "post" ? storedMentionsOf(payload) : null;
    const mentionedUsers = type === "post" && text
      ? stored
        ? stored.map((e) => ({ username: e.usernameSnapshot, userId: e.userId }))
        : Array.from(new Set(extractMentions(text)))
            .map((h) => (mentionMap as Map<string, { id: string; username: string }>).get(h))
            .filter((u): u is { id: string; username: string } => !!u)
            .map((u) => ({ username: u.username, userId: u.id }))
      : null;

    return {
      id: contentId,
      rowKey: e.id,
      actorId: contentActorId,
      actorName: profById.get(contentActorId)?.display_name ?? (profById.get(contentActorId)?.username ? `@${profById.get(contentActorId)!.username}` : "A manager"),
      actorUsername: profById.get(contentActorId)?.username ?? null,
      actorAvatar: profById.get(contentActorId)?.avatar_url ?? null,
      actorClub: clubByActor.get(contentActorId) ?? null,
      type,
      gw: e.gw ?? null,
      sentence: sentenceFor(type, payload, e.gw ?? null, nameOf),
      createdAt: contentCreatedAt,
      reactions: reactionsFor(contentId),
      myEmoji: myEmojiByEvent.get(contentId) ?? null,
      commentCount: commentCount.get(contentId) ?? 0,
      board,
      player,
      playerId,
      text,
      poll,
      image,
      images,
      gif,
      video,
      link,
      fixture,
      quiz,
      repostedBy,
      unavailable: false,
      repostCount: repostCountByTarget.get(contentId) ?? 0,
      myReposted: viewerId ? myRepostedTargets.has(contentId) : false,
      quoteOf,
      myBookmarked: viewerId ? myBookmarkedSet.has(contentId) : false,
      mentionedUsers,
    } satisfies FeedEvent;
  });

  // "Top" (Phase 5b, AC1) — deterministic score (reactions + 2*comments +
  // 3*reposts, 24h half-life decay, 1.25x for a followed author) then a
  // post-sort diversity pass (no 3-in-a-row same author or same content
  // class — see feedRank.ts, unit-tested standalone). "Latest" (sort ===
  // "recent") is untouched — still plain created_at order from the query.
  if (sort === "top") return rankTop(mapped, { followedIds: followedIds ?? null }).slice(0, limit);
  return mapped.slice(0, limit);
}

// ── Bookmarks (Phase 3b, AC2) ────────────────────────────────────────────────

/** Resolve a bookmark target to the ORIGINAL post id — defensive against a
 *  repost pointer row's own id being passed in (the client only ever sends
 *  `ev.id`, which is already the content id per hydrateEvents' convention,
 *  but a raw id from elsewhere shouldn't create a bookmark on the wrong row). */
async function resolveContentId(db: Db, eventId: string): Promise<{ id: string; type: string } | null> {
  const { data: row } = await db.from("fantasy_feed_events").select("id, type, payload").eq("id", eventId).maybeSingle();
  const target = row as { id: string; type: string; payload: Record<string, unknown> | null } | null;
  if (!target) return null;
  const repostOf = typeof target.payload?.repostOf === "string" ? (target.payload.repostOf as string) : null;
  return { id: repostOf ?? eventId, type: target.type };
}

/** Bookmark a post (AC2). Validates the event exists. Tolerates a missing
 *  fantasy_feed_bookmarks table pre-migration — surfaces as a friendly 503
 *  rather than a crash (AC8), same graceful-absent discipline as the rest of
 *  Phase 3b. */
export async function bookmarkFeedEvent(db: Db, userId: string, eventId: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad bookmark");
  const target = await resolveContentId(db, id);
  if (!target || target.type !== "post") throw new HttpError(404, "Post not found");
  const { error } = await db.from("fantasy_feed_bookmarks")
    .upsert({ event_id: target.id, user_id: userId }, { onConflict: "event_id,user_id" });
  if (error) throw new HttpError(503, "Bookmarks aren't available right now");
  return { ok: true };
}

/** Remove a bookmark (AC2). No-op (still 200) if it wasn't bookmarked. */
export async function unbookmarkFeedEvent(db: Db, userId: string, eventId: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad bookmark");
  const target = await resolveContentId(db, id);
  const originalId = target?.id ?? id;
  const { error } = await db.from("fantasy_feed_bookmarks").delete().eq("event_id", originalId).eq("user_id", userId);
  if (error) throw new HttpError(503, "Bookmarks aren't available right now");
  return { ok: true };
}

/** The viewer's saved posts, newest-bookmark-first (AC2) — NOT the posts' own
 *  created_at order, so a post bookmarked recently but written long ago still
 *  sits near the top of Saved. Empty (not an error) when the bookmarks table
 *  isn't there yet. */
export async function loadBookmarkedFeed(db: Db, viewerId: string, limit = 30): Promise<FeedEvent[]> {
  const { data: marks } = await db.from("fantasy_feed_bookmarks")
    .select("event_id").eq("user_id", viewerId).order("created_at", { ascending: false }).limit(limit);
  const ids = ((marks ?? []) as { event_id: string }[]).map((m) => m.event_id);
  if (!ids.length) return [];
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at").in("id", ids);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));
  // Bookmark order, not query order — .in() doesn't promise the ids back in
  // the order given.
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  return hydrateEvents(db, viewerId, ordered, "recent", limit);
}

// ── Pinned post (Phase 3b, AC7) ──────────────────────────────────────────────

/** Pin one of YOUR OWN posts to the top of your profile's Posts tab.
 *  Validates ownership — pinning someone else's post 403s. Tolerates a
 *  missing profiles.pinned_event_id column pre-migration (503, AC8). */
export async function pinPost(db: Db, userId: string, eventId: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  if (!id) throw new HttpError(400, "bad pin");
  const { data: row } = await db.from("fantasy_feed_events").select("id, actor_id, type").eq("id", id).maybeSingle();
  const target = row as { id: string; actor_id: string; type: string } | null;
  if (!target || target.type !== "post") throw new HttpError(404, "Post not found");
  if (target.actor_id !== userId) throw new HttpError(403, "You can only pin your own posts");
  const { error } = await db.from("profiles").update({ pinned_event_id: id }).eq("id", userId);
  if (error) throw new HttpError(503, "Pinning isn't available right now");
  return { ok: true };
}

/** Unpin whatever's currently pinned (no-op if nothing was). */
export async function unpinPost(db: Db, userId: string): Promise<{ ok: true }> {
  const { error } = await db.from("profiles").update({ pinned_event_id: null }).eq("id", userId);
  if (error) throw new HttpError(503, "Pinning isn't available right now");
  return { ok: true };
}

/** The profile's pinned post, hydrated exactly like any other feed card. Null
 *  when nothing's pinned, the column doesn't exist yet, or the pinned post
 *  itself no longer resolves (deleted, or its author went bot/health-check). */
export async function loadPinnedPost(db: Db, viewerId: string | null, userId: string): Promise<FeedEvent | null> {
  const { data: prof } = await db.from("profiles").select("pinned_event_id").eq("id", userId).maybeSingle();
  const pinnedId = (prof as { pinned_event_id?: string | null } | null)?.pinned_event_id ?? null;
  if (!pinnedId) return null;
  const event = await loadFeedEvent(db, viewerId, pinnedId);
  return event && !event.unavailable ? event : null;
}

// ── Profile tabs (Phase 3b, AC7) ─────────────────────────────────────────────

/** A user's own "post" events for their profile's Posts tab — hydrated same
 *  as the main feed, newest first, excluding pure reposts (a repost pointer
 *  row's payload is ALWAYS just `{ repostOf }`, nothing else — a quote isn't
 *  excluded, since a quote always carries its own text/media, see quoteOf). */
export async function loadUserPosts(db: Db, viewerId: string | null, userId: string, limit = 30): Promise<FeedEvent[]> {
  // Headroom above `limit`: some rows get dropped as pure reposts below, and
  // hydrateEvents' own bot filter could drop a stray row too.
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .eq("actor_id", userId).eq("type", "post")
    .order("created_at", { ascending: false }).limit(limit * 2);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownRows = ((rows ?? []) as any[]).filter((r) => !r.payload?.repostOf).slice(0, limit);
  return hydrateEvents(db, viewerId, ownRows, "recent", limit);
}

export interface UserReply {
  id: string;
  body: string;
  createdAt: string;
  postId: string;
  postText: string | null;
  postActorName: string;
}

/** A user's own fantasy_feed comments for their profile's Replies tab —
 *  compact rows, newest first, each linking to the post they're on. A reply
 *  whose post no longer resolves (deleted, or by a bot/health-check account)
 *  still shows — just with no quoted post text/author. */
export async function loadUserReplies(db: Db, userId: string, limit = 30): Promise<UserReply[]> {
  const { data: rows } = await db.from("comments")
    .select("id, subject_id, body, created_at")
    .eq("subject_type", "fantasy_feed").eq("user_id", userId).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(limit);
  const list = (rows ?? []) as { id: string; subject_id: string; body: string; created_at: string }[];
  if (!list.length) return [];

  const postIds = Array.from(new Set(list.map((r) => r.subject_id)));
  const { data: postRows } = await db.from("fantasy_feed_events").select("id, actor_id, payload").in("id", postIds);
  const bots = syntheticActors();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postById = new Map<string, any>((postRows ?? []).map((p: any) => [p.id, p]));
  const actorIds = Array.from(new Set(((postRows ?? []) as { actor_id: string }[]).map((p) => p.actor_id)));
  const { data: profs } = actorIds.length
    ? await db.from("profiles").select("id, display_name, username").in("id", actorIds)
    : { data: [] as { id: string; display_name: string | null; username: string | null }[] };
  const nameById = new Map(
    ((profs ?? []) as { id: string; display_name: string | null; username: string | null }[])
      .map((p) => [p.id, p.display_name ?? (p.username ? `@${p.username}` : "A manager")]),
  );

  return list.map((r) => {
    const post = postById.get(r.subject_id);
    const renderable = post && !bots.has(post.actor_id);
    return {
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      postId: r.subject_id,
      postText: renderable && typeof post.payload?.text === "string" ? post.payload.text : null,
      postActorName: renderable ? nameById.get(post.actor_id) ?? "A manager" : "A manager",
    };
  });
}

export interface UserMediaItem { postId: string; thumbUrl: string }

/** A user's own posts that carry an image or GIF, for their profile's Media
 *  tab — newest first, one thumbnail per post (the first image, or the GIF's
 *  still). Pure reposts carry no media of their own and are skipped. */
export async function loadUserMedia(db: Db, userId: string, limit = 30): Promise<UserMediaItem[]> {
  // Headroom: not every post carries media, so a plain `limit` rows fetch
  // could come back thin even when the user has plenty of media posts further back.
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, payload, created_at")
    .eq("actor_id", userId).eq("type", "post")
    .order("created_at", { ascending: false }).limit(limit * 3);

  const items: UserMediaItem[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (rows ?? []) as any[]) {
    if (r.payload?.repostOf) continue;
    const p = r.payload ?? {};
    const thumb: string | null =
      (Array.isArray(p.images) && typeof p.images[0] === "string" ? p.images[0] : null) ??
      (typeof p.image === "string" ? p.image : null) ??
      (p.gif && typeof p.gif.webp === "string" ? p.gif.webp : null) ??
      (p.gif && typeof p.gif.gifUrl === "string" ? p.gif.gifUrl : null);
    if (thumb) items.push({ postId: r.id, thumbUrl: thumb });
    if (items.length >= limit) break;
  }
  return items;
}

// ── Discover feed filters (Phase 5b, AC2) ────────────────────────────────────

export type DiscoverFilter = "trending" | "players" | "polls" | "squads" | "games";

/** A post can never be labelled Trending below this raw (undecayed) engagement
 *  floor (AC2) — reactions + comments + reposts, on the actual post, not the
 *  time-decayed score. Exported so the client's empty-state copy can reference
 *  the same number if it ever needs to. */
export const TRENDING_MIN_ENGAGEMENT = 5;
const TRENDING_WINDOW_HOURS = 48;
const DISCOVER_FETCH_LIMIT = 200; // wide window to rank/group within, mirrors "top" sort's fetchLimit

export interface DiscoverPlayer { playerId: number; name: string; club: string; avatarUrl: string | null; postCount: number }
export interface DiscoverFeedResult {
  events: FeedEvent[];
  /** Only populated for filter === "players" — the top discussed players,
   *  grouped by playerId, min 2 posts to appear (AC2). */
  players?: DiscoverPlayer[];
}

/** Discover's five feed-backed filter chips (AC2). Leagues and Managers are
 *  NOT here — they're existing surfaces (discoverLeagues(), /api/fantasy/
 *  discover) this deliberately leaves untouched. */
export async function loadDiscoverFeed(
  db: Db, viewerId: string | null, filter: DiscoverFilter, limit = 30,
): Promise<DiscoverFeedResult> {
  if (filter === "squads") {
    const { data: rows } = await db.from("fantasy_feed_events")
      .select("id, actor_id, type, gw, payload, created_at")
      .eq("type", "squad_complete")
      .order("created_at", { ascending: false }).limit(limit);
    return { events: await hydrateEvents(db, viewerId, rows ?? [], "recent", limit) };
  }

  if (filter === "games") {
    const { data: rows } = await db.from("fantasy_feed_events")
      .select("id, actor_id, type, gw, payload, created_at")
      .eq("type", "quiz_result")
      .order("created_at", { ascending: false }).limit(limit);
    return { events: await hydrateEvents(db, viewerId, rows ?? [], "recent", limit) };
  }

  if (filter === "polls") {
    // Headroom above `limit`: the open-first re-sort below happens AFTER
    // hydration, so the fetch needs enough rows that a real "open" poll isn't
    // left behind a page of closed ones the DB happened to return first.
    const { data: rows } = await db.from("fantasy_feed_events")
      .select("id, actor_id, type, gw, payload, created_at")
      .eq("type", "post")
      .not("payload->poll", "is", null)
      .order("created_at", { ascending: false }).limit(limit * 3);
    const events = await hydrateEvents(db, viewerId, rows ?? [], "recent", limit * 3);
    const now = Date.now();
    const isOpen = (e: FeedEvent) => !e.poll?.endsAt || Date.parse(e.poll.endsAt) > now;
    const sorted = [...events].sort((a, b) =>
      Number(isOpen(b)) - Number(isOpen(a)) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { events: sorted.slice(0, limit) };
  }

  if (filter === "trending") {
    // Last 48h (AC2), a wide window like Top's own fetchLimit, ranked by the
    // SAME scorer AC1 uses — but the >=5 floor is on RAW engagement, never
    // the decayed score, so a post can't sneak in on the follow boost alone.
    const since = new Date(Date.now() - TRENDING_WINDOW_HOURS * 3_600_000).toISOString();
    const { data: rows } = await db.from("fantasy_feed_events")
      .select("id, actor_id, type, gw, payload, created_at")
      .eq("type", "post")
      .gte("created_at", since)
      .order("created_at", { ascending: false }).limit(DISCOVER_FETCH_LIMIT);
    const events = await hydrateEvents(db, viewerId, rows ?? [], "recent", DISCOVER_FETCH_LIMIT);
    const qualifying = events.filter((e) => rawEngagement(e) >= TRENDING_MIN_ENGAGEMENT);
    let followedIds: Set<string> | undefined;
    if (viewerId) {
      const { data: follows } = await db.from("user_follows").select("followee_id").eq("follower_id", viewerId);
      followedIds = new Set(((follows ?? []) as { followee_id: string }[]).map((f) => f.followee_id));
    }
    const ranked = [...qualifying].sort((a, b) =>
      scoreFeedEvent(b, { followedIds }) - scoreFeedEvent(a, { followedIds }) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { events: ranked.slice(0, limit) };
  }

  // filter === "players" — posts carrying a player attachment, plus the top
  // discussed players across this window (grouped by playerId, min 2 posts).
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .eq("type", "post")
    .not("payload->player", "is", null)
    .order("created_at", { ascending: false }).limit(DISCOVER_FETCH_LIMIT);
  const events = await hydrateEvents(db, viewerId, rows ?? [], "recent", DISCOVER_FETCH_LIMIT);
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  const counts = new Map<number, number>();
  events.forEach((e) => { if (e.playerId != null) counts.set(e.playerId, (counts.get(e.playerId) ?? 0) + 1); });
  const players: DiscoverPlayer[] = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([playerId, postCount]) => {
      const p = poolById.get(playerId);
      return { playerId, name: p?.name ?? `#${playerId}`, club: p?.club ?? "", avatarUrl: p?.avatarUrl ?? null, postCount };
    });
  return { events: events.slice(0, limit), players };
}

// ── Post search (Phase 5b, AC3) ──────────────────────────────────────────────

const POST_SEARCH_WINDOW_DAYS = 30;
const POST_SEARCH_LIMIT = 20;

/** Search posts by body text — authed-optional (guests search too), last 30
 *  days, exclude deleted/hidden. hydrateEvents already applies the 5a hidden-
 *  actor filter (signed-in viewer only) and drops soft-deleted/bot posts, so
 *  this just needs to narrow the query itself. */
export async function searchFeedPosts(db: Db, viewerId: string | null, q: unknown, limit = POST_SEARCH_LIMIT): Promise<FeedEvent[]> {
  const query = typeof q === "string" ? q.trim().slice(0, 80) : "";
  if (query.length < 2) return [];
  const since = new Date(Date.now() - POST_SEARCH_WINDOW_DAYS * 86_400_000).toISOString();
  // Escape PostgREST ilike wildcards so a search term can't smuggle a % or _
  // pattern into the filter.
  const escaped = query.replace(/[%_\\]/g, (c) => `\\${c}`);
  const cappedLimit = Math.min(Math.max(1, limit), 20);
  const { data: rows } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .eq("type", "post")
    .gte("created_at", since)
    .ilike("payload->>text", `%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(cappedLimit + 15); // headroom for hydrateEvents' own bot/hidden/deleted filter
  return hydrateEvents(db, viewerId, rows ?? [], "recent", cappedLimit);
}
