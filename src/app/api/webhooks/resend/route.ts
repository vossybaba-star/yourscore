import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  // FAIL CLOSED. This endpoint runs with the service-role key, so an unsigned
  // request must never be processed. Previously, a missing RESEND_WEBHOOK_SECRET
  // silently skipped verification and turned this into an unauthenticated
  // account-mutation endpoint. If the secret is not configured, reject.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[resend webhook] RESEND_WEBHOOK_SECRET is not set — rejecting request");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = req.headers.get("svix-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const body = await req.text();
  const { Webhook } = await import("svix");
  const wh = new Webhook(secret);
  try {
    wh.verify(body, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": signature,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
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
        ? ((data.bounce_type as string | undefined) ?? (data.bounce as { type?: string } | undefined)?.type ?? null)
        : ((data.complaint_type as string | undefined) ?? null);

    // SUPPRESS-ONLY. Stop emailing this address — but never destroy the account.
    // A bounce (even a "permanent" one) or a spam complaint must not delete a
    // user's account and game history: bounces can be transient (full mailbox,
    // greylisting) and are spoofable upstream, and complaints are not deletion
    // requests. Account deletion is handled exclusively by the authenticated
    // self-serve flow (delete_user_account, gated by the signed-in user).
    await supabase.from("email_suppressions").upsert(
      { email: email.toLowerCase().trim(), reason, detail },
      { onConflict: "email", ignoreDuplicates: true }
    );
  }

  // Broadcast unsubscribe — fired when a contact clicks the Resend-managed unsubscribe link.
  // Sync to email_suppressions so transactional sends also respect it.
  if (type === "contact.unsubscribed") {
    const email = data.email as string | undefined;
    if (email) {
      await supabase.from("email_suppressions").upsert(
        { email: email.toLowerCase().trim(), reason: "unsubscribe", detail: "broadcast" },
        { onConflict: "email", ignoreDuplicates: true }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
