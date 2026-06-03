import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Guards an /api/admin/* route. Returns null when the caller is an
 * authenticated admin, otherwise a NextResponse (401/403) to return early.
 *
 * This is required because the admin routes write via the service-role
 * client, which bypasses RLS — so the DB-level admin rule
 * (`raw_app_meta_data->>'is_admin' = 'true'`, see supabase/schema.sql)
 * never runs. We re-check it here in application code.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Use app_metadata (service-role-only, NOT user-editable) — user_metadata can
  // be self-set by any client via supabase.auth.updateUser({ data: {...} }).
  if (user.app_metadata?.is_admin !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
