/**
 * Stop a rehearsal from notifying real people.
 *
 * Every drill that drives a gameweek to `final` also runs the retention loop:
 * the result push, and — if the staged gameweek happens to be the last of its
 * calendar month, which a backdated one always is — a month-winner announcement
 * to every member of every league. Those leagues contain real accounts with real
 * devices registered.
 *
 * This is not hypothetical. The feed-downtime drill was written without it and
 * pushed "July 2026 is settled" to the founder's phone.
 *
 * `notifyUsers` writes to notification_log BEFORE it delivers and skips anyone
 * already logged, so pre-claiming the keys is the system's own mute button. It
 * lives here, in one place, so a new drill cannot forget it: call `muteComms`
 * immediately after staging and before the first tick.
 */

/** Europe/London "YYYY-MM" for an ISO instant — the month key comms uses. */
export function monthKeyOf(iso) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  return `${y}-${m}`;
}

/**
 * Claim every notification key the staged gameweek could emit.
 * Returns the claims so a teardown can remove exactly what it added.
 */
export async function muteComms(db, { gw, deadline, userIds = [] }) {
  const key = monthKeyOf(deadline);
  const { data: leagues } = await db.from("fantasy_leagues").select("id");
  const { data: members } = await db.from("fantasy_league_members").select("league_id, user_id");

  const claims = [];
  // The result push, for whoever has an entry.
  for (const user_id of userIds) claims.push({ user_id, key: `fantasy-result:${gw}` });
  // The month title, for every member of every league — including people who
  // have nothing to do with the drill.
  for (const l of leagues ?? []) {
    for (const m of (members ?? []).filter((x) => x.league_id === l.id)) {
      claims.push({ user_id: m.user_id, key: `fantasy-month:${l.id}:${key}` });
    }
  }
  if (claims.length) await db.from("notification_log").insert(claims);
  return claims;
}

/** Remove exactly the claims muteComms added. */
export async function unmuteComms(db, claims) {
  for (const c of claims ?? []) {
    await db.from("notification_log").delete().eq("user_id", c.user_id).eq("key", c.key);
  }
}
