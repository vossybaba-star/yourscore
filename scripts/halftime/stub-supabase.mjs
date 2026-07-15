#!/usr/bin/env node
/**
 * stub-supabase.mjs — an in-memory PostgREST + Edge-Function stand-in, for the
 * replay harness ONLY.
 *
 * ═══ READ THIS BEFORE YOU TRUST A GREEN RUN ═══
 *
 * This is NOT Postgres. It is a faithful-enough emulation of the PostgREST wire
 * protocol that supabase-js speaks, so that the REAL Next.js route handlers and
 * the REAL src/lib/halftime/release.ts run unmodified against it during a
 * replay. What that buys, and what it does not:
 *
 *   PROVEN here      the poller's behaviour, the routes' logic, the release
 *                    engine's branches, idempotency of the code paths, the
 *                    state machine end to end, push fan-out and the daily cap.
 *   NOT proven here  Postgres semantics. The compare-and-set is atomic in this
 *                    process only because a Node request handler is a single
 *                    synchronous block. That the CAS is *also* atomic under
 *                    Postgres READ COMMITTED was proven separately by W1, with
 *                    12 real parallel psql sessions racing one row. Neither
 *                    proof substitutes for the other.
 *   NOT proven here  RLS, CHECK constraints as the database enforces them, or
 *                    the migration applying cleanly. (The two CHECKs that would
 *                    silently kill the feature — quiz_packs.type and .source —
 *                    ARE enforced below, because a stub that accepts what prod
 *                    rejects is worse than no stub at all.)
 *
 * Why it exists at all: there is no Docker on this machine, so no local
 * Supabase; and the migration is deliberately unapplied to prod, so there is no
 * remote table to test against either. The alternative was to test nothing.
 *
 * Usage:  node scripts/halftime/stub-supabase.mjs [--port 8788]
 * Then:   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8788 SUPABASE_SERVICE_ROLE_KEY=stub next dev
 */

import { createServer } from "node:http";

const PORT = Number(
  (process.argv.indexOf("--port") >= 0 && process.argv[process.argv.indexOf("--port") + 1]) || 8788,
);

// ── the "database" ───────────────────────────────────────────────────────────

/** table → rows[]. Nothing is persisted; every run starts empty. */
const TABLES = {
  halftime_releases: [],
  halftime_control: [],
  halftime_heartbeat: [],
  quiz_packs: [],
  notification_log: [],
  profiles: [],
  quiz_attempts: [],
  club_supporters: [],
  halftime_predictions: [],
  halftime_prediction_results: [],
};

/** Primary/unique keys, so a duplicate insert fails the way Postgres fails. */
const KEYS = {
  halftime_releases: ["fixture_id"],
  halftime_control: ["matchday"],
  halftime_heartbeat: ["id"],
  quiz_packs: ["id"],
  notification_log: ["user_id", "key"],
  profiles: ["id"],
  quiz_attempts: ["id"],
  // PK (user_id, season_id) — one club per user PER SEASON. A user_id-only key
  // would wrongly reject a returning fan declaring for a new season.
  club_supporters: ["user_id", "season_id"],
  // One pick per fan per fixture — the DB lock the poll relies on.
  halftime_predictions: ["user_id", "fixture_id"],
  halftime_prediction_results: ["fixture_id"],
};

/**
 * The CHECK constraints that actually bite. quiz_packs.type is the one W1 found
 * by reading prod: a 'halftime' type would be rejected at INSERT — meaning every
 * pack would fail at the whistle and nowhere earlier, and an off-season test
 * against a permissive stub would have sailed straight past it. So the stub
 * enforces it.
 */
const CHECKS = {
  quiz_packs: [
    { col: "type", allowed: ["club", "national", "records"], name: "quiz_packs_type_check" },
    { col: "source", allowed: ["system", "user"], name: "quiz_packs_source_check" },
  ],
  halftime_releases: [
    {
      col: "state",
      allowed: ["scheduled", "base_ready", "staged", "released", "released_late", "cancelled", "failed"],
      name: "halftime_releases_state_check",
    },
    {
      col: "fresh_state",
      allowed: ["none", "pending_veto", "approved", "vetoed", "killed", "skipped"],
      name: "halftime_releases_fresh_state_check",
    },
  ],
};

const pushes = []; // everything /functions/v1/send-push was asked to deliver
const log = [];    // every mutation, for the report

