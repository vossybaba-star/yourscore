import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Decides whether to ask this player for a rating, and records every ask that
// actually gets shown (migration 102). The decision lives here rather than in
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
// THE SCHEDULE. Keen early, backing off once someone is clearly not interested:
//
//   day 0    signs up, downloads, plays          nothing
//   day 1+   first finished Game on a RETURN     ask 1
//            visit (account at least a day old)
//   +7d      ignored                             ask 2
//   +14d     ignored                             ask 3
//   +30d     ignored                             ask 4
//   +90d     ignored, and every 90 after         ask 5, 6, ...
//   any time they tap Rate us                    never again
//
// review_prompts isn't in the generated Database type yet (types lag the
// migration), so the service client is cast the same way /api/wc-thanks does.
function service(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

// Days to wait before the Nth ask, indexed by how many they have already had.
// Past the end of the list the last value repeats, so ask 5 onwards is quarterly.
const ASK_GAP_DAYS = [7, 14, 30, 90];
// Don't ask someone on their very first day — the ask is for players who came
// back, not for a stranger mid-first-session.
const MIN_ACCOUNT_AGE_HOURS = 24;

const DAY_MS = 86_400_000;

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
    // Lifetime, not a rolling window — "they already rated" has no expiry.
    // 'download' rows are the web nudge, not a review ask: acting on one means
    // they installed the app, which must never suppress a rating ask.
    const { data: recent } = await db
      .from("review_prompts")
      .select("variant, outcome, created_at")
      .eq("user_id", user.id)
      .in("variant", ["native", "card"])
      .order("created_at", { ascending: false });

    const asks = recent ?? [];

    // Terminal: they went to the App Store off our card. Never ask again.
    if (asks.some((a) => a.outcome === "acted")) {
      return NextResponse.json({ ask: false });
    }

    const last = asks[0];
    if (last) {
      const gap = ASK_GAP_DAYS[Math.min(asks.length - 1, ASK_GAP_DAYS.length - 1)];
      if (Date.now() - Date.parse(last.created_at) < gap * DAY_MS) {
        return NextResponse.json({ ask: false });
      }
    }

    return NextResponse.json({ ask: true, variant: "card" });
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

    const { data } = await db
      .from("review_prompts")
      .insert({ user_id: user.id, surface, variant })
      .select("id")
      .maybeSingle();

    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
