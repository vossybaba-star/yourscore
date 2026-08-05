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
import {
  BOT_PERSONAS, activeBotPersonas, generateBotMove, generateBotReply,
  type BotMove, type BotPoolPlayer, type ReplyTarget,
} from "./botContent";
import { FEED_REACTIONS } from "./feed";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

/** How long a persona stays quiet after posting. Real accounts don't tweet
 *  every hour on the hour. */
const PERSONA_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export interface BotTickReport {
  bots: number;
  active: number;
  posted: number;
  reactions: number;
  pollVotes: number;
  replies: number;
  reveals: number;
}

const botPool = (): BotPoolPlayer[] =>
  fantasyPool().players.map((p) => ({ id: p.id, name: p.name, club: p.club, pos: p.pos, price: p.price }));

export async function runBotTick(db: Db): Promise<BotTickReport> {
  const { data: botRows } = await db.from("profiles")
    .select("id, username").eq("source", "bot").eq("is_seed", true);
  const bots = (botRows ?? []) as { id: string; username: string | null }[];

  // The ramp gate: accounts all exist, but the CAST grows over launch week
  // (7 personas on day 0 → 11 → 16), so the community reads as filling up.
  const activePersonas = activeBotPersonas(Date.now());
  const activeUsernames = new Set(activePersonas.map((p) => p.username));
  const activeBots = bots.filter((b) => activeUsernames.has(b.username ?? ""));

  const report: BotTickReport = {
    bots: bots.length, active: activeBots.length,
    posted: 0, reactions: 0, pollVotes: 0, replies: 0, reveals: 0,
  };
  if (!activeBots.length) return report;

  const byUsername = new Map(bots.map((b) => [b.username ?? "", b.id]));
  const idOf = (personaKey: string): string | null => {
    const persona = BOT_PERSONAS.find((p) => p.key === personaKey);
    return persona ? (byUsername.get(persona.username) ?? null) : null;
  };
  const botIds = bots.map((b) => b.id);          // every bot — for spotting bot-authored rows
  const botIdSet = new Set(botIds);
  const activeBotIds = activeBots.map((b) => b.id); // only these ACT this tick

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
  const rested = activePersonas
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
  const recent = (recentAll ?? []) as {
    id: string; actor_id: string; type: string; created_at: string;
    payload: { k?: string; poll?: { options?: unknown[] } } | null;
  }[];

  const reactionRows: { event_id: string; user_id: string; emoji: string }[] = [];
  const nReactions = 2 + Math.floor(Math.random() * 5); // 2–6 per tick
  // Real-user content gets first claim on bot engagement — it should never feel
  // like shouting into the void.
  const targets = [...recent].sort((a, b) => Number(botIdSet.has(a.actor_id)) - Number(botIdSet.has(b.actor_id)));
  for (const ev of targets.slice(0, nReactions * 2)) {
    if (reactionRows.length >= nReactions) break;
    const eligible = activeBotIds.filter((id) => id !== ev.actor_id);
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
    const voters = activeBotIds.filter((id) => id !== p.actor_id).sort(() => Math.random() - 0.5).slice(0, nVoters);
    for (const v of voters) voteRows.push({ event_id: p.id, user_id: v, option_index: Math.floor(Math.random() * options) });
  }
  if (voteRows.length) {
    const { error } = await db.from("fantasy_feed_poll_votes")
      .upsert(voteRows, { onConflict: "event_id,user_id", ignoreDuplicates: true });
    if (!error) report.pollVotes = voteRows.length;
  }

  // ── 0–2 replies under recent items ─────────────────────────────────────────
  // Only items 20 minutes to 36 hours old (a reply landing seconds after a post
  // reads as automation), and at most two bot comments per item (no pile-ons).
  // Real users' free-text posts get reactions only — generateBotReply returns
  // null for them, because a canned line under a specific post reads as a bot.
  const replyRoll = Math.random();
  const wantReplies = replyRoll < 0.35 ? 0 : replyRoll < 0.85 ? 1 : 2;
  if (wantReplies > 0) {
    const replyable = recent.filter((e) => {
      const age = now - Date.parse(e.created_at);
      return age > 20 * 60 * 1000 && age < 36 * 60 * 60 * 1000;
    });
    const targetIds = replyable.map((e) => e.id);
    const [{ data: existingComments }, { data: recentReplyBodies }] = await Promise.all([
      targetIds.length
        ? db.from("comments").select("subject_id, user_id")
            .eq("subject_type", "fantasy_feed").in("subject_id", targetIds).is("deleted_at", null)
        : Promise.resolve({ data: [] }),
      // A canned line the feed has seen this week doesn't get said again — two
      // cards apart with the same comment is the fastest tell there is.
      db.from("comments").select("body").in("user_id", botIds)
        .eq("subject_type", "fantasy_feed")
        .gte("created_at", new Date(now - 7 * 864e5).toISOString()),
    ]);
    const usedBodies = new Set(((recentReplyBodies ?? []) as { body: string }[]).map((r) => r.body));
    const commentsByEvent = new Map<string, string[]>();
    for (const c of (existingComments ?? []) as { subject_id: string; user_id: string }[]) {
      commentsByEvent.set(c.subject_id, [...(commentsByEvent.get(c.subject_id) ?? []), c.user_id]);
    }

    // Real-user content first, then least-commented.
    const ordered = [...replyable].sort((a, b) =>
      Number(botIdSet.has(a.actor_id)) - Number(botIdSet.has(b.actor_id)) ||
      (commentsByEvent.get(a.id)?.length ?? 0) - (commentsByEvent.get(b.id)?.length ?? 0));

    const replyRows: { subject_type: string; subject_id: string; user_id: string; body: string }[] = [];
    for (const ev of ordered) {
      if (replyRows.length >= wantReplies) break;
      const already = commentsByEvent.get(ev.id) ?? [];
      if (already.filter((u) => botIdSet.has(u)).length >= 2) continue;
      const target: ReplyTarget = {
        type: ev.type,
        k: botIdSet.has(ev.actor_id) ? ev.payload?.k : undefined,
        pollOptions: Array.isArray(ev.payload?.poll?.options)
          ? (ev.payload!.poll!.options as unknown[]).filter((o): o is string => typeof o === "string")
          : undefined,
      };
      let body: string | null = null;
      for (let i = 0; i < 4 && !body; i++) {
        const candidate = generateBotReply(target);
        if (!candidate) break;
        if (!usedBodies.has(candidate)) body = candidate;
      }
      if (!body) continue;
      const eligible = activeBotIds.filter((id) => id !== ev.actor_id && !already.includes(id));
      if (!eligible.length) continue;
      usedBodies.add(body);
      replyRows.push({
        subject_type: "fantasy_feed", subject_id: ev.id,
        user_id: eligible[Math.floor(Math.random() * eligible.length)], body,
      });
    }
    if (replyRows.length) {
      const { error } = await db.from("comments").insert(replyRows);
      if (!error) report.replies = replyRows.length;
    }
  }

  // ── The occasional squad reveal (rate-my-team energy) ──────────────────────
  // Each persona shows their squad on the feed AT MOST once, at a slow trickle,
  // so reveal cards dot the opening week instead of landing in one clump.
  // Direct insert (never emitFeedEvent) — the emit path pushes notifications to
  // followers, and a bot must never trigger a real push.
  if (Math.random() < 0.12) {
    const { data: revealedRows } = await db.from("fantasy_feed_events")
      .select("actor_id").eq("type", "squad_complete").in("actor_id", activeBotIds);
    const revealed = new Set(((revealedRows ?? []) as { actor_id: string }[]).map((r) => r.actor_id));
    const candidates = activeBotIds.filter((id) => !revealed.has(id));
    if (candidates.length) {
      const who = candidates[Math.floor(Math.random() * candidates.length)];
      const { data: squad } = await db.from("fantasy_squads")
        .select("xi, bench, captain, vice").eq("user_id", who).maybeSingle();
      if (squad?.xi) {
        const { error } = await db.from("fantasy_feed_events").insert({
          actor_id: who, type: "squad_complete", gw: null,
          payload: { xi: squad.xi, bench: squad.bench, captain: squad.captain, vice: squad.vice, k: "squad-reveal" },
        });
        if (!error) report.reveals = 1;
      }
    }
  }

  return report;
}
