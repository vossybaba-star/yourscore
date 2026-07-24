import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Decides whether to ask this player for a rating, and records every ask that
// actually gets shown (migration 104). The decision lives here rather than in
// localStorage because a device stamp is invisible to us and resets on every
// reinstall — we could not previously count our own asks.
//
// ONCE THEY RATE, WE STOP FOREVER. That is the whole point of this file, and
// it is the reason we ask on our own card rather than through Apple's native
// star popup. Apple never tells us anyone rated: no callback, no API, no field
// on the app record. A player who rates inside the native popup is invisible to
// us and would go on being asked forever. A player who taps through our card is
// not — we record outcome 'acted' and never ask again, lifetime, no expiry.
//
// The trade is deliberate. The native popup converts better because rating
// happens inline in two taps, but it is unobservable and Apple caps it at three
// per user per year. We chose the surface we can actually honour a promise on.
//
// THE SCHEDULE IS COUNTED IN GAMES PLAYED, NOT DAYS. Somebody who opens the
// app twice a week and somebody who plays ten Games a night should not be on
// the same clock; the second has seen far more of the product and has far more
// to say about it. Games come from player_game_counts (migration 105), which
// this route increments on each game-end screen and which was seeded from every
// existing play record so a veteran is not treated as new.
//
//   game 3    ask 1   (and account at least a day old, so it lands on a return
//                      visit rather than mid first session)
//   game 6    ask 2
//   game 10   ask 3
//   game 15   ask 4
//   game 21   ask 5, then 28, 36, 45, 55 ...
//   taps Rate us        never again
//
// The gap widens by one Game each time: 3, then 4, then 5, then 6. Somebody
// who has ignored ten asks is down to one every twelve Games, which backs off
// on its own without a special case for it.
//
// Gaps are measured from the play count AT the previous ask, not cumulative
// totals. Cumulative would misfire for every seeded veteran: a player sitting
// on 500 Games clears every threshold at once and would take the whole run of
// asks back to back.
//
// review_prompts isn't in the generated Database type yet (types lag the
// migration), so the service client is cast the same way /api/wc-thanks does.
function service(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

// Service-role reads in a route handler get pinned by Vercel's data cache on a
// constant key, which would freeze one player's answer and serve it to everyone
// forever. Per-user and side-effecting: never cache it.
export const fetchCache = "force-no-store";

// Games before the FIRST ask.
const MIN_GAMES = 3;
// Games since the previous ask. It widens by one each time, so asks land on
// Games 3, 6, 10, 15, 21, 28 and so on.
const askGapGames = (priorAsks: number) => priorAsks + 2;
// Don't ask someone on their very first day — the ask is for players who came
// back, not for a stranger mid-first-session.
const MIN_ACCOUNT_AGE_HOURS = 24;

export async function GET() {
  try {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ ask: false });

    // A returning player, not a first-session one. auth.users.created_at is the
    // signup moment and needs no extra query.
    const age = Date.now() - Date.parse(user.created_at);
    if (!(age >= MIN_ACCOUNT_AGE_HOURS * 3_600_000)) {
      return NextResponse.json({ ask: false });
    }

    const db = service();

    // This request IS a finished Game: the card only mounts on a game-end
    // screen. Count it first, then decide, so the count is never behind.
    const { data: counted } = await db
      .rpc("bump_player_games", { p_user: user.id })
      .single<number>();
    const games = counted ?? 0;

    // Lifetime, not a rolling window — "they already rated" has no expiry.
    // 'download' rows are the web nudge, not a review ask: acting on one means
    // they installed the app, which must never suppress a rating ask.
    const { data: recent } = await db
      .from("review_prompts")
      .select("variant, outcome, created_at, games_at")
      .eq("user_id", user.id)
      .in("variant", ["native", "card"])
      .order("created_at", { ascending: false });

    const asks = recent ?? [];

    // Terminal: they went to the App Store off our card. Never ask again.
    if (asks.some((a) => a.outcome === "acted")) {
      return NextResponse.json({ ask: false });
    }

    const last = asks[0];
    if (!last) {
      // Never asked: the only bar is having played enough to have a view.
      return NextResponse.json({ ask: games >= MIN_GAMES, variant: "card" });
    }

    const gap = askGapGames(asks.length);
    // games_at is null for rows written before migration 105 (the WC backfill).
    // Treating those as "asked at their current count" is the cautious read: it
    // waits a full gap rather than firing immediately on deploy.
    const since = games - (last.games_at ?? games);
    return NextResponse.json({ ask: since >= gap, variant: "card" });
  } catch {
    // Never let a broken prompt break a game-end screen.
    return NextResponse.json({ ask: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ ok: false }, { status: 403 });

    const body = (await req.json()) as {
      surface?: string;
      variant?: string;
      outcome?: string;
      id?: string;
    };

    const db = service();

    // Second call for the same ask: stamp how they responded.
    if (body.id) {
      if (body.outcome !== "acted" && body.outcome !== "dismissed") {
        return NextResponse.json({ ok: false }, { status: 400 });
      }
      await db
        .from("review_prompts")
        .update({ outcome: body.outcome })
        .eq("id", body.id)
        .eq("user_id", user.id);
      return NextResponse.json({ ok: true });
    }

    const surface = body.surface ?? "post-game";
    const variant = body.variant;
    if (!["native", "card", "download"].includes(variant ?? "")) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Stamp the play count at the moment of asking — the schedule is measured
    // in Games since the previous ask, so this is what the next one reads.
    const { data: gc } = await db
      .from("player_game_counts")
      .select("games")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data } = await db
      .from("review_prompts")
      .insert({ user_id: user.id, surface, variant, games_at: gc?.games ?? 0 })
      .select("id")
      .maybeSingle();

    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
