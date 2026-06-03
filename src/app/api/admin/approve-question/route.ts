import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/admin";

export async function POST(request: NextRequest) {
  // Admin-only — service client below bypasses RLS
  const denied = await requireAdmin();
  if (denied) return denied;

  const { questionId, approved } = await request.json();
  if (!questionId || approved === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const db = createServiceClient();
  const { error } = await db
    .from("questions")
    .update({ approved })
    .eq("id", questionId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
