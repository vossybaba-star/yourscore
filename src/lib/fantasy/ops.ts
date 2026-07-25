import "server-only";
/**
 * fantasy-ops — the hourly watchdog over the live season.
 *
 * It reads, it alerts (Telegram), and it can veto a finalise with one DB flag.
 * That's the whole surface. It never advances or mutates a live/locked/scored
 * gameweek except two narrow paths:
 *
 *   - Guard B RED sets `fantasy_gameweeks.ops_hold = true`. One-directional —
 *     nothing here ever sets it back to false. Clearing the veto is a human
 *     decision once they've looked at what tripped it.
 *   - Guard A autosync (default OFF, `FANTASY_OPS_AUTOSYNC=true`) may correct
 *     an `open` gameweek's window/deadline from the SportMonks round — never a
 *     locked/scored/final row, never one whose deadline has already passed.
 *
 * Guard A (calendar) watches the current + next 2 live gameweeks against
 * SportMonks' rounds and FPL's own deadlines — the thing that catches a
 * fixture the PL moved OUT of its window, which the window-bounded fetch this
 * codebase already has (`fetchGwFixtures` in ingest.ts) is structurally blind
 * to. Guard B (facts) watches every scored gameweek against FPL's live feed —
 * the thing that catches a scoring bug before it locks into a final table.
 *
 * The actual diffing is pure and lives in ops-diff.ts (see that file's header
 * for why: `import "server-only"` throws on a plain `require()`, so nothing
 * that needs to run under `node --test` can live in this file).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchFacts } from "./values";
import { enginePool } from "./pool";
import {
  autosyncEnabled, buildAlertText, correctedFieldsFromRound, dedupeDecision, diffCalendar, diffFacts,
  fingerprint, hasLiveData, parseRounds, selectGuardAScope, shouldAutosync,
  type CalendarFinding, type FplElementMeta, type FplEvent, type FplLiveElement, type FplLiveStats,
  type GwCalRow, type OpsGuard, type OpsReport, type StoredScoreRow,
} from "./ops-diff";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, "public", any>;

// ── pagination (PostgREST caps an unbounded select at 1000 rows — see season.ts) ──
const PAGE = 1000;
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

// ── SportMonks / FPL fetchers ─────────────────────────────────────────────────

/** Own thin rounds fetcher — deliberately NOT `fetchGwFixtures` (ingest.ts),
 *  which is window-bounded and can never see a fixture that moved OUT of the
 *  window. `fixtures.participants` gives club identity for the blank/double
 *  check; build-calendar.mjs doesn't need it (it only reads kickoff times). */
export async function fetchSeasonRounds(smSeasonId: number, apiKey: string) {
  const res = await fetch(
    `https://api.sportmonks.com/v3/football/rounds/seasons/${smSeasonId}?include=fixtures;fixtures.participants&api_token=${apiKey}`,
  );
  if (!res.ok) throw new Error(`SM rounds ${res.status}`);
  return parseRounds(await res.json());
}

async function fetchFplBootstrap(): Promise<{ events: FplEvent[]; elements: Map<number, FplElementMeta> }> {
  const res = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
  if (!res.ok) throw new Error(`FPL bootstrap ${res.status}`);
  const body = (await res.json()) as {
    events?: FplEvent[];
    elements?: { id: number; selected_by_percent: string }[];
  };
  const elements = new Map(
    (body.elements ?? []).map((e) => [e.id, { id: e.id, selectedByPercent: Number(e.selected_by_percent) || 0 }]),
  );
  return { events: body.events ?? [], elements };
}

/** Null on any failure or the pre-season empty-elements response — Guard B
 *  treats both as the same safe no-op (see the feed-downtime law in season.ts;
 *  this is that same law applied to a read-only guard). */
async function fetchFplLive(gw: number): Promise<FplLiveElement[] | null> {
  try {
    const res = await fetch(`https://fantasy.premierleague.com/api/event/${gw}/live/`);
    if (!res.ok) return null;
    const body = (await res.json()) as { elements?: { id: number; stats: FplLiveStats }[] };
    const els = body.elements ?? [];
    return els.length ? els.map((e) => ({ id: e.id, stats: e.stats })) : null;
  } catch (e) {
    console.error(`[fantasy-ops] FPL live fetch failed for gw ${gw}:`, e);
    return null;
  }
}

