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
import { pitchName, type BoardPlayer } from "./board";
import { notifyFantasy } from "./notify";
import { commentRejection } from "@/lib/moderation";
import { HttpError } from "./server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type FeedType =
  | "transfer" | "captain" | "chip" | "haul" | "rank_jump"
  | "squad_complete" | "squad_update" | "shortlist_add"
  | "post" // a user-authored text/poll/image/player post (Social → Live)
  | "quiz_result"; // a finished quiz pack or knowledge round worth shouting about
export type FeedScope = "following" | "global";
export type FeedSort = "recent" | "top";
export interface FeedResult { events: FeedEvent[]; followingCount: number }

export interface FeedFace { name: string; avatarUrl: string | null; captain?: boolean }

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
 *  own choice (if voted), and the total votes. */
export interface FeedPoll {
  question: string;
  options: { text: string; votes: number }[];
  myChoice: number | null;
  total: number;
}
export const MAX_POLL_OPTIONS = 4;
export const POST_MAX = 500;

/** A quiz_result tile: the score line plus where the game lives, so the tile
 *  can send a reader off to play the same thing. */
export interface FeedQuiz {
  correct: number;
  total: number;
  title: string | null;
  game: "quiz" | "round";
}

export interface FeedEvent {
  id: string;
  actorId: string;
  actorName: string;
  /** The @username handle (never bold in the UI — Twitter grammar). Null when
   *  the account hasn't picked one. */
  actorHandle: string | null;
  actorAvatar: string | null;
  /** The manager's captain's club — the crest we show beside them (no stored
   *  favourite club exists, so the player they backed most stands in for it). */
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
  /** An optional image attached to a post (public post-media URL). */
  image?: string | null;
  /** A quiz_result's score card. */
  quiz?: FeedQuiz | null;
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
const syntheticActors = () =>
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
  const b = (body ?? {}) as { text?: unknown; poll?: unknown; image?: unknown; playerId?: unknown };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, POST_MAX) : "";

  // An attached player card — must be a real pool id (the tile links to their
  // profile, so a junk id would mint a dead link).
  let playerId: number | null = null;
  if (b.playerId != null) {
    const pid = Number(b.playerId);
    if (!Number.isInteger(pid) || !clientPool().players.some((p) => p.id === pid)) throw new HttpError(400, "bad player");
    playerId = pid;
  }

  let poll: { question: string; options: string[] } | null = null;
  const rawPoll = b.poll as { question?: unknown; options?: unknown } | undefined;
  if (rawPoll && (rawPoll.question != null || Array.isArray(rawPoll.options))) {
    const question = typeof rawPoll.question === "string" ? rawPoll.question.trim().slice(0, 120) : "";
    const options = Array.isArray(rawPoll.options)
      ? rawPoll.options.map((o) => (typeof o === "string" ? o.trim().slice(0, 60) : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
      : [];
    if (!question) throw new HttpError(400, "A poll needs a question");
    if (options.length < 2) throw new HttpError(400, "A poll needs at least two options");
    poll = { question, options };
  }

  // An image must live in OUR post-media bucket — never an arbitrary external URL.
  let image = typeof b.image === "string" ? b.image.trim() : "";
  if (image) {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
    if (!base || !image.startsWith(`${base}/storage/v1/object/public/post-media/`)) {
      throw new HttpError(400, "bad image");
    }
    image = image.slice(0, 500);
  }

  if (!text && !poll && !image && playerId == null) throw new HttpError(400, "Write something, add a poll or an image");
  const why = commentRejection([text, poll?.question ?? "", ...(poll?.options ?? [])].filter(Boolean).join(" "));
  if (why) throw new HttpError(400, why);

  const payload: Record<string, unknown> = {};
  if (text) payload.text = text;
  if (poll) payload.poll = poll;
  if (image) payload.image = image;
  if (playerId != null) payload.player = playerId;
  const { data, error } = await db.from("fantasy_feed_events")
    .insert({ actor_id: userId, type: "post", gw: null, payload })
    .select("id").single();
  if (error) throw new HttpError(500, error.message);
  return { id: (data as { id: string }).id };
}

/** Vote on a post's poll — one choice per user, switchable. */
export async function voteFeedPoll(db: Db, userId: string, eventId: unknown, optionIndex: unknown): Promise<{ ok: true }> {
  const id = typeof eventId === "string" ? eventId : "";
  const idx = Number(optionIndex);
  if (!id || !Number.isInteger(idx) || idx < 0 || idx >= MAX_POLL_OPTIONS) throw new HttpError(400, "bad vote");
  const { data: ev } = await db.from("fantasy_feed_events").select("type, payload").eq("id", id).maybeSingle();
  const post = ev as { type: string; payload: { poll?: { options?: unknown[] } } } | null;
  if (!post || post.type !== "post" || !Array.isArray(post.payload?.poll?.options)) throw new HttpError(404, "poll not found");
  if (idx >= post.payload.poll.options.length) throw new HttpError(400, "no such option");
  const { error } = await db.from("fantasy_feed_poll_votes")
    .upsert({ event_id: id, user_id: userId, option_index: idx }, { onConflict: "event_id,user_id" });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

export async function loadFeed(
  db: Db, viewerId: string | null, scope: FeedScope, sort: FeedSort = "recent", limit = 30,
): Promise<FeedResult> {
  // Who the viewer follows — drives the "Following" filter AND whether the
  // Following tab should exist at all (no follows → global only).
  let followeeIds: string[] = [];
  if (viewerId) {
    const { data: follows } = await db.from("user_follows").select("followee_id").eq("follower_id", viewerId);
    followeeIds = ((follows ?? []) as { followee_id: string }[]).map((f) => f.followee_id);
  }
  const followingCount = followeeIds.length;
  if (scope === "following" && followingCount === 0) return { events: [], followingCount };

  // "Top" ranks by engagement, so pull a wider recent window then sort in memory.
  const fetchLimit = sort === "top" ? Math.min(200, limit * 6) : limit;
  let q = db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .order("created_at", { ascending: false }).limit(fetchLimit);
  if (scope === "following") q = q.in("actor_id", followeeIds);
  const { data: rows } = await q;
  const events = await hydrateEvents(db, viewerId, rows ?? [], sort, limit);
  return { events, followingCount };
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
): Promise<FeedEvent[]> {
  // Read-time belt to the emit-time braces: rows a bot wrote under an older
  // deploy (or one missing HEALTH_BOT_USER_ID) still never render.
  const bots = syntheticActors();
  events = events.filter((e) => !bots.has(e.actor_id as string));
  if (!events.length) return [];

  // Everything a manager does is public feed content right up until the gameweek
  // starts (founder, 3 Aug — the feed needs content, and a squad/transfer/captain
  // is worth talking about before kick-off). No pre-deadline hiding: once the
  // gameweek is under way the moves are locked and simply historical anyway.

  const eventIds = events.map((e) => e.id as string);
  const actorIds = Array.from(new Set(events.map((e) => e.actor_id as string)));

  // Player resolver — name for the sentence, face for the portrait, board marker
  // (pos + club + face) for the squad_complete pitch.
  const poolById = new Map(clientPool().players.map((p) => [p.id, p]));
  const nameOf = (id: number) => poolById.get(id)?.name ?? `#${id}`;
  const faceOf = (id: number): FeedFace => ({ name: poolById.get(id)?.name ?? `#${id}`, avatarUrl: poolById.get(id)?.avatarUrl ?? null });
  const markerOf = (id: number): BoardPlayer => {
    const p = poolById.get(id);
    return { id, name: p?.name ?? `#${id}`, label: pitchName(p?.name ?? `#${id}`), pos: p?.pos ?? "MID", club: p?.club, avatarUrl: p?.avatarUrl ?? null };
  };

  const postEventIds = events.filter((e) => e.type === "post").map((e) => e.id as string);
  const [{ data: profs }, { data: reactionRows }, { data: commentRows }, { data: squadRows }, { data: pollVoteRows }] = await Promise.all([
    db.from("profiles").select("id, display_name, username, avatar_url").in("id", actorIds),
    db.from("fantasy_feed_likes").select("event_id, user_id, emoji").in("event_id", eventIds),
    db.from("comments").select("subject_id").eq("subject_type", "fantasy_feed").in("subject_id", eventIds).is("deleted_at", null),
    db.from("fantasy_squads").select("user_id, captain").in("user_id", actorIds),
    postEventIds.length
      ? db.from("fantasy_feed_poll_votes").select("event_id, user_id, option_index").in("event_id", postEventIds)
      : Promise.resolve({ data: [] as { event_id: string; user_id: string; option_index: number }[] }),
  ]);

  const profById = new Map<string, { display_name: string | null; username: string | null; avatar_url: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));

  // The crest beside each manager = their captain's club (their headline pick).
  const clubByActor = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (squadRows ?? []).forEach((s: any) => clubByActor.set(s.user_id, s.captain != null ? (poolById.get(s.captain)?.club ?? null) : null));

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
  const totalReactions = (eventId: string): number => {
    const byEmoji = reactionTally.get(eventId);
    if (!byEmoji) return 0;
    let n = 0; byEmoji.forEach((c) => (n += c)); return n;
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
    const payload = (e.payload ?? {}) as Record<string, unknown>;
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
    // A user post carries its text, an optional image, and (optionally) a poll.
    let text: string | null | undefined;
    let poll: FeedPoll | null | undefined;
    let image: string | null | undefined;
    if (type === "post") {
      text = typeof payload.text === "string" ? payload.text : null;
      image = typeof payload.image === "string" ? payload.image : null;
      const p = payload.poll as { question?: unknown; options?: unknown } | undefined;
      if (p && Array.isArray(p.options)) {
        const opts = (p.options as unknown[]).map((o) => (typeof o === "string" ? o : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS);
        const byOpt = pollCounts.get(e.id);
        let total = 0;
        const options = opts.map((t, i) => { const c = byOpt?.get(i) ?? 0; total += c; return { text: t, votes: c }; });
        poll = { question: typeof p.question === "string" ? p.question : "", options, myChoice: myPollChoice.has(e.id) ? myPollChoice.get(e.id)! : null, total };
      }
    }
    return {
      id: e.id,
      actorId: e.actor_id,
      actorName: profById.get(e.actor_id)?.display_name ?? "A manager",
      actorHandle: profById.get(e.actor_id)?.username ?? null,
      actorAvatar: profById.get(e.actor_id)?.avatar_url ?? null,
      actorClub: clubByActor.get(e.actor_id) ?? null,
      type,
      gw: e.gw ?? null,
      sentence: sentenceFor(type, payload, e.gw ?? null, nameOf),
      createdAt: e.created_at,
      reactions: reactionsFor(e.id),
      myEmoji: myEmojiByEvent.get(e.id) ?? null,
      commentCount: commentCount.get(e.id) ?? 0,
      board,
      player,
      playerId,
      text,
      poll,
      image,
      quiz,
    };
  });

  // "Top" = most engaged first (reactions + comments), recency as the tiebreak.
  if (sort === "top") {
    const engagement = (e: FeedEvent) => totalReactions(e.id) + e.commentCount;
    mapped.sort((a, b) => engagement(b) - engagement(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  return mapped.slice(0, limit);
}
