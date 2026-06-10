"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Returns the number of incoming (pending) friend requests for the
 * currently authenticated user.
 *
 * Returns 0 when the user is not logged in or requests are still loading.
 * Refreshes automatically when the component mounts.
 */
export function usePendingFriends(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;

      sb.from("friendships")
        .select("id", { count: "exact", head: true })
        .eq("friend_id", uid)
        .eq("status", "pending")
        .then(({ count: c }: { count: number | null }) => {
          setCount(c ?? 0);
        });
    });
  }, []);

  return count;
}
