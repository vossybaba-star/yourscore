import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
