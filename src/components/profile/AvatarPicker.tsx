"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { avatarPalette, avatarInitial } from "@/lib/avatar";
import { FOOTBALL_AVATARS, avatarSrc, avatarIdFromUrl } from "@/lib/footballAvatars";
import { uploadAvatar, AvatarUploadError } from "@/lib/avatarUpload";

// Tap your avatar → upload a photo from your phone, or pick a football
// illustration. Both save to profiles.avatar_url so they show everywhere. This
// is the ONE avatar UI — Settings renders it too, so both flows are identical.

export function AvatarPicker({ userId, name, initialAvatarUrl, size = 56, overlay = false }: {
  userId: string; name: string; initialAvatarUrl: string | null; size?: number;
  /** Sit invisibly over the player card's avatar circle instead of drawing one. */
  overlay?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(initialAvatarUrl);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const p = avatarPalette(userId || name);
  const currentId = avatarIdFromUrl(url);

  async function choose(id: string | null) {
    if (saving) return;
    setSaving(true);
    setError("");
    const next = id ? avatarSrc(id) : null;
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

  async function onFile(file: File) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const next = await uploadAvatar(file, userId);
      setUrl(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof AvatarUploadError ? e.message : "Upload failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function Face({ u, s }: { u: string | null; s: number }) {
    return u ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={u} alt={name} width={s} height={s} className="rounded-full" style={{ objectFit: "cover", width: s, height: s }} />
    ) : (
      <div className="rounded-full flex items-center justify-center font-display" style={{ width: s, height: s, background: `linear-gradient(140deg, ${p.from}, ${p.to})`, color: p.fg, fontSize: s * 0.44 }}>{avatarInitial(name)}</div>
    );
  }

  // On the player card the avatar is already drawn (inside the card's SVG, which
  // can't hold a button), so the trigger is a transparent tap target laid over it
  // — one avatar on screen, still tappable.
  const trigger = overlay ? (
    <button
      onClick={() => setOpen(true)}
      className="absolute inset-0 rounded-full active:scale-95 transition-transform"
      aria-label="Change avatar"
    >
      <span
        className="absolute rounded-full flex items-center justify-center"
        style={{ width: 26, height: 26, right: "4%", bottom: "4%", background: "#00d8c0", border: "2px solid #0a0a0f" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18 10l-4-4L4 16z" stroke="#04231f" strokeWidth="2.4" strokeLinejoin="round" /></svg>
      </span>
    </button>
  ) : (
    <button onClick={() => setOpen(true)} className="relative flex-shrink-0 active:scale-95 transition-transform" aria-label="Change avatar" style={{ width: size, height: size }}>
      <Face u={url} s={size} />
      <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#00d8c0", border: "2px solid #0a0a0f" }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M4 20h4L18 10l-4-4L4 16z" stroke="#04231f" strokeWidth="2.4" strokeLinejoin="round" /></svg>
      </span>
    </button>
  );

  return (
    <>
      {trigger}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center" style={{ background: "rgba(0,0,0,0.65)" }} onClick={() => !saving && setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl p-5 pb-8" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)", animation: "slideUp 0.22s ease" }} onClick={(e) => e.stopPropagation()}>
            <div className="w-9 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.15)" }} />
            <p className="font-display text-2xl text-white mb-1">Your avatar</p>
            <p className="font-body text-sm text-text-muted mb-4">Upload a photo, or pick a player — it shows everywhere on YourScore.</p>

            {/* Upload a photo — the same action Settings offers. */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 mb-4 font-body text-sm font-bold disabled:opacity-50"
              style={{ background: "#00d8c0", color: "#04231f" }}
            >
              {saving ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="rgba(4,35,31,0.3)" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#04231f" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Uploading…
                </>
              ) : (
                <>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" stroke="#04231f" strokeWidth="1.8" />
                    <path d="M3 9h1.5l2-3h9l2 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" stroke="#04231f" strokeWidth="1.8" strokeLinejoin="round" />
                  </svg>
                  Upload a photo
                </>
              )}
            </button>

            {error && <p className="font-body text-xs text-danger text-center mb-3 -mt-1">{error}</p>}

            <p className="font-body text-[11px] text-text-muted uppercase tracking-widest mb-3">Or pick a player</p>
            <div className="grid grid-cols-4 gap-3">
              {FOOTBALL_AVATARS.map((a) => {
                const active = a.id === currentId;
                return (
                  <button key={a.id} onClick={() => choose(a.id)} disabled={saving} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50">
                    <div className="rounded-full" style={{ padding: 2, border: `2px solid ${active ? "#00d8c0" : "transparent"}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={avatarSrc(a.id)} alt={a.label} width={56} height={56} className="rounded-full" loading="lazy" />
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
