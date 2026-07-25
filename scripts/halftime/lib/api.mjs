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

/** GET /api/gameday/schedule?date= — today's rows + the matchday kill-switch state. */
export function schedule(date) {
  const q = date ? `?date=${date}` : "";
  return call(`/api/gameday/schedule${q}`);
}

// FIX P2-c (W2): /api/halftime/fresh was the single content-write route for
// the retired staged/released quiz pipeline and is deleted (§0.1). Its
// replacement, /api/gameday/content, implements the ops the Gameday
// pipeline actually needs — base, approve, dedup, cancel — one code path per
// side effect, same discipline as the route it replaced. op() targets it.
// putFresh/putVeto/putKickoff/kill/unkill below are fresh-slice-only leftovers
// with no server-side implementation and stay marked @deprecated — nothing
// in the Gameday pipeline calls them.
export function op(body) {
  return call("/api/gameday/content", { method: "POST", body: JSON.stringify(body) });
}

/** Persist the generated base slate. scheduled|base_ready → base_ready. */
export const putBase = (fixtureId, questions) => op({ op: "base", fixtureId, questions });

/** The gate: write the approved questions, pre-assign pack_id, freeze
 * publish_at. base_ready → approved. */
export const putApprove = (fixtureId, questions) => op({ op: "approve", fixtureId, questions });

/**
 * The gate's deadline path (AC7 / spec §3.3): a pack unapproved by its
 * publish_at → cancelled, no pack, no push. Also used for postponements
 * gate.mjs learns about directly. Any pre-publish state → cancelled.
 */
export const putCancel = (fixtureId, reason) => op({ op: "cancel", fixtureId, reason });

/** @deprecated fresh-slice op, no longer implemented server-side. */
export const putFresh = (fixtureId, questions, state, extra = {}) =>
  op({ op: "fresh", fixtureId, questions, state, ...extra });

/** @deprecated fresh-slice veto op, no longer implemented server-side. */
export const putVeto = (fixtureId, index, status = "vetoed", all = false) =>
  op({ op: "veto", fixtureId, index, status, all });

/**
 * Season-wide duplicate check (AC6 / FIX P2-c). Returns the INDICES into
 * `texts` that collide with the `questions` bank, any other gameday pack
 * this season, or any Recap pack this season — normalizeQuestionText,
 * server-side, same normalization the bank's own uniqueness guard uses.
 */
export const dedupCheck = async (texts, excludeFixtureId) => {
  if (!texts.length) return [];
  const res = await op({ op: "dedup", texts, excludeFixtureId });
  return res.collisions ?? [];
};

/** @deprecated kickoff-drift-persist op, no longer implemented server-side. */
export const putKickoff = (fixtureId, kickoffAt, extra = {}) =>
  op({ op: "kickoff", fixtureId, kickoffAt, ...extra });

/** @deprecated the fresh-slice kill switch, no longer implemented server-side. */
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

/**
 * Read existing rows by fixture_id, whatever date their CURRENT kickoff_at
 * says (which may be far from the incoming one for a postponed fixture).
 * FIX P2-a: sync-fixtures.mjs needs this BEFORE the upsert to detect "this
 * fixture_id already exists, was cancelled, and its kickoff has moved" —
 * readFixtures() alone can't see it if the old kickoff_at falls outside the
 * date range being synced. Same direct-REST exception as upsertFixtures,
 * confined to sync-fixtures.mjs (read-only here, so lower-risk than the write).
 */
export async function readFixturesByIds(fixtureIds) {
  if (!fixtureIds.length) return [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const q = new URLSearchParams({
    select: "fixture_id,home,away,kickoff_at,state,round_name",
    fixture_id: `in.(${fixtureIds.join(",")})`,
  });
  const res = await fetch(`${url}/rest/v1/halftime_releases?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`read failed ${res.status}`);
  return res.json();
}

export const apiBase = () => BASE;
