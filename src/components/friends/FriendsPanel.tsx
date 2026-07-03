/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BottomNav } from "@/components/ui/BottomNav";
import { Button } from "@/components/ui/Button";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { useVersusStats, type Rivalry } from "@/hooks/useVersusStats";
import { trackShare } from "@/lib/analytics/trackGame";

// Friends — one scrolling page (mockup order): invite card → friend requests →
// RIVALS (head-to-head records vs friends) → people you've played (non-friends
// you've faced) → all friends → find people. Standalone at /friends and
// embedded in the Versus tab (embedded=true strips page chrome + bottom nav).

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";
const RED = "#ff6b78";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>{children}</p>;
}

// ── Contacts invite (Android web only — iOS lacks navigator.contacts) ─────────

interface ContactEntry { name: string; tel: string | null; email: string | null }

function ContactsInviteButton() {
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in (window as any));
  }, []);

  if (!supported) return null;

  async function pickContacts() {
    try {
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
    } catch { /* user dismissed */ }
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
                style={{ background: "rgba(174,234,0,0.14)", color: LIME, border: "1px solid rgba(174,234,0,0.25)" }}>
                {(c.name[0] ?? "?").toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-white truncate">{c.name}</p>
                <p className="font-body text-xs text-text-muted truncate">{c.tel ?? c.email ?? "No contact info"}</p>
              </div>
              {c.tel ? (
                <a href={`sms:${c.tel}?body=${INVITE_TEXT}`} className="flex-shrink-0 px-3 py-1.5 rounded-lg font-body text-xs font-semibold"
                  style={{ background: "rgba(174,234,0,0.12)", color: LIME, border: "1px solid rgba(174,234,0,0.22)" }}>Send SMS</a>
              ) : c.email ? (
                <a href={`mailto:${c.email}?subject=Join me on YourScore&body=${INVITE_TEXT}`} className="flex-shrink-0 px-3 py-1.5 rounded-lg font-body text-xs font-semibold"
                  style={{ background: "rgba(174,234,0,0.12)", color: LIME, border: "1px solid rgba(174,234,0,0.22)" }}>Email</a>
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

// ── Invite card (mockup's "friend code": your personal add-link) ──────────────
// navigator.share works in the iOS WKWebView, so this is the cross-platform
// invite; copy is the fallback.
function InviteCard({ myId }: { myId: string | null }) {
  const [copied, setCopied] = useState(false);
  const link = `${typeof window !== "undefined" ? window.location.origin : "https://yourscore.app"}/add/${myId ?? ""}`;

  async function copy() {
    if (!myId) return;
    trackShare("friends-invite");
    try { await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no-op */ }
  }
  async function share() {
    if (!myId) return;
    trackShare("friends-invite");
    const text = "Add me on YourScore and let's go head-to-head ⚽";
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "YourScore", text, url: link }); return; } catch { /* dismissed */ }
    }
    copy();
  }

  return (
    <div className="rounded-2xl p-4" style={{ background: "linear-gradient(150deg, rgba(0,216,192,0.12), #0c1613)", border: "1px solid rgba(0,216,192,0.28)" }}>
      <p className="font-body text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: TEAL }}>Your invite link</p>
      <p className="font-mono text-xs text-white truncate mb-3" style={{ opacity: 0.85 }}>{myId ? link.replace(/^https?:\/\//, "") : "…"}</p>
      <div className="flex gap-2">
        <button onClick={copy} disabled={!myId} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ background: "rgba(255,255,255,0.06)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.14)" }}>
          {copied ? "COPIED ✓" : "COPY LINK"}
        </button>
        <button onClick={share} disabled={!myId} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ background: TEAL, color: "#04231f" }}>
          SHARE LINK
        </button>
      </div>
    </div>
  );
}

// ── Rival / played rows ───────────────────────────────────────────────────────

