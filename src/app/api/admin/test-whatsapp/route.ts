import { NextRequest, NextResponse } from "next/server";
import { sendQuestionAlert } from "@/lib/whatsapp";
import { requireAdmin } from "@/lib/auth/admin";

export async function POST(request: NextRequest) {
  // Admin-only — sends real WhatsApp messages; was previously unauthenticated
  const denied = await requireAdmin();
  if (denied) return denied;

  const { to } = await request.json();
  if (!to) return NextResponse.json({ error: "Missing 'to' number" }, { status: 400 });

  const result = await sendQuestionAlert(to, {
    roomName: "The Lads' Room",
    questionText: "How many World Cup goals has Kylian Mbappé scored for France?",
    durationSeconds: 45,
    roomUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3003"}/room/mock-room-id`,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
