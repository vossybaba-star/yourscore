"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    // Fast path: read session from localStorage immediately (no network round-trip).
    // Using a static import (not dynamic) so this runs synchronously in the first tick.
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (mounted) {
        setUser(sessionData.session?.user ?? null);
        setLoading(false);
      }
      // Background server verification — silently corrects if token was revoked.
      supabase.auth.getUser().then(({ data }) => {
        if (mounted) setUser(data.user ?? null);
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