// ── Telegram (ports scripts/tg.mjs sendMessage — no server-side TS sender exists) ──
async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_LAUNCH_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_LAUNCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) { console.error("[fantasy-ops] telegram not configured — skipping send"); return false; }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      const j = await res.json();
      if (j.ok) return true;
      if (res.status !== 429 && res.status < 500) { console.error("[fantasy-ops] telegram error:", j); return false; }
    } catch (e) {
      console.error(`[fantasy-ops] telegram send attempt ${attempt + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  console.error("[fantasy-ops] telegram send failed after retries");
  return false;
}

// ── fingerprint state (fantasy_ops_state) ─────────────────────────────────────
async function readFingerprint(db: Db, guard: OpsGuard, gw: number): Promise<string | null> {
  const { data, error } = await db.from("fantasy_ops_state")
    .select("fingerprint").eq("guard", guard).eq("gw", gw).maybeSingle();
  if (error) throw new Error(`ops state read: ${error.message}`);
  return (data as { fingerprint: string } | null)?.fingerprint ?? null;
}
async function writeFingerprint(db: Db, guard: OpsGuard, gw: number, fp: string): Promise<void> {
  const { error } = await db.from("fantasy_ops_state")
    .upsert({ guard, gw, fingerprint: fp, alerted_at: new Date().toISOString() }, { onConflict: "guard,gw" });
  if (error) throw new Error(`ops state write: ${error.message}`);
}

// ── Guard A: calendar ─────────────────────────────────────────────────────────
async function guardA(db: Db): Promise<OpsReport[]> {
  const { data, error } = await db.from("fantasy_gameweeks").select("*").eq("mode", "live");
  if (error) throw new Error(`ops guardA read: ${error.message}`);
  const scope = selectGuardAScope((data ?? []) as GwCalRow[]);
  if (!scope.length) return [];

  const key = process.env.SPORTMONKS_API_KEY;
  if (!key) throw new Error("SPORTMONKS_API_KEY not configured");

  const [roundsByGw, fpl] = await Promise.all([
    fetchSeasonRounds(scope[0].sm_season_id, key),
    fetchFplBootstrap(),
  ]);

  const allFindings = diffCalendar(scope, roundsByGw, fpl.events);
  const byGw = new Map<number, CalendarFinding[]>();
  for (const f of allFindings) byGw.set(f.gw, [...(byGw.get(f.gw) ?? []), f]);

  const autosync = autosyncEnabled(process.env.FANTASY_OPS_AUTOSYNC);
  const out: OpsReport[] = [];

  for (const gw of scope) {
    const gwFindings = byGw.get(gw.gw) ?? [];
    const prev = await readFingerprint(db, "A", gw.gw);
    const fp = fingerprint(gwFindings);
    const decision = dedupeDecision(prev, gwFindings.length, fp);

    if (decision === "alert") {
      const text = buildAlertText(
        `<b>fantasy-ops · Guard A · GW${gw.gw}</b>`,
        gwFindings.map((f) => `• [${f.type}] ${f.detail}`),
        `Fix: <code>node scripts/fantasy/build-calendar.mjs --season ${gw.sm_season_id} --apply</code>`,
      );
      const sent = await sendTelegram(text);
      if (sent) await writeFingerprint(db, "A", gw.gw, fp);
      out.push({ guard: "A", gw: gw.gw, action: "alerted", detail: `${gwFindings.length} finding(s)${sent ? "" : " (telegram failed, will retry)"}` });
    } else if (decision === "silent") {
      out.push({ guard: "A", gw: gw.gw, action: "alerted", detail: `${gwFindings.length} finding(s), unchanged since last alert` });
    } else if (decision === "clear") {
      const sent = await sendTelegram(`<b>fantasy-ops · Guard A · GW${gw.gw}</b>\nAll clear — calendar matches SportMonks/FPL again.`);
      if (sent) await writeFingerprint(db, "A", gw.gw, fp);
      out.push({ guard: "A", gw: gw.gw, action: "clear", detail: `previously alerted, now clean${sent ? "" : " (telegram failed, will retry)"}` });
    } else {
      out.push({ guard: "A", gw: gw.gw, action: "green", detail: "calendar matches" });
    }

    if (autosync) {
      const round = roundsByGw.get(gw.gw);
      if (round && shouldAutosync(gw.status, gw.deadline, Date.now())) {
        const corrected = correctedFieldsFromRound(round);
        if (corrected && (corrected.window_start !== gw.window_start
          || corrected.window_end !== gw.window_end || corrected.deadline !== gw.deadline)) {
          const { error: upErr } = await db.from("fantasy_gameweeks")
            .update(corrected).eq("gw", gw.gw).eq("status", "open");
          if (upErr) console.error(`[fantasy-ops] autosync gw ${gw.gw} failed:`, upErr.message);
        }
      }
    }
  }
  return out;
}

// ── Guard B: facts ─────────────────────────────────────────────────────────────
async function guardB(db: Db): Promise<OpsReport[]> {
  const { data, error } = await db.from("fantasy_gameweeks")
    .select("gw").eq("status", "scored").eq("mode", "live");
  if (error) throw new Error(`ops guardB read: ${error.message}`);
  const gws = ((data ?? []) as { gw: number }[]).map((r) => r.gw);
  if (!gws.length) return [];

  const posOf = new Map(enginePool().map((p) => [p.id, p.pos]));
  const poolIds = new Set(enginePool().map((p) => p.id));
  const out: OpsReport[] = [];

  for (const gw of gws) {
    const live = await fetchFplLive(gw);
    if (!hasLiveData(live)) {
      out.push({ guard: "B", gw, action: "skipped", detail: "no live data" });
      continue;
    }

    const [scoreRows, entryRows, fpl] = await Promise.all([
      pageAll<{ player_id: number; facts: MatchFacts }>(
        (from, to) => db.from("fantasy_player_scores").select("player_id, facts").eq("gw", gw).range(from, to),
        "ops guardB scores",
      ),
      pageAll<{ picks: { id: number }[] }>(
        (from, to) => db.from("fantasy_entries").select("picks").eq("gw", gw).not("locked_at", "is", null).range(from, to),
        "ops guardB entries",
      ),
      fetchFplBootstrap(),
    ]);

    const stored: StoredScoreRow[] = scoreRows.map((r) => ({ playerId: r.player_id, facts: r.facts }));
    const ownedIds = new Set<number>();
    for (const e of entryRows) for (const p of e.picks ?? []) ownedIds.add(p.id);

    const findings = diffFacts(stored, live as FplLiveElement[], poolIds, fpl.elements, posOf, ownedIds);
    const holdFindings = findings.filter((f) => f.tier === "hold");
    const prev = await readFingerprint(db, "B", gw);
    const fp = fingerprint(findings);
    const decision = dedupeDecision(prev, findings.length, fp);

    if (findings.length > 0) {
      // Only HOLD-tier findings veto finalise (goals mismatch, coverage 0-min
      // — unambiguous). ALERT-tier findings (assists/clean-sheet/minutes/dc —
      // each has known definitional slop against FPL's own numbers) still
      // page the founder but never touch the flag. Set on every red tick with
      // a hold-tier finding — idempotent, never depends on whether we're
      // about to re-send the same alert.
      if (holdFindings.length > 0) {
        const { error: holdErr } = await db.from("fantasy_gameweeks").update({ ops_hold: true }).eq("gw", gw);
        if (holdErr) throw new Error(`ops guardB hold: ${holdErr.message}`);
      }
      const action = holdFindings.length > 0 ? "held" : "alerted";

      if (decision === "alert") {
        const text = buildAlertText(
          `<b>fantasy-ops · Guard B · GW${gw}${holdFindings.length > 0 ? " — ⛔ HOLD" : " — ⚠️ FYI (no hold)"}</b>`,
          findings.map((f) => `• ${f.tier === "hold" ? "⛔ HOLD" : "⚠️ FYI"} [${f.type}] player ${f.playerId}: ${f.detail}`),
          holdFindings.length > 0 ? "finalise vetoed (ops_hold=true) until reviewed." : "no hold — founder review only.",
        );
        const sent = await sendTelegram(text);
        if (sent) await writeFingerprint(db, "B", gw, fp);
        out.push({ guard: "B", gw, action, detail: `${findings.length} finding(s) (${holdFindings.length} hold-tier)${sent ? "" : " (telegram failed, will retry)"}` });
      } else {
        out.push({ guard: "B", gw, action, detail: `${findings.length} finding(s), unchanged` });
      }
    } else if (decision === "clear") {
      const sent = await sendTelegram(
        `<b>fantasy-ops · Guard B · GW${gw}</b>\nAll clear — facts match FPL again. ops_hold is NOT auto-cleared — reset it by hand once you've verified.`,
      );
      if (sent) await writeFingerprint(db, "B", gw, fp);
      out.push({ guard: "B", gw, action: "clear", detail: `previously alerted, now clean${sent ? "" : " (telegram failed, will retry)"}` });
    } else {
      out.push({ guard: "B", gw, action: "green", detail: "facts match FPL" });
    }
  }
  return out;
}

export async function runOps(db: Db): Promise<OpsReport[]> {
  const a = await guardA(db);
  const b = await guardB(db);
  return [...a, ...b];
}
