import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const fetchCache = "force-no-store";

// Persist a new user's first-touch acquisition source onto their profile.
// Called by SignupPixel right after registration. First-touch only — it fills
// the columns solely when `source` is still null, and only for the authed user.
export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    source?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    referrer?: string;
    device_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clip = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 255) : null);
  const patch = {
    source: clip(body.source),
    utm_source: clip(body.utm_source),
    utm_medium: clip(body.utm_medium),
    utm_campaign: clip(body.utm_campaign),
    referrer: clip(body.referrer),
  };
  const deviceId = clip(body.device_id);
  const hasSource = patch.source || patch.utm_source || patch.referrer;
  if (!hasSource && !deviceId) {
    return NextResponse.json({ ok: true, skipped: "no signal" });
  }

  const db = createServiceClient();

  // First-touch acquisition source — written only while `source` is still null.
  if (hasSource) {
    const { error } = await db
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .is("source", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Durable device id — written once, never overwritten, so it stably links this
  // account to the device (and its guest activity). Independent of the source above.
  if (deviceId) {
    const { error } = await db
      .from("profiles")
      .update({ device_id: deviceId })
      .eq("id", user.id)
      .is("device_id", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
