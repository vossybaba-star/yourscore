import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { GridBackground } from "@/components/ui/GridBackground";
import { BottomNav } from "@/components/ui/BottomNav";
import { BackPill } from "@/components/ui/BackPill";
import { AddFriendCard } from "@/components/social/AddFriendCard";

// Public player profile — any signed-in player can look up any other player:
// their rank + record, the quizzes they've done, their recent head-to-heads,
// and one-tap ways to connect (add friend / challenge / play their runs).
//
// Cross-user reads (quiz_attempts, h2h_challenges) go through the SERVICE
// client: RLS scopes those tables to their owner, so the viewer's session
// would see nothing (the old version of this page had a permanently-empty
// "recent challenges" list for exactly that reason).

const TEAL = "#00d8c0";
const LIME = "#aeea00";
const GOLD = "#ffc233";
const RED = "#ff6b78";

interface RecentAttempt {
  id: string;
  score: number;
  max_score: number;
  completed_at: string;
  pack_name: string | null;
}

interface RecentBattle {
  id: string;
  otherName: string;
  packName: string;
  myScore: number;
  theirScore: number;
  when: string;
}

function AvatarCircle({ name, size = 72, avatarUrl }: { name: string; size?: number; avatarUrl?: string | null }) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt={name} className="rounded-full object-cover flex-shrink-0"
      style={{ width: size, height: size, border: "2px solid rgba(255,255,255,0.1)" }} />;
  }
  const palettes = [
    { bg: "#1a2f4a", text: "#60a5fa" }, { bg: "#3a423d", text: "#aeea00" },
    { bg: "#1a4a2a", text: "#4ade80" }, { bg: "#4a2a1a", text: "#fb923c" },
    { bg: "#4a1a2a", text: "#f87171" },
  ];
  const c = palettes[(name.charCodeAt(0) || 0) % palettes.length];
  return (
    <div className="rounded-full flex items-center justify-center font-body font-bold flex-shrink-0"
      style={{ width: size, height: size, background: c.bg, color: c.text, fontSize: size * 0.38, border: "2px solid rgba(255,255,255,0.1)" }}>
      {(name[0] ?? "?").toUpperCase()}
    </div>
  );
}

