/**
 * Fantasy leagues — server orchestration (Phase 2). Mirrors the Draft XI league
 * shape (src/lib/draft/server.ts, src/app/api/draft/league/*) but with the
 * migration-76 security posture: own-row/public SELECT only, ALL writes via
 * service role. See supabase/migrations/203_fantasy_leagues.sql.
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
import { notifyFantasy } from "@/lib/fantasy/notify";
import { notifyUsers } from "@/lib/notify";
import { createNotification } from "@/lib/notifications";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";
import { momentsForGw, postSystemMessage, summariseLeagueMessage, type ChatMoment } from "./chat";
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
const BIO_MAX = 200;
const LINK_VALUE_MAX = 200;

/** A league's social links (migration 263) — Discord-like community chips.
 *  Discord is restricted to discord.gg/discord.com; every value must be an
 *  https URL, validated on write (validateLinks below). */
export interface LeagueLinks {
  discord?: string; x?: string; instagram?: string; tiktok?: string; website?: string;
}
const LINK_KEYS = ["discord", "x", "instagram", "tiktok", "website"] as const;
const MAX_LINK_KEYS = 5;

/** Venue leagues (migration 266) — a pub/bar/club running YourScore. All venue
 *  content lives in one jsonb blob (venue_meta), the same pattern as bio/links.
 *  Edited by the venue's owner; created/assigned by an admin. */
export interface VenueOffer { title: string; detail: string; expiresAt?: string | null }
export interface VenueContactPerson { name: string; role?: string | null; handle?: string | null }
export interface VenueMeta {
  info?: string | null;
  offers?: VenueOffer[];
  contact?: { people?: VenueContactPerson[]; helpEmail?: string | null };
}
const VENUE_INFO_MAX = 800;
const MAX_OFFERS = 8;
const MAX_CONTACT_PEOPLE = 6;
const VENUE_STR_MAX = 120;
const VENUE_DETAIL_MAX = 300;

/** A short "what's happening" line for a My Leagues tile, so the list feels alive
 *  instead of a row of names. Priority: latest chat > a recent joiner > a quiet
 *  nudge > an invite prompt. `at` drives the relative timestamp; null = static. */
export interface LeagueHighlight {
  tone: "chat" | "join" | "quiet" | "empty";
  /** The manager to bold (chat author or new joiner); null for static nudges. */
  author: string | null;
  text: string;
  at: string | null;
  msgCount: number;
}
export interface LeagueSummary {
  id: string; name: string; code: string; memberCount: number; isPublic: boolean; isOwner: boolean; imageUrl: string | null;
  highlight: LeagueHighlight;
  /** Messages from OTHER members since this viewer last opened the chat. */
  unread: number;
  /** 'private' | 'public' | 'club' | 'founder' — club/founder are auto-join. */
  kind: string;
  /** A league YourScore itself runs (club / Founder / mixed) — carries a tick. */
  official: boolean;
  /** Community identity (migration 263) — a short "about" line, capped ~200
   *  chars app-side. Null until the owner sets one. */
  bio: string | null;
  /** Social chips — Discord-like community presence. Empty object until the
   *  owner adds any. */
  links: LeagueLinks;
}
export interface PublicLeagueSummary {
  id: string; name: string; code: string; memberCount: number; imageUrl: string | null; official: boolean;
  bio: string | null; links: LeagueLinks;
}
export interface LeagueRow {
  rank: number; userId: string; username: string | null; displayName: string | null;
  avatarUrl: string | null; points: number; played: number;
  /** Right answers over this table's gameweeks — the tiebreak (audit decision 6). */
  knowledge: number;
  lastGwPoints: number | null; isMe: boolean;
  /** Places gained since the previous scored gameweek. Positive = climbed, negative
   *  = dropped, 0 = held. Null when there's no earlier gameweek to compare — a
   *  table showing its first ever result has no movement to report yet, and a "–"
   *  is honest where a "0" would falsely claim you held a position you never had. */
  movement: number | null;
}
interface LeagueRecord {
  id: string; owner_id: string; name: string; join_code: string; is_public: boolean;
  stakes: string | null; image_url: string | null;
  kind?: string; club?: string | null; official?: boolean;
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
    .select("id, owner_id, name, join_code, is_public, stakes, image_url, kind, club, official")
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

/** bio/links (migration 263) — read in a SEPARATE query from every list/detail
 *  read above, and wrapped so a pre-migration database (the columns don't
 *  exist yet) degrades to an empty map instead of failing the whole read.
 *  PostgREST fails the entire select when an unknown column is named, so this
 *  can't be folded into the main `fantasy_leagues` select those callers already
 *  run — same probe/fallback discipline as chat.ts's pinned_message_id. */
async function leagueProfiles(svc: Db, leagueIds: string[]): Promise<Map<string, { bio: string | null; links: LeagueLinks; venueMeta: VenueMeta }>> {
  const out = new Map<string, { bio: string | null; links: LeagueLinks; venueMeta: VenueMeta }>();
  if (!leagueIds.length) return out;
  try {
    const { data, error } = await svc.from("fantasy_leagues").select("id, bio, links, venue_meta").in("id", leagueIds);
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; bio: string | null; links: unknown; venue_meta: unknown }[]) {
      out.set(r.id, { bio: r.bio ?? null, links: sanitizeStoredLinks(r.links), venueMeta: sanitizeVenueMeta(r.venue_meta) });
    }
  } catch (e) {
    console.error("[fantasy:leagues] bio/links/venue probe failed (migration 263/266 not applied yet?) — degrading to empty:", e);
  }
  return out;
}
const emptyProfile = { bio: null as string | null, links: {} as LeagueLinks, venueMeta: {} as VenueMeta };

/** Defensive pass over a stored `links` jsonb value on the way OUT — never
 *  trust it's still shaped like LeagueLinks (a future migration, a hand-edit,
 *  whatever) beyond known keys + string values. Mirrors validateLinks's
 *  allowlist but doesn't re-validate URL shape; the write path already did. */
function sanitizeStoredLinks(raw: unknown): LeagueLinks {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: LeagueLinks = {};
  for (const key of LINK_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v) out[key] = v;
  }
  return out;
}

/** Defensive read of a stored venue_meta blob — clamp to known shape + lengths,
 *  never trust it beyond that (mirrors sanitizeStoredLinks). */
