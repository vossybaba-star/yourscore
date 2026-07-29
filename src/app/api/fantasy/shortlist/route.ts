import { NextRequest } from "next/server";
import { HttpError } from "@/lib/fantasy/server";
import { withFantasyUser } from "../_lib";

// Authed + founder-gated + service-role, exactly like the sibling routes.
// force-no-store so Next's data cache can't pin this per-user read to a stale
// snapshot (the CLAUDE.md Vercel-cache gotcha).
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic"; // reads auth cookies — never prerender

// GET → the user's shortlisted player ids, newest first.
// DEGRADES GRACEFULLY: before the migration is applied the table doesn't exist,
// so an "undefined_table" error reads as an empty shortlist rather than a 500 —
// the UI shows a clean empty state instead of an error card.
export async function GET() {
  return withFantasyUser("shortlist-get", async (db, userId) => {
    const { data, error } = await db
      .from("fantasy_shortlist")
      .select("player_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) {
      if (error.code === "42P01") return { ids: [] as number[] };
      throw new HttpError(500, error.message);
    }
    return { ids: (data ?? []).map((r: { player_id: number }) => r.player_id) };
  });
}

// POST { playerId } → add/upsert. Idempotent: re-starring a saved player is a
// no-op, not a duplicate-key error (primary key is (user_id, player_id)).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const playerId = Number(body.playerId);
  return withFantasyUser("shortlist-add", async (db, userId) => {
    if (!Number.isInteger(playerId)) throw new HttpError(400, "playerId required", "bad-request");
    const { error } = await db
      .from("fantasy_shortlist")
      .upsert({ user_id: userId, player_id: playerId }, { onConflict: "user_id,player_id" });
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  });
}

// DELETE { playerId } → remove (star off). No-op if it wasn't there.
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const playerId = Number(body.playerId);
  return withFantasyUser("shortlist-remove", async (db, userId) => {
    if (!Number.isInteger(playerId)) throw new HttpError(400, "playerId required", "bad-request");
    const { error } = await db
      .from("fantasy_shortlist")
      .delete()
      .eq("user_id", userId)
      .eq("player_id", playerId);
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  });
}
