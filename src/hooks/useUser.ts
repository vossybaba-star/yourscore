"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return;

    let mounted = true;
    setLoading(true);

    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();

      supabase.auth.getUser().then(({ data }) => {
        if (mounted) {
          setUser(data.user);
          setLoading(false);
        }
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
