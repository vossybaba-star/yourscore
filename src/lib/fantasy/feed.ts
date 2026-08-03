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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type FeedType =
  | "transfer" | "captain" | "chip" | "haul" | "rank_jump"
  | "squad_complete" | "squad_update" | "shortlist_add";
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

export interface FeedEvent {
  id: string;
  actorId: string;
  actorName: string;
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
}

const CHIP_LABEL: Record<string, string> = {
  triple_captain: "Triple Captain",
  bench_boost: "Bench Boost",
  insight: "Insight",
};

/** Emit one feed event. No-throw by default at the call site — a feed write must
 *  never fail the user's actual move (see the route wrappers). */
export async function emitFeedEvent(
  db: Db, actorId: string, type: FeedType, gw: number | null, payload: Record<string, unknown>,
): Promise<void> {
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

  const all = [...haulRows, ...jumpRows];
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
    default:
      return "made a move";
  }
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
  if (!events.length) return [];

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

  const [{ data: profs }, { data: reactionRows }, { data: commentRows }, { data: squadRows }] = await Promise.all([
    db.from("profiles").select("id, display_name, avatar_url").in("id", actorIds),
    db.from("fantasy_feed_likes").select("event_id, user_id, emoji").in("event_id", eventIds),
    db.from("comments").select("subject_id").eq("subject_type", "fantasy_feed").in("subject_id", eventIds).is("deleted_at", null),
    db.from("fantasy_squads").select("user_id, captain").in("user_id", actorIds),
  ]);

  const profById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
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
    } else if ((type === "shortlist_add" || type === "squad_update") && payload.player != null) {
      playerId = Number(payload.player);
      player = faceOf(playerId);
    }
    return {
      id: e.id,
      actorId: e.actor_id,
      actorName: profById.get(e.actor_id)?.display_name ?? "A manager",
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
    };
  });

  // "Top" = most engaged first (reactions + comments), recency as the tiebreak.
  if (sort === "top") {
    const engagement = (e: FeedEvent) => totalReactions(e.id) + e.commentCount;
    mapped.sort((a, b) => engagement(b) - engagement(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  return mapped.slice(0, limit);
}