export default async function PublicProfilePage({ params }: { params: { userId: string } }) {
  const userId = params.userId;
  const supabase = await createClient();

  // Viewing your own profile → redirect to the personal page (server-side).
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === userId) redirect("/profile");

  const db = createServiceClient();

  const { data: profile } = await db
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .single();

  if (!profile) {
    return (
      <main className="min-h-dvh bg-bg flex flex-col items-center justify-center px-6 gap-4">
        <p className="font-display text-5xl">🤔</p>
        <p className="font-display text-2xl text-white">Player not found</p>
        <Link href="/versus" className="font-body text-sm" style={{ color: LIME }}>← Versus</Link>
      </main>
    );
  }

  // Independent reads in parallel: rank card (RPC also carries W-D-L), league
  // memberships, their recent quizzes, their recent head-to-head battles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (db as any).rpc("get_yourscore_rank", { p_user_id: userId });
  const [{ data: rankRows }, { count: leagues }, { data: att }, { data: h2h }] = await Promise.all([
    rpc,
    db.from("league_members").select("*", { count: "exact", head: true }).eq("user_id", userId),
    db.from("quiz_attempts")
      .select("id, score, max_score, completed_at, pack_id")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false })
      .limit(8),
    db.from("h2h_challenges")
      .select("id, challenger_id, opponent_id, challenger_name, challenger_score, opponent_score, quiz_pack_name, created_at")
      .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
      .not("opponent_score", "is", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const rank = (rankRows?.[0] ?? null) as
    | { overall_score: number; overall_rank: number; tier: string | null; wins: number; draws: number; losses: number }
    | null;

  // Recent quizzes with pack names.
  let attempts: RecentAttempt[] = [];
  if (att?.length) {
    const packIds = Array.from(new Set(att.map((a) => a.pack_id).filter(Boolean)));
    const packNames: Record<string, string> = {};
    if (packIds.length > 0) {
      const { data: packs } = await db.from("quiz_packs").select("id, name").in("id", packIds);
      (packs ?? []).forEach((pk) => { packNames[pk.id] = pk.name; });
    }
    attempts = att.map((a) => ({
      id: a.id, score: a.score, max_score: a.max_score,
      completed_at: a.completed_at, pack_name: packNames[a.pack_id] ?? null,
    }));
  }

  // Recent battles, framed from THIS player's side. Opponent names resolved in
  // one batch (challenger_name is stored; the invited side needs profiles).
  let battles: RecentBattle[] = [];
  if (h2h?.length) {
    const otherIds = Array.from(new Set(
      h2h.map((c) => (c.challenger_id === userId ? c.opponent_id : c.challenger_id)).filter(Boolean),
    )) as string[];
    const { data: profs } = otherIds.length
      ? await db.from("profiles").select("id, display_name").in("id", otherIds)
      : { data: [] as { id: string; display_name: string | null }[] };
    const nameById = new Map((profs ?? []).map((p) => [p.id, p.display_name ?? "Player"]));
    battles = h2h.map((c) => {
      const iAmChallenger = c.challenger_id === userId;
      return {
        id: c.id,
        otherName: iAmChallenger
          ? (c.opponent_id ? nameById.get(c.opponent_id) ?? "Player" : "Player")
          : c.challenger_name ?? "Player",
        packName: c.quiz_pack_name ?? "Quiz Battle",
        myScore: iAmChallenger ? c.challenger_score ?? 0 : c.opponent_score ?? 0,
        theirScore: iAmChallenger ? c.opponent_score ?? 0 : c.challenger_score ?? 0,
        when: c.created_at ?? "",
      };
    });
  }

  const name = profile.display_name ?? "Player";
  const avgAcc = attempts.length > 0
    ? Math.round(attempts.reduce((s, a) => s + (a.max_score > 0 ? a.score / a.max_score : 0), 0) / attempts.length * 100)
    : null;

  return (
    <main className="min-h-dvh bg-bg pb-28">
      <GridBackground opacity={0.02} />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-5 py-4 max-w-lg mx-auto">
        <BackPill href="/versus" label="Versus" tone="neutral" />
        <span className="font-body text-xs px-3 py-1 rounded-full"
          style={{ background: "rgba(174,234,0,0.1)", color: LIME, border: "1px solid rgba(174,234,0,0.2)" }}>
          Player Profile
        </span>
      </nav>

      <div className="relative z-0 max-w-lg mx-auto px-5 space-y-5">

        {/* Avatar + name + rank */}
        <div className="flex items-center gap-4">
          <AvatarCircle name={name} size={72} avatarUrl={profile.avatar_url} />
          <div className="flex-1 min-w-0">
            <p className="font-display text-3xl text-white tracking-wide truncate">{name.toUpperCase()}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {rank && (
                <span className="font-body text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(174,234,0,0.12)", color: LIME, border: "1px solid rgba(174,234,0,0.2)" }}>
                  #{rank.overall_rank} global
                </span>
              )}
              {rank?.tier && (
                <span className="font-body text-xs px-2 py-0.5 rounded-full"
                  style={{ background: `${GOLD}1f`, color: GOLD, border: `1px solid ${GOLD}33` }}>
                  {rank.tier}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Connect: add friend (hides itself when you already are) + challenge */}
        <AddFriendCard userId={userId} displayName={name} />
        <div className="flex gap-2">
          <Link href={`/versus/quiz?to=${userId}`} className="flex-1 text-center rounded-xl py-3 font-display text-sm tracking-wide active:scale-[0.98] transition-transform" style={{ background: TEAL, color: "#04231f" }}>
            CHALLENGE THEM
          </Link>
          <Link href={`/versus/shadow/${userId}`} className="flex-1 text-center rounded-xl py-3 font-display text-sm tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(0,216,192,0.12)", color: TEAL, border: `1px solid ${TEAL}33` }}>
            PLAY THEIR RUNS
          </Link>
        </div>

        {/* Games record — head-to-heads across both games (rank RPC W-D-L) */}
        {rank && (rank.wins + rank.draws + rank.losses > 0) && (
          <div className="rounded-2xl p-5 flex items-center gap-2" style={{ background: "linear-gradient(150deg, #15211a, #0c1613)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {([
              [String(rank.wins), "Wins", GOLD],
              [String(rank.draws), "Draws", "#8a948f"],
              [String(rank.losses), "Losses", RED],
              [(rank.overall_score ?? 0).toLocaleString(), "Score", LIME],
            ] as const).map(([v, label, color], i) => (
              <div key={label} className="flex-1 text-center" style={i ? { borderLeft: "1px solid rgba(255,255,255,0.08)" } : undefined}>
                <p className="font-display text-2xl leading-none" style={{ color }}>{v}</p>
                <p className="font-body text-[10px] uppercase tracking-widest text-text-muted mt-1.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Leagues", value: String(leagues ?? 0), color: LIME },
            { label: "Avg accuracy", value: avgAcc !== null ? `${avgAcc}%` : "—", color: "#ffb800" },
          ].map(s => (
            <div key={s.label} className="rounded-2xl px-5 py-4 bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-display text-3xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="font-body text-xs text-text-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Recent head-to-heads */}
        {battles.length > 0 && (
          <div>
            <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Recent battles</p>
            <div className="space-y-2">
              {battles.map((b) => {
                const draw = b.myScore === b.theirScore, won = b.myScore > b.theirScore;
                const col = draw ? "#8a948f" : won ? GOLD : RED;
                return (
                  <div key={b.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="font-display text-lg w-5 text-center flex-shrink-0" style={{ color: col }}>{draw ? "D" : won ? "W" : "L"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">vs {b.otherName}</p>
                      <p className="font-body text-xs truncate" style={{ color: "#586058" }}>{b.packName}</p>
                    </div>
                    <p className="font-display text-sm text-white flex-shrink-0">{b.myScore.toLocaleString()}–{b.theirScore.toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* The quizzes they've done */}
        <div>
          <p className="font-body text-xs text-text-muted uppercase tracking-widest mb-3">Quizzes played</p>
          {attempts.length === 0 ? (
            <div className="rounded-2xl p-6 text-center bg-surface" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="font-body text-sm text-text-muted">No quizzes played yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {attempts.map(a => {
                const pct = a.max_score > 0 ? Math.round(a.score / a.max_score * 100) : 0;
                const pctColor = pct >= 80 ? LIME : pct >= 50 ? "#ffb800" : "#f87171";
                const date = new Date(a.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-surface"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm font-medium text-white truncate">
                        {a.pack_name ?? "Challenge"}
                      </p>
                      <p className="font-body text-xs" style={{ color: "#586058" }}>{date}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-display text-lg leading-none" style={{ color: pctColor }}>{pct}%</p>
                      <p className="font-body text-xs" style={{ color: "#586058" }}>
                        {a.score}/{a.max_score} pts
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
