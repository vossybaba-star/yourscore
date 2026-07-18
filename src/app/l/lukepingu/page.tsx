"use client";

/**
 * /l/lukepingu — LukePingu's Club League hub (bespoke demo build).
 *
 * Purpose-built, self-contained showcase to present to Luke + 4Sake. Uses his
 * real branding (DP + cover from his channel, his Millionaire-purple accent) and
 * the sections he asked for: Live competition · Games · Leaderboard (= the league)
 * · his socials. Sample data is hardcoded so it renders with no DB/auth — the
 * productionised version feeds these same sections from the existing Club League
 * API (/api/club/[slug]) the generic /l/[slug] hub already uses.
 */

import Link from "next/link";
import { BottomNav } from "@/components/ui/BottomNav";
import { GridBackground } from "@/components/ui/GridBackground";

// ── Luke's brand ─────────────────────────────────────────────────────────────
const BRAND = "#a855f7"; //  electric purple (his channel-art primary)
const BLUE = "#4f9dff"; //   neon-blue highlight (his secondary)
const GOLD = "#ffc233"; //   wins / prize
const COVER = "/clubs/lukepingu/cover.webp";
const DP = "/clubs/lukepingu/dp.jpg";

const SOCIALS = [
  { label: "YouTube", handle: "@LukePingu", href: "https://www.youtube.com/@LukePingu", icon: YouTubeIcon },
  { label: "Instagram", handle: "@lukepingu", href: "https://www.instagram.com/lukepingu/", icon: InstagramIcon },
  { label: "TikTok", handle: "@lukepingu", href: "https://www.tiktok.com/@lukepingu", icon: TikTokIcon },
];

// ── Demo data ────────────────────────────────────────────────────────────────
const MEMBERS = 1247;
const LAUNCH_LABEL = "SAT 28 JUN"; // first daily game drops on Luke's launch video
const COMP_DAY = 0; //   pre-launch — campaign hasn't started yet
const COMP_TOTAL = 14;

const GAMES = [
  {
    key: "mastermind",
    emoji: "🧠",
    name: "38-0 World Cup Mastermind",
    tag: "DAILY · 28 JUN",
    blurb: "A fresh World Cup squad + quiz-gated draft every single day. The campaign game — points stack toward the £100.",
    cta: "First drop 28 Jun",
    href: "/38-0",
    live: true,
  },
  {
    key: "perfect-10",
    emoji: "🪜",
    name: "Perfect 10",
    tag: "LUKE'S FORMAT",
    blurb: "Name the hidden top 10, 3 lives, 3 hints. Luke's signature format — get all ten and share your tower.",
    cta: "Play the latest list",
    href: "/play/game/perfect-10",
    live: true,
  },
  {
    key: "quiz",
    emoji: "⚽",
    name: "World Cup Quiz",
    tag: "QUICK",
    blurb: "Daily World Cup knowledge quiz. A fast second game when the Mastermind ends early on stream.",
    cta: "Take the quiz",
    href: "/play",
    live: false,
  },
];

const BOARD = [
  { name: "SemajHutch", pts: 18400, days: 6, you: false },
  { name: "PinguArmy_Joe", pts: 17950, days: 6, you: false },
  { name: "DerbyTillIDie", pts: 16200, days: 6, you: false },
  { name: "xG_Wizard", pts: 15600, days: 5, you: false },
  { name: "OffsideOllie", pts: 14800, days: 6, you: false },
  { name: "KaneNotAble", pts: 13900, days: 5, you: false },
  { name: "ToePokeTommy", pts: 12500, days: 4, you: false },
  { name: "you", pts: 9200, days: 3, you: true },
  { name: "BergkampFlick", pts: 8700, days: 3, you: false },
  { name: "ThrowInThiago", pts: 7400, days: 2, you: false },
];

