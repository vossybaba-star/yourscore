"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Count of async challenges aimed at me that I haven't opened yet — drives the
// bottom-nav badge. Mirrors usePendingFriends.
export function usePendingTurns(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      // 1v1 challenges aimed at me, unopened.
      const h2h = sb.from("h2h_challenges")
        .select("id", { count: "exact", head: true })
        .eq("invited_user_id", uid)
        .eq("status", "awaiting_opponent")
        .eq("seen_by_opponent", false);
      // Group challenges I was invited to, not yet played or seen.
      const grp = sb.from("group_challenge_participants")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("invited", true)
        .is("score", null)
        .eq("seen", false);
      const [a, b] = await Promise.all([h2h, grp]);
      setCount((a.count ?? 0) + (b.count ?? 0));
    });
  }, []);

  return count;
}
