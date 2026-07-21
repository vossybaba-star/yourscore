/**
 * Fantasy leagues — server orchestration (Phase 2). Mirrors the Draft XI league
 * shape (src/lib/draft/server.ts, src/app/api/draft/league/*) but with the
 * migration-76 security posture: own-row/public SELECT only, ALL writes via
 * service role. See supabase/migrations/79_fantasy_leagues.sql.
 *
 * Table math lives HERE, read-time only: fantasy_entries.points is the single
 * source of truth. Scoring recomputes from the locked snapshot and never
 * accumulates, so a rescored gameweek must flow into these tables automatically
 * — there is deliberately no season-total / month-total column anywhere.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { genJoinCode } from "@/lib/draft/server";
import { HttpError } from "@/lib/fantasy/server";
import { commentRejection } from "@/lib/moderation";
import { notifyUsers } from "@/lib/notify";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";
import type { GwRow } from "./gameweeks";

// fantasy_leagues / fantasy_league_members aren't in the generated Database
// types until migration 79 is applied + types regenerated (same situation as
// notification_log in src/lib/notify.ts) — untyped handle for those calls, and
// for the join reads against fantasy_entries/fantasy_gameweeks/profiles here.
type Db = SupabaseClient;
function db(): Db {
  return createServiceClient() as unknown as Db;
}

const NAME_MAX = 40;
const MAX_OWNED = 20;
const MAX_MEMBERS = 50;

export interface LeagueSummary {
  id: string; name: string; code: string; memberCount: number; isPublic: boolean; isOwner: boolean;
}
export interface PublicLeagueSummary {
  id: string; name: string; code: string; memberCount: number;
}
export interface LeagueRow {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; points: number; played: number;
  /** Right answers over this table's gameweeks — the tiebreak (audit decision 6). */
  knowledge: number;
  lastGwPoints: number | null; isMe: boolean;
}
interface LeagueRecord {
  id: string; owner_id: string; name: string; join_code: string; is_public: boolean;
}
interface MemberRecord { user_id: string; joined_at: string }
interface ProfileRecord { id: string; username: string | null; display_name: string | null; avatar_url: string | null }
interface EntryRecord { user_id: string; gw: number; points: number | null; round_correct: number | null }

function validateName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, NAME_MAX) : "";
  if (!name) throw new HttpError(400, "Name required");
  if (commentRejection(name)) throw new HttpError(400, "Pick a different name");
  return name;
}

async function findLeagueByCode(svc: Db, code: string): Promise<LeagueRecord> {
  const normCode = code.trim().toUpperCase();
  const { data } = await svc
    .from("fantasy_leagues")
    .select("id, owner_id, name, join_code, is_public")
    .eq("join_code", normCode)
    .maybeSingle();
  if (!data) throw new HttpError(404, "League not found");
  return data as LeagueRecord;
}

async function requireOwnerLeague(svc: Db, code: string, userId: string): Promise<LeagueRecord> {
  const league = await findLeagueByCode(svc, code);
  if (league.owner_id !== userId) throw new HttpError(403, "Only the league owner can do this");
  return league;
}

async function memberCounts(svc: Db, leagueIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!leagueIds.length) return counts;
  // .range past PostgREST's 1000-row default — 30 leagues × 50 members = 1500 rows,
  // and a silent truncation here would undercount members with no error anywhere.
  const { data } = await svc
    .from("fantasy_league_members").select("league_id").in("league_id", leagueIds).range(0, 9999);
  for (const m of (data ?? []) as { league_id: string }[]) counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);
  return counts;
}

// ── create / join ─────────────────────────────────────────────────────────────

export async function createLeague(
  userId: string,
  body: { name?: unknown; isPublic?: unknown },
): Promise<{ id: string; name: string; code: string; isPublic: boolean }> {
  const svc = db();
  const name = validateName(body.name);
  const isPublic = body.isPublic === true; // default private

  const { count } = await svc
    .from("fantasy_leagues").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if ((count ?? 0) >= MAX_OWNED) throw new HttpError(400, "You've hit the league limit");

  // Insert with a fresh code, retrying on the (rare) unique-collision — same
  // retry shape as src/app/api/draft/league/route.ts.
  let created: { id: string; name: string; join_code: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const { data, error } = await svc
      .from("fantasy_leagues")
      .insert({ owner_id: userId, name, join_code: genJoinCode(), is_public: isPublic })
      .select("id, name, join_code")
      .single();
    if (!error && data) created = data as { id: string; name: string; join_code: string };
    else if (error && error.code !== "23505") throw new HttpError(500, "Could not create league");
  }
  if (!created) throw new HttpError(500, "Could not create league");

  // If the owner's own membership fails to land, the league exists but is invisible
  // to them (My Leagues is driven by memberships) while still counting against their
  // cap — bin it rather than strand it.
  const { error: memberErr } = await svc.from("fantasy_league_members")
    .upsert({ league_id: created.id, user_id: userId }, { onConflict: "league_id,user_id" });
  if (memberErr) {
    await svc.from("fantasy_leagues").delete().eq("id", created.id);
    throw new HttpError(500, "Could not create league");
  }

  return { id: created.id, name: created.name, code: created.join_code, isPublic };
}

