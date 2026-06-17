import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  // Verify Resend webhook signature if secret is configured
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get("svix-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    // Svix signature verification
    const { Webhook } = await import("svix");
    const wh = new Webhook(secret);
    const body = await req.text();
    try {
      wh.verify(body, {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": signature,
      });
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const event = JSON.parse(body);
    return handleEvent(event);
  }

  const event = await req.json();
  return handleEvent(event);
}

async function handleEvent(event: { type: string; data: Record<string, unknown> }) {
  const { type, data } = event;

  if (type === "email.bounced" || type === "email.complained") {
    const email = (data.to as string[] | undefined)?.[0] ?? (data.email as string | undefined);
    if (!email) return NextResponse.json({ ok: true });

    const reason = type === "email.bounced" ? "bounce" : "complaint";
    const detail =
      type === "email.bounced"
        ? ((data.bounce_type as string | undefined) ?? null)
        : ((data.complaint_type as string | undefined) ?? null);

    await supabase.from("email_suppressions").upsert(
      { email: email.toLowerCase().trim(), reason, detail },
      { onConflict: "email", ignoreDuplicates: true }
    );

    // Delete the user account — clears all public schema data then removes the auth identity.
    const { data: userId } = await supabase.rpc("delete_bounced_user", { p_email: email });
    if (userId) {
      await supabase.auth.admin.deleteUser(userId);
    }
  }

  return NextResponse.json({ ok: true });
}
