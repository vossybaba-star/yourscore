/**
 * /marketing/instagram — internal preview + download gallery for the YourScore
 * Instagram post generator (/api/og/instagram).
 *
 * Browse every preset at every size, tweak nothing or tweak everything, and
 * download the PNG to post. Not linked from app nav — a marketing tool.
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Instagram posts · YourScore",
  robots: { index: false, follow: false },
};

const PRESETS: { id: string; label: string; note: string }[] = [
  { id: "wc", label: "World Cup Mastermind", note: "Launch hook · gold + trophy" },
  { id: "380", label: "38-0 (flagship)", note: "Team-builder · green + pitch" },
  { id: "quiz", label: "Quiz", note: "Knowledge game · green + grid" },
  { id: "rank", label: "YourScore Rank", note: "Cross-game ladder · gold + grid" },
  { id: "league", label: "Leagues", note: "Social loop · green + pitch" },
  { id: "stat", label: "Stat (info-first)", note: "The number IS the post" },
];

const SIZES: { id: string; label: string; ratio: string }[] = [
  { id: "portrait", label: "Feed 4:5", ratio: "1080×1350" },
  { id: "square", label: "Feed 1:1", ratio: "1080×1080" },
  { id: "story", label: "Story 9:16", ratio: "1080×1920" },
];

export default function InstagramGallery() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0f", color: "#fff", fontFamily: "system-ui, sans-serif", padding: "48px 32px 96px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <h1 style={{ fontSize: 34, fontWeight: 900, margin: 0 }}>
          <span>YOUR</span>
          <span style={{ color: "#aeea00" }}>SCORE</span>
          <span style={{ color: "#9aa39d", fontWeight: 700 }}> · Instagram posts</span>
        </h1>
        <p style={{ color: "#9aa39d", fontSize: 16, lineHeight: 1.6, maxWidth: 720 }}>
          Code-rendered, on-brand posts (no AI imagery). Every preset below is one
          editable URL — open it, then right-click → <em>Save image</em> to post.
          Override any line with query params, e.g.{" "}
          <code style={{ color: "#aeea00" }}>?hero=Knockout {"{"}rounds{"}"} are live&amp;sub=…</code>.
        </p>

        {PRESETS.map((p) => (
          <section key={p.id} style={{ marginTop: 48 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{p.label}</h2>
              <span style={{ color: "#8a948f", fontSize: 14 }}>{p.note}</span>
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
              {SIZES.map((s) => {
                const src = `/api/og/instagram?template=${p.id}&size=${s.id}`;
                // Preview width scaled so all three sit on a row; story is tall.
                const w = s.id === "story" ? 220 : s.id === "portrait" ? 264 : 264;
                return (
                  <a
                    key={s.id}
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "#000" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`${p.label} — ${s.label}`} width={w} style={{ display: "block", width: w, height: "auto" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, color: "#9aa39d", fontSize: 13 }}>
                      <span style={{ fontWeight: 700, color: "#c4ccc6" }}>{s.label}</span>
                      <span>{s.ratio}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        ))}

        <section style={{ marginTop: 56, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 28 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Customising</h2>
          <ul style={{ color: "#9aa39d", fontSize: 15, lineHeight: 1.8 }}>
            <li><code style={{ color: "#aeea00" }}>template</code> — wc · 380 · quiz · rank · league · stat</li>
            <li><code style={{ color: "#aeea00" }}>size</code> — portrait (4:5) · square (1:1) · story (9:16)</li>
            <li><code style={{ color: "#aeea00" }}>badge · supra · hero · sub · cta · url</code> — override any copy. Wrap one <code>{"{token}"}</code> in <code>hero</code> to colour it with the accent.</li>
            <li><code style={{ color: "#aeea00" }}>p1 · p2 · p3</code> — the three support pills</li>
            <li><code style={{ color: "#aeea00" }}>accent</code> — green · gold &nbsp;·&nbsp; <code style={{ color: "#aeea00" }}>backdrop</code> — trophy · pitch · grid · none</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