export async function joinLeague(
  userId: string,
  body: { code?: unknown },
): Promise<{ id: string; name: string; code: string }> {
  const svc = db();
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) throw new HttpError(400, "Code required");

  const league = await findLeagueByCode(svc, code);

  const { data: existing } = await svc
    .from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();

  // Cap only gates NEW joins — a duplicate join by an existing member must stay
  // idempotent even if the league has since filled up.
  if (!existing) {
    const { count } = await svc
      .from("fantasy_league_members").select("user_id", { count: "exact", head: true }).eq("league_id", league.id);
    if ((count ?? 0) >= MAX_MEMBERS) throw new HttpError(400, "This league is full");
  }

  const { error } = await svc.from("fantasy_league_members")
    .upsert({ league_id: league.id, user_id: userId }, { onConflict: "league_id,user_id" });
  if (error) throw new HttpError(500, "Could not join");

  // Fire-and-forget owner ping — notifyUsers dedupes per (user, key) itself, so
  // a duplicate join call never double-notifies.
  if (userId !== league.owner_id) {
    void notifyUsers({
      userIds: [league.owner_id],
      title: "New league member",
      body: `A friend joined ${league.name}`,
      url: `/fantasy/leagues/${league.join_code}`,
      dedupeKey: `fantasy-league-join:${league.id}:${userId}`,
    }).catch(() => {});
  }

  return { id: league.id, name: league.name, code: league.join_code };
}

// ── lists ─────────────────────────────────────────────────────────────────────

export async function myLeagues(userId: string): Promise<LeagueSummary[]> {
  const svc = db();
  const { data: memberships } = await svc
    .from("fantasy_league_members").select("league_id").eq("user_id", userId);
  const ids = ((memberships ?? []) as { league_id: string }[]).map((m) => m.league_id);
  if (!ids.length) return [];

  const { data: leagues } = await svc
    .from("fantasy_leagues").select("id, owner_id, name, join_code, is_public").in("id", ids);
  const counts = await memberCounts(svc, ids);

  return ((leagues ?? []) as LeagueRecord[]).map((l) => ({
    id: l.id, name: l.name, code: l.join_code, memberCount: counts.get(l.id) ?? 1,
    isPublic: l.is_public, isOwner: l.owner_id === userId,
  }));
}

