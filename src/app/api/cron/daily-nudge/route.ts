import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyUsers } from "@/lib/notify";
import {
  buildDailyNudge,
  NUDGE_DAYS,
  STREAK_MIN,
  type NudgeContext,
  type PrimaryGame,
} from "@/lib/notify/daily-nudge";

/**
 * Hourly cron: the ONE personalised daily play-reminder.
 *
 * Send-time personalised (like wc-mastermind): each opted-in, reachable user is
 * considered at THEIR habitual hour (profiles.active_hour_utc; null → 19:00 UTC).
 * Over 24 hourly runs every user is considered once. For each, we assemble a
 * NudgeContext from their recent play history + rank and let buildDailyNudge()
 * pick the single best message (or decline). See src/lib/notify/daily-nudge.ts
 * for the priority ladder and the "never nudge daily" guarantees.
 *
 * ≤1 push/user/day: one send-hour bucket per user + a shared `daily-push:<date>`
 * dedupe key inside notifyUsers.
 *
 * This SUPERSEDES the generic wc-mastermind blast (the locked WC copy survives as
 * the ladder's fallback branch). Keep only one of the two crons live at a time —
 * see vercel.json.
 *
 * Safety rails: gated behind DAILY_NUDGE_PUSH_ENABLED; only reachable users
 * (device token present); hard cap MAX_PER_RUN. Auth: Bearer CRON_SECRET.
 */
const FALLBACK_HOUR = 19; // must match wc-mastermind + compute-send-times evening
const MAX_PER_RUN = 500;
const WINDOW_DAYS = 40; // enough history for the 30-day nudge + streak walk-back

// PostgREST silently caps every response at max_rows (1000 on this project) — no
// error, no signal. The history reads below fan out across up to MAX_PER_RUN users
// and would blow past that, dropping rows with no warning. A dropped row is not
// cosmetic: a missing play-day makes playedToday false for someone who DID play,
// so we'd push them anyway and break the module's core "never nudge a player who
// already played today" guarantee. So: fetch every history table in id-chunks,
// and page each chunk to exhaustion.
const ID_CHUNK = 50; // users per history query — keeps each result far under the cap
const PAGE = 1000; // == PostgREST max_rows

