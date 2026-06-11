"use client";

/**
 * /38-0/live/[code] — friend join. Claims the p2 seat in the lobby for this code
 * and redirects into the match. Fails soft (no team / full / not found) with a
 * link back. Shows inline sign-in when the user is not authenticated.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AuthProviders } from "@/components/auth/AuthButton";
import { hydrateSavedTeam, saveTeam } from "@/lib/draft/local";
import { asLeague, type Formation, type PlacedPlayer, type Projected } from "@/lib/draft/types";

export default function LiveJoin() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"joining" | "picking" | "retrying">("joining");

  useEffect(() => {
    let cancelled = false;
    const CODE = String(params.code).toUpperCase();

    async function tryJoin() {
      const res = await fetch("/api/draft/live", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", code: CODE }),
      });
      const json = await res.json().catch(() => ({ error: "Couldn't join" }));
      return json;
    }

    (async () => {
      let json = await tryJoin();
      if (cancelled) return;

      // New user with no saved team — auto-generate one so they can play immediately.
      if (json.error === "Save a team first") {
        setPhase("picking");
        const lobbyComp = asLeague(new URLSearchParams(window.location.search).get("competition"));
        const randRes = await fetch("/api/draft/team/random", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ competition: lobbyComp }),
        });
        const randData = await randRes.json().catch(() => ({}));

        if (!cancelled && randData.formation && Array.isArray(randData.squad)) {
          // Hydrate localStorage so the match/result page can display the XI.
          const localTeam = hydrateSavedTeam(
            randData.formation as Formation,
            randData.squad as PlacedPlayer[],
            lobbyComp
          );
          saveTeam({
            ...localTeam,
            projected: (randData.projected ?? null) as Projected | null,
            autoAssigned: true,
          });

          // Retry the join now that the team is saved.
          setPhase("retrying");
          json = await tryJoin();
          if (cancelled) return;
        }
      }

      if (json.error || !json.match) {
        setError(json.error ?? "Couldn't join this lobby");
        setPhase("joining");
        return;
      }
      router.replace(`/38-0/live/match/${json.match.id}`);
    })();
    return () => { cancelled = true; };
  }, [params.code, router]);

  const code = String(params.code).toUpperCase();
  const needsAuth = !!error && /sign in/i.test(error);

  return (
    <div className="min-h-[100dvh] grid place-items-center px-6" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      {error ? (
        needsAuth ? (
          /* Inline auth — user returns to this URL after sign-in and the effect
             re-runs (fresh mount from /auth/callback), auto-joining the match. */
          <div className="w-full max-w-sm">
            <div className="text-center mb-6">
              <div className="font-display tracking-wide" style={{ fontSize: 28, color: "#fff" }}>
                JOIN THE MATCH
              </div>
              <p className="font-body mt-2" style={{ fontSize: 14, color: "#8888aa" }}>
                Sign in to claim your spot in this lobby.
              </p>
            </div>
            <AuthProviders nextPath={`/38-0/live/${code}`} />
            <Link href="/38-0" className="block text-center mt-5 font-body text-sm" style={{ color: "#8888aa" }}>
              ← Back to Draft XI
            </Link>
          </div>
        ) : (
          <div className="text-center">
            <p className="font-semibold" style={{ color: "#ff7a88" }}>{error}</p>
            {/team/i.test(error) && <p className="mt-2 text-sm" style={{ color: "#9a9ab0" }}><Link href="/38-0/play" className="underline">Build your XI</Link> first, then try again.</p>}
            <Link href="/38-0/live" className="mt-5 inline-block underline text-sm" style={{ color: "#8888aa" }}>← Back to Live</Link>
          </div>
        )
      ) : (
        <div className="text-center">
          <div className="mx-auto h-10 w-10 rounded-full animate-spin" style={{ border: "3px solid rgba(0,255,135,0.25)", borderTopColor: "#00ff87" }} />
          <p className="mt-5 font-body" style={{ color: "#9a9ab0" }}>
            {phase === "picking"
              ? "Picking your team…"
              : phase === "retrying"
              ? "Joining lobby…"
              : "Joining lobby…"}
          </p>
        </div>
      )}
    </div>
  );
}
