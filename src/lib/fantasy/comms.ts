import "server-only";
/**
 * Post-gameweek comms — the retention loop, kept OUT of season.ts so the state
 * machine stays a pure driver and a failed email can never hold the season.
 *
 * Three moments, all design-mandated:
 *   - deadline email  ("web leans on email for deadline reminders", D:460-461)
 *   - result moment   (push + personal email when your gameweek finalises)
 *   - month winner    (the headline table's payoff: announced, then a fresh start)
 *
 * Emails are gated behind FANTASY_EMAILS_ENABLED so nothing sends until the
 * founder flips the switch; pushes ride the existing opt-in + dedupe rails.
 * Every send is claimed in notification_log BEFORE delivery (the notifyUsers
 * idiom), so a re-tick can never double-send.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers } from "@/lib/notify";
import { sendFantasyDeadlineEmail, sendFantasyGwResultEmail } from "@/lib/email/senders";
import { enginePool } from "./pool";
import { groupGwsByMonth, monthKeyOf, monthLabel } from "./months";
import type { SeasonGw } from "./season";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

const EMAILS_ON = () => process.env.FANTASY_EMAILS_ENABLED === "true";
const BATCH_CAP = 250; // hard ceiling per tick — a bug can never mass-mail past it

/** Claim (user, key) in notification_log before sending. True = ours to send. */
async function claimOnce(db: Db, userIds: string[], key: string): Promise<string[]> {
  if (!userIds.length) return [];
  const { data: prior } = await db.from("notification_log")
    .select("user_id").eq("key", key).in("user_id", userIds);
  const done = new Set(((prior ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const fresh = userIds.filter((u) => !done.has(u));
  if (!fresh.length) return [];
  const { error } = await db.from("notification_log")
    .insert(fresh.map((user_id) => ({ user_id, key })));
  if (error) { console.error("[fantasy-comms] claim failed:", error.message); return []; }
  return fresh;
}

/** Email + suppression lookup. Emails live in auth; suppressed users are skipped. */
async function emailsFor(db: Db, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of userIds.slice(0, BATCH_CAP)) {
    const { data } = await db.auth.admin.getUserById(id);
    const email = data?.user?.email;
    if (email) out.set(id, email);
  }
  if (out.size) {
    const { data: sup } = await db.from("email_suppressions")
      .select("email").in("email", Array.from(out.values()));
    const suppressed = new Set(((sup ?? []) as { email: string }[]).map((r) => r.email));
    for (const [id, email] of Array.from(out)) if (suppressed.has(email)) out.delete(id);
  }
  return out;
}

// ── deadline: the one ritual that must never be missed ───────────────────────
/** Nudge everyone with a squad ~24h before the deadline. Personal: it says
 *  whether YOUR round is played, not a generic reminder. */
export async function deadlineComms(db: Db, gw: SeasonGw): Promise<number> {
  if (!EMAILS_ON() || !gw.deadline) return 0;
  const { data: squads } = await db.from("fantasy_squads").select("user_id").range(0, 9999);
  const ids = ((squads ?? []) as { user_id: string }[]).map((s) => s.user_id);
  const fresh = await claimOnce(db, ids, `fantasy-email:deadline:${gw.gw}`);
  if (!fresh.length) return 0;

  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, round_done_at").eq("gw", gw.gw).in("user_id", fresh);
  const roundDone = new Set(((entries ?? []) as { user_id: string; round_done_at: string | null }[])
    .filter((e) => e.round_done_at).map((e) => e.user_id));

  const emails = await emailsFor(db, fresh);
  const d = new Date(gw.deadline);
  const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  let sent = 0;
  for (const [userId, email] of Array.from(emails)) {
    await sendFantasyDeadlineEmail({
      userId, email, gw: gw.gw, deadlineDay: day, deadlineTime: time,
      statusLine: roundDone.has(userId)
        ? "Your round is played and your credits are banked — set your team and captain."
        : "You haven't played this week's knowledge round yet. Right answers earn transfers.",
    });
    sent++;
  }
  return sent;
}

// ── the result moment ────────────────────────────────────────────────────────
export async function resultComms(db: Db, gw: SeasonGw): Promise<{ pushed: number; emailed: number }> {
  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, points, points_breakdown, round_correct, cash_points")
    .eq("gw", gw.gw).eq("status", "final").not("points", "is", null).range(0, 9999);
  const rows = (entries ?? []) as {
    user_id: string; points: number; round_correct: number; cash_points: number;
    points_breakdown: { id: number; points: number; captain: boolean }[] | null;
  }[];
  if (!rows.length) return { pushed: 0, emailed: 0 };

  // Push: one dedupe key for the gameweek; the tap lands on the result card.
  const { targeted } = await notifyUsers({
    userIds: rows.map((r) => r.user_id),
    title: `Gameweek ${gw.gw} is in`,
    body: "Your team has scored — see the breakdown and who earned the armband.",
    url: "/fantasy",
    dedupeKey: `fantasy-result:${gw.gw}`,
  });

  let emailed = 0;
  if (EMAILS_ON()) {
    const fresh = await claimOnce(db, rows.map((r) => r.user_id), `fantasy-email:result:${gw.gw}`);
    const emails = await emailsFor(db, fresh);
    const nameOf = new Map(enginePool().map((p) => [p.id, p.name]));
    for (const r of rows) {
      const email = emails.get(r.user_id);
      if (!email) continue;
      const bd = r.points_breakdown ?? [];
      const cap = bd.find((b) => b.captain);
      const top = [...bd].sort((a, b) => b.points - a.points)[0];
      await sendFantasyGwResultEmail({
        userId: r.user_id, email, gw: gw.gw, points: r.points,
        captain: cap ? (nameOf.get(cap.id) ?? "—") : "—", captainPts: cap?.points ?? 0,
        top: top ? (nameOf.get(top.id) ?? "—") : "—", topPts: top?.points ?? 0,
        knowledgeLine: r.cash_points > 0
          ? `Your round went ${r.round_correct}/11 and cashed ${r.cash_points} points straight onto the total.`
          : r.round_correct > 0
            ? `Your round went ${r.round_correct}/11.`
            : "You rolled over unplayed this week — the team still counted.",
      });
      emailed++;
    }
  }
  return { pushed: targeted, emailed };
}

// ── month winner: the headline table pays out ────────────────────────────────
/** If this gameweek closed its month, announce each league's month winner.
 *  Winner = month points, knowledge as the tiebreak (audit decision 6). */
export async function monthWinnerComms(db: Db, gw: SeasonGw, allGws: SeasonGw[]): Promise<number> {
  const key = monthKeyOf(gw);
  const monthGws = groupGwsByMonth(allGws.filter((g) => g.mode === gw.mode)).get(key) ?? [];
  const isLastOfMonth = monthGws.length > 0 && gw.gw === Math.max(...monthGws);
  if (!isLastOfMonth) return 0;

  const { data: leagues } = await db.from("fantasy_leagues").select("id, name, join_code").range(0, 9999);
  if (!leagues?.length) return 0;
  const { data: members } = await db.from("fantasy_league_members")
    .select("league_id, user_id").range(0, 9999);
  const byLeague = new Map<string, string[]>();
  for (const m of (members ?? []) as { league_id: string; user_id: string }[]) {
    (byLeague.get(m.league_id) ?? byLeague.set(m.league_id, []).get(m.league_id)!).push(m.user_id);
  }

  const { data: entries } = await db.from("fantasy_entries")
    .select("user_id, points, round_correct").in("gw", monthGws)
    .not("scored_at", "is", null).range(0, 9999);
  const tally = new Map<string, { pts: number; kn: number }>();
  for (const e of (entries ?? []) as { user_id: string; points: number | null; round_correct: number }[]) {
    const t = tally.get(e.user_id) ?? { pts: 0, kn: 0 };
    t.pts += e.points ?? 0; t.kn += e.round_correct;
    tally.set(e.user_id, t);
  }

  let announced = 0;
  for (const l of leagues as { id: string; name: string; join_code: string }[]) {
    const ms = byLeague.get(l.id) ?? [];
    if (ms.length < 2) continue; // a league of one has nobody to beat
    const ranked = ms
      .map((u) => ({ u, ...(tally.get(u) ?? { pts: 0, kn: 0 }) }))
      .sort((a, b) => (b.pts - a.pts) || (b.kn - a.kn));
    const win = ranked[0];
    if (!win || win.pts <= 0) continue;
    const { data: prof } = await db.from("profiles")
      .select("display_name, username").eq("id", win.u).maybeSingle();
    const who = prof?.display_name ?? (prof?.username ? `@${prof.username}` : "Someone");
    await notifyUsers({
      userIds: ms,
      title: `${monthLabel(key)} is settled`,
      body: `${who} takes the month in ${l.name} with ${win.pts} points. Fresh table from the next gameweek.`,
      url: `/fantasy/leagues/${l.join_code}`,
      dedupeKey: `fantasy-month:${l.id}:${key}`,
    });
    announced++;
  }
  return announced;
}
