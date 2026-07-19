import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientPricedPool } from "@/lib/fantasy/pool";

// Must run per-request. Without this Next PRERENDERS the route at build time and
// bakes that moment's prices in forever — the exact failure the price table exists
// to prevent. The CDN still caches it for an hour via the header below, which costs
// nothing: a gameweek's prices are frozen at open anyway.
export const dynamic = "force-dynamic";
// And force-dynamic alone is NOT enough: the route re-runs, but Next still serves
// the Supabase reads inside it from its Data Cache, so this went on quoting prices
// for a gameweek that had been deleted from the database. Every other fantasy route
// sets this for the same reason.
export const fetchCache = "force-no-store";

/**
 * The pool, priced for the gameweek that's currently open.
 *
 * Prices track FPL weekly now, so this can't be the static payload it used to be:
 * the builder and the transfer screen quote money off this response, and if it
 * disagreed with what the server charges, a user would pick a squad at one price
 * and be rejected at another.
 *
 * Still cacheable — a gameweek's prices are snapshotted once at open and frozen
 * for the week, so an hour of staleness costs nothing. Shared data, no per-user
 * anything, so the cache stays public.
 */
export async function GET() {
  const db = createServiceClient();
  const { data: gws } = await db.from("fantasy_gameweeks")
    .select("gw, status, mode").order("gw", { ascending: true });
  const all = (gws ?? []) as { gw: number; status: string; mode: string }[];
  // A live season owns the pricing, so live rows win outright — mirrors currentGw()
  // in server.ts. Without this, a leftover replay gameweek sorts first and the app
  // would quote seed prices while the server charged this week's real ones.
  const live = all.filter((g) => g.mode === "live");
  const rows = live.length ? live : all;
  // The gameweek being played = the earliest one not finished. Its prices are on sale.
  const current = rows.find((g) => g.status !== "final") ?? rows[rows.length - 1];
  if (!current) return NextResponse.json({ error: "no gameweeks" }, { status: 409 });

  return NextResponse.json(await clientPricedPool(db, current.gw), {
    headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
