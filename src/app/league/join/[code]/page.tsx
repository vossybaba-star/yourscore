"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";
import { GridBackground } from "@/components/ui/GridBackground";
import { Button } from "@/components/ui/Button";
import { afLeagueJoin } from "@/lib/analytics/appsflyerEvents";

const ANIM = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulseGlow {
    0%,100% { box-shadow: 0 0 28px rgba(174,234,0,0.35), 0 0 60px rgba(174,234,0,0.1); }
    50%      { box-shadow: 0 0 48px rgba(174,234,0,0.6),  0 0 90px rgba(174,234,0,0.22); }
  }
  @keyframes floatBadge {
    0%,100% { transform: translateY(0px); }
    50%      { transform: translateY(-5px); }
  }
  .fade-1 { animation: fadeUp 0.5s ease-out 0.05s both; }
  .fade-2 { animation: fadeUp 0.5s ease-out 0.15s both; }
  .fade-3 { animation: fadeUp 0.5s ease-out 0.25s both; }
  .fade-4 { animation: fadeUp 0.5s ease-out 0.35s both; }
  .fade-5 { animation: fadeUp 0.5s ease-out 0.45s both; }
  .fade-6 { animation: fadeUp 0.5s ease-out 0.55s both; }
  .pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
  .float-badge { animation: floatBadge 4s ease-in-out infinite; }
