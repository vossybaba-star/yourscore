/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { Spinner } from "@/components/ui/Spinner";
import { BottomNav } from "@/components/ui/BottomNav";

export default function SettingsPage() {
  const { user, loading } = useUser();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setProfileLoading(false);
      return;
    }
    import("@/lib/supabase/client").then(({ createClient }) => {
      createClient()
        .from("profiles")
        .select("display_name, username, avatar_url")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setDisplayName((data as any).display_name ?? "");
            setUsername((data as any).username ?? "");
            setAvatarUrl((data as any).avatar_url ?? null);
          }
          setProfileLoading(false);
        });
    });
  }, [user, loading]);

  async function handleAvatarUpload(file: File) {
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setUploading(true);
    setUploadError("");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${user.id}.${ext}`;
      const { error: uploadErr } = await (sb as any).storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) { setUploadError("Upload failed. Try again."); return; }
      const { data: urlData } = (sb as any).storage.from("avatars").getPublicUrl(path);
      const publicUrl = urlData?.publicUrl ?? null;
      if (publicUrl) {
        await sb.from("profiles").update({ avatar_url: publicUrl }).eq("id", user.id);
        setAvatarUrl(publicUrl + "?t=" + Date.now()); // cache bust
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!user || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    setSaving(true);
    const { createClient } = await import("@/lib/supabase/client");
    await createClient()
      .from("profiles")
      .update({
        display_name: displayName.trim() || null,
        username: username.trim() || null,
      })
      .eq("id", user.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleSignOut() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
    window.location.href = "/";
  }

  if (loading || profileLoading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <Spinner size={32} />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to access settings.</p>
          <Link href="/" className="font-body text-sm font-semibold" style={{ color: "#00ff87" }}>
            ← Home
          </Link>
          <Link href="/auth/sign-in" className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-body font-bold text-sm transition-all"
            style={{ background: "rgba(0,255,135,0.1)", color: "#00ff87", border: "1px solid rgba(0,255,135,0.28)" }}>
            Sign in →
          </Link>
        </div>
      </main>
    );
  }

  const initials = (displayName || user.email || "?")[0].toUpperCase();

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Header */}
      <div
        className="sticky top-0 z-10"
        style={{
          background: "rgba(10,10,15,0.92)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center justify-between">
          <Link
            href="/profile"
            className="font-body text-xs text-text-muted hover:text-white transition-colors"
          >
            ← Profile
          </Link>
          <p className="font-body text-xs font-semibold text-white">Settings</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="font-body text-xs font-semibold transition-colors"
            style={{ color: "#00ff87" }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>

      <div className="relative z-0 max-w-lg mx-auto px-5 pt-6 space-y-6">

        {/* Avatar */}
        <div className="flex items-center gap-4">
          <label className="relative cursor-pointer flex-shrink-0 group">
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarUpload(file);
                e.target.value = "";
              }}
            />
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-16 h-16 rounded-full object-cover"
                style={{ border: "2px solid rgba(255,255,255,0.1)" }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center font-body font-bold text-2xl"
                style={{ background: "#1a2f4a", color: "#60a5fa", border: "2px solid rgba(255,255,255,0.1)" }}
              >
                {initials}
              </div>
            )}
            {/* Overlay */}
            <div
              className="absolute inset-0 rounded-full flex items-center justify-center transition-opacity"
              style={{ background: "rgba(0,0,0,0.55)", opacity: uploading ? 1 : 0 }}
            >
              {uploading ? (
                <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : null}
            </div>
            <div
              className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: "rgba(0,0,0,0.45)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" stroke="white" strokeWidth="1.8"/>
                <path d="M3 9h1.5l2-3h9l2 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" stroke="white" strokeWidth="1.8" strokeLinejoin="round"/>
              </svg>
            </div>
          </label>
          <div>
            <p className="font-body text-base font-semibold text-white">
              {displayName || user.email?.split("@")[0]}
            </p>
            <p className="font-body text-xs text-text-muted mt-0.5">{user.email}</p>
            {uploadError && <p className="font-body text-xs mt-1" style={{ color: "#ff4757" }}>{uploadError}</p>}
            <button
              type="button"
              className="font-body text-xs mt-1 transition-colors"
              style={{ color: "#00ff87" }}
              onClick={() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.click()}
            >
              {uploading ? "Uploading…" : "Change photo"}
            </button>
          </div>
        </div>

        {/* Profile */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Profile</p>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <label className="font-body text-xs text-text-muted block mb-2">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 30))}
                placeholder="Your name"
                className="w-full font-body text-sm text-white bg-transparent outline-none placeholder:text-white/20"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
            </div>
            <div className="px-5 py-4">
              <label className="font-body text-xs text-text-muted block mb-2">
                Username <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <div className="flex items-center gap-1">
                <span className="font-body text-sm text-text-muted">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) =>
                    setUsername(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "")
                        .slice(0, 20)
                    )
                  }
                  placeholder="yourusername"
                  className="flex-1 font-body text-sm text-white bg-transparent outline-none placeholder:text-white/20"
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Account */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Account</p>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            >
              <span className="font-body text-xs text-text-muted">Email</span>
              <span className="font-body text-sm text-white truncate max-w-[200px]">{user.email}</span>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <span className="font-body text-xs text-text-muted">Sign-in method</span>
              <span className="font-body text-sm text-white capitalize">
                {user.app_metadata?.provider ?? "google"}
              </span>
            </div>
          </div>
        </div>

        {/* Save button (also at bottom for convenience) */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-4 rounded-2xl font-body font-bold text-base transition-all"
          style={{
            background: saved ? "rgba(0,255,135,0.12)" : "#00ff87",
            color: saved ? "#00ff87" : "#0a0a0f",
            border: saved ? "1px solid rgba(0,255,135,0.2)" : "none",
            boxShadow: saved ? "none" : "0 0 20px rgba(0,255,135,0.2)",
          }}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-3.5 rounded-2xl font-body text-sm font-semibold transition-all hover:opacity-80"
          style={{
            background: "rgba(255,71,87,0.07)",
            color: "#ff4757",
            border: "1px solid rgba(255,71,87,0.15)",
          }}
        >
          Sign out
        </button>
      </div>

      <BottomNav />
    </main>
  );
}
