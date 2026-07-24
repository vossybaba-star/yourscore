import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Decides whether to ask this player for a rating, and records every ask that
// actually gets shown (migration 102). The decision lives here rather than in
// localStorage because a device stamp is invisible to us and resets on every
// reinstall — we could not previously count our own asks.
//
// Two limits, for two different reasons:
//
//   NATIVE_CAP_PER_YEAR — Apple's, not ours. SKStoreReviewController shows at
//     most 3 popups per user per 365 days and silently does nothing beyond
//     that: no popup, no error, no way to detect it. So past 3 we stop asking
//     for the popup and serve the soft card instead, which has no such cap.
//     Without this we would log "asked" for prompts Apple never drew.
//
//   COOLDOWN_DAYS — ours. How often any ask may reappear.
//
// review_prompts isn't in the generated Database type yet (types lag the
// migration), so the service client is cast the same way /api/wc-thanks does.
function service(): SupabaseClient {
  return createServiceClient() as unknown as SupabaseClient;
}

const NATIVE_CAP_PER_YEAR = 3;
const COOLDOWN_DAYS = 14;
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
    const { data: recent } = await db
      .from("review_prompts")
      .select("variant, created_at")
      .eq("user_id", user.id)
      .in("variant", ["native", "card"])
      .gte("created_at", new Date(Date.now() - 365 * DAY_MS).toISOString())
      .order("created_at", { ascending: false });

    const asks = recent ?? [];

    const last = asks[0];
    if (last && Date.now() - Date.parse(last.created_at) < COOLDOWN_DAYS * DAY_MS) {
      return NextResponse.json({ ask: false });
    }

    const nativeThisYear = asks.filter((a) => a.variant === "native").length;
    return NextResponse.json({
      ask: true,
      variant: nativeThisYear < NATIVE_CAP_PER_YEAR ? "native" : "card",
    });
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
