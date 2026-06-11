import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { validateNationLocked, validateWorld, newRunPlan, createWcDb, WORLD_TEAM_NAME } from "@/lib/draft/wc-server";

// Start a World Cup Run: validate a nation-locked XI, plan the bracket (deterministic
// by a server seed), and create the run row. Server-authoritative — Strength is
// recomputed and every player is checked to be eligible for the chosen nation.

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to play" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-wc-start:${user.id}`, 20, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { action?: string; mode?: string; nation?: string; formation?: unknown; squad?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (body.action !== "start") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const mode = body.mode === "world" ? "world" : "nation";
  // nation mode: locked to one nation; world mode: open draft, stored under "World XI".
  const nation = mode === "world" ? WORLD_TEAM_NAME : String(body.nation ?? "");
  let team;
  try {
    team = mode === "world"
      ? validateWorld(body.formation, body.squad)
      : validateNationLocked(body.formation, body.squad, nation);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid team" }, { status: 400 });
  }

  const seed = crypto.randomUUID();
  const plan = newRunPlan(mode, nation, seed);

  const db = createWcDb();
  const { data, error } = await db
    .from("draft_wc_runs")
    .insert({
      user_id: user.id,
      mode,
      nation,
      seed,
      status: "active",
      stage: "group",
      stage_index: 0,
      formation: team.formation,
      squad: team.squad,
      strength: team.strength,
      plan,
      group_played: 0,
      group_points: 0,
      upgrades_left: 0,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not start run" }, { status: 500 });
  return NextResponse.json({ runId: data.id, nation, strength: team.strength, plan });
}
