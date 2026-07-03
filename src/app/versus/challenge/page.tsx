"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { coverUrl } from "@/lib/img";
import { BackPill } from "@/components/ui/BackPill";

// Challenge a friend — quiz-first. Pick a quiz you've already played, pick a
// friend, and your scorecard is fired at them (server reads your stored attempt).
// To challenge with a quiz you haven't played, head to a quiz and play it first.

interface Scorecard { packId: string; name: string; score: number; correct: number; total: number; cover: string | null }
interface Friend { user_id: string; display_name: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }

export default function ChallengePage() {
  const router = useRouter();
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [picked, setPicked] = useState<Scorecard | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [preTo, setPreTo] = useState<string | null>(null); // ?to=<id> — rematch/rivalry target to float up

  useEffect(() => { setPreTo(new URLSearchParams(window.location.search).get("to")); }, []);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setCards([]); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = sb as any;

    const { data: attempts } = await db
      .from("quiz_attempts")
      .select("pack_id, score, correct_count, completed_at")
      .eq("user_id", uid)
      .order("completed_at", { ascending: false })
      .limit(24);
    const rows = (attempts ?? []) as Row[];
    const packIds = Array.from(new Set(rows.map((r) => r.pack_id))).filter(Boolean);

    let packs: Record<string, Row> = {};
    if (packIds.length) {
      const { data: pk } = await db.from("quiz_packs").select("id, name, questions, metadata").in("id", packIds);
      packs = Object.fromEntries(((pk ?? []) as Row[]).map((p) => [p.id, p]));
    }
    const seen = new Set<string>();
    const list: Scorecard[] = [];
    for (const r of rows) {
      const p = packs[r.pack_id];
      if (!p || seen.has(r.pack_id)) continue;
      seen.add(r.pack_id);
      list.push({
        packId: r.pack_id, name: p.name ?? "Quiz", score: r.score ?? 0, correct: r.correct_count ?? 0,
        total: Array.isArray(p.questions) ? p.questions.length : 0, cover: p.metadata?.cover_image ?? null,
      });
    }
    setCards(list);

    // Accepted friends.
    const { data: fr } = await db.from("friendships").select("user_id, friend_id, status").or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    const ids = ((fr ?? []) as Row[]).filter((r) => r.status === "accepted").map((r) => (r.user_id === uid ? r.friend_id : r.user_id)).filter(Boolean);
    if (ids.length) {
      const { data: profs } = await db.from("profiles").select("id, display_name").in("id", ids);
      setFriends(((profs ?? []) as Row[]).map((p) => ({ user_id: p.id, display_name: p.display_name ?? "Player" })));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function send(friend: Friend) {
    if (!picked || sending) return;
    setSending(friend.user_id);
    try {
      const res = await fetch("/api/h2h/from-attempt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: picked.packId, invitedUserId: friend.user_id }),
      });
      const data = await res.json();
      if (res.ok && data.id) { setSentTo(friend.display_name); return; }
      if (data.needsPlay) { router.push(`/play?challenge=${friend.user_id}&pid=${picked.packId}`); return; }
    } catch { /* fall through */ }
    setSending(null);
  }

  // ── Sent confirmation ──
  if (sentTo) {
    return (
      <Screen>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.35)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke="#00d8c0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <p className="font-display text-xl text-white">Sent to {sentTo}!</p>
          <p className="font-body text-sm text-text-muted mt-1.5">They&apos;ll see it in their Versus inbox and have to beat your {picked?.score.toLocaleString()}.</p>
          <Link href="/versus" className="inline-block mt-6 rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Back to Versus →</Link>
        </div>
      </Screen>
    );
  }

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4"><BackPill href="/versus" label="Versus" tone="play" /></div>

        {/* Step 2 — pick a friend */}
        {picked ? (
          <>
            <div className="mt-3">
              <button onClick={() => setPicked(null)} className="font-body text-xs text-text-muted mb-2">← pick a different quiz</button>
              <p className="font-display text-2xl text-white leading-tight">Who are you challenging?</p>
              <p className="font-body text-sm text-text-muted mt-1">Sending your {picked.score.toLocaleString()} on {picked.name}</p>
            </div>
            <div className="mt-4 space-y-2">
              {friends.length === 0 ? (
                <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="font-body text-sm text-white">No friends yet</p>
                  <Link href="/versus?view=friends" className="font-body text-xs mt-1 inline-block" style={{ color: "#00d8c0" }}>Add some first →</Link>
                </div>
              ) : [...friends].sort((a, b) => (a.user_id === preTo ? -1 : 0) - (b.user_id === preTo ? -1 : 0)).map((f) => {
                const isTarget = f.user_id === preTo;
                return (
                <button key={f.user_id} onClick={() => send(f)} disabled={!!sending}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 bg-surface active:scale-[0.99] transition-transform disabled:opacity-60" style={{ border: `1px solid ${isTarget ? "rgba(0,216,192,0.45)" : "rgba(0,216,192,0.2)"}` }}>
                  <span className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe6" }}>{initial(f.display_name)}</span>
                  <span className="flex-1 text-left font-body text-sm font-semibold text-white truncate">{f.display_name}</span>
                  <span className="font-display text-xs tracking-wide px-3 py-1.5 rounded-lg flex-shrink-0" style={{ background: "rgba(0,216,192,0.15)", color: "#00d8c0", border: "1px solid rgba(0,216,192,0.3)" }}>{sending === f.user_id ? "…" : isTarget ? "Rematch" : "Send"}</span>
                </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            {/* Step 1 — pick a quiz you've played */}
            <div className="mt-3">
              <p className="font-display text-2xl text-white leading-tight">Challenge a friend</p>
              <p className="font-body text-sm text-text-muted mt-1">Pick a quiz you&apos;ve played — we&apos;ll send your scorecard.</p>
            </div>

            {cards === null ? (
              <p className="font-body text-sm text-text-muted mt-6">Loading your scores…</p>
            ) : cards.length === 0 ? (
              <div className="mt-5 rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <p className="font-body text-sm text-white">You haven&apos;t played a quiz yet</p>
                <p className="font-body text-xs text-text-muted mt-1 mb-3">Play one, then challenge a friend with your score.</p>
                <Link href="/play" className="inline-block rounded-xl px-4 py-2 font-display text-sm tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Find a quiz →</Link>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {cards.map((c) => (
                  <button key={c.packId} onClick={() => setPicked(c)} className="w-full flex items-center gap-3 rounded-2xl p-3 bg-surface active:scale-[0.99] transition-transform" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div className="w-12 h-12 rounded-xl flex-shrink-0" style={{ background: c.cover ? `center/cover url(${coverUrl(c.cover, 48)})` : "rgba(0,216,192,0.12)" }} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-body text-sm font-semibold text-white truncate">{c.name}</p>
                      <p className="font-body text-xs text-text-muted">Your score: {c.score.toLocaleString()} · {c.correct}/{c.total}</p>
                    </div>
                    <span className="font-display text-xs flex-shrink-0" style={{ color: "#00d8c0" }}>Use →</span>
                  </button>
                ))}
                <Link href="/play" className="block text-center font-body text-xs text-text-muted mt-3 py-2">Or play a new quiz to challenge with →</Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh grid place-items-center bg-bg px-6">{children}</div>;
}
