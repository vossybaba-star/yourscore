import { NextRequest } from "next/server";
import { playChip, removeChip } from "@/lib/fantasy/server";
import type { Chip } from "@/lib/fantasy/engine";
import { tryEmitFeedEvent } from "@/lib/fantasy/feed";
import { withFantasyUser } from "../_lib";

export const fetchCache = "force-no-store";

// POST { chip } plays it; DELETE un-plays whatever's played this gameweek.
// playChip validates the chip name itself (400 unknown-chip) — no need to
// duplicate that check here.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const chip = body.chip as Chip;
  return withFantasyUser("chip", async (db, userId) => {
    const result = await playChip(db, userId, chip);
    await tryEmitFeedEvent(db, userId, "chip", null, { chip });
    return result;
  });
}

export async function DELETE() {
  return withFantasyUser("chip", (db, userId) => removeChip(db, userId));
}