function sanitizeVenueMeta(raw: unknown): VenueMeta {
  if (!raw || typeof raw !== "object") return {};
  const v = raw as Record<string, unknown>;
  const out: VenueMeta = {};
  if (typeof v.info === "string" && v.info.trim()) out.info = v.info.trim().slice(0, VENUE_INFO_MAX);
  if (Array.isArray(v.offers)) {
    out.offers = v.offers.slice(0, MAX_OFFERS).map((o) => {
      const oo = (o ?? {}) as Record<string, unknown>;
      return {
        title: typeof oo.title === "string" ? oo.title.slice(0, VENUE_STR_MAX) : "",
        detail: typeof oo.detail === "string" ? oo.detail.slice(0, VENUE_DETAIL_MAX) : "",
        expiresAt: typeof oo.expiresAt === "string" ? oo.expiresAt : null,
      };
    }).filter((o) => o.title);
  }
  const c = v.contact as Record<string, unknown> | undefined;
  if (c && typeof c === "object") {
    const contact: NonNullable<VenueMeta["contact"]> = {};
    if (Array.isArray(c.people)) {
      contact.people = c.people.slice(0, MAX_CONTACT_PEOPLE).map((p) => {
        const pp = (p ?? {}) as Record<string, unknown>;
        return {
          name: typeof pp.name === "string" ? pp.name.slice(0, VENUE_STR_MAX) : "",
          role: typeof pp.role === "string" ? pp.role.slice(0, VENUE_STR_MAX) : null,
          handle: typeof pp.handle === "string" ? pp.handle.slice(0, VENUE_STR_MAX) : null,
        };
      }).filter((p) => p.name);
    }
    if (typeof c.helpEmail === "string" && c.helpEmail.trim()) contact.helpEmail = c.helpEmail.trim().slice(0, VENUE_STR_MAX);
    if (contact.people?.length || contact.helpEmail) out.contact = contact;
  }
  return out;
}

/** Owner-set venue content (offers / contact / info). Clamps lengths + counts,
 *  requires a title on each offer and a name on each contact person, and checks
 *  the help email looks like one. Runs the same profanity gate as bio. */
function validateVenueMeta(raw: unknown): VenueMeta {
  if (raw == null || typeof raw !== "object") return {};
  const v = raw as Record<string, unknown>;
  const out: VenueMeta = {};
  if (typeof v.info === "string") {
    const info = v.info.trim().slice(0, VENUE_INFO_MAX);
    if (info) { const why = commentRejection(info); if (why) throw new HttpError(400, why); out.info = info; }
  }
  if (Array.isArray(v.offers)) {
    if (v.offers.length > MAX_OFFERS) throw new HttpError(400, `Up to ${MAX_OFFERS} offers`);
    const offers: VenueOffer[] = [];
    for (const o of v.offers) {
      const oo = (o ?? {}) as Record<string, unknown>;
      const title = typeof oo.title === "string" ? oo.title.trim().slice(0, VENUE_STR_MAX) : "";
      if (!title) continue; // drop blank rows
      const detail = typeof oo.detail === "string" ? oo.detail.trim().slice(0, VENUE_DETAIL_MAX) : "";
      const why = commentRejection(`${title} ${detail}`);
      if (why) throw new HttpError(400, why);
      offers.push({ title, detail, expiresAt: typeof oo.expiresAt === "string" && oo.expiresAt ? oo.expiresAt : null });
    }
    out.offers = offers;
  }
  if (v.contact && typeof v.contact === "object") {
    const c = v.contact as Record<string, unknown>;
    const contact: NonNullable<VenueMeta["contact"]> = {};
    if (Array.isArray(c.people)) {
      if (c.people.length > MAX_CONTACT_PEOPLE) throw new HttpError(400, `Up to ${MAX_CONTACT_PEOPLE} contacts`);
      const people: VenueContactPerson[] = [];
      for (const p of c.people) {
        const pp = (p ?? {}) as Record<string, unknown>;
        const name = typeof pp.name === "string" ? pp.name.trim().slice(0, VENUE_STR_MAX) : "";
        if (!name) continue;
        people.push({
          name,
          role: typeof pp.role === "string" && pp.role.trim() ? pp.role.trim().slice(0, VENUE_STR_MAX) : null,
          handle: typeof pp.handle === "string" && pp.handle.trim() ? pp.handle.trim().slice(0, VENUE_STR_MAX) : null,
        });
      }
      contact.people = people;
    }
    if (typeof c.helpEmail === "string" && c.helpEmail.trim()) {
      const email = c.helpEmail.trim().slice(0, VENUE_STR_MAX);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That help email isn't a valid email");
      contact.helpEmail = email;
    }
    out.contact = contact;
  }
  return out;
}

function validateBio(raw: unknown): string | null {
  if (raw == null) return null;
  const bio = typeof raw === "string" ? raw.trim().slice(0, BIO_MAX) : "";
  if (!bio) return null;
  const why = commentRejection(bio);
  if (why) throw new HttpError(400, why);
  return bio;
}

/** Owner-set social links — Discord-like community chips. Strips empty
 *  strings, caps at 5 keys from the allowed set, requires https, and holds
 *  discord to its own domains so a chip can never link somewhere unexpected. */
