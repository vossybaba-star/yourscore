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

export interface ChatMessage {
  id: string; userId: string; name: string; avatarUrl: string | null;
  body: string; createdAt: string; isMe: boolean;
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

/** The week's talking points, derived from the latest scored gameweek. */
async function momentsFor(db: Db, memberIds: string[]): Promise<ChatMoment[]> {
  const { data: latest } = await db.from("fantasy_entries")
    .select("gw").in("user_id", memberIds).not("scored_at", "is", null)
    .order("gw", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return [];
  const gw = latest.gw as number;

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
    if (r.chip === "wildcard") moments.push({ emoji: "🃏", text: `${nameOf(r.user_id)} hit the panic button — full wildcard rebuild.`, gw });
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
  const { data: profs } = authorIds.length
    ? await db.from("profiles").select("id, display_name, username, avatar_url").in("id", authorIds)
    : { data: [] };
  const profOf = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null; avatar_url: string | null }[])
    .map((p) => [p.id, p]));

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
      };
    }),
    moments: await momentsFor(db, memberIds),
  };
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