export default function LukePinguHub() {
  return (
    <main className="min-h-dvh" style={{ background: "var(--bg)", paddingBottom: 110 }}>
      <GridBackground opacity={0.025} />

      <div style={{ maxWidth: 600, margin: "0 auto" }}>
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <div style={{ position: "relative", height: 230 }}>
          {/* overlaid back chip */}
          <Link
            href="/"
            className="pt-safe"
            style={{ position: "absolute", top: 10, left: 12, zIndex: 20, display: "flex", alignItems: "center", gap: 6, padding: "7px 12px 7px 10px", borderRadius: 999, background: "rgba(8,13,10,0.55)", backdropFilter: "blur(8px)", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 700, letterSpacing: 0.6 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>‹</span> CLUB LEAGUE
          </Link>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={COVER} alt="LukePingu" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, rgba(8,13,10,0.35) 0%, rgba(8,13,10,0.2) 40%, var(--bg) 100%)` }} />
          <div style={{ position: "absolute", inset: 0, boxShadow: `inset 0 -1px 0 ${BRAND}55`, background: `radial-gradient(120% 80% at 50% 120%, ${BRAND}33 0%, transparent 60%)` }} />
        </div>

        <div style={{ padding: "0 18px", marginTop: -52, position: "relative", zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
            <div style={{ width: 96, height: 96, borderRadius: 22, overflow: "hidden", flexShrink: 0, border: `3px solid ${BRAND}`, boxShadow: `0 8px 30px ${BRAND}55`, background: "#0e1611" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DP} alt="LukePingu" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ paddingBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: 0.2 }}>LukePingu</h1>
                <VerifiedTick color={BRAND} />
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 13, color: BRAND, fontWeight: 700 }}>Football Quizmaster 🐧 · #DCFC</p>
            </div>
          </div>

          {/* stat strip */}
          <div style={{ display: "flex", gap: 18, marginTop: 14, fontSize: 13 }}>
            <Stat value={MEMBERS.toLocaleString()} label="members" />
            <Divider />
            <Stat value="28 JUN" label="kickoff" color={BRAND} />
            <Divider />
            <Stat value="£100" label="up for grabs" color={GOLD} />
          </div>

          {/* socials */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", textDecoration: "none", color: "var(--text-primary)" }}
              >
                <s.icon />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.handle}</span>
              </a>
            ))}
          </div>

          {/* primary CTA */}
          <button
            style={{ width: "100%", marginTop: 16, padding: "15px", borderRadius: 16, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 900, letterSpacing: 0.3, color: "#1a0033", background: `linear-gradient(135deg, ${BRAND}, ${BLUE})`, boxShadow: `0 8px 26px ${BRAND}44` }}
          >
            JOIN THE LEAGUE →
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            Free to play · climb the board · winner takes the prize
          </p>
        </div>

        {/* ── COMPETITION ──────────────────────────────────────────────────── */}
        <Section title="The competition" accent={BRAND}>
          <div style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${BRAND}55`, background: `linear-gradient(160deg, ${BRAND}1f, var(--surface) 55%)` }}>
            <div style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <StartsPill color={BLUE} label={LAUNCH_LABEL} />
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{COMP_TOTAL}-day campaign</span>
              </div>
              <h3 style={{ margin: 0, fontSize: 21, fontWeight: 900, color: "#fff" }}>38-0 World Cup Mastermind</h3>
              <p style={{ margin: "6px 0 0", fontSize: 14, color: "#c4ccc6", lineHeight: 1.5 }}>
                A new game every day — fresh World Cup squad, fresh quiz-gated draft. Play daily and your points stack up.
                <b style={{ color: "#fff" }}> Miss a day? Catch up on yesterday&apos;s.</b>
              </p>

              {/* progress dots */}
              <div style={{ display: "flex", gap: 5, marginTop: 14 }}>
                {Array.from({ length: COMP_TOTAL }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: i < COMP_DAY ? BRAND : "var(--surface-3)", opacity: i < COMP_DAY ? 1 : 0.6 }} />
                ))}
              </div>

              {/* prize line */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "12px 14px", borderRadius: 14, background: "rgba(255,194,51,0.08)", border: "1px solid rgba(255,194,51,0.22)" }}>
                <span style={{ fontSize: 22 }}>🏆</span>
                <div>
                  <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: GOLD, fontWeight: 800 }}>The prize</p>
                  <p style={{ margin: "2px 0 0", fontSize: 13.5, color: "#fff" }}>
                    Top of the board by Luke&apos;s next video wins <b>£100</b>.
                  </p>
                </div>
              </div>

              <div style={{ display: "block", textAlign: "center", marginTop: 14, padding: 14, borderRadius: 14, background: BRAND, color: "#fff", fontWeight: 900, fontSize: 15 }}>
                FIRST GAME DROPS {LAUNCH_LABEL} →
              </div>
            </div>
          </div>

          {/* upcoming / second game */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 22 }}>🪜</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#fff" }}>Perfect 10 <span style={{ fontSize: 11, color: BLUE, fontWeight: 700 }}>· LUKE&apos;S FORMAT</span></p>
              <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>The latest list is live — can you name all ten?</p>
            </div>
            <Link href="/play/game/perfect-10" style={{ fontSize: 13, fontWeight: 800, color: BRAND, textDecoration: "none", whiteSpace: "nowrap" }}>Play →</Link>
          </div>
        </Section>

        {/* ── GAMES ────────────────────────────────────────────────────────── */}
        <Section title="Games" accent={BRAND}>
          <div style={{ display: "grid", gap: 10 }}>
            {GAMES.map((g) => (
              <Link key={g.key} href={g.href} style={{ textDecoration: "none" }}>
                <div style={{ display: "flex", gap: 14, padding: 16, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, display: "grid", placeItems: "center", fontSize: 24, background: "var(--surface-2)", flexShrink: 0 }}>{g.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#fff" }}>{g.name}</p>
                      <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, padding: "2px 6px", borderRadius: 5, color: g.live ? BRAND : "var(--text-muted)", background: g.live ? `${BRAND}1f` : "var(--surface-3)" }}>{g.tag}</span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{g.blurb}</p>
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, fontWeight: 800, color: BRAND }}>{g.cta} →</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Section>

        {/* ── LEADERBOARD / THE LEAGUE ─────────────────────────────────────── */}
        <Section title="Leaderboard" accent={BRAND} subtitle="This is the league — most points by Luke's next video wins.">
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, marginBottom: 12, background: "rgba(255,194,51,0.07)", border: "1px solid rgba(255,194,51,0.2)" }}>
            <span style={{ fontSize: 18 }}>🏆</span>
            <p style={{ margin: 0, fontSize: 13, color: "#fff" }}>
              <b style={{ color: GOLD }}>£100 prize</b> · ends with Luke&apos;s next video · play daily to climb
            </p>
          </div>

          <p style={{ margin: "0 2px 10px", fontSize: 11.5, color: "var(--text-muted)" }}>
            <span style={{ color: BLUE, fontWeight: 700 }}>Preview</span> — the board fills once the campaign kicks off on {LAUNCH_LABEL}.
          </p>

          <div style={{ display: "grid", gap: 6 }}>
            {BOARD.map((r, i) => {
              const pos = i + 1;
              const medal = ["🥇", "🥈", "🥉"][i];
              return (
                <div
                  key={r.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14,
                    background: r.you ? `${BRAND}16` : "var(--surface)",
                    border: `1px solid ${r.you ? `${BRAND}55` : "var(--border)"}`,
                  }}
                >
                  <div style={{ width: 26, textAlign: "center", flexShrink: 0 }}>
                    {medal ? <span style={{ fontSize: 16 }}>{medal}</span> : <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-muted)" }}>{pos}</span>}
                  </div>
                  <div style={{ width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 800, fontSize: 14, color: r.you ? "#fff" : BLUE, background: r.you ? BRAND : "rgba(79,157,255,0.14)", border: "1px solid var(--border)" }}>
                    {(r.you ? "Y" : r.name[0]).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>
                      {r.you ? "You" : r.name}
                      {r.you && <span style={{ fontSize: 10.5, color: BRAND, marginLeft: 6, fontWeight: 600 }}>you</span>}
                    </p>
                    <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "var(--text-muted)" }}>
                      {r.days}/{COMP_DAY} days played
                    </p>
                  </div>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: pos === 1 ? GOLD : r.you ? BRAND : "#c4ccc6", flexShrink: 0 }}>
                    {r.pts.toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
          <p style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", marginTop: 12 }}>
            Points = your daily 38-0 Mastermind + Perfect 10 scores, added up over the campaign.
          </p>
        </Section>

        {/* footer */}
        <p style={{ textAlign: "center", fontSize: 12, color: "#3a423d", margin: "26px 0 8px" }}>
          Powered by <Link href="/" style={{ color: "var(--text-muted)" }}>YourScore</Link>
        </p>
      </div>
      <BottomNav />
    </main>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────────

function Section({ title, subtitle, accent, children }: { title: string; subtitle?: string; accent: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "26px 18px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: subtitle ? 2 : 12 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: accent }} />
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase", color: "#fff" }}>{title}</h2>
      </div>
      {subtitle && <p style={{ margin: "0 0 12px 12px", fontSize: 12.5, color: "var(--text-muted)" }}>{subtitle}</p>}
      {children}
    </section>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <span style={{ fontWeight: 900, color: color ?? "#fff", fontSize: 15 }}>{value}</span>
      <span style={{ color: "var(--text-muted)", marginLeft: 5 }}>{label}</span>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, background: "var(--border)" }} />;
}

