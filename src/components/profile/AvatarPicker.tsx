"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { avatarPalette, avatarInitial } from "@/lib/avatar";
import { FOOTBALL_AVATARS, avatarDataUri, avatarIdFromUrl } from "@/lib/footballAvatars";

// Tap your avatar → pick a football illustration. Saves the SVG data-URI to
// profiles.avatar_url (RLS: users update own profile), so it shows everywhere.

export function AvatarPicker({ userId, name, initialAvatarUrl, size = 56 }: {
  userId: string; name: string; initialAvatarUrl: string | null; size?: number;
}) {
  const [url, setUrl] = useState<string | null>(initialAvatarUrl);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const p = avatarPalette(userId || name);
  const currentId = avatarIdFromUrl(url);

  async function choose(id: string | null) {
    if (saving) return;
    setSaving(true);
    const next = id ? avatarDataUri(id) : null;
    try {
      const sb = createClient();
      const { data: auth } = await sb.auth.getUser();
      const uid = auth.user?.id ?? userId;
      const { error } = await sb.from("profiles").update({ avatar_url: next }).eq("id", uid);
      if (!error) setUrl(next);
    } catch { /* keep current on failure */ }
    setSaving(false);
    setOpen(false);
  }

  function Face({ u, s }: { u: string | null; s: number }) {
    return u ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={u} alt={name} width={s} height={s} className="rounded-full" style={{ objectFit: "cover" }} />
    ) : (
      <div className="rounded-full flex items-center justify-center font-display" style={{ width: s, height: s, background: `linear-gradient(140deg, ${p.from}, ${p.to})`, color: p.fg, fontSize: s * 0.44 }}>{avatarInitial(name)}</div>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="relative flex-shrink-0 active:scale-95 transition-transform" aria-label="Change avatar" style={{ width: size, height: size }}>
        <Face u={url} s={size} />
        <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#00d8c0", border: "2px solid #0a0a0f" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18 10l-4-4L4 16z" stroke="#04231f" strokeWidth="2.4" strokeLinejoin="round" /></svg>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl p-5 pb-8" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)", animation: "slideUp 0.22s ease" }} onClick={(e) => e.stopPropagation()}>
            <div className="w-9 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.15)" }} />
            <p className="font-display text-2xl text-white mb-1">Pick your avatar</p>
            <p className="font-body text-sm text-text-muted mb-5">Choose a football look — it shows on your matches everywhere.</p>
            <div className="grid grid-cols-4 gap-3">
              {FOOTBALL_AVATARS.map((a) => {
                const active = a.id === currentId;
                return (
                  <button key={a.id} onClick={() => choose(a.id)} disabled={saving} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50">
                    <div className="rounded-full" style={{ padding: 2, border: `2px solid ${active ? "#00d8c0" : "transparent"}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={avatarDataUri(a.id)} alt={a.label} width={56} height={56} className="rounded-full" />
                    </div>
                    <span className="font-body text-[10px]" style={{ color: active ? "#00d8c0" : "#8a948f" }}>{a.label}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => choose(null)} disabled={saving} className="w-full mt-5 rounded-2xl py-3 font-body text-sm disabled:opacity-50" style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}>
              Use my initial instead
            </button>
          </div>
        </div>
      )}
    </>
  );
}
