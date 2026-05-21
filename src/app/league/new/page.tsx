/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
// useRouter reserved for future redirect
import { useUser } from "@/hooks/useUser";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";

function generateLeagueCode(name: string): string {
  const prefix = name.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "X");
  const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
  return (prefix + suffix).slice(0, 6);
}

function CreateLeagueInner() {
  const { user, loading } = useUser();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (loading) return <div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>;

  async function handleCreate() {
    if (!name.trim() || !user) return;
    setSubmitting(true);
    const code = generateLeagueCode(name);
    try {
      const sb = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (sb as any)
        .from("leagues")
        .insert({ name: name.trim(), description: description.trim() || null, code, created_by: user.id })
        .select("id, code")
        .single();
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any).from("league_members").insert({ league_id: data.id, user_id: user.id });
      setCreated({ id: data.id, code: data.code });
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  function copyCode() {
    if (!created) return;
    const url = `${window.location.origin}/league/join/${created.code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function shareWhatsApp() {
    if (!created) return;
    const url = `${window.location.origin}/league/join/${created.code}`;
    const text = `Join my YourScore league 🏆\n\n${name}\n\nJoin here: ${url}\nCode: ${created.code}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  return (
    <main className="min-h-dvh bg-bg">
      <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-2xl mx-auto">
        <Link href="/" className="font-display text-2xl text-white tracking-wider hover:opacity-80 transition-opacity">YOURSCORE</Link>
        {user && (
          <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center text-xs font-body font-semibold text-white" style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
            {user.email?.[0].toUpperCase()}
          </div>
        )}
      </nav>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-6">
        {!created ? (
          <>
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 font-body text-xs uppercase tracking-widest"
                style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9l-3 1.5.5-3.5L1 4.5 4.5 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
                New league
              </div>
              <h1 className="font-display text-5xl text-white mb-2">CREATE A LEAGUE</h1>
              <p className="font-body text-text-muted">A private league tracks your group&apos;s points across every game you each play — World Cup, Euros, Champions League, all of it.</p>
            </div>

            <div className="space-y-4 mb-6">
              <div>
                <label className="font-body text-xs text-text-muted uppercase tracking-widest block mb-3">League name</label>
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value.slice(0, 40))}
                  placeholder="The Usual Suspects" maxLength={40} autoFocus
                  className="w-full rounded-xl px-4 py-4 font-body text-white text-base outline-none transition-all placeholder:text-white/20"
                  style={{ background: "#12121e", border: `1px solid ${name ? "rgba(167,139,250,0.4)" : "rgba(255,255,255,0.1)"}` }}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && user && handleCreate()}
                />
                <p className="font-body text-xs text-text-muted mt-2 text-right">{name.length}/40</p>
              </div>

              <div>
                <label className="font-body text-xs text-text-muted uppercase tracking-widest block mb-3">Description <span className="normal-case">(optional)</span></label>
                <input
                  type="text" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 80))}
                  placeholder="The lads from uni, every game this summer"
                  className="w-full rounded-xl px-4 py-4 font-body text-white text-base outline-none transition-all placeholder:text-white/20"
                  style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>
            </div>

            <div className="rounded-2xl p-4 mb-6" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.12)" }}>
              <p className="font-body text-xs font-semibold mb-2" style={{ color: "#a78bfa" }}>What your league tracks</p>
              <div className="space-y-2">
                {[
                  "Points stack across every game each member plays",
                  "See who is live right now and which match they are in",
                  "One leaderboard across World Cup, Euros, Champions League",
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
                <p className="font-body text-sm text-white font-medium mb-1">Sign in to create a league</p>
                <p className="font-body text-xs text-text-muted mb-4">Free. Takes 10 seconds.</p>
                <SignInWithGoogle redirectTo="/league/new" />
              </div>
            ) : (
              <button onClick={handleCreate} disabled={!name.trim() || submitting}
                className="w-full py-4 rounded-xl font-body font-bold text-base flex items-center justify-center gap-2 transition-all"
                style={{ background: name.trim() ? "#a78bfa" : "rgba(255,255,255,0.06)", color: name.trim() ? "#0a0a0f" : "#8888aa", boxShadow: name.trim() ? "0 0 20px rgba(167,139,250,0.25)" : "none" }}>
                {submitting ? <Spinner size={18} /> : "Create league"}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(167,139,250,0.15)" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h1 className="font-display text-4xl text-white leading-none">LEAGUE CREATED</h1>
                <p className="font-body text-xs text-text-muted mt-1">{name}</p>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden mb-5" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="px-5 pt-5 pb-4">
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">League code</p>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-display text-5xl tracking-[0.12em]" style={{ color: "#a78bfa", textShadow: "0 0 20px rgba(167,139,250,0.3)" }}>
                    {created.code}
                  </span>
                  <button onClick={copyCode}
                    className="ml-auto flex items-center gap-1.5 text-xs font-body font-semibold px-3 py-2 rounded-lg transition-all"
                    style={{ background: copied ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.06)", color: copied ? "#a78bfa" : "#8888aa", border: `1px solid ${copied ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                    {copied ? "✓ Copied" : "Copy link"}
                  </button>
                </div>
                <p className="font-body text-xs text-text-muted">Share this code with your group — they join your league instantly</p>
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
              <div className="p-4 grid grid-cols-2 gap-2">
                <button onClick={shareWhatsApp}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium transition-all hover:opacity-80"
                  style={{ background: "rgba(37,211,102,0.1)", border: "1px solid rgba(37,211,102,0.2)", color: "#25d366" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                  WhatsApp
                </button>
                <button onClick={() => { window.open(`sms:?body=${encodeURIComponent(`Join my YourScore league ${name}\n${window.location.origin}/league/join/${created.code}`)}`, "_blank"); }}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-body font-medium transition-all hover:opacity-80"
                  style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4l-3 2V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
                  SMS / iMessage
                </button>
              </div>
            </div>

            <Link href={`/league/${created.id}`}
              className="w-full flex items-center justify-center py-4 rounded-xl font-body font-bold text-base"
              style={{ background: "#a78bfa", color: "#0a0a0f", boxShadow: "0 0 20px rgba(167,139,250,0.25)" }}>
              Go to league →
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

export default function CreateLeaguePage() {
  return <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}><CreateLeagueInner /></Suspense>;
}