function StartsPill({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 900, letterSpacing: 0.8, color, background: `${color}1f`, border: `1px solid ${color}55`, padding: "3px 9px", borderRadius: 999 }}>
      🚀 STARTS {label}
    </span>
  );
}

function VerifiedTick({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.2 1.6 2.7-.3 1.1 2.5 2.5 1.1-.3 2.7L24 12l-1.6 2.2.3 2.7-2.5 1.1-1.1 2.5-2.7-.3L12 22l-2.2-1.6-2.7.3-1.1-2.5-2.5-1.1.3-2.7L2 12l1.6-2.2-.3-2.7 2.5-1.1L6.9 3.4l2.7.3L12 2z" fill={color} />
      <path d="M8.5 12l2.3 2.3 4.7-4.7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z" /></svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="#E1306C" strokeWidth="1.7" /><circle cx="12" cy="12" r="4.2" stroke="#E1306C" strokeWidth="1.7" /><circle cx="17.3" cy="6.7" r="1.2" fill="#E1306C" /></svg>
  );
}

function TikTokIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M16.5 3c.3 2.1 1.5 3.6 3.5 3.9v2.6c-1.3.1-2.5-.3-3.6-1v5.6c0 4-2.9 6.4-6 6.4-3 0-5-2.3-5-5 0-3 2.4-5 5.4-4.8v2.8c-.4-.1-.8-.2-1.2-.1-1.2.1-2 .9-2 2.1 0 1.2 1 2.1 2.2 2 .9-.1 1.8-.9 1.8-2.3V3h2.4z" /></svg>
  );
}