function RivalRow({ r, isFriend, onAdd, addState }: { r: Rivalry; isFriend: boolean; onAdd?: (id: string) => void; addState?: "idle" | "requested" }) {
  const leadTxt = r.lead > 0 ? `You lead ${r.wins}–${r.losses}` : r.lead < 0 ? `You trail ${r.wins}–${r.losses}` : `Level ${r.wins}–${r.losses}`;
  const leadCol = r.lead > 0 ? LIME : r.lead < 0 ? RED : GOLD;
  const total = r.total || 1;
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="flex items-center gap-3">
        <PlayerAvatar seed={r.opponentId} name={r.name} avatarUrl={r.avatarUrl} size={40} ring={isFriend ? leadCol : undefined} />
        <div className="flex-1 min-w-0">
          <p className="font-body text-sm font-semibold text-white truncate">{r.name}</p>
          {isFriend
            ? <p className="font-body text-[11px]" style={{ color: leadCol }}>{leadTxt}</p>
            : <p className="font-body text-[11px] text-text-muted">Played {r.total} {r.total === 1 ? "match" : "matches"}</p>}
        </div>
        {!isFriend && onAdd && (
          addState === "requested"
            ? <span className="font-body text-xs flex-shrink-0" style={{ color: TEAL }}>Requested</span>
            : <button onClick={() => onAdd(r.opponentId)} className="font-body text-xs font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)", color: "#8a948f", border: "1px solid rgba(255,255,255,0.1)" }}>+ Add</button>
        )}
        <Link href={`/versus/quiz?to=${r.opponentId}`} className="font-display text-[11px] tracking-wide px-3.5 py-2 rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>CHALLENGE</Link>
      </div>
      {isFriend && (
        <div className="flex gap-1 h-1.5 rounded-full overflow-hidden mt-2.5" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div style={{ width: `${(r.wins / total) * 100}%`, background: LIME }} />
          <div style={{ width: `${(r.draws / total) * 100}%`, background: "#5a655e" }} />
          <div style={{ width: `${(r.losses / total) * 100}%`, background: RED }} />
        </div>
      )}
    </div>
  );
}

