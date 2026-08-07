/**
 * Scout's Latest — the DAILY, auto-published Scout recommender (founder, 7 Aug).
 *
 * The Four Picks (scoutPicks.ts) are one frozen set per gameweek, drafted and
 * approved by hand — which is exactly why they sat unchanged for a week. This
 * is the opposite: a small, rotating set of 1-3 player IDEAS the Scout surfaces
 * every day, built from the research the news/snapshot crons already gather but
 * never turned into a recommendation. No draft, no approval — a daily cron
 * selects mechanically, grounds the copy, and publishes.
 *
 * This file is the IMPURE half: the DB reads, the grounded AI line, the upsert.
 * The pure selection + dedup lives in scoutLatestSelect.ts (unit tested); this
 * re-exports it so callers import one name.
 *
 * ── Where the daily freshness comes from ────────────────────────────────────
 * Three signals, each moving on its own clock, so the set rotates day to day:
 *   - momentum:      ownership (selected_by_percent) climbing over ~24h — the
 *                    genuinely daily-fresh signal, a different leader most days.
 *   - fixture_swing: a club whose run of fixtures is turning kind (the news
 *                    doc's own fixture-swing insight), mapped to that club's
 *                    best-projected available outfielder.
 *   - watch:         a new doubt over a WIDELY-owned player.
 *
 * ── The guarantee (same as scoutPicks.ts) ───────────────────────────────────
 * Selection is 100% code. The model is handed a CLOSED facts payload for the
 * already-chosen player and may only rephrase it into ONE narrative line,
 * grounded by tips.ts's exact rule plus the no-hype/no-dash lint reused from
 * scoutPicks.ts. A line that fails grounding falls back to a line composed by
 * CODE from the same facts, and copy_source records which happened.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoolPlayer } from "./engine";
import { pricedPool } from "./pool";
import { clubKey } from "./clubKey";
import type { NewsDoc } from "./news";
import { cleanField, collectPayloadTokens, isProseGrounded, hasUngroundedClaim } from "./tips";
import { lintCopy } from "./scoutPicks";
import {
  DEDUP_LOOKBACK_DAYS,
  selectMomentumIdeas, selectFixtureSwingIdeas, selectWatchIdeas, assembleIdeas,
  ideaFacts, headlineFor, ctaFor, composeMechanicalBody, resolveIdeasAtReadTime,
  type SnapLite, type IdeaCandidate, type IdeaFacts, type ScoutIdea, type ScoutLatestDoc,
  type ScoutLatestKind,
} from "./scoutLatestSelect";

// Re-export the shared shapes so components/routes import them from one place.
export {
  MOMENTUM_MIN_DELTA, MOMENTUM_MIN_EP, WATCH_MIN_OWNERSHIP, IDEAS_TARGET, DEDUP_LOOKBACK_DAYS,
  resolveIdeasAtReadTime,
} from "./scoutLatestSelect";
export type {
  ScoutLatestKind, ScoutIdea, ScoutLatestDoc, IdeaFacts, IdeaCandidate, SnapLite, CopySource,
} from "./scoutLatestSelect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

const MODEL = "claude-sonnet-5";

// ── grounding (reuses tips.ts, same rule as scoutPicks.ts) ───────────────────

export interface IdeaCopyOutput { body: string }

/** Ground the model's single body line against the idea's own facts. Pure. One
 *  or two sentences, no invented proper noun / number / claim term, and clean
 *  under the no-hype/no-dash lint — else null, and the caller ships the
 *  mechanical body. */
export function groundIdeaCopy(out: IdeaCopyOutput, facts: IdeaFacts): IdeaCopyOutput | null {
  const base = collectPayloadTokens(facts);
  const words = new Set<string>();
  base.words.forEach((w) => words.add(w));
  ["fpl", "owned", "ownership", "managers", "fixtures", "run", "doubt", "projected", "points"]
    .forEach((w) => words.add(w));
  const tokens = { words, numbers: base.numbers };
  const clean = cleanField(out.body);
  const terminators = (clean.match(/[.!?]+/g) ?? []).length;
  const safe = isProseGrounded(clean, tokens) && !hasUngroundedClaim(clean, words) && lintCopy(clean);
  return clean && terminators > 0 && terminators <= 2 && safe ? { body: clean } : null;
}

// ── AI copy layer (Sonnet, tool-forced — same fetch shape as scoutPicks.ts) ──

interface AnthropicResponse { content?: { type: string; input?: IdeaCopyOutput }[] }

