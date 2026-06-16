import { NextRequest, NextResponse } from "next/server";
import { createWcDb } from "@/lib/draft/wc-server";
import { WC_SEASON_START, WC_SEASON_END } from "@/lib/draft/wc";

// A player's World Cup Daily ranked-run history (for the board drill-down): every day's
// draft (squad + result + match breakdown) in the WC2026 window. Public read via the
// get_wc_player_history definer RPC; fails soft to an empty list so the page never errors.

export const revalidate = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const user = new URL(req.url).searchParams.get("user") ?? "";
  if (!UUID_RE.test(user)) return NextResponse.json({ runs: [], ready: true });
  try {
    const db = createWcDb();
    const { data, error } = await db.rpc("get_wc_player_history", {
      p_user: user,
      p_start: WC_SEASON_START,
      p_end: WC_SEASON_END,
    });
    if (error) return NextResponse.json({ runs: [], ready: false });
    return NextResponse.json({ runs: data ?? [], ready: true });
  } catch {
    return NextResponse.json({ runs: [], ready: false });
  }
}
