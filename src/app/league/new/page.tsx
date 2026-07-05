"use client";

import { useState, Suspense, useEffect, useRef } from "react";
import { GridBackground } from "@/components/ui/GridBackground";
import Link from "next/link";
// useRouter reserved for future redirect
import { useUser } from "@/hooks/useUser";
import { SignInWithGoogle } from "@/components/auth/AuthButton";
import { Spinner } from "@/components/ui/Spinner";
import { createClient } from "@/lib/supabase/client";
import { BackPill } from "@/components/ui/BackPill";
import { Button } from "@/components/ui/Button";
import { afLeagueCreate } from "@/lib/analytics/appsflyerEvents";

function generateLeagueCode(name: string): string {
  const prefix = name.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "X");
  const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
  return (prefix + suffix).slice(0, 6);
}

function CreateLeagueInner() {
  const { user, loading } = useUser();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const QRCode = useRef<React.ComponentType<{ value: string; size?: number }> | null>(null);

  useEffect(() => {
    import("react-qr-code").then(m => { QRCode.current = m.default; });
  }, []);

  useEffect(() => {
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    createClient().from("profiles").select("display_name").eq("id", user.id).single()
      .then(({ data }) => { if (data?.display_name) setProfileName(data.display_name); });
  }, [user]);

  if (loading) return <div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>;

  async function handleCreate() {
    if (!name.trim() || !user) return;
    setSubmitting(true);
    const code = generateLeagueCode(name);
    try {
      const sb = createClient();
      const { data, error } = await sb
        .from("leagues")
        .insert({ name: name.trim(), description: description.trim() || null, code, created_by: user.id, is_public: isPublic })
        .select("id, code")
        .single();
      if (error) throw error;
      await sb.from("league_members").insert({ league_id: data.id, user_id: user.id });
      // Fire-and-forget: lifecycle email if this is the user's first league.
      void fetch("/api/email/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "league_created", data: { leagueId: data.id } }),
      }).catch(() => {});
      afLeagueCreate({ leagueType: "general" });
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
      <GridBackground opacity={0.025} />

      <nav className="relative z-10 pt-safe flex items-center justify-between px-6 py-5 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <BackPill fallback="/versus?view=leagues" label="Back" tone="neutral" />
          <Link href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="YourScore" height={28} style={{ height: 28, width: "auto" }} />
          </Link>
        </div>
        {user && (
          <Link href="/profile" className="w-8 h-8 rounded-full flex items-center justify-center font-body font-bold text-sm hover:opacity-80 transition-opacity"
            style={{ background: "linear-gradient(135deg, #1a2f4a, #3a423d)", color: "#aeea00", border: "1.5px solid rgba(174,234,0,0.25)" }}>
            {(profileName || user.email || "?")[0].toUpperCase()}
          </Link>
        )}
      </nav>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-6">
        {!created ? (
          <>
            <div className="mb-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 font-body text-xs uppercase tracking-widest"
                style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.2)", color: "#aeea00" }}>
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
                  placeholder="The Usual Suspects" maxLength={40}
                  className="w-full rounded-xl px-4 py-4 font-body text-white text-base outline-none transition-all placeholder:text-white/20"
                  style={{ background: "#0e1611", border: `1px solid ${name ? "rgba(174,234,0,0.4)" : "rgba(255,255,255,0.1)"}` }}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && user && handleCreate()}
                />
                <p className="font-body text-xs text-text-muted mt-2 text-right">{name.length}/40</p>
              </div>

              <div>
                <label className="font-body text-xs text-text-muted uppercase tracking-widest block mb-3">Description <span className="normal-case">(optional)</span></label>
                <input
                  type="text" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 80))}
                  placeholder="The mates from uni, every game this summer"
                  className="w-full rounded-xl px-4 py-4 font-body text-white text-base outline-none transition-all placeholder:text-white/20 bg-surface"
                  style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                />
              </div>

              <div>
                <label className="font-body text-xs text-text-muted uppercase tracking-widest block mb-3">Visibility</label>
                <div className="flex gap-2">
                  {([
                    { pub: false, title: "Private", sub: "Invite only — join by code" },
                    { pub: true, title: "Public", sub: "Anyone can find and join it" },
                  ] as const).map((opt) => {
                    const active = isPublic === opt.pub;
                    return (
                      <button key={opt.title} type="button" onClick={() => setIsPublic(opt.pub)}
                        className="flex-1 rounded-xl px-4 py-3.5 text-left transition-all"
                        style={{ background: active ? "rgba(174,234,0,0.08)" : "#0e1611", border: `1px solid ${active ? "rgba(174,234,0,0.4)" : "rgba(255,255,255,0.1)"}` }}>
                        <p className="font-body text-sm font-semibold" style={{ color: active ? "#aeea00" : "#eef2f0" }}>{opt.title}</p>
                        <p className="font-body text-xs text-text-muted mt-0.5">{opt.sub}</p>
                      </button>
                    );
                  })}
                </div>
                {isPublic && <p className="font-body text-xs text-text-muted mt-2">Your league will appear in Discover — anyone on YourScore can join.</p>}
              </div>
            </div>

            <div className="rounded-2xl p-4 mb-6" style={{ background: "rgba(174,234,0,0.04)", border: "1px solid rgba(174,234,0,0.12)" }}>
              <p className="font-body text-xs font-semibold mb-2" style={{ color: "#aeea00" }}>What your league tracks</p>
              <div className="space-y-2">
                {[
                  "Points stack across every game each member plays",
                  "See who is live right now and which match they are in",
                  "One leaderboard across World Cup, Euros, Champions League",
                ].map(t => (
                  <div key={t} className="flex items-start gap-2">
                    <span className="mt-0.5 flex-shrink-0" style={{ color: "#aeea00" }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <p className="font-body text-xs text-text-muted">{t}</p>
                  </div>
                ))}
              </div>
            </div>

            {!user ? (
              <div className="rounded-2xl p-5 bg-surface border border-border">
                <p className="font-body text-sm text-white font-medium mb-1">Sign in to create a league</p>
                <p className="font-body text-xs text-text-muted mb-4">Free. Takes 10 seconds.</p>
                <SignInWithGoogle redirectTo="/league/new" />
              </div>
            ) : (
              <Button onClick={handleCreate} disabled={!name.trim() || submitting}
                variant="primary" tone="lime" size="lg" fullWidth>
                {submitting ? <Spinner size={18} /> : "Create league"}
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(174,234,0,0.15)" }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3.5 9l4 4 7-7" stroke="#aeea00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <h1 className="font-display text-4xl text-white leading-none">LEAGUE CREATED</h1>
                <p className="font-body text-xs text-text-muted mt-1">{name}</p>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden mb-5 bg-surface border border-border">
              <div className="px-5 pt-5 pb-4">
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">League code</p>
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-display text-5xl tracking-[0.12em]" style={{ color: "#aeea00", textShadow: "0 0 20px rgba(174,234,0,0.3)" }}>
                    {created.code}
                  </span>
                  <button onClick={copyCode}
                    className="ml-auto flex items-center gap-1.5 text-xs font-body font-semibold px-3 py-2 rounded-lg transition-all"
                    style={{ background: copied ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.06)", color: copied ? "#aeea00" : "#8a948f", border: `1px solid ${copied ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                    {copied ? "✓ Copied" : "Copy link"}
                  </button>
                </div>
                <p className="font-body text-xs text-text-muted">Share this code with your group — they join your league instantly</p>
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
              <div className="p-4 grid grid-cols-3 gap-2">
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
                  SMS
                </button>
                <button onClick={() => setShowQR(v => !v)}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-body font-medium transition-all hover:opacity-80"
                  style={{ background: showQR ? "rgba(174,234,0,0.15)" : "rgba(255,255,255,0.05)", border: `1px solid ${showQR ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.08)"}`, color: showQR ? "#aeea00" : "#8a948f" }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.3"/><rect x="3" y="3" width="1.5" height="1.5" fill="currentColor"/><rect x="10" y="3" width="1.5" height="1.5" fill="currentColor"/><rect x="3" y="10" width="1.5" height="1.5" fill="currentColor"/><path d="M8 8h1.5v1.5H8zM10.5 8H12v1.5h-1.5zM10.5 10.5H12V12h-1.5zM8 10.5h1.5V12H8z" fill="currentColor"/></svg>
                  QR Code
                </button>
              </div>
              {showQR && QRCode.current && (
                <div className="px-4 pb-4">
                  <div className="flex flex-col items-center gap-2 p-4 rounded-2xl" style={{ background: "white" }}>
                    <QRCode.current value={`${typeof window !== "undefined" ? window.location.origin : ""}/league/join/${created.code}`} size={160} />
                    <p className="font-body text-xs text-black/50 mt-1">Scan to join <span className="font-semibold text-black/70">{name}</span></p>
                  </div>
                </div>
              )}
            </div>

            <Button href={`/league/${created.id}`} variant="primary" tone="lime" size="lg" fullWidth>
              Go to league →
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

export default function CreateLeaguePage() {
  return <Suspense fallback={<div className="min-h-dvh bg-bg flex items-center justify-center"><Spinner size={32} /></div>}><CreateLeagueInner /></Suspense>;
}
