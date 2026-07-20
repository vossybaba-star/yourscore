/**
 * api.mjs — HTTP client for the W1 halftime routes.
 *
 * These scripts NEVER touch the database directly. Every content write goes
 * through /api/halftime/fresh and every state transition through the routes that
 * own it — one code path per side effect (LOOP rule 4). A veto tap persisted here
 * is a veto tap the poller re-reads from the DB after a restart, rather than one
 * that lived in a process that died.
 *
 * Writes are ASSERTED, not assumed (LOOP rule 1): after persisting we re-read the
 * schedule and confirm the row actually says what we think it says. A 200 from a
 * route is not evidence that a row changed.
 */

const BASE = (process.env.HALFTIME_API_BASE || process.env.NEXT_PUBLIC_APP_URL || "https://yourscore.app").replace(/\/$/, "");

function auth() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  return { Authorization: `Bearer ${secret}`, "content-type": "application/json" };
}

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...auth(), ...(init.headers ?? {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${body.error ?? body.raw ?? ""}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** GET /api/halftime/schedule?date= — today's rows + the matchday kill-switch state. */
export function schedule(date) {
  const q = date ? `?date=${date}` : "";
  return call(`/api/halftime/schedule${q}`);
}

export function op(body) {
  return call("/api/halftime/fresh", { method: "POST", body: JSON.stringify(body) });
}

/** Persist the approved base slate. scheduled → base_ready. */
export const putBase = (fixtureId, questions) => op({ op: "base", fixtureId, questions });

/** Persist the validated fresh slice + its veto deadline and Telegram message id. */
export const putFresh = (fixtureId, questions, state, extra = {}) =>
  op({ op: "fresh", fixtureId, questions, state, ...extra });

/** One founder tap. Idempotent; honoured right up to release-copy time. */
export const putVeto = (fixtureId, index, status = "vetoed", all = false) =>
  op({ op: "veto", fixtureId, index, status, all });

/**
 * Season-wide duplicate check (AC6): which of these question texts already
 * exist in the active bank or in any halftime pack this season? Returns the
 * indexes that collide. Normalization happens server-side with the canonical
 * normalizeQuestionText, so the generators never re-implement it.
 */
export const dedupCheck = async (texts, excludeFixtureId) => {
  if (!texts.length) return [];
  const res = await op({ op: "dedup", texts, excludeFixtureId });
  return res.collisions ?? [];
};

/**
 * Persist a moved kickoff. The row is the single clock: the watchdog reads
 * kickoff_at from the DB, so a kickoff the poller followed only in its own
 * memory would leave the watchdog acting on a stale time if the poller died.
 */
export const putKickoff = (fixtureId, kickoffAt, extra = {}) =>
  op({ op: "kickoff", fixtureId, kickoffAt, ...extra });

/** The slate kill switch. One message, whole matchday. */
export const kill = (matchday) => op({ op: "kill", matchday });
export const unkill = (matchday) => op({ op: "unkill", matchday });

/**
 * Upsert a fixture row. The routes W1 shipped have no create path (the sync is
 * the only thing that creates rows), so this goes straight to PostgREST with the
 * service-role key — the ONE exception to the no-direct-DB rule, and it is
 * confined to sync-fixtures.mjs. Documented so nobody copies the pattern.
 */
export async function upsertFixtures(rows) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  if (!rows.length) return [];

  const res = await fetch(`${url}/rest/v1/halftime_releases?on_conflict=fixture_id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // merge-duplicates = upsert. Kickoff changes and postponements land here.
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`upsert failed ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Read rows straight back out — used to ASSERT the upsert (LOOP rule 1). */
export async function readFixtures({ fromUtc, toUtc }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const q = new URLSearchParams({
    select: "fixture_id,home,away,kickoff_at,state,round_name",
    kickoff_at: `gte.${fromUtc}`,
    order: "kickoff_at.asc",
  });
  q.append("kickoff_at", `lt.${toUtc}`);
  const res = await fetch(`${url}/rest/v1/halftime_releases?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`read failed ${res.status}`);
  return res.json();
}

export const apiBase = () => BASE;
