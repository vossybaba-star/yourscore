"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BackPill } from "@/components/ui/BackPill";

// Quiz Battle — quiz-first. Step 1: browse the quiz library (rich cover cards +
// category filters, mirroring the solo quiz view). Step 2: pick a friend + how
// to play them:
//   • Play live  → creates an h2h room bound to the pack + invites them → both
//     get the same questions at the same time (game-show style).
//   • Send scorecard (only if you've already played it) → async challenge.

const TEAL = "#00d8c0";

interface Pack {
  id: string; name: string; type: string | null; parameter: string | null;
  questionCount: number; cover: string | null; featured: boolean;
  featuredOrder: number; series: string; createdAt: string; played: boolean;
}
interface Friend { user_id: string; display_name: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Cat = "all" | "featured" | "worldcup" | "club" | "records";

function initial(n: string) { return (n[0] ?? "?").toUpperCase(); }
function bucket(qc: number) { return qc <= 5 ? 5 : qc <= 10 ? 10 : 20; }
function isWC(p: Pack) { return p.series.startsWith("wc") || /world cup/i.test(p.name) || /world cup/i.test(p.parameter ?? ""); }
function catOf(p: Pack): Exclude<Cat, "all"> {
  if (p.featured) return "featured";
  if (isWC(p)) return "worldcup";
  if (p.type === "club") return "club";
  return "records";
}

const CATS: { key: Cat; label: string }[] = [
  { key: "all", label: "All" }, { key: "featured", label: "Featured" },
  { key: "worldcup", label: "World Cup" }, { key: "club", label: "Clubs" }, { key: "records", label: "Records" },
];

export default function QuizBattlePage() {
  const router = useRouter();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [picked, setPicked] = useState<Pack | null>(null);
  const [cat, setCat] = useState<Cat>("all");
  const [preTo, setPreTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setPreTo(new URLSearchParams(window.location.search).get("to")); }, []);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setPacks([]); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = sb as any;

    // Render the quiz grid off packs + attempts only — don't block it on the
    // friends query (not needed until step 2).
    const [pkRes, attRes] = await Promise.all([
      db.from("quiz_packs").select("id, name, type, parameter, question_count, featured, featured_order, metadata, created_at").eq("status", "published").eq("rotation_active", true),
      db.from("quiz_attempts").select("pack_id").eq("user_id", uid),
    ]);
    const playedIds = new Set(((attRes.data ?? []) as Row[]).map((r) => r.pack_id));
    const list: Pack[] = ((pkRes.data ?? []) as Row[]).map((p) => ({
      id: p.id, name: p.name, type: p.type ?? null, parameter: p.parameter ?? null,
      questionCount: p.question_count ?? 0, cover: p.metadata?.cover_image ?? null,
      featured: !!p.featured, featuredOrder: p.featured_order ?? 99,
      series: (p.metadata?.series ?? "").toLowerCase(), createdAt: p.created_at ?? "",
      played: playedIds.has(p.id),
    }));
    setPacks(list);

