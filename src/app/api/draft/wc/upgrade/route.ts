import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { rowToRun, validateNationLocked, createWcDb } from "@/lib/draft/wc-server";

// Spend one upgrade pick: replace a slot with another player FROM THE SAME NATION.
// Allowed only while the run is active and has upgrades left. Re-validates the whole
// XI (fit, no duplicate, nation-locked) and recomputes Strength server-side.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-upgrade:${user.id}`, 60, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { runId?: string; slotId?: string; newPlayerId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const runId = String(body.runId ?? "");
  const slotId = String(body.slotId ?? "");
  const newPlayerId = String(body.newPlayerId ?? "");

  const db = createWcDb();
  const { data: row } = await db.from("draft_wc_runs").select("*").eq("id", runId).eq("user_id", user.id).single();
  if (!row) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const run = rowToRun(row);
  if (run.status !== "active") return NextResponse.json({ error: "Run is over" }, { status: 400 });
  if (run.upgrades_left <= 0) return NextResponse.json({ error: "No upgrades left" }, { status: 400 });
  if (!run.squad.some((p) => p.slot === slotId)) return NextResponse.json({ error: "Unknown slot" }, { status: 400 });

  // Swap the chosen slot's player; re-validate the full XI (also enforces nation-lock).
  const squadInput = run.squad.map((p) => ({
    slot: p.slot,
    player_season_id: p.slot === slotId ? newPlayerId : p.player_season_id,
  }));
  let team;
  try {
    team = validateNationLocked(run.formation, squadInput, run.nation);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid upgrade" }, { status: 400 });
  }

  const { error } = await db
    .from("draft_wc_runs")
    .update({ squad: team.squad, strength: team.strength, upgrades_left: run.upgrades_left - 1, updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not apply upgrade" }, { status: 500 });

  return NextResponse.json({ squad: team.squad, strength: team.strength, upgrades_left: run.upgrades_left - 1 });
}
