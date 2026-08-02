/**
 * The Scout page cover — a tactical "radar" sweep in the app's teal-on-pitch
 * language (per the founder's reference), condensed to a short band. It self-
 * fetches real data: the players on the radar are the most-owned in the game
 * right now (a fact, not a pick — "who everyone's watching"), with their real
 * SportMonks headshots; the NEXT FIXTURES list is the top player's club's actual
 * upcoming run. Everything degrades: no data → the radar still renders clean.
 *
 * Async server component (the Scout pages are ISR); one snapshot read + one feed
 * read, both cheap and cache-friendly.
 */
import { createClient } from "@supabase/supabase-js";
import { enginePool } from "@/lib/fantasy/pool";
import { faceUrlById, faceFor } from "@/lib/fantasy/faces";

const TEAL = "#00d8c0";
const INK = "#eef2f0";
const MUTED = "#8a948f";
// Local copy of the position palette (this is a server component; matches shared.tsx POS_COLOR).
const POS_HUE: Record<string, string> = { GK: "#f4a63a", DEF: "#00d8c0", MID: "#8ad14f", FWD: "#ff7a85" };

type Featured = { id: number; name: string; pos: string; club: string; face: string };
type Fix = { opp: string; home: boolean };

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, next: { revalidate: 600 } }),
      },
    },
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