function validateLinks(raw: unknown): LeagueLinks {
  if (raw == null) return {};
  if (typeof raw !== "object") throw new HttpError(400, "Bad links");
  const input = raw as Record<string, unknown>;
  const out: LeagueLinks = {};
  let count = 0;
  for (const key of LINK_KEYS) {
    const v = input[key];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue; // strip empty strings
    if (count >= MAX_LINK_KEYS) throw new HttpError(400, "Too many links");
    if (trimmed.length > LINK_VALUE_MAX) throw new HttpError(400, `That ${key} link is too long`);
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new HttpError(400, `That ${key} link isn't a valid URL`); }
    if (url.protocol !== "https:") throw new HttpError(400, `The ${key} link must start with https://`);
    if (key === "discord" && !(trimmed.startsWith("https://discord.gg/") || trimmed.startsWith("https://discord.com/"))) {
      throw new HttpError(400, "Discord links must start with https://discord.gg/ or https://discord.com/");
    }
    out[key] = trimmed;
    count++;
  }
  return out;
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
  /** Optional non-default kind (e.g. 'venue'). The API route decides who's
   *  allowed to pass this — createLeague trusts the caller here, same as it
   *  trusts userId. Undefined → the DB default ('private'). */
  kind?: "venue",
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
      .insert({ owner_id: userId, name, join_code: genJoinCode(), is_public: isPublic, ...(kind ? { kind } : {}) })
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

  // Club and Founder leagues are automatic — you can't join them by code. A club
  // league is open to look around, but only its own fans can post: name the club
  // so the manager knows why. The Founder League is the first-1,000 badge holders.
  const { data: meta } = await svc.from("fantasy_leagues").select("kind, club").eq("id", league.id).maybeSingle();
  if (meta?.kind === "club") {
    const club = (meta.club as string | null) ?? "this club";
    throw new HttpError(400, `This is the ${club} fans' league. Have a look around, but only ${club} fans can post here.`);
  }
  if (meta?.kind === "founder") {
    throw new HttpError(400, "The Founder League is for the first 1,000 managers to build a squad. Build your squad and you're in.");
  }

  const { data: existing } = await svc
    .from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", userId).maybeSingle();
  // Whether this call is a genuinely NEW join — gates the "joined the league"
  // system chat line below so a re-join (already a member, calls join again)
  // never re-posts it.
  const isNewJoin = !existing;

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

  // Ping the EXISTING members that someone new joined (never the joiner). Fire-
  // and-forget; notifyFantasy dedupes per (user, key), so a duplicate join call
  // never double-notifies.
  const { data: memberRows } = await svc
    .from("fantasy_league_members").select("user_id").eq("league_id", league.id);
  const others = ((memberRows ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== userId);
  if (others.length) {
    const { data: prof } = await svc
      .from("profiles").select("display_name, username").eq("id", userId).maybeSingle();
    const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "A new manager");
    void notifyFantasy({
      userIds: others,
      title: `${who} joined ${league.name}`,
      body: "Say hello and settle who really knows their football.",
      url: `/fantasy/leagues/${league.join_code}`,
      dedupeKey: `fantasy-league-join:${league.id}:${userId}`,
      type: "fantasy_league_join",
      actorId: userId,
      subjectType: "fantasy_league",
      subjectId: league.id,
    });
    // A system line in the chat itself (Phase 4b, AC3b) — separate from the
    // push above; deduped on the joiner's id so a retried call never doubles it.
    if (isNewJoin) {
      void postSystemMessage(svc, league.id, userId, `${who} joined the league`, "member_joined", { userId })
        .catch((e) => console.error("[fantasy:leagues] member_joined system message failed:", e));
    }
  }

  return { id: league.id, name: league.name, code: league.join_code };
}

/**
 * Invite a specific YourScore user to a league the inviter belongs to (from the
 * feed, a profile, etc.). Delivers a notification linking to the league, where a
 * non-member already sees "JOIN THIS LEAGUE".
 *
 * A league invite is user-initiated and transactional, so it goes STRAIGHT to
 * the invitee's inbox (createNotification) and push (notifyUsers) — deliberately
 * NOT through notifyFantasy, whose kill-switch only holds the automated feed/
 * event notifications. Both dedupe on the same key, so re-inviting the same
 * person to the same league never spams.
 */
export async function inviteToLeague(
  inviterId: string,
  code: string,
  inviteeId: unknown,
): Promise<{ ok: true; league: string }> {
  const invitee = typeof inviteeId === "string" ? inviteeId.trim() : "";
  if (!invitee) throw new HttpError(400, "No one to invite");
  if (invitee === inviterId) throw new HttpError(400, "You can't invite yourself");

  const svc = db();
  const league = await findLeagueByCode(svc, typeof code === "string" ? code.trim().toUpperCase() : "");

  const { data: mine } = await svc.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", inviterId).maybeSingle();
  if (!mine) throw new HttpError(403, "You're not in this league");

  const { data: already } = await svc.from("fantasy_league_members")
    .select("user_id").eq("league_id", league.id).eq("user_id", invitee).maybeSingle();
  if (already) throw new HttpError(409, "They're already in this league");

  const { data: prof } = await svc.from("profiles").select("display_name, username").eq("id", inviterId).maybeSingle();
  const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "A manager");
  const key = `league-invite:${league.id}:${invitee}`;
  // ?join=1 makes the invite a one-tap join: opening it drops them straight into
  // the league (same as the shared invite link).
  const url = `/fantasy/leagues/${league.join_code}?join=1`;

  await createNotification({
    userId: invitee,
    type: "league_invite",
    actorId: inviterId,
    title: `${who} invited you to ${league.name}`,
    body: "Tap to join and put your gameweek points on the table.",
    url,
    dedupeKey: key,
  });
  void notifyUsers({
    userIds: [invitee],
    title: `${who} invited you to ${league.name}`,
    body: "Tap to join their YourScore Fantasy league.",
    url,
    dedupeKey: key,
  });

  return { ok: true, league: league.name };
}

// ── lists ─────────────────────────────────────────────────────────────────────

/** How recently someone joined still reads as "news" on a tile. Past this, a
 *  chat-less league shows the quiet-banter nudge instead of a stale "joined". */
const JOIN_FRESH_MS = 21 * 24 * 60 * 60 * 1000;
const TONE_RANK: Record<LeagueHighlight["tone"], number> = { chat: 0, join: 1, quiet: 2, empty: 3 };

