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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

export type FeedType =
  | "transfer" | "captain" | "chip" | "haul" | "rank_jump"
  | "squad_complete" | "squad_update" | "shortlist_add";
export type FeedScope = "following" | "global";

export interface FeedFace { name: string; avatarUrl: string | null; captain?: boolean }

export interface FeedEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorAvatar: string | null;
  type: FeedType;
  gw: number | null;
  sentence: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  /** The XI faces for a squad_complete tile (captain marked). */
  faces?: FeedFace[];
  /** A single player's portrait for shortlist/squad_update tiles. */
  player?: FeedFace | null;
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
      return "finalised their squad";
    case "squad_update":
      return payload.player != null ? `added ${nameOf(Number(payload.player))} to their squad` : "reshaped their squad";
    case "shortlist_add":
      return `shortlisted ${nameOf(Number(payload.player))}`;
    default:
      return "made a move";
  }
}

export async function loadFeed(
  db: Db, viewerId: string | null, scope: FeedScope, limit = 30,
): Promise<FeedEvent[]> {
  // Following = actors the viewer follows; global = everyone.
  let actorFilter: string[] | null = null;
  if (scope === "following") {
    if (!viewerId) return [];
    const { data: follows } = await db.from("user_follows").select("followee_id").eq("follower_id", viewerId);
    const ids = ((follows ?? []) as { followee_id: string }[]).map((f) => f.followee_id);
    if (!ids.length) return [];
    actorFilter = ids;
  }

  let q = db.from("fantasy_feed_events")
    .select("id, actor_id, type, gw, payload, created_at")
    .order("created_at", { ascending: false }).limit(limit);
  if (actorFilter) q = q.in("actor_id", actorFilter);
  const { data: rows } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events = (rows ?? []) as any[];
  if (!events.length) return [];

  const eventIds = events.map((e) => e.id as string);
  const actorIds = Array.from(new Set(events.map((e) => e.actor_id as string)));

  // Player resolver — name for the sentence, face for the tile.
  const poolById = new Map(clientPool().players.map((p) => [p.id, { name: p.name, avatarUrl: p.avatarUrl ?? null }]));
  const nameOf = (id: number) => poolById.get(id)?.name ?? `#${id}`;
  const faceOf = (id: number): FeedFace => ({ name: poolById.get(id)?.name ?? `#${id}`, avatarUrl: poolById.get(id)?.avatarUrl ?? null });

  const [{ data: profs }, { data: likeRows }, { data: commentRows }] = await Promise.all([
    db.from("profiles").select("id, display_name, avatar_url").in("id", actorIds),
    db.from("fantasy_feed_likes").select("event_id, user_id").in("event_id", eventIds),
    db.from("comments").select("subject_id").eq("subject_type", "fantasy_feed").in("subject_id", eventIds).is("deleted_at", null),
  ]);

  const profById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (profs ?? []).forEach((p: any) => profById.set(p.id, p));

  const likeCount = new Map<string, number>();
  const likedByMe = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (likeRows ?? []).forEach((l: any) => {
    likeCount.set(l.event_id, (likeCount.get(l.event_id) ?? 0) + 1);
    if (viewerId && l.user_id === viewerId) likedByMe.add(l.event_id);
  });

  const commentCount = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (commentRows ?? []).forEach((c: any) => commentCount.set(c.subject_id, (commentCount.get(c.subject_id) ?? 0) + 1));

  return events.map((e) => {
    const type = e.type as FeedType;
    const payload = (e.payload ?? {}) as Record<string, unknown>;
    // squad_complete tiles show the XI faces (captain marked); shortlist/squad_update
    // tiles show the one player's portrait.
    let faces: FeedFace[] | undefined;
    let player: FeedFace | null | undefined;
    if (type === "squad_complete" && Array.isArray(payload.xi)) {
      const cap = Number(payload.captain);
      faces = (payload.xi as number[]).slice(0, 11).map((id) => ({ ...faceOf(id), captain: id === cap }));
    } else if ((type === "shortlist_add" || type === "squad_update") && payload.player != null) {
      player = faceOf(Number(payload.player));
    }
    return {
      id: e.id,
      actorId: e.actor_id,
      actorName: profById.get(e.actor_id)?.display_name ?? "A manager",
      actorAvatar: profById.get(e.actor_id)?.avatar_url ?? null,
      type,
      gw: e.gw ?? null,
      sentence: sentenceFor(type, payload, e.gw ?? null, nameOf),
      createdAt: e.created_at,
      likeCount: likeCount.get(e.id) ?? 0,
      likedByMe: likedByMe.has(e.id),
      commentCount: commentCount.get(e.id) ?? 0,
      faces,
      player,
    };
  });
}
