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

export type FeedType = "transfer" | "captain" | "chip" | "haul" | "rank_jump";
export type FeedScope = "following" | "global";

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

  // Player-name resolver for the sentence.
  const poolById = new Map(clientPool().players.map((p) => [p.id, p.name]));
  const nameOf = (id: number) => poolById.get(id) ?? `#${id}`;

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

  return events.map((e) => ({
    id: e.id,
    actorId: e.actor_id,
    actorName: profById.get(e.actor_id)?.display_name ?? "A manager",
    actorAvatar: profById.get(e.actor_id)?.avatar_url ?? null,
    type: e.type as FeedType,
    gw: e.gw ?? null,
    sentence: sentenceFor(e.type as FeedType, e.payload ?? {}, e.gw ?? null, nameOf),
    createdAt: e.created_at,
    likeCount: likeCount.get(e.id) ?? 0,
    likedByMe: likedByMe.has(e.id),
    commentCount: commentCount.get(e.id) ?? 0,
  }));
}