export function FriendsPanel({ embedded = false }: { embedded?: boolean }) {
  const [myId, setMyId] = useState<string | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addState, setAddState] = useState<Record<string, "idle" | "requested">>({});
  const { rivalries } = useVersusStats();

  const supabase = createClient();
  const sb = supabase as any;

  const loadFriends = useCallback(async (uid: string) => {
    const { data } = await (supabase as any)
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(`user_id.eq.${uid},friend_id.eq.${uid}`);

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
    setAddState((s) => ({ ...s, [toUserId]: "requested" }));
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

  // Rivalries split: friends → RIVALS; strangers you've faced → PEOPLE YOU'VE PLAYED.
  const acceptedIds = new Set(accepted.map((f) => f.user_id));
  const pendingSentIds = new Set(pendingSent.map((f) => f.user_id));
  const rivals = rivalries.filter((r) => acceptedIds.has(r.opponentId));
  const played = rivalries.filter((r) => !acceptedIds.has(r.opponentId)).slice(0, 8);

  if (loading) {
    return (
      <main className={embedded ? "py-16 flex items-center justify-center" : "min-h-dvh bg-bg flex items-center justify-center"}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "rgba(0,216,192,0.4)", borderTopColor: TEAL }} />
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
    <main className={embedded ? "" : "min-h-dvh bg-bg pb-28"}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.25s ease-out both; }
      `}</style>

      {/* Header — hidden when embedded inside the Versus tab (it has its own). */}
      {!embedded && (
        <div className="sticky top-0 z-20 pt-safe" style={{ background: "rgba(8,13,10,0.95)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
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
        </div>
      )}

      <div className="max-w-lg mx-auto px-5 pt-4">

        {/* ── Invite ─────────────────────────────────────────────────────── */}
        <InviteCard myId={myId} />

        {/* ── Friend requests (incoming leads; hidden when none) ───────────── */}
        {pendingReceived.length > 0 && (
          <>
            <SectionLabel>Friend requests</SectionLabel>
            <div className="space-y-2">
              {pendingReceived.map((f, i) => (
                <div key={f.user_id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: "rgba(0,216,192,0.05)", border: "1px solid rgba(0,216,192,0.22)", animationDelay: `${i * 0.05}s` }}>
                  <PlayerAvatar seed={f.user_id} name={f.display_name} avatarUrl={f.avatar_url} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                    <p className="font-body text-xs text-text-muted">wants to be your friend</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => acceptRequest(f.id)} className="px-3.5 py-1.5 rounded-lg font-display text-xs tracking-wide" style={{ background: TEAL, color: "#04231f" }}>ACCEPT</button>
                    <button onClick={() => declineRequest(f.id)} className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: "#8a948f" }}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Rivals — head-to-head records vs friends ──────────────────── */}
        {rivals.length > 0 && (
          <>
            <SectionLabel>Rivals</SectionLabel>
            <div className="space-y-2">
              {rivals.map((r) => <RivalRow key={r.opponentId} r={r} isFriend />)}
            </div>
          </>
        )}

        {/* ── People you've played (not friends yet) ────────────────────── */}
        {played.length > 0 && (
          <>
            <SectionLabel>People you&rsquo;ve played</SectionLabel>
            <div className="space-y-2">
              {played.map((r) => (
                <RivalRow key={r.opponentId} r={r} isFriend={false} onAdd={sendRequest}
                  addState={pendingSentIds.has(r.opponentId) ? "requested" : (addState[r.opponentId] ?? "idle")} />
              ))}
            </div>
          </>
        )}

        {/* ── All friends ───────────────────────────────────────────────── */}
        <SectionLabel>{accepted.length > 0 ? `Friends (${accepted.length})` : "Friends"}</SectionLabel>
        {accepted.length === 0 ? (
          <div className="rounded-2xl p-8 text-center fade-in" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            <p className="text-3xl mb-3">🤝</p>
            <p className="font-body text-sm font-semibold text-white mb-1">No friends yet</p>
            <p className="font-body text-xs text-text-muted">Share your invite link above, or find people below.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accepted.map((f, i) => (
              <div key={f.user_id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface"
                style={{ border: "1px solid rgba(255,255,255,0.07)", animationDelay: `${i * 0.05}s` }}>
                <PlayerAvatar seed={f.user_id} name={f.display_name} avatarUrl={f.avatar_url} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                  <p className="font-body text-xs text-text-muted">{(f.total_score ?? 0).toLocaleString()} pts</p>
                </div>
                <Link href={`/versus/quiz?to=${f.user_id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-display text-xs tracking-wide flex-shrink-0 transition-all active:scale-[0.97]"
                  style={{ background: "rgba(0,216,192,0.14)", color: TEAL, border: "1px solid rgba(0,216,192,0.3)" }}>
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
          </div>
        )}

        {/* Sent requests (small, informational) */}
        {pendingSent.length > 0 && (
          <>
            <SectionLabel>Sent requests</SectionLabel>
            <div className="space-y-2">
              {pendingSent.map((f) => (
                <div key={f.user_id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <PlayerAvatar seed={f.user_id} name={f.display_name} avatarUrl={f.avatar_url} size={36} />
                  <p className="flex-1 font-body text-sm font-semibold text-white truncate">{f.display_name}</p>
                  <span className="font-body text-xs" style={{ color: "#586058" }}>Pending…</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Find people ───────────────────────────────────────────────── */}
        <SectionLabel>Find people</SectionLabel>
        <ContactsInviteButton />
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-white w-full"
          style={{
            padding: "11px 14px", borderRadius: 12, marginBottom: 12,
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            fontFamily: "var(--font-body, sans-serif)", fontSize: 14, outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,216,192,0.4)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
        />

        {searching && <p className="font-body text-xs text-center text-text-muted py-4">Searching…</p>}

        {!searching && search.length >= 2 && searchResults.length === 0 && (
          <p className="font-body text-xs text-center text-text-muted py-4">No players found matching &quot;{search}&quot;</p>
        )}

        {searchResults.map((r, i) => (
          <div key={r.id} className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl mb-2 bg-surface"
            style={{ border: "1px solid rgba(255,255,255,0.07)", animationDelay: `${i * 0.04}s` }}>
            <PlayerAvatar seed={r.id} name={r.display_name} avatarUrl={r.avatar_url} size={40} />
            <div className="flex-1 min-w-0">
              <p className="font-body text-sm font-semibold text-white truncate">{r.display_name}</p>
              <p className="font-body text-xs text-text-muted">{(r.total_score ?? 0).toLocaleString()} pts</p>
            </div>
            {r.friendship_status === "none" && (
              <button onClick={() => sendRequest(r.id)}
                className="px-3 py-1.5 rounded-lg font-body text-xs font-semibold transition-all flex-shrink-0"
                style={{ background: "rgba(0,216,192,0.15)", color: TEAL, border: "1px solid rgba(0,216,192,0.3)" }}>
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
                style={{ background: TEAL, color: "#04231f" }}>
                Accept
              </button>
            )}
            {r.friendship_status === "accepted" && (
              <span className="font-body text-xs flex-shrink-0" style={{ color: TEAL }}>✓ Friends</span>
            )}
          </div>
        ))}

        {search.length < 2 && searchResults.length === 0 && !searching && (
          <p className="font-body text-xs text-text-muted pb-2">Type at least 2 characters to search.</p>
        )}
      </div>

      {!embedded && <BottomNav />}
    </main>
  );
}