export async function myLeagues(userId: string): Promise<LeagueSummary[]> {
  const svc = db();
  const { data: memberships } = await svc
    .from("fantasy_league_members").select("league_id").eq("user_id", userId);
  const ids = ((memberships ?? []) as { league_id: string }[]).map((m) => m.league_id);
  if (!ids.length) return [];

  // Three batched reads across ALL the user's leagues at once (never per-league):
  // the leagues, every membership (count + newest joiner), and every chat message
  // (latest line + count). .range past PostgREST's 1000-row default — a chatty set
  // of leagues would silently truncate otherwise, dropping the newest line.
  const [{ data: leagues }, { data: memberRows }, { data: msgRows }, { data: readRows }] = await Promise.all([
    svc.from("fantasy_leagues").select("id, owner_id, name, join_code, is_public, image_url, kind, official").in("id", ids),
    svc.from("fantasy_league_members").select("league_id, user_id, joined_at").in("league_id", ids).range(0, 9999),
    svc.from("comments").select("subject_id, user_id, body, kind, payload, created_at")
      .eq("subject_type", "fantasy_league").in("subject_id", ids).is("deleted_at", null)
      .order("created_at", { ascending: false }).range(0, 9999),
    svc.from("fantasy_league_reads").select("league_id, last_read_at").eq("user_id", userId).in("league_id", ids),
  ]);

  // Member count + the newest OTHER joiner (not the viewer, so "you joined" never
  // becomes a league's headline) per league.
  const counts = new Map<string, number>();
  const newestOther = new Map<string, { userId: string; joinedAt: string }>();
  const joinedByLeague = new Map<string, number>(); // the VIEWER's join time per league
  for (const m of (memberRows ?? []) as { league_id: string; user_id: string; joined_at: string }[]) {
    counts.set(m.league_id, (counts.get(m.league_id) ?? 0) + 1);
    if (m.user_id === userId) { joinedByLeague.set(m.league_id, Date.parse(m.joined_at)); continue; }
    const cur = newestOther.get(m.league_id);
    if (!cur || Date.parse(m.joined_at) > Date.parse(cur.joinedAt)) newestOther.set(m.league_id, { userId: m.user_id, joinedAt: m.joined_at });
  }

  // When the viewer last opened each chat; before their first open, treat their
  // join time as the read line so old backlog never shows as unread.
  const lastReadByLeague = new Map<string, number>();
  for (const r of (readRows ?? []) as { league_id: string; last_read_at: string }[]) lastReadByLeague.set(r.league_id, Date.parse(r.last_read_at));

  // Latest message + total count + UNREAD (from other members, since last read) per
  // league (msgRows already newest-first).
  const latestMsg = new Map<string, { userId: string; body: string; kind: string | null; payload: unknown; at: string }>();
  const msgCount = new Map<string, number>();
  const unread = new Map<string, number>();
  for (const m of (msgRows ?? []) as { subject_id: string; user_id: string; body: string; kind: string | null; payload: unknown; created_at: string }[]) {
    msgCount.set(m.subject_id, (msgCount.get(m.subject_id) ?? 0) + 1);
    // Never the tile's headline either — "Gameweek 5 is live" attributed to
    // whichever id happened to carry the row would misread as that member
    // having said it (msgRows is newest-first, so this just skips past it to
    // the next real message; a thread of nothing but system rows falls
    // through to the "quiet" nudge below, same as an empty thread).
    if (m.kind !== "system" && !latestMsg.has(m.subject_id)) latestMsg.set(m.subject_id, { userId: m.user_id, body: m.body, kind: m.kind, payload: m.payload, at: m.created_at });
    // A system row (Phase 4b, AC3) is never counted toward the unread badge —
    // it isn't a member saying something, so it shouldn't read as "new banter".
    // `kind` is already in this same select, so the check is free.
    if (m.user_id !== userId && m.kind !== "system") {
      const line = lastReadByLeague.get(m.subject_id) ?? joinedByLeague.get(m.subject_id) ?? 0;
      if (Date.parse(m.created_at) > line) unread.set(m.subject_id, (unread.get(m.subject_id) ?? 0) + 1);
    }
  }

  // One profiles batch for every name we'll show (chat authors + new joiners).
  const nameIds = new Set<string>();
  Array.from(latestMsg.values()).forEach((v) => nameIds.add(v.userId));
  Array.from(newestOther.values()).forEach((v) => nameIds.add(v.userId));
  const nameOf = new Map<string, string>();
  if (nameIds.size) {
    const { data: profs } = await svc.from("profiles").select("id, display_name, username").in("id", Array.from(nameIds));
    for (const p of (profs ?? []) as ProfileRecord[]) nameOf.set(p.id, p.display_name ?? (p.username ? `@${p.username}` : "A manager"));
  }

  const highlightFor = (leagueId: string, memberCount: number): LeagueHighlight => {
    const count = msgCount.get(leagueId) ?? 0;
    const msg = latestMsg.get(leagueId);
    if (msg) {
      return { tone: "chat", author: nameOf.get(msg.userId) ?? "A manager", text: summariseLeagueMessage(msg.kind, msg.body, msg.payload), at: msg.at, msgCount: count };
    }
    const joiner = newestOther.get(leagueId);
    if (joiner && Date.now() - Date.parse(joiner.joinedAt) < JOIN_FRESH_MS) {
      return { tone: "join", author: nameOf.get(joiner.userId) ?? "A manager", text: "joined", at: joiner.joinedAt, msgCount: 0 };
    }
    if (memberCount > 1) return { tone: "quiet", author: null, text: "Quiet so far. Start the banter.", at: null, msgCount: 0 };
    return { tone: "empty", author: null, text: "Invite your friends to get going.", at: null, msgCount: 0 };
  };

  const profiles = await leagueProfiles(svc, ids);
  const out = ((leagues ?? []) as unknown as LeagueRecord[]).map((l) => {
    const memberCount = counts.get(l.id) ?? 1;
    const profile = profiles.get(l.id) ?? emptyProfile;
    return {
      id: l.id, name: l.name, code: l.join_code, memberCount,
      isPublic: l.is_public, isOwner: l.owner_id === userId, imageUrl: l.image_url ?? null,
      highlight: highlightFor(l.id, memberCount),
      unread: unread.get(l.id) ?? 0,
      kind: (l as { kind?: string }).kind ?? "private",
      official: (l as { official?: boolean }).official ?? false,
      bio: profile.bio, links: profile.links,
    };
  });

  // Unread leagues first (the ones wanting your attention), then liveliest: chat
  // over joins over quiet, and within a tone the most recent.
  out.sort((a, b) =>
    (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0)
    || TONE_RANK[a.highlight.tone] - TONE_RANK[b.highlight.tone]
    || Date.parse(b.highlight.at ?? "0") - Date.parse(a.highlight.at ?? "0")
    || a.name.localeCompare(b.name));
  return out;
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
    .select("id, name, join_code, created_at, image_url, official")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(30 + mine.size);
  const filtered = ((pub ?? []) as { id: string; name: string; join_code: string; image_url: string | null; official: boolean }[])
    .filter((l) => !mine.has(l.id))
    .slice(0, 30);

  const counts = await memberCounts(svc, filtered.map((l) => l.id));
  const profiles = await leagueProfiles(svc, filtered.map((l) => l.id));
  return filtered.map((l) => {
    const profile = profiles.get(l.id) ?? emptyProfile;
    return { id: l.id, name: l.name, code: l.join_code, memberCount: counts.get(l.id) ?? 1, imageUrl: l.image_url ?? null, official: l.official ?? false, bio: profile.bio, links: profile.links };
  });
}

/** Search PUBLIC leagues by name (Social → Discover → Leagues). Private leagues
 *  stay code-only. Excludes leagues the viewer is already in. */