const IDEA_SYSTEM = `You write ONE short line for a YourScore fantasy football "Scout" idea of the day.

THE ABSOLUTE RULE
You know NOTHING about football beyond the JSON you are given. The only proper
noun you may write is the player's name, spelled EXACTLY as "player" gives it.
Do not name his club, his opponent, a manager, or anyone else, and do not add
context you "know" (a reputation, an injury, a transfer, last season).

DO NOT QUOTE NUMBERS
The price, ownership and projection are ALREADY shown on the card next to your
words. Do NOT write any figure, percentage or decimal. Say it in WORDS instead:
"being bought steadily", "a growing pick", "a kind run of fixtures", "a fresh
doubt". A sentence with a number in it will be thrown away.

WHAT THE IDEA IS
The player was already chosen by the app, not by you. "kind" tells you why:
- momentum: managers are buying him, his ownership is rising. Say that plainly.
- fixture_swing: his club's fixtures are turning kind. Lean on fixtureNote if present.
- watch: a doubt has appeared over a widely owned player. Flag it, do not sell him.

VOICE
- ONE sentence, two at the very most. Plain, dry, a little knowing.
- State the point, do not predict a score or promise returns.
- No hype: never "must", "essential", "unlock", "guaranteed", and no hype
  adjectives (amazing, elite, unstoppable, and the like).
- No em dashes or en dashes anywhere. Never output JSON, quotes or braces.

WHAT TO PRODUCE
- body: one short, number-free sentence about this player and why he is the
  idea, in the Scout's voice.`;

async function callModelForIdea(facts: IdeaFacts): Promise<IdeaCopyOutput | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error("[scout latest] copy skipped: no ANTHROPIC_API_KEY");
    return null;
  }
  const tool = {
    name: "scout_idea_copy",
    description: "The single narrative line for a Scout idea of the day.",
    input_schema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
    },
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: IDEA_SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "scout_idea_copy" },
        messages: [{
          role: "user",
          content:
            `These are the ONLY facts that exist for this player:\n\n${JSON.stringify(facts, null, 2)}\n\n` +
            `Write the body. Every name and number must come from that JSON.`,
        }],
      }),
      cache: "no-store",
    });
    if (!res.ok) { console.error(`[scout latest] copy failed: http-${res.status}`); return null; }
    const json = (await res.json()) as AnthropicResponse;
    const block = json.content?.find((c) => c.type === "tool_use");
    if (!block?.input) { console.error("[scout latest] copy failed: no-tool-use-block"); return null; }
    return block.input;
  } catch (e) {
    console.error("[scout latest] copy failed: exception", e);
    return null;
  }
}

/** Full copy step for one idea: ask the model, ground it, fall back to the
 *  mechanical body on any failure. Never throws, never blocks the day's run. */
export async function writeIdea(c: IdeaCandidate): Promise<ScoutIdea> {
  const facts = ideaFacts(c);
  const modelOut = await callModelForIdea(facts);
  const grounded = modelOut ? groundIdeaCopy(modelOut, facts) : null;
  const body = grounded ? grounded.body : composeMechanicalBody(c);
  return {
    id: `${c.kind}:${c.playerId}`,
    kind: c.kind,
    playerId: c.playerId,
    name: c.name,
    club: c.club,
    clubId: c.clubId,
    pos: c.pos,
    priceTenths: c.priceTenths,
    headline: headlineFor(c),
    body,
    cta: ctaFor(c.kind),
    copySource: grounded ? "model" : "mechanical",
    facts,
  };
}

// ── orchestration (impure: DB reads, the AI calls, the upsert) ──────────────

type SnapRow = {
  player_id: number; team: number | null; status: string | null;
  chance_of_playing_next_round: number | null; ep_next: number | null;
  selected_by_percent: number | string | null; next_event: number | null;
};

const numOrNull = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

/** Read the two most recent snapshot batches (current + the newest at least ~20h
 *  earlier, for a real day-over-day ownership delta) plus the newest news doc,
 *  select the day's ideas mechanically, write their copy, and upsert today's
 *  row. Returns the doc it stored (or null when there's nothing to read). */
