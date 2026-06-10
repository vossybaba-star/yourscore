import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * `getUser()` with a hard timeout, for Server Components.
 *
 * A server-side `supabase.auth.getUser()` makes a network call to Supabase Auth.
 * Under load (e.g. the World Cup launch surge) that call can hang, turning an SSR
 * render into a 25s function timeout (504). This bounds it: if Auth doesn't reply
 * within `ms`, return null and let the caller render its logged-out view rather
 * than failing the whole request.
 */
export async function getUserBounded(
  supabase: SupabaseClient<Database>,
  ms = 3000,
) {
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    return result === null ? null : result.data.user;
  } catch {
    return null;
  }
}