export async function searchPublicLeagues(userId: string, qRaw: unknown): Promise<PublicLeagueSummary[]> {
  // Strip ilike wildcards so a stray % / _ can't widen the match to everything.
  const q = (typeof qRaw === "string" ? qRaw : "").replace(/[%_]/g, "").trim().slice(0, 40);
  if (q.length < 2) return [];
  const svc = db();
  const { data: memberships } = await svc
    .from("fantasy_league_members").select("league_id").eq("user_id", userId);
  const mine = new Set(((memberships ?? []) as { league_id: string }[]).map((m) => m.league_id));

  const { data: pub } = await svc
    .from("fantasy_leagues")
    .select("id, name, join_code, image_url, official")
    .eq("is_public", true)
    .ilike("name", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(20 + mine.size);
  const filtered = ((pub ?? []) as { id: string; name: string; join_code: string; image_url: string | null; official: boolean }[])
    .filter((l) => !mine.has(l.id))
    .slice(0, 20);

  const counts = await memberCounts(svc, filtered.map((l) => l.id));
  const profiles = await leagueProfiles(svc, filtered.map((l) => l.id));
  return filtered.map((l) => {
    const profile = profiles.get(l.id) ?? emptyProfile;
    return { id: l.id, name: l.name, code: l.join_code, memberCount: counts.get(l.id) ?? 1, imageUrl: l.image_url ?? null, official: l.official ?? false, bio: profile.bio, links: profile.links };
  });
}

/** One Discover row — a league anyone can look at, plus whether THIS viewer can
 *  post in it (club leagues are browsable but fans-only to contribute). */
export interface DiscoverLeague {
  id: string; name: string; code: string; memberCount: number; imageUrl: string | null;
  official: boolean; kind: string; club: string | null; isMember: boolean; canContribute: boolean;
  bio: string | null; links: LeagueLinks;
}
export interface DiscoverLeaguesResult {
  /** Mixed cross-fan leagues + the Founder League — YourScore's own, up top. */
  featured: DiscoverLeague[];
  /** Every club's fan league, browsable by anyone. */
  clubs: DiscoverLeague[];
  /** Public leagues managers have made. */
  open: DiscoverLeague[];
}

/** Everything worth discovering in Social → Leagues (founder, 3 Aug): the mixed
 *  cross-fan leagues and the Founder League first, then every club's fan league
 *  (you can look into a rival club's league, you just can't post there), then the
 *  public leagues managers have created. Works signed-out (viewerId null). */
export async function discoverLeagues(viewerId: string | null): Promise<DiscoverLeaguesResult> {
  const svc = db();

  // The YourScore-run leagues (club / founder / mixed-official) + user-made public
  // leagues, in one read each.
  const [{ data: ours }, { data: publicRows }] = await Promise.all([
    svc.from("fantasy_leagues")
      .select("id, name, join_code, image_url, kind, club, official, created_at")
      .or("kind.in.(club,founder),official.eq.true")
      .order("created_at", { ascending: true }),
    svc.from("fantasy_leagues")
      .select("id, name, join_code, image_url, kind, club, official, created_at")
      .eq("is_public", true).eq("official", false)
      .not("kind", "in", "(club,founder)")
      .order("created_at", { ascending: false }).limit(30),
  ]);

  // Who the viewer is: their memberships (isMember) + supported clubs (can post in
  // that club's league).
  const memberOf = new Set<string>();
  const supportedClubs = new Set<string>();
  if (viewerId) {
    const [{ data: mem }, { data: sup }] = await Promise.all([
      svc.from("fantasy_league_members").select("league_id").eq("user_id", viewerId),
      svc.from("club_supporters").select("club").eq("user_id", viewerId),
    ]);
    for (const m of (mem ?? []) as { league_id: string }[]) memberOf.add(m.league_id);
    for (const s of (sup ?? []) as { club: string | null }[]) if (s.club) supportedClubs.add(s.club);
  }

  type Row = { id: string; name: string; join_code: string; image_url: string | null; kind: string | null; club: string | null; official: boolean };
  const allRows = [...((ours ?? []) as Row[]), ...((publicRows ?? []) as Row[])];
  const counts = await memberCounts(svc, allRows.map((l) => l.id));
  const profiles = await leagueProfiles(svc, allRows.map((l) => l.id));

  const toDiscover = (l: Row): DiscoverLeague => {
    const kind = l.kind ?? "private";
    const isMember = memberOf.has(l.id);
    const isClubGated = kind === "club" || kind === "founder";
    const canContribute = isMember || (!isClubGated) || (kind === "club" && !!l.club && supportedClubs.has(l.club));
    const profile = profiles.get(l.id) ?? emptyProfile;
    return {
      id: l.id, name: l.name, code: l.join_code, memberCount: counts.get(l.id) ?? 1,
      imageUrl: l.image_url ?? null, official: l.official ?? false, kind, club: l.club ?? null,
      isMember, canContribute, bio: profile.bio, links: profile.links,
    };
  };

  const oursMapped = ((ours ?? []) as Row[]).map(toDiscover);
  const featured = oursMapped.filter((l) => l.kind !== "club").sort((a, b) => a.name.localeCompare(b.name));
  const clubs = oursMapped.filter((l) => l.kind === "club").sort((a, b) => (a.club ?? "").localeCompare(b.club ?? ""));
  const open = ((publicRows ?? []) as Row[]).map(toDiscover).filter((l) => !l.isMember);
  return { featured, clubs, open };
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
  /** userId → their rank on this same table BEFORE the latest scored gameweek,
   *  so each row can report how many places it moved. Omitted for a table that
   *  has no earlier state to compare against. */
  priorRank?: Map<string, number>,
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

  return withJoin.map((r, i) => {
    const before = priorRank?.get(r.userId);
    return {
      rank: i + 1, userId: r.userId, username: r.username, displayName: r.displayName,
      avatarUrl: r.avatarUrl, points: r.points, played: r.played, knowledge: r.knowledge,
      lastGwPoints: r.lastGwPoints, isMe: r.isMe,
      // A lower prior rank number means they were higher up, so gaining places is
      // (before − now). Null when we have no prior rank for them.
      movement: before === undefined ? null : before - (i + 1),
    };
  });
}

/** Rank-by-user for a set of entries — the ordering only, for computing movement. */
function rankMap(
  entries: EntryRecord[], members: MemberRecord[], profiles: Map<string, ProfileRecord>,
): Map<string, number> {
  const rows = buildRows(entries, members, profiles, null);
  return new Map(rows.map((r) => [r.userId, r.rank]));
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
    stakes: string | null; imageUrl: string | null;
    /** 'private' | 'public' | 'club' | 'founder'. */
    kind: string;
    /** The supported club, for a kind='club' league (else null). */
    club: string | null;
    /** YourScore-run league — shows the verified tick. */
    official: boolean;
    /** Whether THIS viewer may post here. A club league is browsable by anyone
     *  but only its club's fans (its members) can contribute. */
    canContribute: boolean;
    /** Community identity (migration 263) — a short "about" line + social
     *  chips. bio null / links {} until the owner sets any. */
    bio: string | null;
    links: LeagueLinks;
    /** Venue content (migration 266) — only meaningful when kind='venue'; {}
     *  otherwise. Info + offers + contact, edited by the venue owner. */
    venueMeta: VenueMeta;
  };
  /** The current gameweek and its phase, for the Hub's summary card. */
  gw: { number: number; phase: "pre" | "live" | "final"; deadline: string | null };
  season: LeagueRow[];
  month: { key: string; label: string; gws: number[]; rows: LeagueRow[] };
  lastMonth: { key: string; label: string; winner: { userId: string; username: string | null; displayName: string | null; points: number } } | null;
  /** Pre-deadline readiness (Phase 4b, AC1) — see leagueDetail's computation
   *  for why "captain still unset" isn't a real state in this schema. Null
   *  outside the "pre" phase, or if the one extra query fails. */
  readiness: {
    squadsIn: number; totalMembers: number;
    waitingCount: number;
    waitingAvatars: { userId: string; name: string; avatarUrl: string | null }[];
  } | null;
  /** Post-gameweek recap (Phase 4b, AC2) — final phase only, free-riding the
   *  season table already built for this response. */
  gwRecap: {
    gw: number;
    winner: { userId: string; name: string; avatarUrl: string | null; points: number };
    riser: { userId: string; name: string; avatarUrl: string | null; places: number } | null;
  } | null;
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

  // Rank movement: compare each table to how it stood BEFORE its latest scored
  // gameweek. The season table compares to all-but-the-latest scored gameweek;
  // the month table to all-but-the-latest WITHIN the month, so early in a month
  // it correctly reports no movement rather than borrowing last month's order.
  const latestScoredGw = entries.reduce((max, e) => Math.max(max, e.gw), -1);
  const seasonPrior = latestScoredGw >= 0
    ? rankMap(entries.filter((e) => e.gw < latestScoredGw), members, profiles)
    : undefined;
  const latestMonthGw = monthEntries.reduce((max, e) => Math.max(max, e.gw), -1);
  const monthPrior = latestMonthGw >= 0
    ? rankMap(monthEntries.filter((e) => e.gw < latestMonthGw), members, profiles)
    : undefined;

  const season = buildRows(entries, members, profiles, viewerId, seasonPrior);
  const month = {
    key: currentMonthKey,
    label: monthLabel(currentMonthKey),
    gws: monthGws,
    rows: buildRows(monthEntries, members, profiles, viewerId, monthPrior),
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

  // Current gameweek + its phase, for the Hub. `pre` before any member has a
  // scored entry for it, `live` once one lands, `final` when the gw is settled.
  const currentGw = gws.find((g) => g.status !== "final") ?? gws[gws.length - 1];
  const currentScored = entries.some((e) => e.gw === currentGw.gw);
  const phase: "pre" | "live" | "final" =
    currentGw.status === "final" ? "final" : currentScored ? "live" : "pre";

  // Contribution rule: members can always post. A club league is open to browse
  // but only its own fans (its members) contribute — so for a non-member the only
  // thing that unlocks posting is being that club's supporter, which is exactly
  // what auto-membership already encodes. Mirror it so the UI can gate cleanly.
  const kind = league.kind ?? "private";
  const canContribute = isMember;

  const profile = (await leagueProfiles(svc, [league.id])).get(league.id) ?? emptyProfile;

  // ── AC1: pre-deadline readiness — one extra query, ONLY in the pre phase
  // (nothing to show once scoring's started). fantasy_squads is written in a
  // single upsert covering picks + xi + bench + captain + vice together
  // (createSquad in server.ts) — there's no partial row, so "has a squad row"
  // already means "complete". A squad's captain is likewise never left unset:
  // smartDefaults auto-picks one (priciest outfield player) the moment the
  // squad is built, so "captain still null" isn't a state this schema can be
  // in — the readiness signal collapses to squad-built vs not, which is what's
  // shown below (deviation from a literal "still picking a captain" line;
  // documented in the Phase 4b hand-off).
  let readiness: LeagueDetail["readiness"] = null;
  if (phase === "pre" && ids.length) {
    try {
      const { data: squadRows, error: sqErr } = await svc.from("fantasy_squads").select("user_id").in("user_id", ids);
      if (sqErr) throw sqErr;
      const haveSquad = new Set(((squadRows ?? []) as { user_id: string }[]).map((s) => s.user_id));
      const without = members.filter((m) => !haveSquad.has(m.user_id));
      readiness = {
        squadsIn: haveSquad.size, totalMembers: ids.length,
        waitingCount: without.length,
        waitingAvatars: without.slice(0, 5).map((m) => {
          const p = profiles.get(m.user_id);
          return { userId: m.user_id, name: p?.display_name ?? (p?.username ? `@${p.username}` : "Player"), avatarUrl: p?.avatar_url ?? null };
        }),
      };
    } catch (e) {
      console.error("[fantasy:leagues] readiness query failed — hiding the block:", e);
      readiness = null;
    }
  }

  // ── AC2: post-gameweek recap — final phase only, entirely derived from the
  // `season` rows already built above (no extra query). `movement` on a
  // LeagueRow is already "places gained vs the table before the latest scored
  // gameweek" (buildRows, above), which for a final-phase gw IS "vs the
  // previous gameweek" — so the riser is a straight read of existing data,
  // not a recompute.
  let gwRecap: LeagueDetail["gwRecap"] = null;
  if (phase === "final") {
    const recapNameOf = (r: LeagueRow) => r.displayName ?? (r.username ? `@${r.username}` : "Player");
    const scorers = season.filter((r) => r.lastGwPoints !== null);
    if (scorers.length) {
      const winnerRow = scorers.reduce((a, b) => (b.lastGwPoints! > a.lastGwPoints! ? b : a));
      const risers = season.filter((r) => r.movement !== null && r.movement > 0);
      const riserRow = risers.length ? risers.reduce((a, b) => (b.movement! > a.movement! ? b : a)) : null;
      gwRecap = {
        gw: currentGw.gw,
        winner: { userId: winnerRow.userId, name: recapNameOf(winnerRow), avatarUrl: winnerRow.avatarUrl, points: winnerRow.lastGwPoints! },
        riser: riserRow ? { userId: riserRow.userId, name: recapNameOf(riserRow), avatarUrl: riserRow.avatarUrl, places: riserRow.movement! } : null,
      };
    }
  }

  return {
    league: {
      id: league.id, name: league.name, code: league.join_code,
      memberCount: ids.length, isPublic: league.is_public, isMember, isOwner,
      stakes: league.stakes, imageUrl: league.image_url ?? null,
      kind, club: league.club ?? null, official: league.official ?? false, canContribute,
      bio: profile.bio, links: profile.links, venueMeta: profile.venueMeta,
    },
    gw: { number: currentGw.gw, phase, deadline: currentGw.deadline },
    season, month, lastMonth, readiness, gwRecap,
  };
}

// ── system-message broadcasts (Phase 4b, AC3a / AC3c) ───────────────────────
// Both hang off the season tick (season.ts), touch every league at once, and
// batch their own dedupe-check + insert (one SELECT, one INSERT — never one
// round trip per league). Both are best-effort: caught internally, they never
// throw, so a chat hiccup can't hold up scoring or settlement.

/** "Gameweek N is live" — hooked from season.ts's scoreGameweek the FIRST time
 *  this gw stamps any entry with scored_at (matches leagueDetail's own
 *  pre→live rule above), so it fires once per gw across the whole platform,
 *  not once per provisional tick. */
export async function notifyLeaguesGwLive(gw: number): Promise<void> {
  try {
    const svc = db();
    const { data: leagueRows } = await svc.from("fantasy_leagues").select("id, owner_id").range(0, 9999);
    const leagues = (leagueRows ?? []) as { id: string; owner_id: string }[];
    if (!leagues.length) return;
    const ids = leagues.map((l) => l.id);
    const { data: already } = await svc.from("comments").select("subject_id")
      .eq("subject_type", "fantasy_league").in("subject_id", ids)
      .eq("kind", "system").eq("payload->>event", "gw_live").eq("payload->>gw", String(gw))
      .is("deleted_at", null);
    const done = new Set(((already ?? []) as { subject_id: string }[]).map((r) => r.subject_id));
    const rows = leagues.filter((l) => !done.has(l.id)).map((l) => ({
      subject_type: "fantasy_league", subject_id: l.id, user_id: l.owner_id,
      body: `Gameweek ${gw} is live`, kind: "system", payload: { event: "gw_live", gw },
    }));
    if (rows.length) await svc.from("comments").insert(rows);
  } catch (e) { console.error("[fantasy:leagues] notifyLeaguesGwLive failed:", e); }
}

/** "X moved into first" — hooked from season.ts's finaliseGameweek, once the
 *  gw is properly settled (not a provisional tick, which would flip-flop the
 *  leader mid-matchday and spam the chat). Compares each league's leader
 *  before this gw to its leader after, points then knowledge-round correct —
 *  the season table's own primary tiebreak (buildRows, above); the table's
 *  further tiebreaks (lastGwPoints, joined_at) aren't replayed here since this
 *  is a chat nudge, not the table itself, so a tie this close is a rare miss,
 *  never a wrong answer on the table that actually decides standings. */
export async function notifyLeaguesLeadChange(gw: number): Promise<void> {
  try {
    const svc = db();
    const [{ data: leagueRows }, { data: memberRows }, { data: entryRows }] = await Promise.all([
      svc.from("fantasy_leagues").select("id, owner_id").range(0, 9999),
      svc.from("fantasy_league_members").select("league_id, user_id").range(0, 9999),
      svc.from("fantasy_entries").select("user_id, gw, points, round_correct").lte("gw", gw).not("scored_at", "is", null).range(0, 9999),
    ]);
    const leagues = (leagueRows ?? []) as { id: string; owner_id: string }[];
    if (!leagues.length) return;

    const membersByLeague = new Map<string, string[]>();
    for (const m of (memberRows ?? []) as { league_id: string; user_id: string }[]) {
      const arr = membersByLeague.get(m.league_id) ?? [];
      arr.push(m.user_id);
      membersByLeague.set(m.league_id, arr);
    }
    const entries = (entryRows ?? []) as { user_id: string; gw: number; points: number | null; round_correct: number | null }[];
    const totalsThrough = (ceiling: number) => {
      const totals = new Map<string, { points: number; knowledge: number }>();
      for (const e of entries) {
        if (e.gw > ceiling) continue;
        const acc = totals.get(e.user_id) ?? { points: 0, knowledge: 0 };
        acc.points += e.points ?? 0;
        acc.knowledge += e.round_correct ?? 0;
        totals.set(e.user_id, acc);
      }
      return totals;
    };
    const before = totalsThrough(gw - 1);
    const after = totalsThrough(gw);
    const leaderOf = (totals: Map<string, { points: number; knowledge: number }>, memberIds: string[]): string | null => {
      let best: string | null = null, bestPts = -1, bestKnow = -1;
      for (const id of memberIds) {
        const t = totals.get(id);
        if (!t) continue;
        if (t.points > bestPts || (t.points === bestPts && t.knowledge > bestKnow)) {
          best = id; bestPts = t.points; bestKnow = t.knowledge;
        }
      }
      return best;
    };

    const changes: { leagueId: string; ownerId: string; newLeaderId: string }[] = [];
    for (const l of leagues) {
      const memberIds = membersByLeague.get(l.id) ?? [];
      if (memberIds.length < 2) continue; // no "first" contest with one manager
      const beforeLeader = leaderOf(before, memberIds);
      const afterLeader = leaderOf(after, memberIds);
      if (!beforeLeader || !afterLeader || beforeLeader === afterLeader) continue;
      changes.push({ leagueId: l.id, ownerId: l.owner_id, newLeaderId: afterLeader });
    }
    if (!changes.length) return;

    const ids = changes.map((c) => c.leagueId);
    const { data: already } = await svc.from("comments").select("subject_id")
      .eq("subject_type", "fantasy_league").in("subject_id", ids)
      .eq("kind", "system").eq("payload->>event", "lead_change").eq("payload->>gw", String(gw))
      .is("deleted_at", null);
    const done = new Set(((already ?? []) as { subject_id: string }[]).map((r) => r.subject_id));
    const pending = changes.filter((c) => !done.has(c.leagueId));
    if (!pending.length) return;

    const { data: profs } = await svc.from("profiles").select("id, display_name, username").in("id", pending.map((c) => c.newLeaderId));
    const nameOf = new Map(((profs ?? []) as { id: string; display_name: string | null; username: string | null }[])
      .map((p) => [p.id, p.display_name ?? (p.username ? `@${p.username}` : "A manager")]));
    const rows = pending.map((c) => ({
      subject_type: "fantasy_league", subject_id: c.leagueId, user_id: c.ownerId,
      body: `${nameOf.get(c.newLeaderId) ?? "A manager"} moved into first`, kind: "system",
      payload: { event: "lead_change", gw },
    }));
    await svc.from("comments").insert(rows);
  } catch (e) { console.error("[fantasy:leagues] notifyLeaguesLeadChange failed:", e); }
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

/** Owner-only: set the community bio and/or social links (migration 263).
 *  Either field is optional — only the ones present in `body` are validated
 *  and written, so a settings page saving just the bio never clobbers links
 *  (or vice versa). Same requireOwnerLeague gate as rename/setVisibility
 *  above — this IS the server-side owner check for the settings page. */
export async function setLeagueProfile(
  userId: string, code: string, body: { bio?: unknown; links?: unknown },
): Promise<{ bio: string | null; links: LeagueLinks }> {
  const svc = db();
  const league = await requireOwnerLeague(svc, code, userId);
  const update: Record<string, unknown> = {};
  if ("bio" in body) update.bio = validateBio(body.bio);
  if ("links" in body) update.links = validateLinks(body.links);
  if (!Object.keys(update).length) throw new HttpError(400, "Nothing to update");
  const { error } = await svc.from("fantasy_leagues").update(update).eq("id", league.id);
  if (error) throw new HttpError(500, "Could not save");
  // Read back whatever wasn't in this call so the response is always the
  // full current profile, not just the half this call touched.
  const current = (await leagueProfiles(svc, [league.id])).get(league.id) ?? emptyProfile;
  return {
    bio: "bio" in body ? (update.bio as string | null) : current.bio,
    links: "links" in body ? (update.links as LeagueLinks) : current.links,
  };
}

/** Owner-only: set the venue content (info / offers / contact) for a venue
 *  league (migration 266). Same requireOwnerLeague gate as the profile setter.
 *  Whole-blob replace — the settings form always sends the full venue_meta. */
export async function setVenueMeta(
  userId: string, code: string, raw: unknown,
): Promise<VenueMeta> {
  const svc = db();
  const league = await requireOwnerLeague(svc, code, userId);
  if (league.kind !== "venue") throw new HttpError(400, "Not a venue league");
  const venueMeta = validateVenueMeta(raw);
  const { error } = await svc.from("fantasy_leagues").update({ venue_meta: venueMeta }).eq("id", league.id);
  if (error) throw new HttpError(500, "Could not save");
  return venueMeta;
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

// ── History ──────────────────────────────────────────────────────────────────

export interface HistoryGw {
  gw: number;
  /** Who scored the most THAT gameweek. */
  winner: { userId: string; name: string; points: number } | null;
  /** The viewer's finish in that gameweek's scoring. */
  yourGwRank: number | null;
  yourGwPoints: number | null;
  /** The cumulative season table as it stood after this gameweek — the snapshot. */
  table: LeagueRow[];
  highlights: ChatMoment[];
}
export interface LeagueHistory {
  league: { name: string; code: string; isMember: boolean };
  gameweeks: HistoryGw[]; // most recent first
}

const historyNameOf = (r: LeagueRow) =>
  r.displayName ?? (r.username ? `@${r.username}` : "Player");

/** The league's permanent per-gameweek memory: for every FINAL gameweek, the
 *  gameweek winner, the viewer's finish, the cumulative table snapshot, and the
 *  gameweek's derived talking points. Everything is recomputed from immutable
 *  scored entries, so a snapshot never drifts. */
export async function leagueHistory(code: string, viewerId: string | null): Promise<LeagueHistory> {
  const svc = db();
  const league = await findLeagueByCode(svc, code);

  const { data: memberRows } = await svc
    .from("fantasy_league_members").select("user_id, joined_at").eq("league_id", league.id);
  const members = (memberRows ?? []) as MemberRecord[];
  const ids = members.map((m) => m.user_id);
  const isMember = !!viewerId && ids.includes(viewerId);

  const base = { league: { name: league.name, code: league.join_code, isMember }, gameweeks: [] as HistoryGw[] };
  if (!ids.length) return base;

  const { data: profileRows } = await svc
    .from("profiles").select("id, username, display_name, avatar_url").in("id", ids);
  const profiles = new Map(((profileRows ?? []) as ProfileRecord[]).map((p) => [p.id, p]));

  const { data: entryRows } = await svc
    .from("fantasy_entries").select("user_id, gw, points, round_correct")
    .in("user_id", ids).not("scored_at", "is", null).range(0, 9999);
  const entries = (entryRows ?? []) as EntryRecord[];
  if (!entries.length) return base;

  const { data: gwRows } = await svc
    .from("fantasy_gameweeks").select("gw, status").order("gw", { ascending: true });
  const scored = new Set(entries.map((e) => e.gw));
  const finalGws = ((gwRows ?? []) as { gw: number; status: string }[])
    .filter((g) => g.status === "final" && scored.has(g.gw))
    .map((g) => g.gw)
    .sort((a, b) => b - a); // most recent first

  const gameweeks: HistoryGw[] = [];
  for (const gw of finalGws) {
    const gwRanking = buildRows(entries.filter((e) => e.gw === gw), members, profiles, viewerId);
    const winnerRow = gwRanking[0];
    const yourRow = gwRanking.find((r) => r.isMe) ?? null;
    const table = buildRows(entries.filter((e) => e.gw <= gw), members, profiles, viewerId);
    gameweeks.push({
      gw,
      winner: winnerRow ? { userId: winnerRow.userId, name: historyNameOf(winnerRow), points: winnerRow.points } : null,
      yourGwRank: yourRow?.rank ?? null,
      yourGwPoints: yourRow?.points ?? null,
      table,
      highlights: await momentsForGw(svc, ids, gw),
    });
  }
  return { league: { name: league.name, code: league.join_code, isMember }, gameweeks };
}
