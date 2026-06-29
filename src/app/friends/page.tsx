/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";

interface Friend {
  id: string;          // friendship row id
  user_id: string;
  display_name: string;
  total_score: number;
  avatar_url: string | null;
  status: string;
  is_requester: boolean; // did I send the request?
}

interface SearchResult {
  id: string;
  display_name: string;
  total_score: number;
  avatar_url: string | null;
  friendship_status: "none" | "pending_sent" | "pending_received" | "accepted";
}

function Avatar({ name, size = 40, url }: { name: string; size?: number; url?: string | null }) {
  if (url) return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "1.5px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
  );
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#3a423d", text: "#aeea00" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: c.bg, color: c.text, fontSize: size * 0.38, fontWeight: 700,
      border: "1.5px solid rgba(255,255,255,0.1)",
      fontFamily: "var(--font-body, sans-serif)",
    }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

// ── Contacts invite ──────────────────────────────────────────────────────────

interface ContactEntry {
  name: string;
  tel: string | null;
  email: string | null;
}

function ContactsInviteButton() {
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSupported(typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in (window as any));
  }, []);

  if (!supported) return null;

  async function pickContacts() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const selected: any[] = await (navigator as any).contacts.select(["name", "tel", "email"], { multiple: true });
      const parsed: ContactEntry[] = selected.map((c: any) => ({
        name: Array.isArray(c.name) ? (c.name[0] ?? "Contact") : (c.name ?? "Contact"),
        tel: Array.isArray(c.tel) ? (c.tel[0] ?? null) : (c.tel ?? null),
        email: Array.isArray(c.email) ? (c.email[0] ?? null) : (c.email ?? null),
      }));
      setContacts(prev => {
        const existing = new Set(prev.map(p => p.tel ?? p.email));
        return [...prev, ...parsed.filter(p => !existing.has(p.tel ?? p.email))];
      });
    } catch {
      // user dismissed — no-op
    }
  }

  const INVITE_TEXT = encodeURIComponent("Hey! I'm on YourScore — pick your Dream XI and challenge me to a head-to-head 🤝⚽ Download at yourscore.app");

  return (
    <div>
      <Button onClick={pickContacts} variant="ghost" size="md" fullWidth className="gap-2 mb-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M10.5 2H5.5A1.5 1.5 0 0 0 4 3.5v9A1.5 1.5 0 0 0 5.5 14h5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 10.5 2z" stroke="currentColor" strokeWidth="1.4"/>
          <circle cx="8" cy="10" r="1" fill="currentColor"/>
        </svg>
        Invite from contacts
      </Button>

      {contacts.length > 0 && (
        <div className="space-y-2">
          {contacts.map((c, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0"
                style={{ background: "rgba(174,234,0,0.14)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.25)" }}>
                {(c.name[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-white truncate">{c.name}</p>
                <p className="font-body text-xs text-text-muted truncate">{c.tel ?? c.email ?? "No contact info"}</p>
              </div>
              {c.tel ? (
                <a href={`sms:${c.tel}?body=${INVITE_TEXT}`}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg font-body text-xs font-semibold"
                  style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.22)" }}>
                  Send SMS
                </a>
              ) : c.email ? (
                <a href={`mailto:${c.email}?subject=Join me on YourScore&body=${INVITE_TEXT}`}
                  className="flex-shrink-0 px-3 py-1.5 rounded-lg font-body text-xs font-semibold"
                  style={{ background: "rgba(174,234,0,0.12)", color: "#aeea00", border: "1px solid rgba(174,234,0,0.22)" }}>
                  Email
                </a>
              ) : (
                <span className="font-body text-xs flex-shrink-0" style={{ color: "#586058" }}>No contact info</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FriendsPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"friends" | "requests" | "search">("friends");

  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const loadFriends = useCallback(async (uid: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(`user_id.eq.${uid},friend_id.eq.${uid}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = data ?? [];
    if (!rows.length) { setFriends([]); return; }

    const otherIds = rows.map((r: any) => r.user_id === uid ? r.friend_id : r.user_id).filter(Boolean) as string[];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, total_score, avatar_url")
      .in("id", otherIds);

    const pm: Record<string, { display_name: string; total_score: number; avatar_url: string | null }> = {};
    (profiles ?? []).forEach(p => { pm[p.id] = { display_name: p.display_name ?? "Player", total_score: p.total_score ?? 0, avatar_url: p.avatar_url ?? null }; });

    setFriends(rows.map((r: any) => {
      const otherId = r.user_id === uid ? r.friend_id : r.user_id;
      const p = pm[otherId] ?? { display_name: "Player", total_score: 0, avatar_url: null };
      return {
        id: r.id ?? "",
        user_id: otherId,
        display_name: p.display_name,
        total_score: p.total_score,
        avatar_url: p.avatar_url,
        status: r.status ?? "accepted",
        is_requester: r.user_id === uid,
      };
    }));
  }, [supabase]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setMyId(uid);
      if (uid) loadFriends(uid).finally(() => setLoading(false));
      else setLoading(false);
    });
  }, [loadFriends, supabase.auth]);

  // Debounced search
  useEffect(() => {
    if (!search.trim() || search.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, total_score, avatar_url")
        .ilike("display_name", `%${search.trim()}%`)
        .neq("id", myId ?? "")
        .limit(10);

      const results: SearchResult[] = (data ?? []).map((p: { id: string; display_name: string | null; total_score: number | null; avatar_url: string | null }) => {
        const f = friends.find(fr => fr.user_id === p.id);
        let friendship_status: SearchResult["friendship_status"] = "none";
        if (f) {
          if (f.status === "accepted") friendship_status = "accepted";
          else if (f.is_requester) friendship_status = "pending_sent";
          else friendship_status = "pending_received";
        }
        return { id: p.id, display_name: p.display_name ?? "Player", total_score: p.total_score ?? 0, avatar_url: p.avatar_url ?? null, friendship_status };
      });
      setSearchResults(results);
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [search, friends, myId, supabase]);

  async function sendRequest(toUserId: string) {
    if (!myId) return;
    await sb.from("friendships").insert({ user_id: myId, friend_id: toUserId, status: "pending" });
    await loadFriends(myId);
    setSearchResults(prev => prev.map(r => r.id === toUserId ? { ...r, friendship_status: "pending_sent" as const } : r));
  }

  async function acceptRequest(friendshipId: string) {
    if (!myId) return;
    await sb.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
    await loadFriends(myId);
  }

  async function declineRequest(friendshipId: string) {
    if (!myId) return;
    await sb.from("friendships").delete().eq("id", friendshipId);
    await loadFriends(myId);
  }

  const accepted = friends.filter(f => f.status === "accepted");
  const pendingReceived = friends.filter(f => f.status === "pending" && !f.is_requester);
  const pendingSent = friends.filter(f => f.status === "pending" && f.is_requester);

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(0,201,255,0.4)", borderTopColor: "#00c9ff" }} />
      </main>
    );
  }

  if (!myId) {
    return (
      <main className="min-h-dvh bg-bg flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <p className="font-body text-text-muted">Sign in to add friends.</p>
          <Link href="/auth/sign-in" className="font-body text-sm font-semibold text-green">Sign in →</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.25s ease-out both; }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-20 pt-safe" style={{ background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="max-w-lg mx-auto px-5 py-4 flex items-center gap-3">
          <Link href="/profile" style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            textDecoration: "none",
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="#9aa39d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <h1 className="font-display text-xl text-white flex-1" style={{ letterSpacing: "-0.01em" }}>Friends</h1>
          {pendingReceived.length > 0 && (
            <span className="w-5 h-5 rounded-full text-center font-body text-xs font-bold flex items-center justify-center"
              style={{ background: "#ff4757", color: "#fff" }}>{pendingReceived.length}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex max-w-lg mx-auto px-5 pb-3 gap-2">
          {([
            { key: "friends", label: `Friends (${accepted.length})` },
            { key: "requests", label: `Requests${pendingReceived.length > 0 ? ` (${pendingReceived.length})` : ""}` },
            { key: "search",   label: "Find people" },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className="font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: activeTab === key ? "rgba(0,201,255,0.15)" : "rgba(255,255,255,0.04)",
                color: activeTab === key ? "#00c9ff" : "#8a948f",
                border: `1px solid ${activeTab === key ? "rgba(0,201,255,0.3)" : "transparent"}`,
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 pt-5 space-y-3">

        {/* ── FRIENDS TAB ─────────────────────────────────────────────── */}
        {activeTab === "friends" && (
          <>
            {accepted.length === 0 ? (
              <div className="rounded-2xl p-8 text-center fade-in" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
                <p className="text-3xl mb-3">🤝</p>
                <p className="font-body text-sm font-semibold text-white mb-1">No friends yet</p>
                <p className="font-body text-xs text-text-muted mb-4">Find your mates and add them</p>
                <button onClick={() => setActiveTab("search")}
                  className="font-body text-sm font-semibold px-4 py-2 rounded-xl transition-all"
                  style={{ background: "rgba(0,201,255,0.15)", color: "#00c9ff", border: "1px solid rgba(0,201,255,0.3)" }}>
                  Find people →
                </button>
              </div>
            ) : accepted.map((f, i) => (
              <div key={f.user_id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)", animationDelay: `${i * 0.05}s` }}>
                <Avatar name={f.display_name} size={40} url={f.avatar_url} />
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                  <p className="font-body text-xs text-text-muted">{(f.total_score ?? 0).toLocaleString()} pts</p>
                </div>
                <Link href={`/play?challenge=${f.user_id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs tracking-wide flex-shrink-0 transition-all active:scale-[0.97]"
                  style={{ background: "rgba(0,216,192,0.14)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}>
                  Challenge
                </Link>
                <Link href={`/messages/${f.user_id}`}
                  className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#9aa39d", border: "1px solid rgba(255,255,255,0.1)" }}
                  aria-label="Message">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H6l-3 2.5V11H3.5A1.5 1.5 0 0 1 2 9.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                </Link>
              </div>
            ))}
          </>
        )}

        {/* ── REQUESTS TAB ────────────────────────────────────────────── */}
        {activeTab === "requests" && (
          <>
            {pendingReceived.length > 0 && (
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-2">Incoming requests</p>
                {pendingReceived.map((f, i) => (
                  <div key={f.user_id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl mb-2"
                    style={{ background: "rgba(0,201,255,0.05)", border: "1px solid rgba(0,201,255,0.2)", animationDelay: `${i * 0.05}s` }}>
                    <Avatar name={f.display_name} size={40} url={f.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                      <p className="font-body text-xs text-text-muted">{(f.total_score ?? 0).toLocaleString()} pts</p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => acceptRequest(f.id)}
                        className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
                        style={{ background: "#00c9ff", color: "#0a0a0f" }}>
                        Accept
                      </button>
                      <button onClick={() => declineRequest(f.id)}
                        className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pendingSent.length > 0 && (
              <div>
                <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-2">Sent requests</p>
                {pendingSent.map((f) => (
                  <div key={f.user_id} className="flex items-center gap-3 px-4 py-3 rounded-2xl mb-2"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <Avatar name={f.display_name} size={40} url={f.avatar_url} />
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                    </div>
                    <span className="font-body text-xs" style={{ color: "#586058" }}>Pending…</span>
                  </div>
                ))}
              </div>
            )}

            {pendingReceived.length === 0 && pendingSent.length === 0 && (
              <div className="rounded-2xl p-8 text-center fade-in" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
                <p className="font-body text-sm text-text-muted">No pending requests</p>
              </div>
            )}
          </>
        )}

        {/* ── SEARCH TAB ──────────────────────────────────────────────── */}
        {activeTab === "search" && (
          <div>
            <ContactsInviteButton />
            <input
              type="text"
              placeholder="Search by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="text-white w-full"
              style={{
                padding: "11px 14px", borderRadius: 12, marginBottom: 12,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                fontFamily: "var(--font-body, sans-serif)", fontSize: 14, outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,201,255,0.4)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
            />

            {searching && <p className="font-body text-xs text-center text-text-muted py-4">Searching…</p>}

            {!searching && search.length >= 2 && searchResults.length === 0 && (
              <p className="font-body text-xs text-center text-text-muted py-4">No players found matching &quot;{search}&quot;</p>
            )}

            {searchResults.map((r, i) => (
              <div key={r.id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl mb-2 bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)", animationDelay: `${i * 0.04}s` }}>
                <Avatar name={r.display_name} size={40} url={r.avatar_url} />
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white truncate">{r.display_name}</p>
                  <p className="font-body text-xs text-text-muted">{(r.total_score ?? 0).toLocaleString()} pts</p>
                </div>
                {r.friendship_status === "none" && (
                  <button onClick={() => sendRequest(r.id)}
                    className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all flex-shrink-0"
                    style={{ background: "rgba(0,201,255,0.15)", color: "#00c9ff", border: "1px solid rgba(0,201,255,0.3)" }}>
                    + Add
                  </button>
                )}
                {r.friendship_status === "pending_sent" && (
                  <span className="font-body text-xs flex-shrink-0" style={{ color: "#586058" }}>Requested</span>
                )}
                {r.friendship_status === "pending_received" && (
                  <button onClick={() => {
                    const f = friends.find(fr => fr.user_id === r.id);
                    if (f) acceptRequest(f.id);
                  }}
                    className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold flex-shrink-0"
                    style={{ background: "#00c9ff", color: "#0a0a0f" }}>
                    Accept
                  </button>
                )}
                {r.friendship_status === "accepted" && (
                  <span className="font-body text-xs flex-shrink-0" style={{ color: "#00c9ff" }}>✓ Friends</span>
                )}
              </div>
            ))}

            {search.length < 2 && (
              <p className="font-body text-xs text-center text-text-muted py-6">Type at least 2 characters to search</p>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