/** Public leagues the user is NOT already in — newest first, cap 30. */
export async function publicLeagues(userId: string): Promise<PublicLeagueSummary[]> {
  const svc = db();
  const { data: memberships } = await svc
    .from("fantasy_league_members").select("league_id").eq("user_id", userId);
  const mine = new Set(((memberships ?? []) as { league_id: string }[]).map((m) => m.league_id));

  // Over-fetch past the 30 cap by however many the user's already in, so
  // excluding those still leaves a full page where enough public leagues exist.
  const { data: pub } = await svc
    .from("fantasy_leagues")
    .select("id, name, join_code, created_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(30 + mine.size);
  const filtered = ((pub ?? []) as { id: string; name: string; join_code: string }[])
    .filter((l) => !mine.has(l.id))
    .slice(0, 30);

  const counts = await memberCounts(svc, filtered.map((l) => l.id));
  return filtered.map((l) => ({ id: l.id, name: l.name, code: l.join_code, memberCount: counts.get(l.id) ?? 1 }));
}

// ── table math (read-time only — see file header) ───────────────────────────

/** Rank a set of scored entries + the full member list. Members with no scored
 *  entries render as a 0-point, 0-played row rather than being dropped or
 *  erroring (edge case: never-locked squad). */
function buildRows(
  entries: EntryRecord[],
  members: MemberRecord[],
  profiles: Map<string, ProfileRecord>,
  viewerId: string | null,
): LeagueRow[] {
  const byUser = new Map<string, { sum: number; played: number; lastGw: number; lastPts: number; knowledge: number }>();
  for (const e of entries) {
    const acc = byUser.get(e.user_id) ?? { sum: 0, played: 0, lastGw: -1, lastPts: 0, knowledge: 0 };
    acc.sum += e.points ?? 0;
    acc.played += 1;
    acc.knowledge += e.round_correct ?? 0;
    if (e.gw > acc.lastGw) { acc.lastGw = e.gw; acc.lastPts = e.points ?? 0; }
    byUser.set(e.user_id, acc);
  }

  const withJoin = members.map((m) => {
    const acc = byUser.get(m.user_id);
    const p = profiles.get(m.user_id);
    return {
      userId: m.user_id,
      username: p?.username ?? null,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      points: acc?.sum ?? 0,
      played: acc?.played ?? 0,
      knowledge: acc?.knowledge ?? 0,
      lastGwPoints: acc && acc.lastGw >= 0 ? acc.lastPts : null,
      isMe: viewerId != null && m.user_id === viewerId,
      joinedAt: m.joined_at,
    };
  });

  // points desc → KNOWLEDGE desc → lastGwPoints desc (nulls last) → joined_at asc.
  // The design's audit decision (6): the tiebreak on a fantasy table is your
  // knowledge-round performance — level on points, the sharper quizzer sits higher.
  const cmpLastGw = (a: number | null, b: number | null) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  };
  withJoin.sort((a, b) =>
    b.points - a.points
    || b.knowledge - a.knowledge
    || cmpLastGw(a.lastGwPoints, b.lastGwPoints)
    || Date.parse(a.joinedAt) - Date.parse(b.joinedAt));

  return withJoin.map((r, i) => ({
    rank: i + 1, userId: r.userId, username: r.username, displayName: r.displayName,
    avatarUrl: r.avatarUrl, points: r.points, played: r.played, knowledge: r.knowledge,
    lastGwPoints: r.lastGwPoints, isMe: r.isMe,
  }));
}

/** "Current month" = the viewer's current GW when signed-in-and-member, else the
 *  season's own current GW — never wall-clock (replay/demo GWs are dated
 *  March–April). Mirrors the currentGw() shape in fantasy/server.ts.
 *  For a guest or non-member we take the first gameweek the season hasn't
 *  finished: once a live season seeds all 38 rows up front, the LAST row is next
 *  May, and every invite link would open on an empty "May" table. */
async function resolveCurrentMonthKey(
  svc: Db, viewerId: string | null, isMember: boolean, gws: GwRow[],
): Promise<string> {
  const latest = gws[gws.length - 1];
  if (!viewerId || !isMember) return monthKeyOf(gws.find((g) => g.status !== "final") ?? latest);

  const { data: entries } = await svc
    .from("fantasy_entries").select("gw, status").eq("user_id", viewerId);
  const finalOf = new Map(((entries ?? []) as { gw: number; status: string }[]).map((e) => [e.gw, e.status]));
  const current = gws.find((g) => finalOf.get(g.gw) !== "final") ?? latest;
  return monthKeyOf(current);
}

export interface LeagueDetail {
  league: {
    id: string; name: string; code: string; memberCount: number;
    isPublic: boolean; isMember: boolean; isOwner: boolean;
  };
  season: LeagueRow[];
  month: { key: string; label: string; gws: number[]; rows: LeagueRow[] };
  lastMonth: { key: string; label: string; winner: { userId: string; username: string | null; displayName: string | null; points: number } } | null;
}

