import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendTelegram, escapeTelegramHtml } from "@/lib/telegram";

/**
 * fantasy-signup-ticker — Telegram ping for every new fantasy manager.
 *
 * A "fantasy user" = a row in fantasy_squads (one row per user, created on
 * first squad build). Every 5 minutes this reads the rows created since the
 * last tick, drops seed accounts (profiles.is_seed — the cold-start managers
 * are not real signups), and sends one Telegram message naming each new
 * manager with the running total, so the latest message in the chat is always
 * the current count.
 *
 * Watermark lives in fantasy_ops_state under guard='signup-ticker', gw=0
 * (fingerprint = ISO timestamp of the newest squad seen). That table has no
 * guard constraint and the ops guards key on 'A'/'B', so this row is invisible
 * to them — reused deliberately so the ticker ships with zero migrations.
 * The watermark only advances after a successful send: a Telegram outage means
 * a repeat attempt next tick, never a silently missed signup.
 *
 * First run (no watermark): arms at "now" and sends the baseline total instead
 * of replaying the entire signup history into the chat.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const STATE_GUARD = "signup-ticker";
const STATE_GW = 0;
const BATCH_LIMIT = 100; // safety valve; overflow rolls into the next tick
const NAMES_SHOWN = 20; // per message; the rest collapse to "+N more"

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  try {
    // ── seed accounts (excluded from both the alerts and the total) ──────────
    const { data: seedRows, error: seedErr } = await db
      .from("profiles").select("id").eq("is_seed", true);
    if (seedErr) throw new Error(`seed read: ${seedErr.message}`);
    const seedIds = new Set((seedRows ?? []).map((r) => r.id));

    // ── running total: all squads minus seed-owned squads ────────────────────
    const { count: allSquads, error: cntErr } = await db
      .from("fantasy_squads").select("*", { count: "exact", head: true });
    if (cntErr) throw new Error(`total count: ${cntErr.message}`);
    let seedSquads = 0;
    if (seedIds.size) {
      const { count, error } = await db
        .from("fantasy_squads").select("*", { count: "exact", head: true })
        .in("user_id", Array.from(seedIds));
      if (error) throw new Error(`seed count: ${error.message}`);
      seedSquads = count ?? 0;
    }
    const total = (allSquads ?? 0) - seedSquads;

    // ── watermark ─────────────────────────────────────────────────────────────
    const { data: state, error: stateErr } = await db
      .from("fantasy_ops_state").select("fingerprint")
      .eq("guard", STATE_GUARD).eq("gw", STATE_GW).maybeSingle();
    if (stateErr) throw new Error(`state read: ${stateErr.message}`);

    if (!state) {
      // First run: arm at now, report the baseline, replay nothing.
      const sent = await sendTelegram(
        `📟 <b>Fantasy signup ticker armed</b>\nCurrent total: <b>${total}</b> fantasy manager${total === 1 ? "" : "s"} (seeds excluded).\nYou'll get a ping here for every new one.`,
      );
      if (sent) await writeWatermark(db, new Date().toISOString());
      return NextResponse.json({ ok: true, armed: true, total, sent });
    }

    // ── new squads since the watermark ────────────────────────────────────────
    const { data: rows, error: rowsErr } = await db
      .from("fantasy_squads").select("user_id, created_at")
      .gt("created_at", state.fingerprint)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (rowsErr) throw new Error(`squads read: ${rowsErr.message}`);
    if (!rows?.length) return NextResponse.json({ ok: true, new: 0, total });

    const fresh = rows.filter((r) => !seedIds.has(r.user_id));
    const newestSeen = rows[rows.length - 1].created_at;

    if (!fresh.length) {
      // Seed-only batch (e.g. a seed top-up) — advance silently.
      await writeWatermark(db, newestSeen);
      return NextResponse.json({ ok: true, new: 0, total, skippedSeeds: rows.length });
    }

    // ── names for the message ────────────────────────────────────────────────
    const { data: profs, error: profErr } = await db
      .from("profiles").select("id, display_name, username, country")
      .in("id", fresh.map((r) => r.user_id));
    if (profErr) throw new Error(`profiles read: ${profErr.message}`);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));

    // Each signup gets its own ordinal so the ticker reads 121, 122, 123…
    const firstOrdinal = total - fresh.length + 1;
    const lines = fresh.slice(0, NAMES_SHOWN).map((r, i) => {
      const p = byId.get(r.user_id);
      const name = escapeTelegramHtml(p?.display_name || p?.username || "Anonymous manager");
      const country = p?.country ? ` (${escapeTelegramHtml(p.country)})` : "";
      return `#${firstOrdinal + i} · ${name}${country}`;
    });
    if (fresh.length > NAMES_SHOWN) lines.push(`…+${fresh.length - NAMES_SHOWN} more`);

    const header = fresh.length === 1
      ? "⚽️ <b>New fantasy manager!</b>"
      : `⚽️ <b>${fresh.length} new fantasy managers!</b>`;
    const text = `${header}\n${lines.join("\n")}\nTotal: <b>${total}</b> fantasy managers`;

    const sent = await sendTelegram(text);
    if (sent) await writeWatermark(db, newestSeen);
    return NextResponse.json({ ok: true, new: fresh.length, total, sent });
  } catch (e) {
    console.error("[fantasy-signup-ticker] FAILED", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function writeWatermark(db: ReturnType<typeof createServiceClient>, iso: string) {
  const { error } = await db.from("fantasy_ops_state").upsert(
    { guard: STATE_GUARD, gw: STATE_GW, fingerprint: iso, alerted_at: new Date().toISOString() },
    { onConflict: "guard,gw" },
  );
  if (error) throw new Error(`state write: ${error.message}`);
}
