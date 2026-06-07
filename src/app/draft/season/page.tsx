"use client";

/**
 * /draft/season — simulate the 38-game season and show how the XI performed.
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
  const [downloaded, setDownloaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = loadTeam();
    if (!t || !isComplete(t)) { router.replace("/draft"); return; }
    setTeam(t);
  }, [router]);

  // Seed by the squad so the season is stable: same XI → same result every view.
  const seed = team ? seasonSeed(team) : "";
  const result: SeasonResult | null = useMemo(
    () => (team ? simulateSeason(team.squad, team.formation, team.strength, seed, leagueOpponents()) : null),
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
  const narr = seasonNarrative(r);
  const accent = r.invincible ? "#ffd700" : r.position === 1 ? "#00ff87" : r.position <= 4 ? "#22d3ee" : r.position <= 12 ? "#ffb800" : "#ff4757";
  const verdictColor = r.verdict === "OVERPERFORMED" ? "#00ff87" : r.verdict === "UNDERPERFORMED" ? "#ff4757" : "#8888aa";

  function shareParams(): URLSearchParams {
    return new URLSearchParams({
      pos: String(r.position), pts: String(r.points), w: String(r.wins), d: String(r.draws), l: String(r.losses),
      gf: String(r.gf), ga: String(r.ga), head: narr.headline, verdict: r.verdict,
      boot: r.goldenBoot ? `${r.goldenBoot.name} ${r.goldenBoot.goals}` : "",
      inv: r.invincible ? "1" : "", formation: team!.formation,
    });
  }

  async function share() {
    const params = shareParams();
    const url = `${window.location.origin}/draft/season/share?${params.toString()}`;
    const text = r.invincible
      ? `38-0. INVINCIBLE. My Draft XI went unbeaten — ${r.points} points. Beat that:`
      : `My Draft XI finished ${ordinal(r.position)} on ${r.points} pts (${r.wins}W ${r.draws}D ${r.losses}L). Build yours:`;
    try {
      // Always generate the broadcast graphic. Share the image file itself where
      // supported (mobile); otherwise download the PNG so there's a real image to
      // share, and copy the unfurling link too.
      let file: File | null = null;
      try {
        const res = await fetch(`/api/draft/season-og?${params.toString()}`);
        if (res.ok) file = new File([await res.blob()], "draft-xi-season.png", { type: "image/png" });
      } catch { /* network — fall through to link */ }

      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Draft XI — Season", text, url });
        return;
      }
      if (file) {
        // Download the image so the user has a shareable graphic on desktop/unsupported.
        const href = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = href; a.download = "draft-xi-season.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 4000);
        try { await navigator.clipboard.writeText(`${text} ${url}`); } catch { /* clipboard blocked */ }
        setDownloaded(true); setTimeout(() => setDownloaded(false), 2500);
        return;
      }
      // No image (network) — last resort: native share / copy the link.
      if (navigator.share) await navigator.share({ title: "Draft XI — Season", text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    } catch { /* cancelled */ }
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
          <div className="font-display tracking-wide leading-none" style={{ fontSize: r.invincible ? 64 : 26, color: accent }}>
            {r.invincible ? "INVINCIBLE" : narr.headline}
          </div>
          <p className="font-body mt-3" style={{ fontSize: 14, color: "#cfcfe6" }}>{narr.body}</p>
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

        {/* record */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {[["WINS", r.wins, "#00ff87"], ["DRAWS", r.draws, "#ffb800"], ["LOSSES", r.losses, "#ff4757"]].map(([k, v, c]) => (
            <div key={k as string} className="rounded-2xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-display" style={{ fontSize: 28, color: c as string }}>{v as number}</div>
              <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{k as string}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          {[["POINTS", r.points, "#fff"], ["GOALS FOR", r.gf, "#00ff87"], ["GOALS AGAINST", r.ga, "#ff4757"]].map(([k, v, c]) => (
            <div key={k as string} className="rounded-2xl py-3 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-display" style={{ fontSize: 28, color: c as string }}>{v as number}</div>
              <div className="font-body" style={{ fontSize: 10, color: "#8888aa" }}>{k as string}</div>
            </div>
          ))}
        </div>

        <button onClick={share} className="w-full mt-5 rounded-2xl py-4 font-display tracking-wide active:scale-[0.98] transition-transform"
          style={{ background: "#ffb800", color: "#1a1300", fontSize: 24 }}>
          {downloaded ? "IMAGE SAVED ✓ (link copied)" : copied ? "LINK COPIED ✓" : "📸 SHARE YOUR SEASON"}
        </button>

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
          <Link href="/draft/team" className="block w-full rounded-2xl py-3 text-center font-body" style={{ background: "#12121e", color: "#cfcfe6", fontSize: 15, border: "1px solid rgba(255,255,255,0.08)" }}>
            Back to my team
          </Link>
          <Link href="/draft" className="block w-full rounded-2xl py-3 text-center font-display tracking-wide" style={{ background: "#00ff87", color: "#062013", fontSize: 20 }}>
            BUILD A NEW XI →
          </Link>
        </div>
      </div>
    </div>
  );
}