export async function buildAndStoreScoutLatest(db: Db, today: string): Promise<ScoutLatestDoc | null> {
  const { data: batches } = await db.from("fantasy_fpl_snapshot")
    .select("captured_at").eq("is_rehearsal", false)
    .order("captured_at", { ascending: false }).limit(1);
  const cutoff: string | undefined = (batches as { captured_at: string }[] | null)?.[0]?.captured_at;
  if (!cutoff) return null;

  const { data: curRows } = await db.from("fantasy_fpl_snapshot")
    .select("player_id, team, status, chance_of_playing_next_round, ep_next, selected_by_percent, next_event")
    .eq("captured_at", cutoff).eq("is_rehearsal", false).range(0, 9999);
  const cur = (curRows ?? []) as SnapRow[];
  if (!cur.length) return null;
  const gw = cur.find((r) => r.next_event !== null)?.next_event ?? null;

  const snapById = new Map<number, SnapLite>();
  for (const r of cur) {
    snapById.set(r.player_id, {
      playerId: r.player_id, team: r.team, status: (r.status ?? "u").trim().toLowerCase() || "u",
      chance: r.chance_of_playing_next_round, epNext: numOrNull(r.ep_next), ownershipPct: numOrNull(r.selected_by_percent),
    });
  }

  // The newest batch at least ~20h before the cutoff — the day-over-day anchor.
  const cutoffMs = new Date(cutoff).getTime();
  const priorBefore = new Date(cutoffMs - 20 * 3_600_000).toISOString();
  const { data: prevBatch } = await db.from("fantasy_fpl_snapshot")
    .select("captured_at").eq("is_rehearsal", false).lt("captured_at", priorBefore)
    .order("captured_at", { ascending: false }).limit(1);
  const prevCutoff: string | undefined = (prevBatch as { captured_at: string }[] | null)?.[0]?.captured_at;
  const prevOwnById = new Map<number, number>();
  if (prevCutoff) {
    const { data: prevRows } = await db.from("fantasy_fpl_snapshot")
      .select("player_id, selected_by_percent").eq("captured_at", prevCutoff).eq("is_rehearsal", false).range(0, 9999);
    for (const r of (prevRows ?? []) as { player_id: number; selected_by_percent: number | string | null }[]) {
      const v = numOrNull(r.selected_by_percent);
      if (v !== null) prevOwnById.set(r.player_id, v);
    }
  }

  // Newest news doc for fixture-swing insights + doubts.
  const { data: newsRow } = await db.from("fantasy_news_feed")
    .select("doc").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const doc = (newsRow as { doc: NewsDoc } | null)?.doc ?? null;
  const insights = doc?.insights?.items ?? [];
  const doubts = doc?.teamNews?.doubts ?? [];

  // The priced pool, indexed the three ways selection needs.
  const pool = gw !== null ? await pricedPool(db, gw) : [];
  const poolById = new Map<number, PoolPlayer>();
  const poolBySmId = new Map<number, PoolPlayer>();
  const poolByClubKey = new Map<string, PoolPlayer[]>();
  for (const p of pool) {
    poolById.set(p.id, p);
    if (p.smId !== null) poolBySmId.set(p.smId, p);
    const k = clubKey(p.club);
    const list = poolByClubKey.get(k) ?? [];
    list.push(p);
    poolByClubKey.set(k, list);
  }

  // Recent (kind, player) keys for dedup.
  const { data: recentRows } = await db.from("fantasy_scout_latest")
    .select("items").lt("day", today).order("day", { ascending: false }).limit(DEDUP_LOOKBACK_DAYS);
  const recentKeys = new Set<string>();
  for (const r of (recentRows ?? []) as { items: ScoutIdea[] }[]) {
    for (const it of r.items ?? []) recentKeys.add(`${it.kind}:${it.playerId}`);
  }

  const byKind: Record<ScoutLatestKind, IdeaCandidate[]> = {
    momentum: selectMomentumIdeas(snapById, prevOwnById, poolById),
    fixture_swing: selectFixtureSwingIdeas(insights, snapById, poolByClubKey),
    watch: selectWatchIdeas(doubts, snapById, poolBySmId),
  };
  const chosen = assembleIdeas(byKind, recentKeys);

  const items: ScoutIdea[] = [];
  for (const c of chosen) items.push(await writeIdea(c));

  const generatedAt = new Date().toISOString();
  const row = { day: today, gw, items, data_cutoff: cutoff, generated_at: generatedAt };
  await db.from("fantasy_scout_latest").upsert(row, { onConflict: "day" });

  return { day: today, gw, generatedAt, dataCutoff: cutoff, items };
}

/** How stale the most recent day's ideas may be before the strip hides itself.
 *  The whole point of this surface is freshness, so if the daily cron stops (or
 *  its kill switch is off) the tab shows NOTHING rather than a week-old strip —
 *  the very staleness the Four Picks suffered. Two days of slack covers a single
 *  missed cron run without flicker. */
export const SCOUT_LATEST_MAX_AGE_DAYS = 2;

/** The most recent day's published ideas, resolved against the newest snapshot.
 *  Returns [] when nothing is stored OR the newest row is older than
 *  SCOUT_LATEST_MAX_AGE_DAYS (a stale strip is worse than no strip here).
 *  Impure; the resolve is pure. */
export async function loadLatestScoutIdeas(db: Db): Promise<ScoutIdea[]> {
  const { data: row } = await db.from("fantasy_scout_latest")
    .select("day, items").order("day", { ascending: false }).limit(1).maybeSingle();
  const stored = row as { day: string; items: ScoutIdea[] } | null;
  const items = stored?.items ?? [];
  if (!items.length) return [];

  // London "today" minus the row's day, in whole days — hide if too stale.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const ageDays = Math.round((Date.parse(today) - Date.parse(stored!.day)) / 86_400_000);
  if (Number.isFinite(ageDays) && ageDays > SCOUT_LATEST_MAX_AGE_DAYS) return [];

  const { data: batches } = await db.from("fantasy_fpl_snapshot")
    .select("captured_at").eq("is_rehearsal", false).order("captured_at", { ascending: false }).limit(1);
  const cutoff: string | undefined = (batches as { captured_at: string }[] | null)?.[0]?.captured_at;
  const liveStatusById = new Map<number, string>();
  if (cutoff) {
    const ids = items.map((i) => i.playerId);
    const { data: snapRows } = await db.from("fantasy_fpl_snapshot")
      .select("player_id, status").eq("captured_at", cutoff).eq("is_rehearsal", false).in("player_id", ids);
    for (const r of (snapRows ?? []) as { player_id: number; status: string | null }[]) {
      liveStatusById.set(r.player_id, (r.status ?? "u").trim().toLowerCase() || "u");
    }
  }
  return resolveIdeasAtReadTime(items, liveStatusById);
}