    // Friends — loaded after, for step 2.
    const frRes = await db.from("friendships").select("user_id, friend_id, status").or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    const ids = ((frRes.data ?? []) as Row[]).filter((r) => r.status === "accepted").map((r) => (r.user_id === uid ? r.friend_id : r.user_id)).filter(Boolean);
    if (ids.length) {
      const { data: profs } = await db.from("profiles").select("id, display_name").in("id", ids);
      const fl: Friend[] = ((profs ?? []) as Row[]).map((p) => ({ user_id: p.id, display_name: p.display_name ?? "Player" }));
      fl.sort((a, b) => (a.user_id === preTo ? -1 : 0) - (b.user_id === preTo ? -1 : 0));
      setFriends(fl);
    }
  }, [preTo]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<Cat, number> = { all: 0, featured: 0, worldcup: 0, club: 0, records: 0 };
    (packs ?? []).forEach((p) => { c.all++; c[catOf(p)]++; });
    return c;
  }, [packs]);

  const shown = useMemo(() => {
    const list = (packs ?? []).filter((p) => cat === "all" || catOf(p) === cat);
    // Featured first (by order), then unplayed, then newest.
    return list.sort((a, b) =>
      (a.featuredOrder - b.featuredOrder) || (Number(a.played) - Number(b.played)) || b.createdAt.localeCompare(a.createdAt));
  }, [packs, cat]);

  async function playLive(friend: Friend) {
    if (!picked || busy) return;
    setBusy(`${friend.user_id}:live`); setErr(null);
    try {
      const res = await fetch("/api/room/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_mode: "h2h", pack_id: picked.id, question_count: bucket(picked.questionCount), name: "Quiz Battle" }),
      });
      const data = await res.json();
      if (!res.ok || !data.room?.id) { setErr(data.error ?? "Couldn't start the battle"); setBusy(null); return; }
      void fetch("/api/room/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: data.room.id, invitedUserId: friend.user_id }) });
      router.push(`/play/${data.room.id}`);
    } catch { setErr("Network error"); setBusy(null); }
  }

  async function sendScorecard(friend: Friend) {
    if (!picked || busy) return;
    setBusy(`${friend.user_id}:card`); setErr(null);
    try {
      const res = await fetch("/api/h2h/from-attempt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: picked.id, invitedUserId: friend.user_id }),
      });
      const data = await res.json();
      if (res.ok && data.id) { setSentTo(friend.display_name); return; }
      setErr(data.needsPlay ? "Play this quiz first to send a scorecard — or play live instead." : (data.error ?? "Couldn't send"));
      setBusy(null);
    } catch { setErr("Network error"); setBusy(null); }
  }

  if (sentTo) {
    return (
      <div className="min-h-dvh grid place-items-center bg-bg px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.35)" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <p className="font-display text-xl text-white">Sent to {sentTo}!</p>
          <p className="font-body text-sm text-text-muted mt-1.5">They&apos;ll get it in their Versus inbox and have to beat your score on {picked?.name}.</p>
          <Link href="/versus" className="inline-block mt-6 rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: TEAL, color: "#04231f" }}>Back to Versus →</Link>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-4"><BackPill href="/versus" label="Versus" tone="play" /></div>

        {picked ? (
          /* ── Step 2 — pick a friend + how to play ── */
          <>
            <div className="mt-3">
              <button onClick={() => { setPicked(null); setErr(null); }} className="font-body text-xs text-text-muted mb-2">← pick a different quiz</button>
              <p className="font-display text-2xl text-white leading-tight">Who are you playing?</p>
              <p className="font-body text-sm text-text-muted mt-1">{picked.name} · {picked.questionCount} questions</p>
            </div>
            {err && <p className="font-body text-sm mt-4" style={{ color: "#ff6b78" }}>{err}</p>}
            <div className="mt-4 space-y-2.5">
              {friends.length === 0 ? (
                <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                  <p className="font-body text-sm text-white">No friends yet</p>
                  <Link href="/versus?view=friends" className="font-body text-xs mt-1 inline-block" style={{ color: TEAL }}>Add some first →</Link>
                </div>
              ) : friends.map((f) => (
                <div key={f.user_id} className="rounded-2xl p-3.5 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-9 h-9 rounded-full flex items-center justify-center font-body font-bold text-sm flex-shrink-0" style={{ background: "rgba(255,255,255,0.06)", color: "#cfcfe6" }}>{initial(f.display_name)}</span>
                    <span className="flex-1 font-body text-sm font-semibold text-white truncate">{f.display_name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => playLive(f)} disabled={!!busy} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide disabled:opacity-60" style={{ background: TEAL, color: "#04231f" }}>
                      {busy === `${f.user_id}:live` ? "Starting…" : "Play live ▶"}
                    </button>
                    {picked.played && (
                      <button onClick={() => sendScorecard(f)} disabled={!!busy} className="flex-1 rounded-xl py-2.5 font-display text-sm tracking-wide disabled:opacity-60" style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>
                        {busy === `${f.user_id}:card` ? "Sending…" : "Send scorecard"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="font-body text-xs text-text-muted mt-4 leading-relaxed">
              <span style={{ color: "#cdeee7" }}>Play live</span> — you both get the same questions at the same time.{picked.played && <> <span style={{ color: "#cdeee7" }}>Send scorecard</span> — they play whenever and try to beat your score.</>}
            </p>
          </>
        ) : (
          /* ── Step 1 — browse the quiz library ── */
          <>
            <div className="mt-3">
              <p className="font-display text-2xl text-white leading-tight">Pick a quiz to battle</p>
              <p className="font-body text-sm text-text-muted mt-1">Choose one, then challenge a friend to it.</p>
            </div>

            {/* Category filter pills */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar mt-4 -mx-5 px-5">
              {CATS.filter((c) => c.key === "all" || counts[c.key] > 0).map((c) => {
                const active = c.key === cat;
                return (
                  <button key={c.key} onClick={() => setCat(c.key)} className="font-body text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all flex-shrink-0"
                    style={{ background: active ? "rgba(0,216,192,0.15)" : "rgba(255,255,255,0.04)", color: active ? TEAL : "#8a948f", border: `1px solid ${active ? "rgba(0,216,192,0.4)" : "transparent"}` }}>
                    {c.label} <span style={{ opacity: 0.6 }}>{counts[c.key]}</span>
                  </button>
                );
              })}
            </div>

            {packs === null ? (
              <p className="font-body text-sm text-text-muted mt-6">Loading quizzes…</p>
            ) : shown.length === 0 ? (
              <p className="font-body text-sm text-text-muted mt-6">No quizzes here right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 mt-4">
                {shown.map((p) => (
                  <button key={p.id} onClick={() => setPicked(p)} className="text-left rounded-2xl overflow-hidden active:scale-[0.97] transition-transform" style={{ background: "linear-gradient(160deg,#0e1611,#15211a)", border: "1px solid rgba(0,216,192,0.16)" }}>
                    <div className="relative flex items-center justify-center" style={{ height: 96, background: "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12), transparent 70%)" }}>
                      {p.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.cover} alt={p.name} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }} />
                      ) : (
                        <div className="flex items-center justify-center rounded-2xl font-display text-3xl text-white" style={{ width: 58, height: 58, background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.2)" }}>{initial(p.name)}</div>
                      )}
                      <span className="absolute top-2 right-2 font-display text-[11px] px-2 py-0.5 rounded-lg" style={{ background: "rgba(0,0,0,0.55)", color: TEAL, border: "1px solid rgba(0,216,192,0.3)" }}>{p.questionCount}Q</span>
                      {!p.played && <span className="absolute top-2 left-2 font-body text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md" style={{ background: TEAL, color: "#04231f" }}>New</span>}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="font-body text-[13px] font-bold text-white leading-snug line-clamp-2">{p.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