`;

type TableMember = { user_id: string; display_name: string; total_score: number };

function LeagueTablePreview({ members, leagueName }: { members: TableMember[]; leagueName: string }) {
  const MEDALS = ["🥇", "🥈", "🥉"];
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0e1611", border: "1px solid rgba(174,234,0,0.18)" }}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ background: "rgba(174,234,0,0.06)", borderBottom: "1px solid rgba(174,234,0,0.12)" }}>
        <div className="flex items-center gap-2">
          <span className="text-sm">🏆</span>
          <span className="font-display text-sm text-white tracking-wide">{leagueName}</span>
        </div>
        <span className="font-body text-xs" style={{ color: "#8a948f" }}>LIVE TABLE</span>
      </div>

      {/* Rows */}
      {members.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="font-body text-sm" style={{ color: "#586058" }}>No scores yet — be the first!</p>
        </div>
      ) : (
        members.map((m, i) => (
          <div key={m.user_id}
            className="flex items-center gap-3 px-4 py-3 transition-colors"
            style={{
              borderBottom: i < members.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              background: i === 0 ? "rgba(174,234,0,0.04)" : "transparent",
            }}>
            {/* Rank */}
            <span className="text-base w-6 text-center flex-shrink-0">
              {i < 3 ? MEDALS[i] : <span className="font-display text-sm" style={{ color: "#586058" }}>{i + 1}</span>}
            </span>
            {/* Avatar initial */}
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-body font-bold text-xs"
              style={{ background: "rgba(174,234,0,0.15)", color: "#aeea00" }}>
              {(m.display_name || "?")[0].toUpperCase()}
            </div>
            {/* Name */}
            <span className="font-body text-sm text-white flex-1 truncate">{m.display_name}</span>
            {/* Score */}
            <span className="font-display text-sm flex-shrink-0" style={{ color: m.total_score > 0 ? "#aeea00" : "#3a423d" }}>
              {m.total_score > 0 ? m.total_score.toLocaleString() : "—"}
            </span>
          </div>
        ))
      )}

      {/* "You" placeholder row */}
      <div className="flex items-center gap-3 px-4 py-3"
        style={{ borderTop: "1px solid rgba(174,234,0,0.12)", background: "rgba(174,234,0,0.03)" }}>
        <span className="text-base w-6 text-center flex-shrink-0">
          <span className="font-display text-sm" style={{ color: "#aeea00" }}>{members.length + 1}</span>
        </span>
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 font-body font-bold text-xs"
          style={{ background: "rgba(174,234,0,0.1)", color: "#aeea00", border: "1px dashed rgba(174,234,0,0.3)" }}>
          ?
        </div>
        <span className="font-body text-sm italic" style={{ color: "#aeea00" }}>You — join to start scoring</span>
        <span className="font-display text-sm flex-shrink-0" style={{ color: "#3a423d" }}>—</span>
      </div>
    </div>
  );
}

function JoinLeagueInner({ code }: { code: string }) {
  const { user, loading } = useUser();
  const router = useRouter();
  const [league, setLeague] = useState<{
    id: string; name: string; description: string | null; member_count: number;
  } | null>(null);
  const [tableMembers, setTableMembers] = useState<TableMember[]>([]);
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [joining, setJoining] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    const sb = createClient();
    sb.from("leagues").select("id, name, description, created_by").eq("code", code.toUpperCase()).single()
      .then(async ({ data }) => {
        if (!data) { setFetching(false); return; }
        const { count } = await sb.from("league_members")
          .select("*", { count: "exact", head: true }).eq("league_id", data.id);
        setLeague({
          id: data.id,
          name: data.name,
          description: data.description,
          member_count: count ?? 0,
        });

        // Creator name for invite pill
        if (data.created_by) {
          const { data: creator } = await sb
            .from("profiles").select("display_name").eq("id", data.created_by).single();
          if (creator?.display_name) setInviterName(creator.display_name);
        }

        // Top 5 members — two-step (no FK join between league_members and profiles)
        const { data: members } = await sb
          .from("league_members")
          .select("user_id, total_score, joined_at")
          .eq("league_id", data.id)
          .order("total_score", { ascending: false, nullsFirst: false })
          .order("joined_at", { ascending: true })
          .limit(5);
        if (members && members.length > 0) {
          const uids = members.map((m) => m.user_id);
          const { data: profileRows } = await sb
            .from("profiles")
            .select("id, display_name")
            .in("id", uids);
          const nameMap: Record<string, string> = {};
          (profileRows ?? []).forEach((p) => { nameMap[p.id] = p.display_name ?? "Player"; });
          setTableMembers(members.map((m) => ({
            user_id: m.user_id,
            display_name: nameMap[m.user_id] ?? "Player",
            total_score: m.total_score ?? 0,
          })));
        }

        if (user) {
          const { data: mem } = await sb.from("league_members")
            .select("user_id").eq("league_id", data.id).eq("user_id", user.id).single();
          if (mem) setAlreadyMember(true);
        }
        setFetching(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user?.id]);

  // Auto-join once user + league loaded
  useEffect(() => {
    if (user && league && !alreadyMember && !joining && !fetching) handleJoin();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, league?.id, alreadyMember, fetching]);

  async function handleJoin() {
    if (!league || !user) return;
    setJoining(true);
    try {
      const sb = createClient();
      await sb.from("league_members")
        .upsert({ league_id: league.id, user_id: user.id }, { onConflict: "league_id,user_id", ignoreDuplicates: true });
      // Fire-and-forget: lifecycle email — server handles invite + first-member-joins logic.
      void fetch("/api/email/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "league_joined", data: { leagueId: league.id } }),
      }).catch(() => {});
      afLeagueJoin({ leagueType: "general" });
      router.push(`/league/${league.id}`);
    } catch (e) {
      console.error(e);
      setJoining(false);
    }
  }

  if (loading || fetching) return (
    <div className="min-h-dvh flex items-center justify-center bg-bg">
      <Spinner size={32} />
    </div>
  );

  if (alreadyMember && league) {
    router.push(`/league/${league.id}`);
    return <div className="min-h-dvh flex items-center justify-center bg-bg"><Spinner size={32} /></div>;
  }

  if (joining && league) return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-bg">
      <Spinner size={36} />
      <p className="font-body text-sm text-text-muted">Joining {league.name}…</p>
    </div>
  );

  if (!league) return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 text-center bg-bg">
      <p className="font-display text-6xl mb-4">🤔</p>
      <h1 className="font-display text-3xl text-white mb-3">League not found</h1>
      <p className="font-body text-sm mb-6 text-text-muted">
        The code <span className="text-white font-semibold">{code.toUpperCase()}</span> doesn&apos;t match any league.
      </p>
      <div className="flex gap-4">
        <Link href="/" className="font-body text-sm text-text-muted">← Home</Link>
        <Link href="/league/join" className="font-body text-sm font-semibold" style={{ color: "#aeea00" }}>Try a different code →</Link>
      </div>
    </div>
  );

  // ── CTA card (reused in two places) ────────────────────────────────────────
  const CtaCard = () => !user ? (
    <div className="rounded-2xl p-6 pulse-glow w-full"
      style={{ background: "linear-gradient(135deg, rgba(174,234,0,0.12) 0%, rgba(10,10,15,0.95) 100%)", border: "1px solid rgba(174,234,0,0.28)" }}>
      <p className="font-display text-xl text-white mb-1">ACCEPT YOUR INVITE</p>
      <p className="font-body text-sm mb-5 text-text-muted">Free forever — takes 10 seconds.</p>
      <SignInWithGoogle redirectTo={`/league/join/${code}`} />
      <p className="font-body text-xs text-center mt-3" style={{ color: "#3a423d" }}>No credit card. No spam. Just football.</p>
    </div>
  ) : (
    <Button onClick={handleJoin} variant="primary" tone="lime" size="lg" fullWidth>
      JOIN {league.name.toUpperCase()} →
    </Button>
  );

  return (
    <main className="min-h-dvh bg-bg">
      <style>{ANIM}</style>

      {/* Background */}
      <GridBackground opacity={0.022} />
      <div className="fixed top-0 left-0 w-[700px] h-[700px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 0% 0%, rgba(174,234,0,0.09) 0%, transparent 60%)" }} />
      <div className="fixed top-0 right-0 w-[500px] h-[500px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 0%, rgba(174,234,0,0.04) 0%, transparent 60%)" }} />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] pointer-events-none"
        style={{ background: "radial-gradient(circle at 100% 100%, rgba(174,234,0,0.05) 0%, transparent 60%)" }} />

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="relative z-10 pt-safe flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
        </Link>
        <Link href="/auth/sign-in"
          className="font-body text-sm px-4 py-2 rounded-lg transition-opacity hover:opacity-80 text-text-muted border border-border">
          Sign in
        </Link>
      </nav>

      {/* ── Hero (2-col desktop) ──────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-16 lg:pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">

          {/* LEFT — invite copy */}
          <div>
            {/* Invite pill */}
            <div className="fade-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6 font-body text-xs uppercase tracking-widest float-badge"
              style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9l-3 1.5.5-3.5L1 4.5l3.5-.5L6 1z" fill="#aeea00" />
              </svg>
              {inviterName ? `You've been invited by ${inviterName}` : "You've been invited"}
            </div>

            {/* League name */}
            <h1 className="fade-2 font-display text-white mb-4"
              style={{ fontSize: "clamp(3rem, 7vw, 5.5rem)", lineHeight: 0.95, letterSpacing: "-0.01em" }}>
              JOIN<br />
              <span style={{ color: "#aeea00" }}>{league.name.toUpperCase()}</span>
            </h1>

            {/* Description */}
            {league.description && (
              <p className="fade-3 font-body text-base mb-5 max-w-sm text-text-muted">
                {league.description}
              </p>
            )}

            {/* Member count */}
            <div className="fade-3 flex items-center gap-2 mb-8">
              <span className="inline-flex items-center gap-2 px-3 py-2 rounded-full font-body text-sm"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#c4ccc6" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="5.5" cy="4.5" r="2.5" stroke="#aeea00" strokeWidth="1.3"/>
                  <circle cx="9.5" cy="4.5" r="2.5" stroke="#aeea00" strokeWidth="1.3"/>
                  <path d="M1 12c0-2.5 2-4.5 4.5-4.5h2M8 12c0-2.5 2-4.5 4.5-4.5" stroke="#aeea00" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span className="font-semibold text-white">{league.member_count}</span>
                {league.member_count === 1 ? " member" : " members"} already in
              </span>
            </div>

          </div>

          {/* RIGHT — table preview + CTA */}
          <div className="fade-5 flex flex-col gap-5">
            {/* League table preview */}
            <LeagueTablePreview members={tableMembers} leagueName={league.name} />

            {/* CTA */}
            <div className="fade-6">
              <CtaCard />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="text-center mb-12">
          <p className="font-body text-xs uppercase tracking-widest mb-3 text-green">Simple as that</p>
          <h2 className="font-display text-white" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", lineHeight: 1.05 }}>
            HOW IT WORKS
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { num: "01", col: "#aeea00", emoji: "🔗", title: "ACCEPT INVITE", desc: "Sign up free in 10 seconds. You'll be added to the league automatically." },
            { num: "02", col: "#aeea00", emoji: "⚽", title: "PICK A MATCH",   desc: "Open any live game — World Cup, Euros, Champions League, Premier League." },
            { num: "03", col: "#ffb800", emoji: "⚡", title: "ANSWER LIVE",    desc: "Questions fire as the game happens. Answer fast — points decay every second." },
            { num: "04", col: "#ff4757", emoji: "📊", title: "CLIMB THE TABLE", desc: "Points stack in the league table. Every match moves the rankings." },
          ].map((step) => (
            <div key={step.num} className="rounded-2xl p-6 relative overflow-hidden group bg-surface"
              style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-display text-8xl absolute -top-3 -right-1 opacity-[0.06] group-hover:opacity-[0.1] transition-opacity select-none"
                style={{ color: step.col }}>{step.num}</div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-xl"
                style={{ background: `${step.col}15`, border: `1px solid ${step.col}25` }}>{step.emoji}</div>
              <h3 className="font-display text-lg text-white mb-2">{step.title}</h3>
              <p className="font-body text-sm leading-relaxed text-text-muted">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Challenges feature ───────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="rounded-3xl overflow-hidden relative p-8 sm:p-12"
          style={{ background: "linear-gradient(135deg, rgba(255,184,0,0.08) 0%, rgba(10,10,15,1) 60%)", border: "1px solid rgba(255,184,0,0.15)" }}>
          <div className="absolute top-0 right-0 w-[300px] h-[300px] pointer-events-none"
            style={{ background: "radial-gradient(circle at 100% 0%, rgba(255,184,0,0.1) 0%, transparent 60%)" }} />
          <p className="font-body text-xs uppercase tracking-widest mb-2 text-amber">Also included</p>
          <h3 className="font-display text-white mb-3" style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}>SOLO CHALLENGES</h3>
          <p className="font-body text-sm sm:text-base leading-relaxed max-w-lg mb-6 text-text-muted">
            100+ football knowledge challenges, playable anytime. Club histories, tournament records, player stats.
            Your scores count toward the league table too.
          </p>
          <div className="flex flex-wrap gap-2">
            {["Arsenal 25/26", "PL Records", "World Cup", "Champions League", "Euro History", "Iconic Managers"].map(tag => (
              <span key={tag} className="font-body text-xs px-3 py-1.5 rounded-full text-amber"
                style={{ background: "rgba(255,184,0,0.1)", border: "1px solid rgba(255,184,0,0.2)" }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 py-16"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-xl mx-auto text-center">
          <h2 className="font-display text-white mb-3" style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)", lineHeight: 1.0 }}>
            YOUR MATES ARE<br />WAITING.
          </h2>
          <p className="font-body text-base mb-8 text-text-muted">
            Join <span className="text-white font-semibold">{league.name}</span> now.
            Free forever — no subscription, no catch.
          </p>
          <CtaCard />
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 py-8 max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="YourScore" height={20} style={{ height: 20, width: "auto", opacity: 0.45 }} />
        <div className="flex items-center gap-5 font-body text-xs" style={{ color: "#586058" }}>
          <Link href="/how-it-works" className="hover:text-white transition-colors">How it works</Link>
          <Link href="/challenges" className="hover:text-white transition-colors">Challenges</Link>
          <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
        </div>
      </footer>
    </main>
  );
}

export default function JoinLeaguePage({ params }: { params: { code: string } }) {
  return (
    <Suspense fallback={
      <div className="min-h-dvh flex items-center justify-center bg-bg">
        <Spinner size={32} />
      </div>
    }>
      <JoinLeagueInner code={params.code} />
    </Suspense>
  );
}
