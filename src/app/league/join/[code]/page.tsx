/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";

function JoinLeagueInner({ code }: { code: string }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const [league, setLeague] = useState<{ id: string; name: string; description: string | null; member_count: number } | null>(null);
  const [fetching, setFetching] = useState(true);
  const [joining, setJoining] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    const sb = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb as any).from("leagues").select("id, name, description").eq("code", code.toUpperCase()).single()
      .then(async ({ data }: { data: any }) => {
        if (!data) { setFetching(false); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count } = await (sb as any).from("league_members").select("*", { count: "exact", head: true }).eq("league_id", data.id);
        setLeague({ ...data, member_count: count ?? 0 });

        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: membership } = await (sb as any).from("league_members").select("user_id").eq("league_id", data.id).eq("user_id", user.id).single();
          if (membership) setAlreadyMember(true);
        }
        setFetching(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user?.id]);

  async function handleJoin() {
    if (!league || !user) return;
    setJoining(true);
    try {
      const sb = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any).from("league_members").upsert({ league_id: league.id, user_id: user.id }, { onConflict: "league_id,user_id", ignoreDuplicates: true });
      router.push(`/league/${league.id}`);
    } catch (e) {
      console.error(e);
      setJoining(false);
    }
  }

  if (loading || fetching) return (
    <div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>
  );

  return (
    <main className="min-h-dvh bg-bg">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
      <div className="fixed top-0 left-0 w-[500px] h-[500px] pointer-events-none" style={{ background: "radial-gradient(circle at 0% 0%, rgba(167,139,250,0.06) 0%, transparent 60%)" }} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-2xl mx-auto">
        <Link href="/" className="font-display text-2xl text-white tracking-wider hover:opacity-80">YOURSCORE</Link>
      </nav>

      <div className="relative z-10 max-w-sm mx-auto px-6 pt-8">
        {!league ? (
          <div className="text-center">
            <p className="font-display text-5xl mb-4">🤔</p>
            <h1 className="font-display text-3xl text-white mb-3">League not found</h1>
            <p className="font-body text-text-muted text-sm mb-6">The code <span className="text-white font-semibold">{code.toUpperCase()}</span> doesn&apos;t match any league.</p>
            <Link href="/" className="font-body text-sm text-text-muted hover:text-white transition-colors">← Back to home</Link>
            <Link href="/league/join" className="font-body text-sm font-semibold" style={{ color: "#a78bfa" }}>Try a different code →</Link>
          </div>
        ) : alreadyMember ? (
          <div className="text-center">
            <p className="font-display text-5xl mb-4">✅</p>
            <h1 className="font-display text-3xl text-white mb-3">Already in this league</h1>
            <p className="font-body text-text-muted text-sm mb-6">You&apos;re already a member of <span className="text-white font-semibold">{league.name}</span>.</p>
            <Link href={`/league/${league.id}`}
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl font-body font-bold text-base"
              style={{ background: "#a78bfa", color: "#0a0a0f" }}>
              Go to league →
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 font-body text-xs uppercase tracking-widest"
                style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
                You&apos;ve been invited
              </div>
              <h1 className="font-display text-5xl text-white mb-2">{league.name}</h1>
              {league.description && <p className="font-body text-text-muted text-sm">{league.description}</p>}
              <p className="font-body text-xs text-text-muted mt-3">{league.member_count} {league.member_count === 1 ? "member" : "members"}</p>
            </div>

            <div className="rounded-2xl p-4 mb-6" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.12)" }}>
              <p className="font-body text-xs font-semibold mb-2" style={{ color: "#a78bfa" }}>What you&apos;re joining</p>
              <div className="space-y-2">
                {[
                  "Your points stack across every match you play",
                  "See all members live games as they happen",
                  "Compete across World Cup, Euros, Champions League",
                ].map(t => (
                  <div key={t} className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0" style={{ color: "#a78bfa" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <p className="font-body text-xs text-text-muted">{t}</p>
                  </div>
                ))}
              </div>
            </div>

            {!user ? (
              <div className="rounded-2xl p-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-body text-sm text-white font-medium mb-1">Sign in to join</p>
                <p className="font-body text-xs text-text-muted mb-4">Your score tracks across every game you play. Free. 10 seconds.</p>
                <SignInWithGoogle redirectTo={`/league/join/${code}`} />
              </div>
            ) : (
              !joining ? (
                <button
                  onClick={handleJoin}
                  className="w-full py-4 rounded-xl font-body font-bold text-base transition-all"
                  style={{ background: "#a78bfa", color: "#0a0a0f", boxShadow: "0 0 20px rgba(167,139,250,0.25)" }}>
                  Join {league.name} →
                </button>
              ) : (
                <div className="w-full py-4 rounded-xl flex items-center justify-center gap-3"
                  style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)" }}>
                  <Spinner size={18} />
                  <span className="font-body text-sm text-white/70">Joining {league.name}…</span>
                </div>
              )
            )}
          </>
        )}
      </div>
    </main>
  );
}

export default function JoinLeaguePage({ params }: { params: { code: string } }) {
  return <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}><JoinLeagueInner code={params.code} /></Suspense>;
}
