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
import { loadLeagueFeed, type FeedEvent } from "./feed";
import { notifyFantasy } from "./notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

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
export type ChatKind = "text" | "player" | "poll" | "captain" | "squad" | "news" | "compare" | "gif";

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
}
export interface ChatMoment { emoji: string; text: string; gw: number }

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
    case "poll": return typeof p.question === "string" ? p.question : "started a poll";
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
  const league = await requireMemberLeague(db, code, userId);
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
  const readOnly = viewGw !== currentGw;
  // The gameweeks worth offering in the selector: up to and including the current.
  const gameweeks = gws.filter((g) => g.gw <= currentGw).map((g) => g.gw);

  // Time bounds for the viewed gameweek. GW1 (index 0) has no lower bound so it
  // scoops up pre-season banter; the last/current gw has no upper bound.
  const vi = gws.findIndex((g) => g.gw === viewGw);
  const lower = vi > 0 ? gws[vi].window_start : null;
  const upper = vi >= 0 && vi < gws.length - 1 ? gws[vi + 1].window_start : null;

  let q = db.from("comments")
    .select("id, user_id, body, created_at, kind, payload")
    .eq("subject_type", "fantasy_league").eq("subject_id", league.id)
    .is("deleted_at", null);
  if (lower) q = q.gte("created_at", lower);
  if (upper) q = q.lt("created_at", upper);
  const { data: rows } = await q.order("created_at", { ascending: false }).limit(50);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgs = (rows ?? []) as { id: string; user_id: string; body: string; created_at: string; kind: string | null; payload: any }[];

  const authorIds = Array.from(new Set(msgs.map((m) => m.user_id)));
  const msgIds = msgs.map((m) => m.id);
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

  const cardFor = (m: { id: string; kind: string | null; payload: unknown }): { kind: ChatKind; player?: PlayerCard | null; poll?: PollCard | null; squad?: SquadCard | null; news?: NewsCard | null; compare?: CompareCard | null; gif?: GifCard | null } => {
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

  return {
    league: { name: league.name, stakes: league.stakes, isOwner: league.owner_id === userId },
    gw: viewGw, currentGw, readOnly, gameweeks,
    // oldest-first for a chat read
    messages: msgs.reverse().map((m): ChatMessage => {
      const p = profOf.get(m.user_id);
      const card = cardFor(m);
      return {
        id: m.id, userId: m.user_id,
        name: p?.display_name ?? (p?.username ? `@${p.username}` : "Player"),
        avatarUrl: p?.avatar_url ?? null,
        body: m.body, createdAt: m.created_at, isMe: m.user_id === userId,
        reactions: reactionsFor(m.id),
        kind: card.kind, player: card.player ?? null, poll: card.poll ?? null, squad: card.squad ?? null,
        news: card.news ?? null, compare: card.compare ?? null, gif: card.gif ?? null,
      };
    }),
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

export async function postChat(db: Db, userId: string, code: string, body: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const text = typeof body === "string" ? body.trim() : "";
  if (!text || text.length > 280) throw new HttpError(400, "1-280 characters");
  const why = commentRejection(text);
  if (why) throw new HttpError(400, why);
  const { data: inserted, error } = await db.from("comments")
    .insert({ subject_type: "fantasy_league", subject_id: league.id, user_id: userId, body: text })
    .select("id").single();
  if (error) throw new HttpError(500, error.message);
  // @mentions only — never a push for every message (the spam trap). Fire-and-forget.
  void notifyChatMentions(db, league.id, code, league.name, userId, text, (inserted as { id: string } | null)?.id ?? null);
  return { ok: true };
}

/** Parse @handles in a chat message and notify the mentioned league members. */
async function notifyChatMentions(db: Db, leagueId: string, code: string, leagueName: string, actorId: string, text: string, commentId: string | null) {
  try {
    if (!commentId) return;
    const handles = Array.from(new Set((text.match(/@([a-zA-Z0-9_]{2,30})/g) ?? []).map((h) => h.slice(1).toLowerCase())));
    if (!handles.length) return;
    const { data: members } = await db.from("fantasy_league_members").select("user_id").eq("league_id", leagueId);
    const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== actorId);
    if (!memberIds.length) return;
    const { data: profs } = await db.from("profiles").select("id, username, display_name").in("id", memberIds);
    const mentioned = ((profs ?? []) as { id: string; username: string | null; display_name: string | null }[])
      .filter((p) => p.username && handles.includes(p.username.toLowerCase()));
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
export async function postGif(db: Db, userId: string, code: string, gif: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const g = (gif ?? {}) as { url?: unknown; preview?: unknown; width?: unknown; height?: unknown };
  const url = typeof g.url === "string" ? g.url : "";
  if (!isAllowedGifUrl(url)) throw new HttpError(400, "That GIF isn't from a source we allow");
  const preview = typeof g.preview === "string" && isAllowedGifUrl(g.preview) ? g.preview : url;
  const width = Math.min(2000, Math.max(0, Math.round(Number(g.width) || 0)));
  const height = Math.min(2000, Math.max(0, Math.round(Number(g.height) || 0)));
  // Non-empty body: the comments table's body check rejects "" (and it's the
  // graceful fallback anywhere a GIF can't render). The UI shows the media, not this.
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: "GIF", kind: "gif", payload: { url, preview, width, height },
  });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Post a poll into the league chat: a question and 2–4 options. */
export async function postPoll(db: Db, userId: string, code: string, question: unknown, options: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const q = typeof question === "string" ? question.trim().slice(0, 120) : "";
  const opts = Array.isArray(options)
    ? options.map((o) => (typeof o === "string" ? o.trim().slice(0, 60) : "")).filter(Boolean).slice(0, MAX_POLL_OPTIONS)
    : [];
  if (!q) throw new HttpError(400, "A poll needs a question");
  if (opts.length < 2) throw new HttpError(400, "A poll needs at least two options");
  const why = commentRejection([q, ...opts].join(" "));
  if (why) throw new HttpError(400, why);
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: q, kind: "poll", payload: { question: q, options: opts },
  });
  if (error) throw new HttpError(500, error.message);
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
export async function sharePlayerToLeague(db: Db, userId: string, code: string, playerId: unknown, note: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || !enginePool().some((p) => p.id === pid)) throw new HttpError(400, "unknown player");
  const n = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const why = n ? commentRejection(n) : null;
  if (why) throw new HttpError(400, why);
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: n || "shared a player", kind: "player", payload: { playerId: pid, note: n || null },
  });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Share the sharer's OWN squad into the league chat (from the composer). Snapshot
 *  at share time — the card shows the eleven they had when they posted it. */
