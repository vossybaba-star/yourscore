"use client";

/**
 * /38-0/season — simulate the 38-game season and show how the XI performed.
 * Plays the matches out (with a Skip), then the end-of-season stats: finish vs
 * projection + verdict, narrative, record, GF/GA, and season awards.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadTeam, isComplete, seasonSeed, saveLastSeason, loadLastSeason, type LocalTeam } from "@/lib/draft/local";
import { leagueOpponents } from "@/lib/draft/pool";
import { simulateSeason, seasonNarrative, type SeasonResult } from "@/lib/draft/season";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function SeasonSim() {
  const router = useRouter();
  const [team, setTeam] = useState<LocalTeam | null>(null);
  const [shown, setShown] = useState(0); // matches revealed
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shortUrl, setShortUrl] = useState<string | null>(null);
  const [giveawayOpen, setGiveawayOpen] = useState(false);
  const giveawayShown = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    if (!t || !isComplete(t)) { router.replace("/38-0"); return; }
    setTeam(t);
  }, [router]);

  // Seed by the squad so the season is stable: same XI → same result every view.
  const seed = team ? seasonSeed(team) : "";
  const result: SeasonResult | null = useMemo(
    () => (team ? simulateSeason(team.squad, team.formation, team.strength, seed, leagueOpponents(team.league)) : null),
    [team, seed]
  );
  // If we've already simulated this exact XI, skip straight to the result.
  const cached = !!team && loadLastSeason()?.seed === seed;

  useEffect(() => {
    if (!result) return;
    if (cached) { setShown(38); setDone(true); return; }
    timer.current = setInterval(() => {
      setShown((n) => {
        if (n >= 38) {
          if (timer.current) clearInterval(timer.current);
          setDone(true);
          saveLastSeason(seed, result);
          return 38;
        }
        return n + 1;
      });
    }, 90);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [result, cached, seed]);

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

  // Auto-show giveaway prompt when simulation first completes.
  // Also kicks off short-URL minting so it's ready before the user taps tweet.
  useEffect(() => {
    if (done && !giveawayShown.current) {
      giveawayShown.current = true;
      void ensureShortUrl();
      const t = setTimeout(() => setGiveawayOpen(true), 700);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function skip() {
    if (timer.current) clearInterval(timer.current);
    setShown(38);
    setDone(true);
    if (result) saveLastSeason(seed, result);
  }

  if (!team || !result) {
    return <div className="min-h-[100dvh] grid place-items-center" style={{ background: "#0a0a0f", color: "#8888aa" }}>Loading…</div>;
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
            <div className="font-body" style={{ fontSize: 12, color: "#8888aa", letterSpacing: 1 }}>SIMULATING SEASON</div>
            <button onClick={skip} className="font-body" style={{ fontSize: 13, color: "#00ff87" }}>Skip →</button>
          </div>
          <div className="font-display tracking-wide" style={{ fontSize: 40, color: "#fff" }}>MATCHWEEK {shown}/38</div>

          <div className="grid grid-cols-4 gap-2 mt-4">
            {[["W", w, "#00ff87"], ["D", d, "#ffb800"], ["L", l, "#ff4757"], ["PTS", pts, "#fff"]].map(([k, v, c]) => (
              <div key={k as string} className="rounded-xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="font-display" style={{ fontSize: 24, color: c as string }}>{v as number}</div>
                <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{k as string}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            {recent.map((g, i) => {
              const c = g.result === "W" ? "#00ff87" : g.result === "D" ? "#ffb800" : "#ff4757";
              return (
                <div key={shown - i} className="flex items-center gap-3 rounded-xl px-4 py-2.5 animate-fade-in" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.06)" }}>
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
  const accent = r.invincible ? "#ffd700" : r.position === 1 ? "#00ff87" : r.position <= 4 ? "#22d3ee" : r.position <= 12 ? "#ffb800" : "#ff4757";
  const verdictColor = r.verdict === "OVERPERFORMED" ? "#00ff87" : r.verdict === "UNDERPERFORMED" ? "#ff4757" : "#8888aa";

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
    await ensureShortUrl();
    const url = shareUrl(), text = blurb();
    try {
      if (navigator.share) { await navigator.share({ title: "YourScore 38-0", text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* cancelled */ }
  }
  function shareX() { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(blurb())}&url=${encodeURIComponent(shareUrl())}`, "_blank", "noopener"); }
  async function copyLink() { try { await ensureShortUrl(); await navigator.clipboard.writeText(`${blurb()} ${shareUrl()}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* blocked */ } }

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

  const awards: [string, string, string][] = [];
  if (r.goldenBoot) awards.push(["👟 Golden Boot", r.goldenBoot.name, `${r.goldenBoot.goals} goals`]);
  if (r.playmaker) awards.push(["🅰️ Playmaker", r.playmaker.name, `${r.playmaker.assists} assists`]);
  if (r.goldenGlove) awards.push(["🧤 Golden Glove", r.goldenGlove.name, `${r.goldenGlove.cleanSheets} clean sheets`]);
  if (r.playerOfTheSeason) awards.push(["🏆 Player of the Season", r.playerOfTheSeason.name, `${r.playerOfTheSeason.goals}G · ${r.playerOfTheSeason.assists}A`]);

  return (
    <div className="min-h-[100dvh] pb-16" style={{ background: "#0a0a0f" }}>
      <div className="max-w-lg mx-auto px-5 pt-safe">
        <div className="pt-8 text-center">
          {/* The season record is the headline scoreline */}
          <div className="font-body" style={{ fontSize: 12, color: "#8888aa", letterSpacing: 1.5 }}>SEASON RECORD</div>
          <div className="flex items-stretch justify-center gap-2 mt-2">
            {([["WINS", r.wins, "#00ff87"], ["DRAWS", r.draws, "#ffb800"], ["LOSSES", r.losses, "#ff4757"]] as [string, number, string][]).map(([k, v, c]) => (
              <div key={k} className="flex-1 rounded-2xl py-4" style={{ background: "#12121e", border: `1px solid ${c}40` }}>
                <div className="font-display" style={{ fontSize: 60, lineHeight: 1, color: c }}>{v}</div>
                <div className="font-body mt-1.5" style={{ fontSize: 12, color: "#8888aa", letterSpacing: 1 }}>{k}</div>
              </div>
            ))}
          </div>
          <div className="font-display tracking-wide leading-none mt-5" style={{ fontSize: r.invincible ? 48 : 24, color: accent }}>
            {r.invincible ? "INVINCIBLE" : narr.headline}
          </div>
          <p className="font-body mt-2" style={{ fontSize: 14, color: "#cfcfe6" }}>{narr.body}</p>
        </div>

        {/* finished vs projected */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <div className="rounded-2xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>FINISHED</div>
            <div className="font-display" style={{ fontSize: 30, color: accent }}>{ordinal(r.position)}</div>
          </div>
          <div className="rounded-2xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>PROJECTED</div>
            <div className="font-display" style={{ fontSize: 30, color: "#8888aa" }}>{ordinal(r.projected.position)}</div>
          </div>
          <div className="rounded-2xl py-3 text-center grid place-items-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="font-display tracking-wide" style={{ fontSize: 13, color: verdictColor }}>{r.verdict}</div>
          </div>
        </div>

        {/* points / goals */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {[["POINTS", r.points, "#fff"], ["GOALS FOR", r.gf, "#00ff87"], ["GOALS AGAINST", r.ga, "#ff4757"]].map(([k, v, c]) => (
            <div key={k as string} className="rounded-2xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-display" style={{ fontSize: 28, color: c as string }}>{v as number}</div>
              <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{k as string}</div>
            </div>
          ))}
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

        <button onClick={openShare} className="w-full mt-2 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "#00ff87", color: "#062013", fontSize: 22 }}>
          📸 SHARE YOUR RESULT
        </button>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Link href="/auth/sign-in"
            className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
            style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.25)", color: "#00ff87", fontSize: 14 }}>
            💾 Save Team, Sign Up
          </Link>
          <Link href="/auth/sign-in"
            className="flex items-center justify-center gap-2 rounded-2xl py-4 font-body font-semibold active:scale-[0.98] transition-transform text-center"
            style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", fontSize: 14 }}>
            ⚔️ Go Head to Head
          </Link>
        </div>

        {/* awards */}
        {awards.length > 0 && (
          <>
            <div className="font-body mt-6 mb-2" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>SEASON AWARDS</div>
            <div className="grid grid-cols-2 gap-2">
              {awards.map(([label, name, sub]) => (
                <div key={label} className="rounded-2xl p-3" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{label}</div>
                  <div className="font-body mt-0.5 truncate" style={{ fontSize: 14, color: "#fff" }}>{name}</div>
                  <div className="font-body" style={{ fontSize: 11, color: "#00ff87" }}>{sub}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* top scorers */}
        {(() => {
          const scorers = r.players.filter((p) => p.goals > 0 || p.assists > 0).sort((a, b) => (b.goals * 2 + b.assists) - (a.goals * 2 + a.assists)).slice(0, 6);
          return scorers.length ? (
            <>
              <div className="font-body mt-6 mb-2" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>TOP CONTRIBUTORS</div>
              <div className="rounded-2xl overflow-hidden" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="flex px-4 py-1.5 font-body" style={{ fontSize: 10, color: "#8888aa" }}>
                  <span className="flex-1">PLAYER</span><span style={{ width: 36, textAlign: "right" }}>G</span><span style={{ width: 36, textAlign: "right" }}>A</span>
                </div>
                {scorers.map((p) => (
                  <div key={p.name} className="flex px-4 py-2 font-body" style={{ fontSize: 14, color: "#fff", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span style={{ width: 36, textAlign: "right", color: "#00ff87" }}>{p.goals}</span>
                    <span style={{ width: 36, textAlign: "right", color: "#22d3ee" }}>{p.assists}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null;
        })()}

        <div className="mt-6 space-y-2">
          <Link href="/38-0/team" className="block w-full rounded-2xl py-3 text-center font-body" style={{ background: "#12121e", color: "#cfcfe6", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
            Back to my team
          </Link>
          <Link href="/38-0" className="block w-full rounded-2xl py-3 text-center font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 20 }}>
            BUILD A NEW XI →
          </Link>
        </div>
      </div>

      {/* ── Share sheet ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShareOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl px-4 pt-3" style={{ background: "#0b0b12", borderTop: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 16px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.2)" }} />

            {/* card preview */}
            <div className="rounded-2xl overflow-hidden mx-auto" style={{ maxWidth: 300, border: "1px solid rgba(255,255,255,0.08)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ogUrl()} alt="Your 38-0 season result" style={{ width: "100%", display: "block" }} />
            </div>

            <button onClick={nativeShare} className="w-full mt-4 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
              style={{ background: "#00ff87", color: "#062013", fontSize: 20 }}>
              🔗 Share link
            </button>

            <div className="grid grid-cols-3 gap-2 mt-2">
              <button onClick={shareX} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#1a1a2e", color: "#fff", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>𝕏</button>
              <button onClick={() => { setShareOpen(false); nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "rgba(225,48,108,0.12)", color: "#e1306c", fontSize: 15, border: "1px solid rgba(225,48,108,0.3)" }}>Instagram</button>
              <button onClick={() => { setShareOpen(false); nativeShare(); }} className="rounded-2xl py-3 font-display tracking-wide active:scale-[0.98] transition-transform" style={{ background: "#1a1a2e", color: "#cfcfe6", fontSize: 15, border: "1px solid rgba(255,255,255,0.15)" }}>TikTok</button>
            </div>

            <button onClick={copyLink} className="w-full mt-2 flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
              style={{ background: copied ? "rgba(0,255,135,0.1)" : "rgba(255,255,255,0.06)", border: `1px solid ${copied ? "rgba(0,255,135,0.3)" : "rgba(255,255,255,0.1)"}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={copied ? "#00ff87" : "#aaaacc"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={copied ? "#00ff87" : "#aaaacc"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="font-body text-sm font-semibold" style={{ color: copied ? "#00ff87" : "#aaaacc" }}>
                {copied ? "Copied!" : "Copy link"}
              </span>
            </button>

            <button onClick={() => setShareOpen(false)} className="w-full mt-2 rounded-2xl py-3 font-body active:scale-[0.98] transition-transform" style={{ background: "transparent", color: "#8888aa", fontSize: 15 }}>Close</button>
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
            <div className="rounded-3xl overflow-hidden" style={{ background: "#0e0d1a", border: "2px solid rgba(255,184,0,0.4)" }}>
              {/* drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="rounded-full" style={{ width: 40, height: 4, background: "rgba(255,255,255,0.18)" }} />
              </div>

              <div className="px-6 pt-4 pb-7 text-center">
                <div style={{ fontSize: 52, lineHeight: 1.1 }}>🏆</div>
                <div className="font-body mt-3" style={{ fontSize: 11, color: "#ffb800", letterSpacing: 3 }}>DAILY GIVEAWAY</div>
                <div className="font-display tracking-wide leading-none mt-1" style={{ fontSize: 80, color: "#fff" }}>£25</div>
                <p className="font-body mt-3" style={{ fontSize: 15, color: "#cfcfe6", lineHeight: 1.6 }}>
                  Share your season result on 𝕏 to enter.<br />
                  <span style={{ color: "#7a7a92", fontSize: 13 }}>One winner drawn every 24 hours.</span>
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
                  style={{ fontSize: 14, color: "#55556a", background: "transparent", border: "none", cursor: "pointer" }}
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
