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
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      // 1v1 challenges aimed at me, unopened. (Group challenges retired from the UI.)
      sb.from("h2h_challenges")
        .select("id", { count: "exact", head: true })
        .eq("invited_user_id", uid)
        .eq("status", "awaiting_opponent")
        .eq("seen_by_opponent", false)
        .then(({ count: c }: { count: number | null }) => setCount(c ?? 0));
    });
  }, []);

  return count;
}