export async function leagueDetail(code: string, viewerId: string | null): Promise<LeagueDetail> {
  const svc = db();
  const league = await findLeagueByCode(svc, code);

  const { data: memberRows } = await svc
    .from("fantasy_league_members").select("user_id, joined_at").eq("league_id", league.id);
  const members = (memberRows ?? []) as MemberRecord[];
  const ids = members.map((m) => m.user_id);
  const isMember = !!viewerId && ids.includes(viewerId);
  const isOwner = !!viewerId && league.owner_id === viewerId;

  // Profiles — two-step fetch. No FK from the league tables to profiles, so an
  // embedded select isn't available here (that trap has already bitten this
  // codebase elsewhere).
  const { data: profileRows } = ids.length
    ? await svc.from("profiles").select("id, username, display_name, avatar_url").in("id", ids)
    : { data: [] as ProfileRecord[] };
  const profiles = new Map(((profileRows ?? []) as ProfileRecord[]).map((p) => [p.id, p]));

  // The ONE query the table math is built from — every scored entry for every
  // member, season-wide. Season sum and every month sum are slices of this same
  // array, never a separate write path.
  // .range past PostgREST's 1000-row default: a full league is 50 members × 38 GWs
  // = 1900 rows, and a silent truncation would drop whole gameweeks out of a
  // member's total with no error to show for it.
  const { data: entryRows } = ids.length
    ? await svc.from("fantasy_entries").select("user_id, gw, points, round_correct")
        .in("user_id", ids).not("scored_at", "is", null).range(0, 9999)
    : { data: [] as EntryRecord[] };
  const entries = (entryRows ?? []) as EntryRecord[];

  const { data: gwRows } = await svc
    .from("fantasy_gameweeks").select("gw, deadline, window_start, mode, window_end, status, sm_season_id, season")
    .order("gw", { ascending: true });
  const gws = (gwRows ?? []) as GwRow[];
  if (!gws.length) throw new HttpError(500, "No gameweeks configured");
  const byMonth = groupGwsByMonth(gws);

  const currentMonthKey = await resolveCurrentMonthKey(svc, viewerId, isMember, gws);
  const monthGws = (byMonth.get(currentMonthKey) ?? []).slice().sort((a, b) => a - b);
  const monthGwSet = new Set(monthGws);
  const monthEntries = entries.filter((e) => monthGwSet.has(e.gw));

  const season = buildRows(entries, members, profiles, viewerId);
  const month = {
    key: currentMonthKey,
    label: monthLabel(currentMonthKey),
    gws: monthGws,
    rows: buildRows(monthEntries, members, profiles, viewerId),
  };

  // Most recent COMPLETED month (strictly before the current one) that has at
  // least one scored entry — string keys sort lexicographically since they're
  // all "YYYY-MM".
  let lastMonth: LeagueDetail["lastMonth"] = null;
  const priorKeys = Array.from(byMonth.keys()).filter((k) => k < currentMonthKey).sort().reverse();
  for (const key of priorKeys) {
    const gwSet = new Set(byMonth.get(key) ?? []);
    const monthlyEntries = entries.filter((e) => gwSet.has(e.gw));
    if (!monthlyEntries.length) continue;
    const rows = buildRows(monthlyEntries, members, profiles, viewerId);
    const top = rows[0];
    lastMonth = {
      key, label: monthLabel(key),
      winner: { userId: top.userId, username: top.username, displayName: top.displayName, points: top.points },
    };
    break;
  }

  return {
    league: {
      id: league.id, name: league.name, code: league.join_code,
      memberCount: ids.length, isPublic: league.is_public, isMember, isOwner,
    },
    season, month, lastMonth,
  };
}

// ── owner / member actions ───────────────────────────────────────────────────

export async function renameLeague(
  userId: string, code: string, rawName: unknown,
): Promise<{ name: string; isPublic: boolean }> {
  const svc = db();
  const name = validateName(rawName);
  const league = await requireOwnerLeague(svc, code, userId);
  await svc.from("fantasy_leagues").update({ name }).eq("id", league.id);
  return { name, isPublic: league.is_public };
}

export async function setVisibility(
  userId: string, code: string, isPublic: boolean,
): Promise<{ name: string; isPublic: boolean }> {
  const svc = db();
  const league = await requireOwnerLeague(svc, code, userId);
  await svc.from("fantasy_leagues").update({ is_public: isPublic }).eq("id", league.id);
  return { name: league.name, isPublic };
}

export async function leaveLeague(userId: string, code: string): Promise<void> {
  const svc = db();
  const league = await findLeagueByCode(svc, code);
  if (league.owner_id === userId) {
    throw new HttpError(400, "You own this league — delete it instead");
  }
  await svc.from("fantasy_league_members").delete().eq("league_id", league.id).eq("user_id", userId);
}

export async function deleteLeague(userId: string, code: string): Promise<void> {
  const svc = db();
  const league = await requireOwnerLeague(svc, code, userId);
  // Members first — the FK cascade covers this too, but explicit is cheap and
  // matches src/app/api/draft/league/[code]/route.ts's delete-mode shape.
  await svc.from("fantasy_league_members").delete().eq("league_id", league.id);
  await svc.from("fantasy_leagues").delete().eq("id", league.id);
}
