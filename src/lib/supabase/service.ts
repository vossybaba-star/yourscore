import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Service role client — bypasses RLS. Server-side admin operations only.
// Never import this in client components or expose to the browser.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase service role env vars");
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
