"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { Spinner } from "@/components/ui/Spinner";
import { BottomNav } from "@/components/ui/BottomNav";
import { BackPill } from "@/components/ui/BackPill";

export default function SettingsPage() {
  const { user, loading } = useUser();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  // Password section
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [resetEmailSent, setResetEmailSent] = useState(false);
  // Delete account
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
            setDisplayName(data.display_name ?? "");
            setUsername(data.username ?? "");
            setAvatarUrl(data.avatar_url ?? null);
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
      const { error: uploadErr } = await sb.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) { setUploadError("Upload failed. Try again."); return; }
      const { data: urlData } = sb.storage.from("avatars").getPublicUrl(path);
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
    setUsernameError("");
    const handle = username.trim();
    if (handle && handle.length < 3) { setSaving(false); setUsernameError("At least 3 characters."); return; }
    const { createClient } = await import("@/lib/supabase/client");
    // Username is the public identity — mirror it into display_name (what every surface
    // reads) so the handle shows everywhere without rewiring them.
    const { error } = await createClient()
      .from("profiles")
      .update({ username: handle || null, ...(handle ? { display_name: handle } : {}) })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setUsernameError(/duplicate|unique/i.test(error.message) ? "That username is taken." : "Couldn't save — try again.");
      return;
    }
    if (handle) setDisplayName(handle);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleSetPassword() {
    if (!user || !newPassword) return;
    if (newPassword !== confirmPassword) { setPasswordError("Passwords don't match"); return; }
    if (newPassword.length < 6) { setPasswordError("Password must be at least 6 characters"); return; }
    setPasswordSaving(true); setPasswordError("");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const { error } = await createClient().auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSaved(true);
      setNewPassword(""); setConfirmPassword("");
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (e: unknown) {
      setPasswordError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleForgotPassword() {
    if (!user?.email) return;
    try {
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      });
      setResetEmailSent(true);
    } catch { /* silent */ }
  }

  async function handleSignOut() {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().auth.signOut();
    window.location.href = "/";
  }

  async function handleDeleteAccount() {
    if (confirmDelete.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true); setDeleteError("");
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not delete your account. Please try again.");
      }
      // Account is gone — clear the local session and leave.
      try {
        const { createClient } = await import("@/lib/supabase/client");
        await createClient().auth.signOut();
      } catch { /* session is moot anyway */ }
      window.location.href = "/?deleted=1";
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Something went wrong.");
      setDeleting(false);
    }
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
          <BackPill href="/" label="Home" tone="neutral" />
          <Link href="/auth/sign-in" className="inline-flex items-center justify-center px-6 py-3 rounded-xl font-body font-bold text-sm transition-all text-green"
            style={{ background: "rgba(174,234,0,0.1)", border: "1px solid rgba(174,234,0,0.28)" }}>
            Sign in →
          </Link>
        </div>
      </main>
    );
  }

  const initials = (username || displayName || user.email || "?")[0].toUpperCase();

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
        className="sticky top-0 z-10 pt-safe"
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
            className="font-body text-xs font-semibold transition-colors text-green"
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
              {username ? `@${username}` : displayName || user.email?.split("@")[0]}
            </p>
            <p className="font-body text-xs text-text-muted mt-0.5">{user.email}</p>
            {uploadError && <p className="font-body text-xs mt-1 text-danger">{uploadError}</p>}
            <button
              type="button"
              className="font-body text-xs mt-1 transition-colors text-green"
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
            className="rounded-2xl overflow-hidden bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="px-5 py-4">
              <label className="font-body text-xs text-text-muted block mb-1">Username</label>
              <p className="font-body text-xs mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Your public name across YourScore — leaderboards, leagues &amp; shared cards.</p>
              <div className="flex items-center gap-1">
                <span className="font-body text-sm text-text-muted">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsernameError("");
                    setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20));
                  }}
                  placeholder="yourusername"
                  className="flex-1 font-body text-sm text-white bg-transparent outline-none placeholder:text-white/20"
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                />
              </div>
              {usernameError && <p className="font-body text-xs mt-2" style={{ color: "#ff7a88" }}>{usernameError}</p>}
            </div>
          </div>
        </div>

        {/* Account */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Account</p>
          <div
            className="rounded-2xl overflow-hidden bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)" }}
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
            background: saved ? "rgba(174,234,0,0.12)" : "#aeea00",
            color: saved ? "#aeea00" : "#0a0a0f",
            border: saved ? "1px solid rgba(174,234,0,0.2)" : "none",
            boxShadow: saved ? "none" : "0 0 20px rgba(174,234,0,0.2)",
          }}
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
        </button>

        {/* Password section */}
        <div className="rounded-2xl overflow-hidden border border-border">
          <div className="px-5 py-4 bg-surface" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="font-body text-sm font-semibold text-white">Password</p>
            <p className="font-body text-xs mt-0.5 text-text-muted">
              {user?.app_metadata?.providers?.includes("email")
                ? "Change your password or send a reset link"
                : "Set a password to sign in without a magic link"}
            </p>
          </div>
          <div className="p-4 space-y-2.5" style={{ background: "#080d0a" }}>
            {resetEmailSent ? (
              <p className="font-body text-xs text-center py-2 text-green">
                ✓ Reset link sent to {user?.email}
              </p>
            ) : (
              <>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  placeholder="New password" autoComplete="new-password"
                  className="w-full rounded-xl px-4 py-3 font-body text-white text-sm outline-none placeholder:text-white/25 bg-surface"
                  style={{ border: `1px solid ${passwordError ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}` }} />
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password" autoComplete="new-password"
                  className="w-full rounded-xl px-4 py-3 font-body text-white text-sm outline-none placeholder:text-white/25 bg-surface"
                  style={{ border: `1px solid ${passwordError ? "rgba(255,71,87,0.4)" : "rgba(255,255,255,0.1)"}` }} />
                {passwordError && <p className="font-body text-xs" style={{ color: "#f87171" }}>{passwordError}</p>}
                <button onClick={handleSetPassword} disabled={!newPassword || !confirmPassword || passwordSaving}
                  className="w-full py-3 rounded-xl font-body text-sm font-semibold transition-all hover:opacity-90"
                  style={{
                    background: newPassword && confirmPassword ? "rgba(174,234,0,0.12)" : "rgba(255,255,255,0.04)",
                    color: newPassword && confirmPassword ? "#aeea00" : "#586058",
                    border: `1px solid ${newPassword && confirmPassword ? "rgba(174,234,0,0.25)" : "rgba(255,255,255,0.07)"}`,
                  }}>
                  {passwordSaving ? "Saving…" : passwordSaved ? "Password updated ✓" : user?.app_metadata?.providers?.includes("email") ? "Update password" : "Set password"}
                </button>
                <button onClick={handleForgotPassword}
                  className="w-full py-1.5 font-body text-xs transition-colors hover:text-white text-center"
                  style={{ color: "#586058" }}>
                  Forgot current password? Send reset link
                </button>
              </>
            )}
          </div>
        </div>

        {/* Email preferences */}
        <Link
          href={user ? `/settings/email?u=${user.id}` : "/settings/email"}
          className="flex items-center justify-between w-full px-4 py-3.5 rounded-2xl font-body text-sm transition-all hover:opacity-90"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#c4ccc6" }}
        >
          <span>Email preferences</span>
          <span style={{ color: "#8a948f" }}>›</span>
        </Link>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-3.5 rounded-2xl font-body text-sm font-semibold transition-all hover:opacity-80 text-danger"
          style={{
            background: "rgba(255,71,87,0.07)",
            border: "1px solid rgba(255,71,87,0.15)",
          }}
        >
          Sign out
        </button>

        {/* Danger zone — delete account */}
        <div className="rounded-2xl p-4" style={{ background: "rgba(255,71,87,0.05)", border: "1px solid rgba(255,71,87,0.2)" }}>
          <p className="font-body text-[10px] font-semibold tracking-widest mb-2" style={{ color: "#ff4757" }}>DANGER ZONE</p>
          <p className="font-body text-sm font-semibold text-white">Delete account</p>
          <p className="font-body text-xs mt-1 mb-3" style={{ color: "#8a948f", lineHeight: 1.55 }}>
            Permanently delete your account and erase everything we hold — your profile, all games,
            38-0 teams, seasons &amp; leaderboard records, friends and quiz history. This cannot be undone.
          </p>
          <button
            onClick={() => { setDeleteOpen(true); setConfirmDelete(""); setDeleteError(""); }}
            className="w-full py-3 rounded-xl font-body text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "rgba(255,71,87,0.1)", color: "#ff4757", border: "1px solid rgba(255,71,87,0.3)" }}
          >
            Delete my account
          </button>
        </div>
      </div>

      {/* Confirmation modal */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(0,0,0,0.82)" }}
          onClick={() => { if (!deleting) setDeleteOpen(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: "#0e1611", border: "1px solid rgba(255,71,87,0.35)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center" style={{ fontSize: 34, lineHeight: 1 }}>⚠️</div>
            <p className="font-display tracking-wide text-center mt-2" style={{ fontSize: 24, color: "#fff" }}>DELETE ACCOUNT?</p>
            <p className="font-body text-sm text-center mt-2 mb-4" style={{ color: "#c4ccc6", lineHeight: 1.55 }}>
              This permanently erases <span style={{ color: "#fff", fontWeight: 600 }}>everything</span> — your profile,
              every game, your 38-0 teams, seasons &amp; leaderboard records, friends and history.{" "}
              <span style={{ color: "#ff6b7a" }}>It can&apos;t be undone.</span>
            </p>
            <p className="font-body text-xs mb-2" style={{ color: "#8a948f" }}>
              Type <span style={{ color: "#ff4757", fontWeight: 700, letterSpacing: 1 }}>DELETE</span> to confirm:
            </p>
            <input
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
              placeholder="DELETE"
              autoCapitalize="characters" autoCorrect="off" autoComplete="off"
              disabled={deleting}
              className="w-full rounded-xl px-4 py-3 font-body text-white text-sm outline-none placeholder:text-white/20 bg-surface"
              style={{ border: "1px solid rgba(255,71,87,0.3)", letterSpacing: 1 }}
            />
            {deleteError && <p className="font-body text-xs mt-2" style={{ color: "#f87171" }}>{deleteError}</p>}
            <button
              onClick={handleDeleteAccount}
              disabled={confirmDelete.trim().toUpperCase() !== "DELETE" || deleting}
              className="w-full py-3 rounded-xl font-body text-sm font-bold transition-all mt-4"
              style={{
                background: confirmDelete.trim().toUpperCase() === "DELETE" && !deleting ? "#ff4757" : "rgba(255,71,87,0.12)",
                color: confirmDelete.trim().toUpperCase() === "DELETE" && !deleting ? "#fff" : "#7a4a52",
                cursor: confirmDelete.trim().toUpperCase() === "DELETE" && !deleting ? "pointer" : "not-allowed",
              }}
            >
              {deleting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              onClick={() => { if (!deleting) setDeleteOpen(false); }}
              disabled={deleting}
              className="w-full py-2.5 mt-1 font-body text-sm transition-colors hover:text-white"
              style={{ color: "#8a948f" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