export async function shareSquad(db: Db, userId: string, code: string) {
  const league = await requireMemberLeague(db, code, userId);
  const { data: squad } = await db.from("fantasy_squads")
    .select("xi, bench, captain, vice").eq("user_id", userId).maybeSingle();
  const xi = squad && Array.isArray(squad.xi) ? (squad.xi as number[]) : [];
  if (!xi.length) throw new HttpError(409, "build a squad first");
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: "shared their squad", kind: "squad",
    payload: { xi, bench: (squad!.bench as number[]) ?? [], captain: squad!.captain ?? null, vice: squad!.vice ?? null },
  });
  if (error) throw new HttpError(500, error.message);
  void notifyLeagueShare(db, league.id, code, league.name, userId, "shared their squad");
  return { ok: true };
}

/** Share the sharer's current captain into the league chat (from the composer). */
export async function shareCaptain(db: Db, userId: string, code: string) {
  const league = await requireMemberLeague(db, code, userId);
  const { data: squad } = await db.from("fantasy_squads")
    .select("captain").eq("user_id", userId).maybeSingle();
  if (!squad || squad.captain == null) throw new HttpError(409, "pick a captain first");
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: "shared their captain", kind: "captain", payload: { playerId: squad.captain },
  });
  if (error) throw new HttpError(500, error.message);
  void notifyLeagueShare(db, league.id, code, league.name, userId, "shared their captain");
  return { ok: true };
}

/** Share a news article into the league chat (from the news reader). Self-contained
 *  — the article fields are stored on the payload, nothing to resolve. */
export async function shareNews(db: Db, userId: string, code: string, article: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const a = (article ?? {}) as { title?: unknown; source?: unknown; url?: unknown; image?: unknown; internal?: unknown };
  const title = typeof a.title === "string" ? a.title.trim().slice(0, 300) : "";
  if (!title) throw new HttpError(400, "nothing to share");
  const why = commentRejection(title);
  if (why) throw new HttpError(400, why);
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: title, kind: "news",
    payload: {
      title,
      source: typeof a.source === "string" ? a.source.slice(0, 80) : "",
      url: typeof a.url === "string" ? a.url.slice(0, 500) : "",
      image: typeof a.image === "string" ? a.image.slice(0, 500) : null,
      internal: a.internal === true,
    },
  });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}

/** Share a two-player comparison into the league chat (from the compare screen). */
export async function shareComparison(db: Db, userId: string, code: string, aId: unknown, bId: unknown) {
  const league = await requireMemberLeague(db, code, userId);
  const a = Number(aId), b = Number(bId);
  const pool = enginePool();
  const known = (id: number) => Number.isInteger(id) && pool.some((p) => p.id === id);
  if (!known(a) || !known(b) || a === b) throw new HttpError(400, "pick two different players");
  const { error } = await db.from("comments").insert({
    subject_type: "fantasy_league", subject_id: league.id, user_id: userId,
    body: "shared a comparison", kind: "compare", payload: { a, b },
  });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
}
