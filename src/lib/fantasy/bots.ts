/**
 * The bot tick — makes the fantasy feed feel like FPL Twitter between real
 * users' posts (founder, 4 Aug). Each run: maybe 0–2 fresh posts from personas
 * that haven't spoken recently, a few reactions on recent feed items, and votes
 * on open polls. Personas live in botContent.ts; accounts are created by
 * scripts/fantasy/bots.ts and found here by profiles.source = 'bot'.
 *
 * Volume is deliberately modest (~20–30 posts/day at an hourly cadence) — the
 * bots are seasoning, not the meal, and every one is torn down in one query.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fantasyPool } from "./pool";
import { BOT_PERSONAS, generateBotMove, type BotMove, type BotPoolPlayer } from "./botContent";
import { FEED_REACTIONS } from "./feed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** How long a persona stays quiet after posting. Real accounts don't tweet
 *  every hour on the hour. */
const PERSONA_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export interface BotTickReport {
  bots: number;
  posted: number;
  reactions: number;
  pollVotes: number;
}

const botPool = (): BotPoolPlayer[] =>
  fantasyPool().players.map((p) => ({ id: p.id, name: p.name, club: p.club, pos: p.pos, price: p.price }));

export async function runBotTick(db: Db): Promise<BotTickReport> {
  const { data: botRows } = await db.from("profiles")
    .select("id, username").eq("source", "bot").eq("is_seed", true);
  const bots = (botRows ?? []) as { id: string; username: string | null }[];
  const report: BotTickReport = { bots: bots.length, posted: 0, reactions: 0, pollVotes: 0 };
  if (!bots.length) return report;

  const byUsername = new Map(bots.map((b) => [b.username ?? "", b.id]));
  const idOf = (personaKey: string): string | null => {
    const persona = BOT_PERSONAS.find((p) => p.key === personaKey);
    return persona ? (byUsername.get(persona.username) ?? null) : null;
  };
  const botIds = bots.map((b) => b.id);
  const botIdSet = new Set(botIds);

  // What the bots have said lately — cooldowns + dedupe keys in one read.
  const { data: recentBotEvents } = await db.from("fantasy_feed_events")
    .select("actor_id, payload, created_at").in("actor_id", botIds)
    .order("created_at", { ascending: false }).limit(600);
  const lastPostAt = new Map<string, number>();
  const usedKeys = new Set<string>();
  for (const e of (recentBotEvents ?? []) as { actor_id: string; payload: { k?: string } | null; created_at: string }[]) {
    const t = Date.parse(e.created_at);
    if (!lastPostAt.has(e.actor_id)) lastPostAt.set(e.actor_id, t);
    if (e.payload?.k) usedKeys.add(e.payload.k);
  }

  // Real published quiz packs so a bot's quiz brag points at a playable thing.
  const { data: packRows } = await db.from("quiz_packs")
    .select("title, name").eq("status", "published").limit(40);
  const quizTitles = ((packRows ?? []) as { title: string | null; name: string | null }[])
    .map((p) => p.title ?? p.name).filter((t): t is string => !!t);

  // ── 0–2 posts from rested personas ─────────────────────────────────────────
  const roll = Math.random();
  const wantPosts = roll < 0.3 ? 0 : roll < 0.78 ? 1 : 2;
  const now = Date.now();
  const rested = BOT_PERSONAS
    .filter((p) => {
      const id = byUsername.get(p.username);
      return id && now - (lastPostAt.get(id) ?? 0) > PERSONA_COOLDOWN_MS;
    })
    .sort(() => Math.random() - 0.5);

  const pool = botPool();
  const moves: (BotMove & { actorId: string })[] = [];
  for (const persona of rested.slice(0, wantPosts)) {
    const move = generateBotMove(persona, pool, usedKeys, quizTitles);
    const actorId = move && idOf(move.personaKey);
    if (move && actorId) {
      usedKeys.add(String(move.payload.k));
      moves.push({ ...move, actorId });
    }
  }
  if (moves.length) {
    const { error } = await db.from("fantasy_feed_events")
      .insert(moves.map((m) => ({ actor_id: m.actorId, type: m.type, gw: null, payload: m.payload })));
    if (!error) report.posted = moves.length;
  }

  // ── Reactions on recent feed items (never their own) ───────────────────────
  const { data: recentAll } = await db.from("fantasy_feed_events")
    .select("id, actor_id, type, payload, created_at")
    .gte("created_at", new Date(now - 36 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false }).limit(60);
  const recent = (recentAll ?? []) as { id: string; actor_id: string; type: string; payload: { poll?: { options?: unknown[] } } | null }[];

  const reactionRows: { event_id: string; user_id: string; emoji: string }[] = [];
  const nReactions = 2 + Math.floor(Math.random() * 5); // 2–6 per tick
  // Real-user content gets first claim on bot engagement — it should never feel
  // like shouting into the void.
  const targets = [...recent].sort((a, b) => Number(botIdSet.has(a.actor_id)) - Number(botIdSet.has(b.actor_id)));
  for (const ev of targets.slice(0, nReactions * 2)) {
    if (reactionRows.length >= nReactions) break;
    const eligible = botIds.filter((id) => id !== ev.actor_id);
    if (!eligible.length) continue;
    const who = eligible[Math.floor(Math.random() * eligible.length)];
    const emoji = FEED_REACTIONS[Math.floor(Math.random() * FEED_REACTIONS.length)];
    reactionRows.push({ event_id: ev.id, user_id: who, emoji });
  }
  if (reactionRows.length) {
    // ignoreDuplicates: a bot that already reacted keeps its original reaction.
    const { error } = await db.from("fantasy_feed_likes")
      .upsert(reactionRows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
    if (!error) report.reactions = reactionRows.length;
  }

  // ── Votes on open polls ────────────────────────────────────────────────────
  const polls = recent.filter((e) => e.type === "post" && Array.isArray(e.payload?.poll?.options)).slice(0, 5);
  const voteRows: { event_id: string; user_id: string; option_index: number }[] = [];
  for (const p of polls) {
    const options = (p.payload!.poll!.options as unknown[]).length;
    const nVoters = Math.floor(Math.random() * 3); // 0–2 new bot votes per poll per tick
    const voters = botIds.filter((id) => id !== p.actor_id).sort(() => Math.random() - 0.5).slice(0, nVoters);
    for (const v of voters) voteRows.push({ event_id: p.id, user_id: v, option_index: Math.floor(Math.random() * options) });
  }
  if (voteRows.length) {
    const { error } = await db.from("fantasy_feed_poll_votes")
      .upsert(voteRows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
    if (!error) report.pollVotes = voteRows.length;
  }

  return report;
}
