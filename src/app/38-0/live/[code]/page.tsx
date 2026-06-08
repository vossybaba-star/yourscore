"use client";

/**
 * /38-0/live/[code] — friend join. Claims the p2 seat in the lobby for this code
 * and redirects into the match. Fails soft (no team / full / not found) with a
 * link back.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function LiveJoin() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/draft/live", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", code: String(params.code).toUpperCase() }),
      });
      const json = await res.json().catch(() => ({ error: "Couldn't join" }));
      if (cancelled) return;
      if (json.error || !json.match) { setError(json.error ?? "Couldn't join this lobby"); return; }
      router.replace(`/38-0/live/match/${json.match.id}`);
    })();
    return () => { cancelled = true; };
  }, [params.code, router]);

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      {error ? (
        <div className="text-center">
          <p className="font-semibold" style={{ color: "#ff7a88" }}>{error}</p>
          {/team/i.test(error) && <p className="mt-2 text-sm" style={{ color: "#9a9ab0" }}><Link href="/38-0/play" className="underline">Build your XI</Link> first, then try again.</p>}
          <Link href="/38-0/live" className="mt-5 inline-block underline text-sm" style={{ color: "#8888aa" }}>← Back to Live</Link>
        </div>
      ) : (
        <div className="text-center">
          <div className="mx-auto h-10 w-10 rounded-full animate-spin" style={{ border: "3px solid rgba(0,255,135,0.25)", borderTopColor: "#00ff87" }} />
          <p className="mt-5" style={{ color: "#9a9ab0" }}>Joining lobby…</p>
        </div>
      )}
    </div>
  );
}
