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
import { enginePool } from "./pool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** The reaction set (founder's pick). Kept small and validated so the column
 *  never fills with arbitrary strings. */
export const CHAT_EMOJI = ["😂", "👀", "🔥", "👏", "❤️", "😭"] as const;
export type ChatEmoji = (typeof CHAT_EMOJI)[number];
export interface ChatReaction { emoji: string; count: number; mine: boolean }

export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean;
  reactions: ChatReaction[];
}
export interface ChatMoment { emoji: string; text: string; gw: number }

async function requireMemberLeague(db: Db, code: string, userId: string) {
  const { data: league } = await db.from("fantasy_leagues")
    .select("id, name, owner_id, stakes").eq("join_code", code.toUpperCase()).maybeSingle();
  if (!league) throw new HttpError(404, "league not found");
  const { data: member } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  if (!member) throw new HttpError(403, "not in this league");
  return league as { id: string; name: string; owner_id: string; stakes: string | null };
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
    .select("user_id, points, hits, cash_points, chip, captain, captain_used, round_done_at, round_correct")
    .eq("gw", gw).in("user_id", memberIds).not("scored_at", "is", null).range(0, 9999);
  const rows = (entries ?? []) as {
    user_id: string; points: number | null; hits: number; cash_points: number;
    chip: string | null; captain: number | null; captain_used: number | null;
    round_done_at: string | null; round_correct: number;
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
  }
  return moments.slice(0, 6);
}

export async function leagueChat(db: Db, userId: string, code: string) {
  const league = await requireMemberLeague(db, code, userId);
  const { data: members } = await db.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).range(0, 9999);
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);

  const { data: rows } = await db.from("comments")
    .select("id, user_id, body, created_at")
    .eq("subject_type", "fantasy_league").eq("subject_id", league.id)
    .is("deleted_at", null).order("created_at", { ascending: false }).limit(50);
  const msgs = (rows ?? []) as { id: string; user_id: string; body: string; created_at: string }[];

  const authorIds = Array.from(new Set(msgs.map((m) => m.user_id)));
  const msgIds = msgs.map((m) => m.id);
  const [{ data: profs }, { data: reactRows }] = await Promise.all([
    authorIds.length
      ? db.from("profiles").select("id, display_name, username, avatar_url").in("id", authorIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[] }),
    msgIds.length
      ? db.from("comment_reactions").select("comment_id, user_id, emoji").in("comment_id", msgIds)
      : Promise.resolve({ data: [] as { comment_id: string; user_id: string; emoji: string }[] }),
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
    // Keep the founder's emoji order stable.
    return CHAT_EMOJI.filter((e) => per.has(e)).map((e) => ({ emoji: e, count: per.get(e)!.count, mine: per.get(e)!.mine }));
  };

  const latest = await latestScoredGw(db, memberIds);

  return {
    league: { name: league.name, stakes: league.stakes, isOwner: league.owner_id === userId },
    // oldest-first for a chat read
    messages: msgs.reverse().map((m): ChatMessage => {
      const p = profOf.get(m.user_id);
      return {
        id: m.id, userId: m.user_id,
        name: p?.display_name ?? (p?.username ? `@${p.username}` : "Player"),
        avatarUrl: p?.avatar_url ?? null,
        body: m.body, createdAt: m.created_at, isMe: m.user_id === userId,
        reactions: reactionsFor(m.id),
      };
    }),
    moments: latest != null ? await momentsForGw(db, memberIds, latest) : [],
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
  const { error } = await db.from("comments")
    .insert({ subject_type: "fantasy_league", subject_id: league.id, user_id: userId, body: text });
  if (error) throw new HttpError(500, error.message);
  return { ok: true };
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
