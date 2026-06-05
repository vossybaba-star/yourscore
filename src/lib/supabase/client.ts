import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Module-level singleton. createBrowserClient is designed to be created once and
// reused — each instance spins up its own GoTrueClient (auth listener + token
// refresh timer), so re-creating it on every call (this was called 60+ times,
// often inside useEffect) wastes resources and can cause multiple auth clients
// to fight over the same session / desync from the realtime socket.
let browserClient: SupabaseClient<Database> | undefined;

export function createClient(): SupabaseClient<Database> {
  return (browserClient ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ));
}
