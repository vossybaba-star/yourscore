import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Stores the signed-in user's IANA timezone (posted by <TimezoneSync/>) so
// notification windows can be computed in their local time. Also captures the
// edge geo country as a coarse fallback. Idempotent — safe to call per session.

function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    // Throws RangeError for an unknown zone.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { tz?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!isValidTz(body.tz)) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  const country = req.headers.get("x-vercel-ip-country");
  const patch: { timezone: string; country?: string } = { timezone: body.tz };
  if (country && /^[A-Z]{2}$/.test(country)) patch.country = country;

  // timezone/country aren't in the generated Database types until migration 57
  // is applied + types regenerated — untyped handle for this update only.
  const raw = supabase as unknown as SupabaseClient;
  const { error } = await raw.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    console.error("[me/timezone] update failed:", error);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
