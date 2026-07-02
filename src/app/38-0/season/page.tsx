"use client";

/**
 * /38-0/season — simulate the 38-game season and show how the XI performed.
 * Plays the matches out (with a Skip), then the end-of-season stats: finish vs
 * projection + verdict, narrative, record, GF/GA, and season awards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadTeam, isComplete, seasonSeed, makeSeasonSalt, saveLastSeason, loadLastSeason, type LocalTeam } from "@/lib/draft/local";
import { leagueOpponents, ensurePool, isPoolReady } from "@/lib/draft/pool";
import { simulateSeason, seasonNarrative, type SeasonResult } from "@/lib/draft/season";
import { SeasonScorecard, type SeasonAward, type SeasonData } from "@/components/draft/SeasonScorecard";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/useUser";
import { trackShare } from "@/lib/analytics/trackGame";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function SeasonSim() {
  const router = useRouter();
  const { user } = useUser();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  // Player pool (~2.6MB) loads on demand; the season sim below needs it.
  const [poolReady, setPoolReady] = useState(isPoolReady());
  useEffect(() => { let off = false; ensurePool().then(() => { if (!off) setPoolReady(true); }).catch(() => {}); return () => { off = true; }; }, []);
  const [shown, setShown] = useState(0); // matches revealed
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [giveawayOpen, setGiveawayOpen] = useState(false);
  const [invincibleOpen, setInvincibleOpen] = useState(false);
  const giveawayShown = useRef(false);
  const recordSubmitted = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    if (!t || !isComplete(t)) { router.replace("/38-0"); return; }
    setTeam(t);
  }, [router]);

  // The XI's identity (cache key + server fingerprint).
  const xiSeed = team ? seasonSeed(team) : "";
  // The roll already saved for THIS XI on this device, if any.
  const storedForXi = useMemo(() => {
    if (!team) return null;
    const last = loadLastSeason();
    return last && last.seed === xiSeed && last.salt ? last : null;
  }, [team, xiSeed]);
  // Per-play salt: reuse this XI's saved roll, else start a fresh one. So the same
  // XI shows a stable season on revisit, but a DIFFERENT player (different device /
  // no cache) rolls their own — a copied XI no longer guarantees the same result.
  const salt = useMemo(() => storedForXi?.salt ?? makeSeasonSalt(), [storedForXi]);
  const playSeed = xiSeed ? `${xiSeed}:${salt}` : "";
  const result: SeasonResult | null = useMemo(
    () => (team && poolReady ? simulateSeason(team.squad, team.formation, team.strength, playSeed, leagueOpponents(team.league)) : null),
    [team, playSeed, poolReady]
  );
  // Already-rolled this exact season → skip straight to the result.
  const cached = !!storedForXi && storedForXi.salt === salt;

  useEffect(() => {
    if (!result) return;
    if (cached) { setShown(38); setDone(true); return; }
    timer.current = setInterval(() => {
      setShown((n) => {
        if (n >= 38) {
          if (timer.current) clearInterval(timer.current);
          setDone(true);
          saveLastSeason(xiSeed, salt, result);
          return 38;
        }
        return n + 1;
      });
    }, 90);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [result, cached, xiSeed, salt]);

  // Hoisted above the early-return so ensureShortUrl can be called from the
  // auto-show effect (700ms before the giveaway overlay opens).
  function shareParams(): URLSearchParams {
    if (!result || !team) return new URLSearchParams();
    const xi = team.squad.map((p) => `${p.position}~${p.name}~${p.overall}`).join("|");
    return new URLSearchParams({
      w: String(result.wins), d: String(result.draws), l: String(result.losses),
      pts: String(result.points), pos: String(result.position), ovr: String(team.strength),
      mode: team.mode === "expert" ? "Expert" : "Normal",
      inv: result.invincible ? "1" : "",
      boot: result.goldenBoot ? `${result.goldenBoot.name}~${result.goldenBoot.goals}` : "",
      pots: result.playerOfTheSeason ? `${result.playerOfTheSeason.name}~${result.playerOfTheSeason.goals}~${result.playerOfTheSeason.assists}` : "",
      xi,
      gf: String(result.gf), ga: String(result.ga),
      verdict: result.verdict ?? "",
      form: team.formation ?? "",
      play: result.playmaker ? `${result.playmaker.name}~${result.playmaker.assists}` : "",
      glov: result.goldenGlove ? `${result.goldenGlove.name}~${result.goldenGlove.cleanSheets}` : "",
    });
  }

  async function ensureShortUrl(): Promise<void> {
    if (shortUrl || !result || !team) return;
    try {
      const payload = Object.fromEntries(shareParams().entries());
      const res = await fetch("/api/draft/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) return;
      const { id } = await res.json();
      if (id) setShortUrl(`${window.location.origin}/s/${id}`);
    } catch { /* keep the long fallback */ }
  }

  // When the season first completes: an Invincible (38-0) earns the full-screen
  // gold celebration; everyone else gets the giveaway prompt. Either way we mint
  // the short URL up front so sharing is instant.
  useEffect(() => {
    if (done && !giveawayShown.current) {
      giveawayShown.current = true;
      void ensureShortUrl();
      const invincible = !!result?.invincible;
      const t = setTimeout(() => (invincible ? setInvincibleOpen(true) : setGiveawayOpen(true)), 700);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // Enter the verified leaderboard: send the XI + this play's salt (never the
  // result — the server re-runs the sim itself with the same salt so the stored
  // record matches what the player saw). Same roll twice is a server no-op.
  useEffect(() => {
    if (!done || !user || !team || recordSubmitted.current) return;
    recordSubmitted.current = true;
    void fetch("/api/draft/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        league: team.league,
        formation: team.formation,
        squad: team.squad.map((p) => ({ slot: p.slot, player_season_id: p.player_season_id })),
        salt,
      }),
    }).catch(() => { /* leaderboard entry is best-effort */ });
  }, [done, user, team, salt]);

  function skip() {
    if (timer.current) clearInterval(timer.current);
    setShown(38);
    setDone(true);
    if (result) saveLastSeason(xiSeed, salt, result);
  }

  if (!team || !result) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8a948f" }}>Loading…</div>;
  }

  // Running tally over the revealed matches.
  const slice = result.games.slice(0, shown);
  const w = slice.filter((g) => g.result === "W").length;
  const d = slice.filter((g) => g.result === "D").length;
  const l = slice.filter((g) => g.result === "L").length;
  const pts = w * 3 + d;

  if (!done) {
    const recent = slice.slice(-6).reverse();
    return (
      <div className="min-h-[100dvh] pb-10" style={{ background: "#0a0a0f" }}>
        <div className="max-w-lg mx-auto px-5 pt-safe">
          <div className="pt-6 flex items-center justify-between">
            <div className="font-body" style={{ fontSize: 12, color: "#8a948f", letterSpacing: 1 }}>SIMULATING SEASON</div>
            <button onClick={skip} className="font-body" style={{ fontSize: 13, color: "#aeea00" }}>Skip →</button>
          </div>
          <div className="font-display tracking-wide" style={{ fontSize: 40, color: "#fff" }}>MATCHWEEK {shown}/38</div>

          <div className="grid grid-cols-4 gap-2 mt-4">
            {[["W", w, "#aeea00"], ["D", d, "#ffb800"], ["L", l, "#ff4757"], ["PTS", pts, "#fff"]].map(([k, v, c]) => (
              <div key={k as string} className="rounded-xl py-3 text-center" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 24, color: c as string }}>{v as number}</div>
                <div className="font-body" style={{ fontSize: 10, color: "#8a948f" }}>{k as string}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {recent.map((g, i) => {
              const c = g.result === "W" ? "#aeea00" : g.result === "D" ? "#ffb800" : "#ff4757";
              return (
                <div key={shown - i} className="flex items-center gap-3 rounded-xl px-4 py-2.5 animate-fade-in" style={{ background: "#0e1611", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="font-display rounded-md px-2" style={{ fontSize: 14, color: "#0a0a0f", background: c }}>{g.result}</span>
                  <span className="font-body flex-1 truncate" style={{ fontSize: 14, color: "#fff" }}>{g.venue === "H" ? "vs" : "@"} {g.opponent}</span>
                  <span className="font-display" style={{ fontSize: 18, color: "#fff" }}>{g.gf}–{g.ga}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Final result ──
  const r = result;
  const narr = seasonNarrative(r, team?.league);

  // The shareable card image, and a public link that unfurls to it on socials.
  const ogUrl = () => `/api/draft/season-og?${shareParams().toString()}`;
  // Long fallback link (carries the whole result in the query string). Used only
  // if the short-link service is unavailable.
  const longShareUrl = () => `${window.location.origin}/38-0/season/share?${shareParams().toString()}`;
  // Resolved short link, once minted — what we actually share.
  const shareUrl = () => shortUrl ?? longShareUrl();

  function openShare() { setShareOpen(true); void ensureShortUrl(); }
  // Auto-blurb so posts (esp. X) carry context + the image (via the unfurling link).
  const blurb = () => r.invincible
    ? `This was my result from YourScore 38-0 ⚽ — INVINCIBLE, ${r.wins}-${r.draws}-${r.losses}, ${r.points} pts. Think you can beat it?`
    : `This was my result from YourScore 38-0 ⚽ — ${r.wins}-${r.draws}-${r.losses}, finished ${ordinal(r.position)} on ${r.points} pts. Think you can beat it?`;

  async function nativeShare() {
    trackShare("season");
    await ensureShortUrl();
    const url = shareUrl(), text = blurb();
    try {
      if (navigator.share) { await navigator.share({ title: "YourScore 38-0", text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* cancelled */ }
  }
  function shareX() { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(blurb())}&url=${encodeURIComponent(shareUrl())}`, "_blank", "noopener"); }
  async function copyLink() { trackShare("season-copy"); try { await ensureShortUrl(); await navigator.clipboard.writeText(`${blurb()} ${shareUrl()}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ } }

  function giveawayTweetText(): string {
    return r.invincible
      ? `Just went INVINCIBLE on YourScore 38-0 ⚽🏆 ${r.wins}-${r.draws}-${r.losses}, ${r.points} pts. Entering the @yourscore_app_ daily £25 giveaway`
      : `My 38-0 season: ${r.wins}W ${r.draws}D ${r.losses}L, finished ${ordinal(r.position)} on ${r.points} pts ⚽ Entering the @yourscore_app_ daily £25 giveaway`;
  }
  function giveawayTweetUrl(): string {
    // Use the short URL (already minted by now); falls back to longShareUrl if needed.
    // Twitter unfurls the OG scorecard image from the /38-0/season/share page.
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(giveawayTweetText())}&url=${encodeURIComponent(shareUrl())}`;
  }

  const awards: SeasonAward[] = [];
  if (r.goldenBoot) awards.push({ label: "Golden Boot", name: r.goldenBoot.name, detail: `${r.goldenBoot.goals} goals` });
  if (r.playmaker) awards.push({ label: "Playmaker", name: r.playmaker.name, detail: `${r.playmaker.assists} assists` });
  if (r.goldenGlove) awards.push({ label: "Golden Glove", name: r.goldenGlove.name, detail: `${r.goldenGlove.cleanSheets} clean sheets` });
  if (r.playerOfTheSeason) awards.push({ label: "Player of the Season", name: r.playerOfTheSeason.name, detail: `${r.playerOfTheSeason.goals}G · ${r.playerOfTheSeason.assists}A` });

  const seasonData: SeasonData = {
    context: "Season",
    invincible: r.invincible,
    wins: r.wins, draws: r.draws, losses: r.losses,
    points: r.points, position: r.position,
    projectedPosition: r.projected.position,
    verdict: r.verdict ?? undefined,
    gf: r.gf, ga: r.ga, strength: team.strength,
    awards,
    contributors: r.players
      .filter((p) => p.goals > 0 || p.assists > 0)
      .sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists))
      .slice(0, 6)
      .map((p) => ({ name: p.name, goals: p.goals, assists: p.assists })),
  };

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-4 pt-safe">
        <div className="pt-6">
          <SeasonScorecard data={seasonData} />
          {narr.body && <p className="text-center font-body mt-3" style={{ fontSize: 13, color: "#9aa39d", lineHeight: 1.55 }}>{narr.body}</p>}
        </div>

        {/* Giveaway CTA — always visible, taps to open the giveaway sheet */}
        <button
          onClick={() => setGiveawayOpen(true)}
          className="w-full mt-5 rounded-2xl overflow-hidden active:scale-[0.98] transition-transform"
          style={{ background: "linear-gradient(135deg, #1c1400, #221900)", border: "2px solid rgba(255,184,0,0.55)" }}
        >
          <div className="flex items-center gap-4 px-5 py-4">
            <div style={{ fontSize: 36, lineHeight: 1 }}>🏆</div>
            <div className="text-left flex-1 min-w-0">
              <div className="font-display tracking-wide" style={{ fontSize: 20, color: "#ffb800" }}>WIN £25 TODAY</div>
              <div className="font-body" style={{ fontSize: 13, color: "#a89060" }}>Share on 𝕏 to enter the daily giveaway →</div>
            </div>
          </div>
        </button>

        <Button variant="primary" tone="lime" size="md" fullWidth className="mt-2" onClick={openShare}>
          📸 SHARE YOUR RESULT
        </Button>

        <div className="grid grid-cols-2 gap-2 mt-2">
          {user ? (
            <>
              <Link href="/38-0/team"
                className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
                style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00", fontSize: 14 }}>
                🏆 My Team
              </Link>
              <Link href="/38-0/team"
                className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
                style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00", fontSize: 14 }}>
                ⚔️ Go Head to Head
              </Link>
            </>
          ) : (
            <>
              <Link href="/auth/sign-in"
                className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
                style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00", fontSize: 14 }}>
                💾 Save Team, Sign Up
              </Link>
              <Link href="/auth/sign-in"
                className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
                style={{ background: "rgba(174,234,0,0.08)", border: "1px solid rgba(174,234,0,0.25)", color: "#aeea00", fontSize: 14 }}>
                ⚔️ Go Head to Head
              </Link>
            </>
          )}
        </div>

        <div className="mt-6 space-y-2">
          <Button href="/38-0/team" variant="ghost" size="md" fullWidth>
            Back to my team
          </Button>
          <Button href="/38-0" variant="primary" tone="lime" size="md" fullWidth>
            BUILD A NEW XI →
          </Button>
        </div>
      </div>

      {/* ── Share sheet ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl px-4 pt-3" style={{ background: "#080d0a", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />

            {/* card preview */}
            <div className="rounded-2xl overflow-hidden mx-auto" style={{ maxWidth: 300, border: "1px solid rgba(255,255,255,0.08)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogUrl()} alt="Your 38-0 season result" style={{ width: "100%", display: "block" }} />
            </div>

            <Button variant="primary" tone="lime" size="md" fullWidth className="mt-4" onClick={nativeShare}>
              🔗 Share link
            </Button>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={shareX} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#fff", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>𝕏</button>
              <button onClick={() => { setShareOpen(false); nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(225,48,108,0.12)", color: "#e1306c", fontSize: 15, border: "1px solid rgba(225,48,108,0.3)" }}>Instagram</button>
              <button onClick={() => { setShareOpen(false); nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#15211a", color: "#c4ccc6", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>TikTok</button>
            </div>

            <button onClick={copyLink} className="w-full mt-2 flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
              style={{ background: copied ? "rgba(174,234,0,0.1)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied ? "rgba(174,234,0,0.3)" : "rgba(255,255,255,0.1)"}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={copied ? "#aeea00" : "#9aa39d"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="font-body text-sm font-semibold" style={{ color: copied ? "#aeea00" : "#9aa39d" }}>
                {copied ? "Copied!" : "Copy link"}
              </span>
            </button>

            <button onClick={() => setShareOpen(false)} className="w-full mt-2 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform" style={{ background: "transparent", color: "#8a948f", fontSize: 15 }}>Close</button>
          </div>
        </div>
      )}

      {/* ── INVINCIBLE celebration ── the big moment for a perfect 38-0 season ── */}
      {invincibleOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-5"
          style={{ background: "radial-gradient(120% 90% at 50% 18%, rgba(60,46,0,0.96), rgba(8,7,3,0.97))" }}
          onClick={() => setInvincibleOpen(false)}
        >
          {/* falling gold sparkles */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {Array.from({ length: 22 }).map((_, i) => (
              <span
                key={i}
                className="absolute sc-particle"
                style={{
                  left: `${(i * 37) % 100}%`,
                  top: "-12px",
                  fontSize: 9 + (i % 4) * 4,
                  color: i % 3 === 0 ? "#fff6cf" : "#ffd700",
                  animationName: "scInvincibleFall" as unknown as string,
                  animationDuration: `${3.4 + (i % 5) * 0.6}s`,
                  animationDelay: `${(i % 7) * 0.4}s`,
                  ["--driftX" as string]: `${((i % 5) - 2) * 18}px`,
                }}
              >
                {i % 4 === 0 ? "★" : "✦"}
              </span>
            ))}
          </div>

          <div className="relative w-full max-w-md text-center" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 72, lineHeight: 1 }}>🏆</div>
            <div className="font-body mt-3" style={{ fontSize: 12, color: "#ffd700", letterSpacing: 5 }}>PERFECT SEASON</div>
            <h2
              className="font-display tracking-wide leading-none mt-2 sc-invincible-pulse"
              style={{
                fontSize: 64,
                background: "linear-gradient(92deg,#fff6cf,#ffd700,#f0a000,#ffd700,#fff6cf)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              INVINCIBLE
            </h2>
            <div className="font-display tracking-wide mt-2" style={{ fontSize: 30, color: "#fff" }}>
              {r.wins}<span style={{ color: "#ffd700" }}>-</span>{r.draws}<span style={{ color: "#ffd700" }}>-</span>{r.losses}
            </div>
            <p className="font-body mt-3 mx-auto" style={{ fontSize: 14, color: "#e8d9a0", lineHeight: 1.55, maxWidth: 320 }}>
              38 played, 38 won, not beaten once. One of the rarest results in 38-0 — you built a perfect season.
              <br />
              <span style={{ color: "#bfae78", fontSize: 12.5 }}>Post it to claim your place on the board (and enter today&apos;s £25 giveaway).</span>
            </p>

            <a
              href={giveawayTweetUrl()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setInvincibleOpen(false)}
              className="flex items-center justify-center gap-3 w-full rounded-2xl py-4 mt-6 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "linear-gradient(135deg,#ffe98a,#ffd700)", color: "#1c1400", fontSize: 21, textDecoration: "none", boxShadow: "0 0 36px rgba(255,215,0,0.35)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#1c1400">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              SHARE YOUR INVINCIBLE SEASON
            </a>
            <button
              onClick={() => setInvincibleOpen(false)}
              className="w-full mt-3 font-body"
              style={{ fontSize: 14, color: "#8a7d52", background: "transparent", border: "none", cursor: "pointer" }}
            >
              See my scorecard
            </button>
          </div>
        </div>
      )}

      {/* ── Giveaway overlay ── */}
      {giveawayOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.9)" }}
          onClick={() => setGiveawayOpen(false)}
        >
          <div
            className="w-full max-w-lg px-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-3xl overflow-hidden" style={{ background: "#080d0a", border: "2px solid rgba(255,184,0,0.4)" }}>
              {/* drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.18)" }} />
              </div>

              <div className="px-6 pt-4 pb-7 text-center">
                <div style={{ fontSize: 52, lineHeight: 1.1 }}>🏆</div>
                <div className="font-body mt-3" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 3 }}>DAILY GIVEAWAY</div>
                <div className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 80, color: "#fff" }}>£25</div>
                <p className="font-body mt-3" style={{ fontSize: 15, color: "#c4ccc6", lineHeight: 1.6 }}>
                  Share your season result on 𝕏 to enter.<br />
                  <span style={{ color: "#8a948f", fontSize: 13 }}>One winner drawn every 24 hours.</span>
                </p>

                <a
                  href={giveawayTweetUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setGiveawayOpen(false)}
                  className="flex items-center justify-center gap-3 w-full rounded-2xl py-4 mt-6 font-display tracking-wide active:scale-[0.98] transition-transform"
                  style={{ background: "#fff", color: "#000", fontSize: 20, textDecoration: "none", display: "flex" }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="black">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.741l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                  POST ON 𝕏 TO ENTER
                </a>

                <button
                  onClick={() => setGiveawayOpen(false)}
                  className="w-full mt-3 font-body"
                  style={{ fontSize: 14, color: "#586058", background: "transparent", border: "none", cursor: "pointer" }}
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
