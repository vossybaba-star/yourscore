import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDraftDb, validateAndScore } from "@/lib/draft/server";
import { FORMATIONS, type Formation, type PlayerSeason } from "@/lib/draft/types";
import { slotsFor } from "@/lib/draft/formations";
import { canPlay, playerIdentity } from "@/lib/draft/score";
import raw from "@/data/draft/player-seasons.json";

// POST /api/draft/team/random
//
// Generates a valid random XI, saves it to draft_teams, and returns the team
// so the client can immediately hydrate localStorage and enter a live match.
// Used when a first-time user follows an invite link and has no saved team.

const data = raw as unknown as { players: PlayerSeason[] };

export async function POST() {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Pick a formation at random from the standard set.
  const formation = FORMATIONS[
    Math.floor(Math.random() * FORMATIONS.length)
  ] as Formation;
  const slots = slotsFor(formation);

  // Shuffle the full player pool, then greedily fill each slot.
  const pool = [...data.players].sort(() => Math.random() - 0.5);
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  const squad = slots
    .map((slot) => {
      const player = pool.find(
        (p) =>
          !usedIds.has(p.id) &&
          !usedNames.has(playerIdentity(p.name)) &&
          canPlay(p.position, slot.pos)
      );
      if (!player) return null;
      usedIds.add(player.id);
      usedNames.add(playerIdentity(player.name));
      return {
        slot: slot.id,
        slotPos: slot.pos,
        player_season_id: player.id,
        name: player.name,
        club: player.club,
        season: player.season,
        overall: player.overall,
        position: player.position,
      };
    })
    .filter(Boolean);

  let validated;
  try {
    validated = validateAndScore(formation, squad);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }

  const db = createDraftDb();
  const { data: profile } = await db
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { error: saveErr } = await db.from("draft_teams").upsert(
    {
      user_id: user.id,
      display_name: profile?.display_name ?? "Player",
      formation: validated.formation,
      squad: validated.squad as unknown as never,
      strength_rating: validated.strength,
      projected: validated.projected as unknown as never,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (saveErr) {
    return NextResponse.json({ error: "Could not save team" }, { status: 500 });
  }

  return NextResponse.json({
    formation: validated.formation,
    squad: validated.squad,
    strength: validated.strength,
    projected: validated.projected,
  });
}