export const fetchCache = "force-no-store";

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * Run `build(idsChunk)` for every chunk of ids and page each to exhaustion.
 * `build` must return a FRESH PostgREST builder (it's finalised by .range()).
 * Rows are order-stabilised by the caller so paging can't skip.
 */
async function fetchAllFor<T>(
  ids: string[],
  build: (idsChunk: string[]) => { range: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: unknown }> }
): Promise<T[]> {
  const out: T[] = [];
  for (const ch of chunk(ids, ID_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(ch).range(from, from + PAGE - 1);
      if (error) {
        console.error("[daily-nudge] history read failed", error);
        break;
      }
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

const ukDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function firstNameOf(dn: string | null): string | null {
  if (!dn) return null;
  const first = dn.trim().split(/\s+/)[0];
  return first || null;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.DAILY_NUDGE_PUSH_ENABLED !== "true") {
    return NextResponse.json({ enabled: false, sent: 0 });
  }

  // Untyped handle: active_hour_utc + the draft_* tables aren't in the generated
  // Database types (same pattern as cron/wc-mastermind and the home dashboard).
  const raw = createServiceClient() as unknown as SupabaseClient;
  const now = new Date();
  const hour = now.getUTCHours();
  const today = now.toISOString().slice(0, 10);
  const todayKey = ukDay(now.toISOString());

  // ── Targets: opted-in users whose habitual hour is now (else fallback bucket) ─
  const displayById = new Map<string, string | null>();
  {
    const { data: exact } = await raw
      .from("profiles")
      .select("id, display_name")
      .eq("notifications_opt_in", true)
      .eq("active_hour_utc", hour)
      .limit(MAX_PER_RUN);
    for (const r of exact ?? []) displayById.set(r.id, r.display_name ?? null);
    if (exact && exact.length >= MAX_PER_RUN) {
      console.warn(`[daily-nudge] hour ${hour}: exact-hour targets hit MAX_PER_RUN cap (${MAX_PER_RUN})`);
    }
    if (hour === FALLBACK_HOUR && displayById.size < MAX_PER_RUN) {
      const { data: noHour } = await raw
        .from("profiles")
        .select("id, display_name")
        .eq("notifications_opt_in", true)
        .is("active_hour_utc", null)
        .limit(MAX_PER_RUN - displayById.size);
      for (const r of noHour ?? []) displayById.set(r.id, r.display_name ?? null);
    }
  }
  if (!displayById.size) {
    return NextResponse.json({ enabled: true, hour, targeted: 0, reason: "no-targets-this-hour" });
  }

  // ── Reachability: only users with a device token (native push only today) ────
  let ids = Array.from(displayById.keys());
  // Also chunked+paged: a user can hold several device tokens, so this can exceed
  // the 1000-row cap even though `ids` cannot.
  const tokenRows = await fetchAllFor<{ user_id: string }>(ids, (c) =>
    raw.from("device_tokens").select("user_id").in("user_id", c).order("user_id", { ascending: true }));
  const reachable = new Set(tokenRows.map((r) => r.user_id));
  ids = ids.filter((id) => reachable.has(id));
  if (!ids.length) {
    return NextResponse.json({ enabled: true, hour, targeted: 0, reason: "no-reachable-targets" });
  }
  const idsSet = new Set(ids);

  // ── Is today's daily World Cup pack live? (drives the locked fallback copy) ──
  const { data: packs } = await raw
    .from("quiz_packs")
    .select("id, metadata")
    .eq("status", "published")
    .contains("metadata", { daily: true, date: today })
    .limit(10);
  const wcPackLive = ((packs ?? []) as { metadata: unknown }[]).some((p) => {
    const m = (p.metadata ?? {}) as { series?: string };
    return (m.series ?? "wc2026") === "wc2026";
  });

  // ── Batch-load recent play history for all targets ──────────────────────────
  const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  type QaRow = { user_id: string; pack_id: string; score: number | null; completed_at: string | null };
  type DmRow = { id: string; challenger_id: string | null; opponent_id: string | null; played_at: string | null };
  type WrRow = { user_id: string; run_date: string | null; created_at: string | null };

  // Every read is chunked + paged (see fetchAllFor). Ordering is stabilised so a
  // page boundary can never skip a row; duplicates across pages would be harmless
  // (play-days are a Set, lastQuiz is a max) but skips would not be.
  const [qa, dm1, dm2, wr, fr1, fr2] = await Promise.all([
    fetchAllFor<QaRow>(ids, (c) =>
      raw.from("quiz_attempts").select("user_id, pack_id, score, completed_at")
        .in("user_id", c).gte("completed_at", windowStart)
        .order("completed_at", { ascending: true }).order("user_id", { ascending: true })),
    fetchAllFor<DmRow>(ids, (c) =>
      raw.from("draft_matches").select("id, challenger_id, opponent_id, played_at")
        .in("challenger_id", c).gte("played_at", windowStart)
        .order("id", { ascending: true })),
    fetchAllFor<DmRow>(ids, (c) =>
      raw.from("draft_matches").select("id, challenger_id, opponent_id, played_at")
        .in("opponent_id", c).gte("played_at", windowStart)
        .order("id", { ascending: true })),
    fetchAllFor<WrRow>(ids, (c) =>
      raw.from("draft_wc_runs").select("user_id, run_date, created_at")
        .in("user_id", c).gte("created_at", windowStart)
        .order("created_at", { ascending: true }).order("user_id", { ascending: true })),
    fetchAllFor<{ user_id: string }>(ids, (c) =>
      raw.from("friendships").select("user_id").in("user_id", c).eq("status", "accepted")
        .order("user_id", { ascending: true })),
    fetchAllFor<{ friend_id: string }>(ids, (c) =>
      raw.from("friendships").select("friend_id").in("friend_id", c).eq("status", "accepted")
        .order("friend_id", { ascending: true })),
  ]);

  type Agg = { days: Set<string>; quiz: number; g38: number; wc: number; lastQuiz: { score: number; packId: string; at: string } | null };
  const agg = new Map<string, Agg>();
  for (const id of ids) agg.set(id, { days: new Set(), quiz: 0, g38: 0, wc: 0, lastQuiz: null });

  for (const r of qa ?? []) {
    const a = agg.get(r.user_id);
    if (!a || !r.completed_at) continue;
    a.days.add(ukDay(r.completed_at));
    a.quiz++;
    if (!a.lastQuiz || r.completed_at > a.lastQuiz.at) {
      a.lastQuiz = { score: r.score ?? 0, packId: r.pack_id, at: r.completed_at };
    }
  }
  // Merge both match directions and dedupe by match id so a game isn't counted twice.
  const matchById = new Map<string, { challenger_id: string | null; opponent_id: string | null; played_at: string | null }>();
  for (const r of [...(dm1 ?? []), ...(dm2 ?? [])]) matchById.set(r.id, r);
  for (const r of Array.from(matchById.values())) {
    if (!r.played_at) continue;
    const day = ukDay(r.played_at);
    for (const uid of [r.challenger_id, r.opponent_id]) {
      if (uid && idsSet.has(uid)) {
        const a = agg.get(uid);
        if (a) { a.days.add(day); a.g38++; }
      }
    }
  }
  for (const r of wr ?? []) {
    const a = agg.get(r.user_id);
    if (!a) continue;
    const day = r.run_date ? String(r.run_date) : r.created_at ? ukDay(r.created_at) : null;
    if (day) a.days.add(day);
    a.wc++;
  }

  const friendSet = new Set<string>();
  for (const r of fr1 ?? []) if (r.user_id) friendSet.add(r.user_id);
  for (const r of fr2 ?? []) if (r.friend_id) friendSet.add(r.friend_id);

  // Names for the "beat your last score" pack reference.
  const lastPackIds = Array.from(
    new Set(Array.from(agg.values()).map((a) => a.lastQuiz?.packId).filter(Boolean) as string[])
  );
  const packName = new Map<string, string>();
  if (lastPackIds.length) {
    const { data: pk } = await raw.from("quiz_packs").select("id, name").in("id", lastPackIds);
    for (const p of pk ?? []) packName.set(p.id, p.name ?? "your last quiz");
  }

  // ── Derived per-user helpers ────────────────────────────────────────────────
  const computeStreak = (days: Set<string>): number => {
    let streak = 0;
    let cursor = Date.parse(`${todayKey}T12:00:00Z`);
    if (!days.has(todayKey)) cursor -= 86_400_000;
    while (days.has(new Date(cursor).toLocaleDateString("en-CA", { timeZone: "Europe/London" }))) {
      streak++;
      cursor -= 86_400_000;
    }
    return streak;
  };
  const daysSince = (days: Set<string>): number | null => {
    if (!days.size) return null;
    let latest = "";
    for (const d of Array.from(days)) if (d > latest) latest = d;
    return Math.round((Date.parse(`${todayKey}T12:00:00Z`) - Date.parse(`${latest}T12:00:00Z`)) / 86_400_000);
  };

  // ── Build a context per user (rank filled in only where a rival hook applies) ─
  type Pre = { id: string; ctx: NudgeContext; needsRank: boolean };
  const pre: Pre[] = ids.map((id) => {
    const a = agg.get(id)!;
    const dayStreak = computeStreak(a.days);
    const dsl = daysSince(a.days);
    const playedToday = a.days.has(todayKey);
    let primaryGame: PrimaryGame = null;
    let best = 0;
    for (const [g, c] of [["wc", a.wc], ["38", a.g38], ["quiz", a.quiz]] as [PrimaryGame, number][]) {
      if (c > best) { best = c; primaryGame = g; }
    }
    const ctx: NudgeContext = {
      firstName: firstNameOf(displayById.get(id) ?? null),
      playedToday,
      daysSinceLastPlay: dsl,
      dayStreak,
      hasFriends: friendSet.has(id),
      primaryGame,
      aheadName: null,
      aheadGap: null,
      lastPackName: a.lastQuiz ? packName.get(a.lastQuiz.packId) ?? null : null,
      lastScore: a.lastQuiz ? a.lastQuiz.score : null,
      wcPackLive,
    };
    // Rank is only consulted at the rival step: not-played-today, no active streak,
    // and on a nudge day. Fetch it only for that subset to keep RPC calls minimal.
    const onNudgeDay = dsl != null && NUDGE_DAYS.has(dsl);
    const needsRank = !playedToday && dayStreak < STREAK_MIN && onNudgeDay;
    return { id, ctx, needsRank };
  });

  await Promise.all(
    pre.filter((p) => p.needsRank).map(async (p) => {
      const { data } = await raw.rpc("get_yourscore_rank", { p_user_id: p.id });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        p.ctx.aheadName = row.ahead_name ?? null;
        const overall = row.overall_score ?? 0;
        p.ctx.aheadGap = row.ahead_points != null ? row.ahead_points - overall : null;
      }
    })
  );

  // ── Send: one personalised push per user, shared per-day dedupe key ─────────
  let targeted = 0;
  const kinds: Record<string, number> = {};
  for (const p of pre) {
    const copy = buildDailyNudge(p.ctx);
    if (!copy) continue;
    kinds[copy.kind] = (kinds[copy.kind] ?? 0) + 1;
    const { targeted: t } = await notifyUsers({
      userIds: [p.id],
      title: copy.title,
      body: copy.body,
      url: copy.url,
      dedupeKey: `daily-push:${today}`,
    });
    targeted += t;
  }

  return NextResponse.json({ enabled: true, hour, reachable: ids.length, targeted, kinds });
}
