import { NextResponse } from "next/server";
import { clientPool } from "@/lib/fantasy/pool";

// Shared static data — edge-cache it (per-user data never flows through here).
export async function GET() {
  return NextResponse.json(clientPool(), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
