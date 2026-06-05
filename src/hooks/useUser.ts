"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) { setLoading(false); return; }

    let mounted = true;

    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();

      // Fast path: read session from local storage immediately (no network).
      // This eliminates the brief null-user flicker when switching tabs.
      supabase.auth.getSession().then(({ data: sessionData }) => {
        if (mounted) {
          setUser(sessionData.session?.user ?? null);
          setLoading(false);
        }
        // Background verification with server (silently updates if token changed)
        supabase.auth.getUser().then(({ data }) => {
          if (mounted) setUser(data.user ?? null);
        });
      });

      const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
        if (mounted) setUser(session?.user ?? null);
      });

      return () => {
        mounted = false;
        listener.subscription.unsubscribe();
      };
    });

    return () => { mounted = false; };
  }, []);

  return { user, loading };
}
