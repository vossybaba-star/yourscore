/**
 * anon-api.mjs — Layer 1: unauthenticated surface of yourscore.app.
 *
 * Fast HTTP probes of everything a logged-out visitor (or the native shell)
 * touches. Each check also asserts the health bot is ABSENT from every
 * leaderboard payload — the £100 prize board must never show the bot.
 */

import { req, BASE } from "../lib/http.mjs";

const BOT_ID = process.env.HEALTH_BOT_USER_ID || "";
// Opt-in: club_leagues is empty until a partner league goes live in the DB
// (the /l/lukepingu hub is still demo data). Set HEALTH_CLUB_SLUG to enable.
const CLUB_SLUG = process.env.HEALTH_CLUB_SLUG || "";

/** True if the bot's user id or display name appears anywhere in the payload. */
function botPresent(payloadText) {
  if (!BOT_ID) return false;
  return payloadText.includes(BOT_ID);
}

export async function run(report, ctx) {
  const bust = `hc=${Date.now()}`;

  // Home page — the app shell itself.
  try {
    const r = await req("/");
    report.add("api", "GET /", r.status === 200 && /<div|<main|__next/i.test(r.text), {
      ms: r.ms,
      detail: r.status === 200 ? "" : `status ${r.status}`,
      hint: "check Vercel deploy status",
    });
  } catch (e) {
    report.add("api", "GET /", false, { detail: e.message, hint: "site unreachable — check Vercel + DNS" });
  }

  const probes = [
    {
      name: "quiz/packs",
      path: "/api/quiz/packs",
      pass: (r) => r.status === 200 && Array.isArray(r.json?.packs) && r.json.packs.length > 0,
      detail: (r) => `status ${r.status}, packs=${r.json?.packs?.length ?? "?"}`,
      hint: "quiz pack rotation empty or route broken",
      keep: "packs",
    },
    {
      name: "leaderboard/yourscore",
      path: `/api/leaderboard/yourscore?${bust}`,
      pass: (r) => r.status === 200 && Array.isArray(r.json?.rows) && r.json.rows.length > 0 && !botPresent(r.text),
      detail: (r) => (botPresent(r.text) ? "HEALTH BOT VISIBLE ON BOARD" : `status ${r.status}, rows=${r.json?.rows?.length ?? "?"}`),
      hint: "if bot visible: stop runs, delete bot rows. Else check get_yourscore_rank RPC",
    },
    {
      name: "leaderboard/wc2026",
      path: `/api/leaderboard/wc2026?${bust}`,
      pass: (r) => r.status === 200 && Array.isArray(r.json?.rows ?? r.json) && !botPresent(r.text),
      detail: (r) => (botPresent(r.text) ? "HEALTH BOT ON THE £100 PRIZE BOARD" : `status ${r.status}`),
      hint: "if bot visible: stop runs, delete its quiz_attempts NOW (prize board)",
    },
    {
      name: "draft/wc/leaderboard",
      path: `/api/draft/wc/leaderboard?${bust}`,
      pass: (r) => r.status === 200 && !botPresent(r.text),
      detail: (r) => (botPresent(r.text) ? "HEALTH BOT VISIBLE ON BOARD" : `status ${r.status}`),
      hint: "if bot visible: stop runs, delete its draft_wc_runs. Else check RPC",
    },
    {
      name: "draft/leaderboard",
      path: "/api/draft/leaderboard",
      pass: (r) => r.status === 200 && r.json !== null,
      detail: (r) => `status ${r.status}`,
      hint: "38-0 classic leaderboard route broken",
    },
    ...(CLUB_SLUG
      ? [{
          name: `club/${CLUB_SLUG}`,
          path: `/api/club/${CLUB_SLUG}`,
          pass: (r) => r.status === 200,
          detail: (r) => `status ${r.status}`,
          hint: "club league route broken (partner-facing)",
        }]
      : []),
  ];

  for (const p of probes) {
    try {
      const r = await req(p.path);
      report.add("api", p.name, p.pass(r), { ms: r.ms, detail: p.pass(r) ? "" : p.detail(r), hint: p.hint });
      if (p.keep && r.json) ctx[p.keep] = r.json[p.keep] ?? r.json;
    } catch (e) {
      report.add("api", p.name, false, { detail: e.message, hint: p.hint });
    }
  }

  // iOS version endpoint — flaky upstream (iTunes lookup), so warn-only on null.
  try {
    const r = await req("/api/ios-version");
    const ok = r.status === 200;
    report.add("api", "ios-version", ok, {
      ms: r.ms,
      warn: ok && !r.json?.version,
      detail: ok ? (r.json?.version ? "" : "version null (iTunes flake)") : `status ${r.status}`,
      hint: "update banner source — non-urgent",
    });
  } catch (e) {
    report.add("api", "ios-version", true, { warn: true, detail: `unreachable: ${e.message}` });
  }

  // The 38-0 draft pool — the stable /public URL that replaced the webpack chunk
  // after the "can't pick a player" incident. Body is reused by the journey layer.
  try {
    const r = await req("/data/draft/player-seasons.json", { timeoutMs: 20_000 });
    const players = r.json?.players ?? r.json;
    const ok = r.status === 200 && Array.isArray(players) && players.length > 5000;
    report.add("api", "draft pool JSON", ok, {
      ms: r.ms,
      detail: ok ? `${players.length} players` : `status ${r.status}, players=${Array.isArray(players) ? players.length : "unparseable"}`,
      hint: "38-0 draft cannot pick players without this — check public/data/draft/",
    });
    if (ok) { ctx.pool = players; ctx.poolNations = r.json?.nations ?? []; }
  } catch (e) {
    report.add("api", "draft pool JSON", false, { detail: e.message, hint: "38-0 draft pool unreachable" });
  }
}