async function loadCover(): Promise<{ featured: Featured[]; fixtures: Fix[]; club: string } | null> {
  try {
    const client = db();
    const { data: latest } = await client
      .from("fantasy_fpl_snapshot").select("captured_at")
      .order("captured_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest) return null;
    const { data: rows } = await client
      .from("fantasy_fpl_snapshot")
      .select("player_id, web_name, position, selected_by_percent")
      .eq("captured_at", (latest as { captured_at: string }).captured_at)
      .order("selected_by_percent", { ascending: false })
      .limit(10);

    const byId = new Map(enginePool().map((p) => [p.id, p]));
    const featured: Featured[] = [];
    for (const r of (rows ?? []) as { player_id: number; web_name: string; position: string }[]) {
      const pp = byId.get(r.player_id);
      const face = faceUrlById(r.player_id) ?? (pp ? faceFor(pp.name) : undefined);
      if (!face) continue;
      featured.push({ id: r.player_id, name: r.web_name, pos: r.position, club: pp?.club ?? "", face });
      if (featured.length >= 4) break;
    }
    if (!featured.length) return null;

    // NEXT FIXTURES — the top player's club's real upcoming run (match by name,
    // sidestepping the SportMonks-vs-FPL club-id mismatch).
    let fixtures: Fix[] = [];
    const topClub = featured[0].club;
    if (topClub) {
      const { data: feed } = await client
        .from("fantasy_news_feed").select("doc")
        .order("gw", { ascending: false }).limit(1).maybeSingle();
      const runs = (feed as { doc?: { fixtures?: { runs?: { club: string; cells?: { oppShort: string; home: boolean }[] }[] } } } | null)
        ?.doc?.fixtures?.runs ?? [];
      // Pool short names vs SportMonks full names: alias the common ones, then
      // match on exact / contains / shared 5-char prefix.
      const ALIAS: Record<string, string> = {
        "man city": "manchester city", "man utd": "manchester united",
        "spurs": "tottenham", "nott'm forest": "nottingham forest",
        "wolves": "wolverhampton", "newcastle": "newcastle united",
        "brighton": "brighton hove albion", "west ham": "west ham united",
      };
      const t = norm(ALIAS[topClub.toLowerCase()] ?? topClub);
      const run = runs.find((r) => {
        const c = norm(r.club);
        return c === t || c.includes(t) || t.includes(c) || c.slice(0, 5) === t.slice(0, 5);
      });
      fixtures = (run?.cells ?? []).slice(0, 5).map((c) => ({ opp: c.oppShort, home: c.home }));
    }
    return { featured, fixtures, club: topClub };
  } catch {
    return null;
  }
}

// Face slots on the radar (viewBox 720×230 coords). Kept clear of the fixtures
// column on the left and the right edge so names don't clip; scattered like blips.
const SLOTS = [
  { cx: 352, cy: 66 },
  { cx: 566, cy: 92 },
  { cx: 452, cy: 166 },
  { cx: 612, cy: 158 },
];
// Decorative blip markers (X/O) that aren't a player.
const BLIPS: { x: number; y: number; o: boolean }[] = [
  { x: 300, y: 150, o: false }, { x: 690, y: 112, o: true },
  { x: 312, y: 84, o: true }, { x: 540, y: 190, o: false },
];

export async function ScoutCover() {
  const data = await loadCover();
  const featured = data?.featured ?? [];
  const fixtures = data?.fixtures ?? [];

  const CX = 445, CY = 100; // radar centre
  const rings = [24, 48, 72, 94];

  return (
    <div style={{
      position: "relative", width: "100%", borderRadius: 16, overflow: "hidden",
      border: `1px solid ${TEAL}30`, background: "#081310", marginBottom: 12,
      aspectRatio: "720 / 165",
    }}>
      <svg viewBox="0 0 720 230" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"
        role="img" aria-label={`The Scout radar. Most-owned players: ${featured.map((f) => f.name).join(", ")}.`}>
        <defs>
          <linearGradient id="scoutBeam" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={TEAL} stopOpacity="0.55" />
            <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
          </linearGradient>
          {featured.map((f, i) => (
            <clipPath key={i} id={`scoutFace${i}`}><circle cx={SLOTS[i].cx} cy={SLOTS[i].cy} r="24" /></clipPath>
          ))}
        </defs>

        <rect width="720" height="230" fill="#081310" />

        {/* rings + crosshair */}
        <g fill="none" stroke={TEAL} strokeOpacity="0.16" strokeWidth="1.2">
          {rings.map((r) => <circle key={r} cx={CX} cy={CY} r={r} />)}
          <line x1={CX - 102} y1={CY} x2={CX + 102} y2={CY} strokeDasharray="3 5" />
          <line x1={CX} y1={CY - 96} x2={CX} y2={CY + 96} strokeDasharray="3 5" />
        </g>
        {/* outer tick marks */}
        <g stroke={TEAL} strokeOpacity="0.22" strokeWidth="1.2">
          {Array.from({ length: 36 }).map((_, i) => {
            const a = (i * 10 * Math.PI) / 180;
            const r1 = 100, r2 = i % 3 === 0 ? 92 : 96;
            return <line key={i} x1={CX + r1 * Math.cos(a)} y1={CY + r1 * Math.sin(a)} x2={CX + r2 * Math.cos(a)} y2={CY + r2 * Math.sin(a)} />;
          })}
        </g>

        {/* static sweep beam (a fixed radar wedge, no animation) */}
        <path d={`M ${CX} ${CY} L ${CX + 96} ${CY - 38} A 103 103 0 0 1 ${CX + 100} ${CY + 6} Z`} fill="url(#scoutBeam)" />
        {/* centre */}
        <circle cx={CX} cy={CY} r="9" fill={TEAL} fillOpacity="0.25" />
        <circle cx={CX} cy={CY} r="5" fill={TEAL} />

        {/* decorative blips */}
        <g stroke={TEAL} strokeOpacity="0.4" strokeWidth="2.4" fill="none">
          {BLIPS.map((b, i) => b.o
            ? <circle key={i} cx={b.x} cy={b.y} r="6" />
            : <g key={i}><line x1={b.x - 5} y1={b.y - 5} x2={b.x + 5} y2={b.y + 5} /><line x1={b.x + 5} y1={b.y - 5} x2={b.x - 5} y2={b.y + 5} /></g>)}
        </g>

        {/* NEXT FIXTURES — the background layer. The Scout is reading the next
            fixtures; the headline sits ON TOP of them (founder's call). Kept faint
            so the big headline reads clearly over it. */}
        <g opacity="0.3">
          <text x="38" y="42" fill={TEAL} fontSize="13" letterSpacing="2" fontFamily="var(--font-bebas), sans-serif">NEXT FIXTURES</text>
          {(fixtures.length ? fixtures.slice(0, 4) : [{ opp: "", home: true }]).map((f, i) => (
            f.opp
              ? <text key={i} x="38" y={68 + i * 27} fill={INK} fontSize="16" fontFamily="var(--font-dm-sans), sans-serif" letterSpacing="1">{f.opp} ({f.home ? "H" : "A"})</text>
              : <text key={i} x="38" y="68" fill={MUTED} fontSize="14" fontFamily="var(--font-dm-sans), sans-serif">Fixtures land soon</text>
          ))}
        </g>

        {/* Heading — big, overlaying the fixtures (founder's call). The Scout
            looks at the fixtures and works out the players. */}
        <text x="34" y="112" fill={INK} fontSize="52" letterSpacing="0.5" fontFamily="var(--font-bebas), sans-serif">YOURSCORE</text>
        <text x="34" y="166" fill={TEAL} fontSize="54" letterSpacing="0.5" fontFamily="var(--font-bebas), sans-serif">SCOUT</text>

        {/* player blips — real headshots, each a link into that player's profile
            (the Players tab opens the profile sheet from the ?focus id), so a
            face that looks tappable actually is. */}
        {featured.map((f, i) => {
          const s = SLOTS[i];
          return (
            <a key={f.id} href={`/fantasy/scout/players?focus=${f.id}`} aria-label={`${f.name} profile`} style={{ cursor: "pointer" }}>
              <circle cx={s.cx} cy={s.cy} r="27" fill="#081310" />
              <image href={f.face} x={s.cx - 24} y={s.cy - 24} width="48" height="48" clipPath={`url(#scoutFace${i})`} preserveAspectRatio="xMidYMid slice" />
              <circle cx={s.cx} cy={s.cy} r="24" fill="none" stroke={TEAL} strokeWidth="2" />
              <text x={s.cx} y={s.cy + 40} fill={INK} fontSize="13.5" fontWeight="700" textAnchor="middle" fontFamily="var(--font-dm-sans), sans-serif">{f.name}</text>
              <text x={s.cx} y={s.cy + 55} fill={POS_HUE[f.pos] ?? MUTED} fontSize="10.5" fontWeight="700" letterSpacing="1" textAnchor="middle" fontFamily="var(--font-dm-sans), sans-serif">{f.pos}</text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}
