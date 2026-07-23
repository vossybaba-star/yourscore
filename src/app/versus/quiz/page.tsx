"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { coverUrl } from "@/lib/img";
import { BackPill } from "@/components/ui/BackPill";
import { clubKey, clubRankMap, UNRANKED, type ClubPopularity } from "@/lib/clubs/popularity";

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
  // club key → 0-based popularity rank among our own players. Versus-only: the
  // shared quiz_packs.featured flag is left alone so the home hero and the solo
  // Quiz hub keep their current order (founder call, 2026-07-23).
  const [clubRank, setClubRank] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    fetch("/api/clubs/popularity")
      .then((r) => r.json())
      .then((d: { clubs?: ClubPopularity[] }) => setClubRank(clubRankMap(d.clubs ?? [])))
      .catch(() => { /* leave empty — the picker falls back to its old order */ });
  }, []);

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

    // Friends — loaded after, for step 2. A ?to= target who isn't a friend yet
    // (suggested opponent from the Play tab) is fetched and pinned on top, so
    // "Play" on a stranger's card still lands somewhere useful.
    const frRes = await db.from("friendships").select("user_id, friend_id, status").or(`user_id.eq.${uid},friend_id.eq.${uid}`);
    const ids = ((frRes.data ?? []) as Row[]).filter((r) => r.status === "accepted").map((r) => (r.user_id === uid ? r.friend_id : r.user_id)).filter(Boolean);
    const fetchIds = preTo && preTo !== uid && !ids.includes(preTo) ? [...ids, preTo] : ids;
    if (fetchIds.length) {
      const { data: profs } = await db.from("profiles").select("id, display_name").in("id", fetchIds);
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

  // Lead with clubs, most-supported first (founder rule, 2026-07-23). A club
  // pack outranks everything else; anything unranked keeps the old ordering
  // behind it, so an empty/failed popularity fetch degrades to the previous
  // featured-then-newest behaviour rather than to nothing.
  const rankOf = useCallback((p: Pack) => (
    p.type === "club" ? (clubRank.get(clubKey(p.name)) ?? UNRANKED) : UNRANKED
  ), [clubRank]);

  const featuredHero = useMemo(() => {
    const byRank = (packs ?? []).slice().sort((a, b) => rankOf(a) - rankOf(b));
    if (byRank[0] && rankOf(byRank[0]) < UNRANKED) return byRank[0];
    const featured = (packs ?? []).filter((p) => p.featured).sort((a, b) => a.featuredOrder - b.featuredOrder);
    return featured[0] ?? (packs ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [packs, rankOf]);

  const popular = useMemo(() => {
    const pool = (packs ?? []).filter((p) => p.id !== featuredHero?.id);
    return pool.sort((a, b) =>
      (rankOf(a) - rankOf(b))
      || (a.featuredOrder - b.featuredOrder)
      || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  }, [packs, featuredHero, rankOf]);

  async function playLive(friend: Friend | null) {
    if (!picked || busy) return;
    setBusy(friend ? `${friend.user_id}:live` : "code"); setErr(null);
    try {
      const res = await fetch("/api/room/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_mode: "h2h", pack_id: picked.id, question_count: bucket(picked.questionCount), name: "Quiz Battle" }),
      });
      const data = await res.json();
      if (!res.ok || !data.room?.id) { setErr(data.error ?? "Couldn't start the battle"); setBusy(null); return; }
      // No friend picked = share-a-code path: the lobby shows the code to share.
      if (friend) void fetch("/api/room/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: data.room.id, invitedUserId: friend.user_id }) });
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
        <div className="pt-4"><BackPill fallback="/versus" label="Back" tone="play" /></div>

        {picked ? (
          /* ── Step 2 — pick a friend + how to play ── */
          <>
            <div className="mt-3">
              <button onClick={() => { setPicked(null); setErr(null); }} className="font-body text-xs text-text-muted mb-2">← pick a different quiz</button>
              <p className="font-display text-2xl text-white leading-tight">Who are you playing?</p>
              <p className="font-body text-sm text-text-muted mt-1">{picked.name} · {picked.questionCount} questions</p>
            </div>
            {err && <p className="font-body text-sm mt-4" style={{ color: "#ff6b78" }}>{err}</p>}

            {/* Find an opponent — the no-friends-needed path: instant match on
                THIS quiz (human first, then a real player's shadow, then CPU). */}
            <Link href={`/versus/find?game=quiz&pack=${picked.id}`} className="mt-4 w-full flex items-center gap-3.5 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform" style={{ background: `linear-gradient(120deg, ${TEAL}, #00b3a0)`, border: `1px solid ${TEAL}` }}>
              <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: "rgba(4,35,31,0.25)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#04231f" strokeWidth="1.5" opacity="0.4" /><circle cx="10" cy="10" r="4.5" stroke="#04231f" strokeWidth="1.5" opacity="0.7" /><circle cx="10" cy="10" r="1.6" fill="#04231f" /><path d="M10 10 16 4.5" stroke="#04231f" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-display text-base leading-none tracking-wide" style={{ color: "#04231f" }}>FIND AN OPPONENT</span>
                <span className="block font-body text-xs mt-1" style={{ color: "#04231fb3" }}>Get matched on this quiz — no friends needed</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: "#04231f", flexShrink: 0 }}><path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>

            <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2.5" style={{ color: "#586058" }}>Or play a friend</p>
            <div className="space-y-2.5">
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
            {/* Share a code — start the lobby without an invite and share from there */}
            <button onClick={() => playLive(null)} disabled={!!busy} className="w-full rounded-2xl py-3 mt-4 font-display text-sm tracking-wide disabled:opacity-60" style={{ background: "rgba(255,255,255,0.04)", color: "#eef2f0", border: "1px solid rgba(255,255,255,0.12)" }}>
              {busy === "code" ? "Starting…" : "OR START A LOBBY & SHARE THE CODE →"}
            </button>
            <p className="font-body text-xs text-text-muted mt-4 leading-relaxed">
              <span style={{ color: "#cdeee7" }}>Play live</span> — you both get the same questions at the same time.{picked.played && <> <span style={{ color: "#cdeee7" }}>Send scorecard</span> — they play whenever and try to beat your score.</>}
            </p>
          </>
        ) : (
          /* ── Step 1 — browse the quiz library ── */
          <>
            <div className="mt-4">
              <p className="font-body text-[11px] font-bold uppercase tracking-[0.32em] mb-2" style={{ color: TEAL }}>Quiz Battle · Versus</p>
              <p className="font-display text-white leading-[0.92]" style={{ fontSize: 34 }}>PICK A QUIZ.<br />BEAT YOUR OPPONENT.</p>
              <p className="font-body text-sm text-text-muted mt-2">Both players answer the same questions. Best score wins.</p>
            </div>

            {/* Featured — big cover card, tap to pick */}
            {featuredHero && (
              <>
                <p className="font-body text-xs font-bold uppercase tracking-widest mt-5 mb-2.5" style={{ color: "#586058" }}>Featured</p>
                <button onClick={() => setPicked(featuredHero)} className="w-full text-left rounded-3xl overflow-hidden active:scale-[0.99] transition-transform" style={{ border: `1px solid ${TEAL}40` }}>
                  <div className="relative" style={{ height: 150, background: "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.15), #0b1310 70%)" }}>
                    {featuredHero.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      // Backdrop crop: designed covers bake their title into the TOP and this
                      // hero overlays its own HTML title — crop from the bottom (pure art).
                      <img src={coverUrl(featuredHero.cover, 480) ?? featuredHero.cover} alt="" className="absolute inset-0 w-full h-full object-cover object-bottom" />
                    )}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,13,10,0) 30%, rgba(8,13,10,0.9) 100%)" }} />
                    {/* "New" means you haven't played it, same as the grid cards.
                        It used to be hardcoded, so the hero claimed New even for
                        a quiz you'd already played. */}
                    {!featuredHero.played && <span className="absolute top-2.5 left-2.5 font-body text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md" style={{ background: TEAL, color: "#04231f" }}>New</span>}
                    <span className="absolute top-2.5 right-2.5 font-display text-[11px] px-2 py-0.5 rounded-lg" style={{ background: "rgba(0,0,0,0.55)", color: TEAL, border: "1px solid rgba(0,216,192,0.3)" }}>{featuredHero.questionCount}Q</span>
                    <div className="absolute bottom-0 left-0 right-0 p-4 flex items-end justify-between gap-3">
                      <p className="font-body text-[15px] font-bold text-white leading-snug min-w-0">{featuredHero.name}</p>
                      <span className="font-display text-[11px] tracking-wide px-3.5 py-2 rounded-lg flex-shrink-0" style={{ background: TEAL, color: "#04231f" }}>PLAY QUIZ →</span>
                    </div>
                  </div>
                </button>
              </>
            )}

            {/* Popular — swipeable covers */}
            {popular.length > 0 && (
              <>
                <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-2.5" style={{ color: "#586058" }}>Popular quizzes</p>
                <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5">
                  {popular.map((p) => (
                    <button key={p.id} onClick={() => setPicked(p)} className="flex-shrink-0 text-left rounded-2xl overflow-hidden active:scale-[0.97] transition-transform" style={{ width: 108, border: "1px solid rgba(0,216,192,0.18)" }}>
                      {/* Cover = a designed card, shown whole (square zone matches it); fallback keeps the short banner */}
                      <div className="relative" style={p.cover ? { aspectRatio: "1 / 1" } : { height: 76, background: "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12), #0b1310 70%)" }}>
                        {p.cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={coverUrl(p.cover, 108) ?? p.cover} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 grid place-items-center font-display text-2xl text-white">{initial(p.name)}</div>
                        )}
                        {!p.played && <span className="absolute top-1.5 left-1.5 font-body text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: TEAL, color: "#04231f" }}>New</span>}
                        <span className="absolute top-1.5 right-1.5 font-display text-[10px] px-1.5 rounded" style={{ background: "rgba(0,0,0,0.55)", color: TEAL }}>{p.questionCount}Q</span>
                      </div>
                      <p className="font-body text-[11px] font-semibold text-white leading-snug line-clamp-2 px-2 py-2" style={{ background: "#0e1611" }}>{p.name}</p>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* All quizzes — full library with filters */}
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-6 mb-1" style={{ color: "#586058" }}>All quizzes</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 -mx-5 px-5">
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
                    {/* Cover = a designed card, shown whole; fallback keeps the short banner */}
                    <div className="relative flex items-center justify-center" style={p.cover ? undefined : { height: 96, background: "radial-gradient(ellipse at 50% 80%, rgba(0,216,192,0.12), transparent 70%)" }}>
                      {p.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={coverUrl(p.cover, 220) ?? p.cover} alt={p.name} loading="lazy" decoding="async" className="block w-full h-auto" />
                      ) : (
                        <div className="flex items-center justify-center rounded-2xl font-display text-3xl text-white" style={{ width: 58, height: 58, background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.2)" }}>{initial(p.name)}</div>
                      )}
                      <span className={`absolute ${p.cover ? "bottom-2" : "top-2"} right-2 font-display text-[11px] px-2 py-0.5 rounded-lg`} style={{ background: "rgba(0,0,0,0.55)", color: TEAL, border: "1px solid rgba(0,216,192,0.3)" }}>{p.questionCount}Q</span>
                      {!p.played && <span className={`absolute ${p.cover ? "bottom-2" : "top-2"} left-2 font-body text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md`} style={{ background: TEAL, color: "#04231f" }}>New</span>}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="font-body text-[13px] font-bold text-white leading-snug line-clamp-2">{p.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* How do you want to play? */}
            <p className="font-body text-xs font-bold uppercase tracking-widest mt-7 mb-2.5" style={{ color: "#586058" }}>How do you want to play?</p>
            <div className="space-y-2.5">
              {([
                {
                  title: "FIND OPPONENT", sub: "Get matched instantly", href: "/versus/find?game=quiz",
                  icon: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke={TEAL} strokeWidth="1.5" opacity="0.4" /><circle cx="10" cy="10" r="4.5" stroke={TEAL} strokeWidth="1.5" opacity="0.7" /><circle cx="10" cy="10" r="1.6" fill={TEAL} /><path d="M10 10 16 4.5" stroke={TEAL} strokeWidth="1.5" strokeLinecap="round" /></svg>,
                },
                {
                  title: "CHALLENGE FRIEND", sub: "Send a scorecard from a quiz you've played", href: "/versus/challenge",
                  icon: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M17.5 2.5 9 11M17.5 2.5 12 17.5l-3-6.5-6.5-3L17.5 2.5Z" stroke={TEAL} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>,
                },
                {
                  title: "SHARE CODE", sub: "Start a Lobby and invite anyone", href: "/play/new",
                  icon: <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="4.5" width="16" height="11" rx="2.5" stroke={TEAL} strokeWidth="1.5" /><path d="M6 9.5h.01M10 9.5h.01M14 9.5h.01" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" /></svg>,
                },
              ] as const).map((row) => (
                <Link key={row.title} href={row.href} className="w-full flex items-center gap-3.5 rounded-2xl px-4 py-4 text-left active:scale-[0.99] transition-transform" style={{ background: "#0e1611", border: "1px solid rgba(0,216,192,0.22)" }}>
                  <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: "rgba(0,216,192,0.1)", border: "1px solid rgba(0,216,192,0.28)" }}>{row.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-display text-base text-white leading-none tracking-wide">{row.title}</span>
                    <span className="block font-body text-xs text-text-muted mt-1">{row.sub}</span>
                  </span>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: TEAL, flexShrink: 0 }}><path d="M6 3l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