// ── PostgREST filter parsing ─────────────────────────────────────────────────

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseValue(raw) {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/** `in.("a","b")` / `in.(1,2)` → [a, b] */
function parseInList(raw) {
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  if (!inner) return [];
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(parseValue);
}

function cmp(a, b) {
  // ISO timestamps compare correctly as strings, but be explicit about it.
  if (typeof a === "string" && typeof b === "string") {
    const da = Date.parse(a);
    const dbb = Date.parse(b);
    if (!Number.isNaN(da) && !Number.isNaN(dbb)) return da - dbb;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function eqLoose(rowVal, want) {
  if (rowVal === want) return true;
  if (rowVal == null || want == null) return false;
  return String(rowVal) === String(want);
}

function buildFilters(url) {
  const filters = [];
  for (const [col, raw] of url.searchParams.entries()) {
    if (RESERVED.has(col)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const rest = raw.slice(dot + 1);
    filters.push({ col, op, raw: rest });
  }
  return filters;
}

function matches(row, filters) {
  return filters.every(({ col, op, raw }) => {
    const v = row[col];

    // PostgREST negation: `col=not.is.null`, `col=not.eq.x`, `col=not.in.(…)`.
    // supabase-js's .not(col, op, val) emits this. Without it the stub 400s on a
    // perfectly valid query — which is exactly how the club table came back
    // silently empty (found 2026-07-14 demoing the club leaderboard).
    if (op === "not") {
      const dot = raw.indexOf(".");
      const innerOp = dot === -1 ? raw : raw.slice(0, dot);
      const innerRaw = dot === -1 ? "" : raw.slice(dot + 1);
      return !matches(row, [{ col, op: innerOp, raw: innerRaw }]);
    }

    switch (op) {
      case "eq": return eqLoose(v, parseValue(raw));
      case "neq": return !eqLoose(v, parseValue(raw));
      case "gt": return v != null && cmp(v, parseValue(raw)) > 0;
      case "gte": return v != null && cmp(v, parseValue(raw)) >= 0;
      case "lt": return v != null && cmp(v, parseValue(raw)) < 0;
      case "lte": return v != null && cmp(v, parseValue(raw)) <= 0;
      case "in": return parseInList(raw).some((w) => eqLoose(v, w));
      case "is": return raw === "null" ? v == null : v === (raw === "true");
      case "like": {
        const re = new RegExp(`^${raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
        return typeof v === "string" && re.test(v);
      }
      default:
        throw Object.assign(new Error(`stub: unsupported filter op "${op}"`), { status: 400 });
    }
  });
}

function applyOrder(rows, url) {
  const order = url.searchParams.get("order");
  if (!order) return rows;
  const [col, dir = "asc"] = order.split(".");
  return [...rows].sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(a[col], b[col]));
}

// ── constraints ──────────────────────────────────────────────────────────────

function keyOf(table, row) {
  return (KEYS[table] ?? []).map((k) => String(row[k])).join(" ");
}

function checkConstraints(table, row) {
  for (const c of CHECKS[table] ?? []) {
    if (row[c.col] !== undefined && !c.allowed.includes(row[c.col])) {
      throw Object.assign(
        new Error(`new row for relation "${table}" violates check constraint "${c.name}"`),
        { status: 400, code: "23514" },
      );
    }
  }
}

// ── http ─────────────────────────────────────────────────────────────────────

const json = (res, code, body) => {
  const payload = body === null ? "" : JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(payload);
};

/**
 * PostgREST's single-object mode. `.single()` / `.maybeSingle()` send
 * `Accept: application/vnd.pgrst.object+json`, and real PostgREST then returns
 * ONE object — or 406/PGRST116 when the row count isn't exactly 1. The stub
 * originally ignored the header and always returned an array, which
 * `/api/challenges/pack` (`.single()`, route.ts:50) surfaced as a pack the
 * challenge page couldn't render (`pack.name` undefined on an array —
 * found demoing 2026-07-14, invisible to the replay suite because it asserted
 * the pack via raw REST, never through a `.single()` client call that renders).
 */
function wantsObject(req) {
  return String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
}

function respondRows(req, res, rows) {
  if (!wantsObject(req)) return json(res, 200, rows);
  if (rows.length === 1) return json(res, 200, rows[0]);
  return json(res, 406, {
    code: "PGRST116",
    message: `JSON object requested, multiple (or no) rows returned`,
    details: `The result contains ${rows.length} rows`,
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;

  try {
    // ── harness inspection ───────────────────────────────────────────────────
    if (p === "/_stub/dump") {
      const t = url.searchParams.get("table");
      return json(res, 200, t ? { [t]: TABLES[t] } : TABLES);
    }
    if (p === "/_stub/pushes") return json(res, 200, { pushes });
    if (p === "/_stub/log") return json(res, 200, { log });
    if (p === "/_stub/reset") {
      for (const t of Object.keys(TABLES)) TABLES[t] = [];
      pushes.length = 0;
      log.length = 0;
      return json(res, 200, { ok: true });
    }
    if (p === "/_stub/seed" && req.method === "POST") {
      const body = await readBody(req);
      const { table, rows } = body;
      if (!TABLES[table]) return json(res, 400, { message: `unknown table ${table}` });
      for (const row of rows) {
        checkConstraints(table, row);
        const k = keyOf(table, row);
        const idx = TABLES[table].findIndex((r) => keyOf(table, r) === k);
        if (idx >= 0) TABLES[table][idx] = { ...TABLES[table][idx], ...row };
        else TABLES[table].push({ ...row });
      }
      return json(res, 200, { ok: true, count: TABLES[table].length });
    }

    // ── the send-push Edge Function (notify.ts calls this directly) ──────────
    if (p === "/functions/v1/send-push") {
      const body = await readBody(req);
      pushes.push({ at: new Date().toISOString(), ...body });
      return json(res, 200, { ok: true, sent: (body?.userIds ?? []).length });
    }

    // ── PostgREST ────────────────────────────────────────────────────────────
    const m = p.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
    if (!m) return json(res, 404, { message: `stub: no route ${req.method} ${p}` });

    const table = m[1];
    if (!TABLES[table]) {
      return json(res, 404, {
        message: `relation "public.${table}" does not exist`,
        code: "42P01",
      });
    }

    const filters = buildFilters(url);
    const prefer = String(req.headers.prefer ?? "");
    const wantsRepresentation = prefer.includes("return=representation");

    if (req.method === "GET") {
      const rows = applyOrder(TABLES[table].filter((r) => matches(r, filters)), url);
      const limit = Number(url.searchParams.get("limit") ?? 0);
      return respondRows(req, res, limit > 0 ? rows.slice(0, limit) : rows);
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const isUpsert = prefer.includes("resolution=");
      const ignoreDupes = prefer.includes("resolution=ignore-duplicates");
      const out = [];

      for (const row of rows) {
        checkConstraints(table, row);
        const k = keyOf(table, row);
        const existing = TABLES[table].findIndex((r) => keyOf(table, r) === k);

        if (existing >= 0) {
          if (!isUpsert) {
            // Exactly what Postgres does — and exactly what notify.ts's
            // log-before-deliver dedup relies on.
            return json(res, 409, {
              message: `duplicate key value violates unique constraint "${table}_pkey"`,
              code: "23505",
              details: `Key (${(KEYS[table] ?? []).join(", ")}) already exists.`,
            });
          }
          if (ignoreDupes) { out.push(TABLES[table][existing]); continue; }
          TABLES[table][existing] = { ...TABLES[table][existing], ...row };
          out.push(TABLES[table][existing]);
          log.push({ at: Date.now(), op: "upsert", table, key: k });
          continue;
        }

        const fresh = { ...row };
        TABLES[table].push(fresh);
        out.push(fresh);
        log.push({ at: Date.now(), op: "insert", table, key: k });
      }

      return wantsRepresentation ? json(res, 201, out) : json(res, 201, null);
    }

    if (req.method === "PATCH") {
      const patch = await readBody(req);
      // ── the compare-and-set ────────────────────────────────────────────────
      // Match + mutate in ONE synchronous block, exactly like a single-statement
      // `update ... where state = 'staged'`. Two concurrent releases cannot
      // interleave here, so the loser sees zero rows — the same outcome
      // Postgres gives under READ COMMITTED (see the header caveat).
      const hit = TABLES[table].filter((r) => matches(r, filters));
      for (const row of hit) {
        checkConstraints(table, { ...row, ...patch });
        Object.assign(row, patch, { updated_at: new Date().toISOString() });
        log.push({ at: Date.now(), op: "update", table, key: keyOf(table, row), patch: Object.keys(patch) });
      }
      return wantsRepresentation ? json(res, 200, hit) : json(res, 204, null);
    }

    if (req.method === "DELETE") {
      const keep = TABLES[table].filter((r) => !matches(r, filters));
      const removed = TABLES[table].length - keep.length;
      TABLES[table] = keep;
      return wantsRepresentation ? json(res, 200, []) : json(res, 204, null);
    }

    return json(res, 405, { message: `stub: ${req.method} not supported` });
  } catch (err) {
    const status = err.status ?? 500;
    return json(res, status, { message: err.message, code: err.code ?? "XX000" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stub-db] in-memory PostgREST on http://127.0.0.1:${PORT} (NOT Postgres — see header)`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
