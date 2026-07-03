import { NextResponse } from "next/server";
import { getReadyPlayers } from "@/lib/versus/activity";

// "People ready to play" — suggested opponents for the Versus Play tab: open
// public-Lobby hosts (deep-joinable) + recently-ranked players. Shared list;
// the client filters out self/friends. Edge-cached like the activity strip.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
};

export async function GET() {
  try {
    const players = await getReadyPlayers();
    return NextResponse.json({ players }, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json({ players: [] });
  }
}
