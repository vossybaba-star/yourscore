/**
 * igBrand — the YourScore Instagram post system, expressed as reusable next/og
 * (Satori) primitives so every generated post is on-brand BY CONSTRUCTION.
 *
 * The brand is taken from the source of truth, not approximated:
 *   • Colours  — tailwind.config.ts: bg #080d0a, surfaces #0e1611/#15211a,
 *     and the brand system rule **lime #aeea00 = 38-0/actions · teal #00d8c0 =
 *     Quiz/knowledge · gold #ffc233 = wins only**.
 *   • Type     — Bebas Neue (the condensed caps of the logo / all display
 *     headers) over DM Sans (body), loaded via src/lib/og/fonts.ts.
 *   • Wordmark — the real logo asset (src/lib/og/logoDataUri.ts), not text.
 *   • Texture  — the app's grid-pattern (40px fine lines).
 *
 * Design law: **the information is always the dominant layer.** Imagery (the
 * gold trophy, the pitch lines, the grid) renders as a dimmed full-bleed
 * BACKDROP that sets the mood but never out-shouts the words and the number we
 * are communicating. The HERO slot is always the largest thing on the canvas.
 *
 * Satori-safe throughout: single linear-gradient backgrounds, every text node
 * wrapped in a span/div with `display: flex`, spacing via `gap` in centred
 * columns (Satori drops marginTop on centred flex children).
 */

import type { ReactElement } from "react";
import { LOGO_DATA_URI } from "@/lib/og/logoDataUri";

// ── Palette (verbatim from tailwind.config.ts) ───────────────────────────────
export const BRAND = {
  lime: "#aeea00", // 38-0 / energy / actions
  teal: "#00d8c0", // Quiz / knowledge
  gold: "#ffc233", // wins only
  danger: "#ff4757",
  white: "#eef2f0", // text-primary
  ink: "#080d0a", // bg
  text: "#c4ccc6",
  muted: "#8a948f", // text-muted
} as const;

export const FONT_DISPLAY = "Bebas Neue";
export const FONT_BODY = "DM Sans";

export type Accent = "lime" | "teal" | "gold";
export const accentHex = (a: Accent) => (a === "gold" ? BRAND.gold : a === "teal" ? BRAND.teal : BRAND.lime);
const ACCENT_RGB: Record<Accent, string> = {
  lime: "174,234,0",
  teal: "0,216,192",
  gold: "255,194,51",
};
export const accentDim = (a: Accent) => `rgba(${ACCENT_RGB[a]},0.12)`;
export const accentBorder = (a: Accent) => `rgba(${ACCENT_RGB[a]},0.5)`;

// ── Canvas sizes (the three formats Instagram actually uses) ─────────────────
export type IgSize = "square" | "portrait" | "story";
export const IG_DIMENSIONS: Record<IgSize, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 }, // feed post (1:1)
  portrait: { w: 1080, h: 1350 }, // feed post (4:5) — biggest feed footprint
  story: { w: 1080, h: 1920 }, // Stories / Reels cover (9:16)
};

// A single dark gradient off the app's pitch→ink ramp, warmed for gold.
const bgFor = (a: Accent) =>
  a === "gold"
    ? "linear-gradient(150deg, #080d0a 0%, #15110a 55%, #0b0d08 100%)"
    : "linear-gradient(150deg, #080d0a 0%, #0e1611 55%, #0b1410 100%)";

// ── Backdrop imagery ─────────────────────────────────────────────────────────
export type Backdrop = "trophy" | "pitch" | "grid" | "none";

// Gold ramp for a metallic, lit look (no SVG gradients — Satori-reliable solids).
const GOLD = {
  hi: "#fff1c2", // specular highlight
  l: "#ffdd6e", // light
  m: "#f5b820", // mid
  d: "#c0820c", // shadow
  dd: "#7c5206", // deep shadow
} as const;

/**
 * A faceted, lit gold trophy — drawn from many solid-tone facets so it reads as
 * a real metallic object (highlight down the centre, shadow on the flanks), not
 * a flat silhouette. Vector, so it never looks like an AI image.
 */
function TrophyArt({ size }: { size: number }): ReactElement {
  return (
    <svg width={size} height={size * 1.32} viewBox="0 0 200 264" style={{ display: "flex" }}>
      {/* handles */}
      <path d="M46 50 C12 50 14 122 64 122" stroke={GOLD.m} strokeWidth={15} fill="none" strokeLinecap="round" />
      <path d="M154 50 C188 50 186 122 136 122" stroke={GOLD.m} strokeWidth={15} fill="none" strokeLinecap="round" />
      <path d="M46 50 C18 50 18 110 60 120" stroke={GOLD.l} strokeWidth={6} fill="none" strokeLinecap="round" />
      {/* bowl — flank shadows then centre highlight for roundness */}
      <path d="M40 44 L160 44 L148 120 C148 154 52 154 52 120 Z" fill={GOLD.m} />
      <path d="M40 44 L74 44 L70 120 C66 138 56 132 52 120 Z" fill={GOLD.d} />
      <path d="M126 44 L160 44 L148 120 C146 134 136 140 130 120 Z" fill={GOLD.d} />
      <path d="M86 44 L114 44 L110 124 C108 150 92 150 90 124 Z" fill={GOLD.l} />
      <path d="M95 46 L105 46 L103 120 C102 140 98 140 97 120 Z" fill={GOLD.hi} />
      {/* rim */}
      <rect x={36} y={36} width={128} height={14} rx={7} fill={GOLD.l} />
      <rect x={36} y={36} width={128} height={5} rx={2.5} fill={GOLD.hi} />
      {/* stem + knot */}
      <rect x={92} y={150} width={16} height={30} fill={GOLD.m} />
      <rect x={92} y={150} width={6} height={30} fill={GOLD.l} />
      <ellipse cx={100} cy={182} rx={20} ry={8} fill={GOLD.d} />
      <ellipse cx={100} cy={180} rx={20} ry={7} fill={GOLD.m} />
      {/* tiered base */}
      <rect x={66} y={188} width={68} height={16} rx={5} fill={GOLD.m} />
      <rect x={66} y={188} width={68} height={5} rx={2.5} fill={GOLD.l} />
      <rect x={52} y={204} width={96} height={22} rx={7} fill={GOLD.d} />
      <rect x={44} y={226} width={112} height={16} rx={6} fill={GOLD.m} />
      <rect x={44} y={226} width={112} height={5} rx={2.5} fill={GOLD.l} />
    </svg>
  );
}

/** Subtle pitch / centre-circle lines — the 38-0 mood. */
function PitchBackdrop({ w, h, color }: { w: number; h: number; color: string }): ReactElement {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "flex" }}>
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={color} strokeWidth={3} />
      <circle cx={w / 2} cy={h / 2} r={w * 0.22} stroke={color} strokeWidth={3} fill="none" />
      <circle cx={w / 2} cy={h / 2} r={10} fill={color} />
      <rect x={w * 0.5 - w * 0.18} y={-2} width={w * 0.36} height={h * 0.14} stroke={color} strokeWidth={3} fill="none" />
      <rect x={w * 0.5 - w * 0.18} y={h - h * 0.14} width={w * 0.36} height={h * 0.14} stroke={color} strokeWidth={3} fill="none" />
    </svg>
  );
}

/** The app's grid-pattern: 40px fine lines (tailwind `bg-grid-pattern`). */
function GridBackdrop({ w, h }: { w: number; h: number }): ReactElement {
  const lines: ReactElement[] = [];
  const step = 40;
  const stroke = "rgba(255,255,255,0.5)"; // dimmed further by the layer opacity
  for (let x = step; x < w; x += step) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke={stroke} strokeWidth={1} />);
  for (let y = step; y < h; y += step) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke={stroke} strokeWidth={1} />);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "flex" }}>
      {lines}
    </svg>
  );
}

function Layer({ children, style }: { children?: ReactElement | ReactElement[]; style: Record<string, unknown> }): ReactElement {
  return <div style={{ position: "absolute", top: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center", ...style }}>{children}</div>;
}

/**
 * The full cinematic stage that sits BEHIND the content: an accent spotlight,
 * the hero art with a glow halo, an edge vignette, and a soft scrim under the
 * centre so the headline always reads crisply (information stays dominant).
 */
function SceneLayers({ backdrop, accent, w, h }: { backdrop: Backdrop; accent: Accent; w: number; h: number }): ReactElement {
  const a = accentHex(accent);
  const rgb = accent === "gold" ? "255,194,51" : accent === "teal" ? "0,216,192" : "174,234,0";
  const trophySize = Math.min(w, h) * 0.86;
  return (
    <Layer style={{ width: w, height: h }}>
      {/* top spotlight */}
      <Layer style={{ width: w, height: h, background: `radial-gradient(circle at 50% 30%, rgba(${rgb},0.20) 0%, rgba(8,13,10,0) 52%)` }} />

      {/* hero art + halo */}
      {backdrop === "trophy" ? (
        <Layer style={{ width: w, height: h }}>
          <Layer style={{ width: w, height: h, background: "radial-gradient(circle at 50% 46%, rgba(255,194,51,0.28) 0%, rgba(8,13,10,0) 40%)" }} />
          <Layer style={{ width: w, height: h }}>
            <div style={{ display: "flex", opacity: 0.92, transform: "translateY(-2%)" }}>
              <TrophyArt size={trophySize} />
            </div>
          </Layer>
        </Layer>
      ) : backdrop === "pitch" ? (
        <Layer style={{ width: w, height: h, opacity: 0.12 }}>
          <PitchBackdrop w={w} h={h} color={a} />
        </Layer>
      ) : backdrop === "grid" ? (
        <Layer style={{ width: w, height: h, opacity: 0.06 }}>
          <GridBackdrop w={w} h={h} />
        </Layer>
      ) : (
        <Layer style={{ width: w, height: h }} />
      )}

      {/* readability scrim under the centre + edge vignette */}
      <Layer style={{ width: w, height: h, background: "radial-gradient(circle at 50% 52%, rgba(8,13,10,0.74) 0%, rgba(8,13,10,0.0) 46%)" }} />
      <Layer style={{ width: w, height: h, background: "radial-gradient(circle at 50% 44%, rgba(8,13,10,0) 52%, rgba(8,13,10,0.66) 100%)" }} />
    </Layer>
  );
}

// ── Shared content primitives ────────────────────────────────────────────────
/** The real YourScore wordmark (logo-mark.png inlined). */
export function Wordmark({ height = 60 }: { height?: number }): ReactElement {
  const ratio = 465 / 125; // logo-mark.png aspect
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO_DATA_URI} alt="YourScore" height={height} width={Math.round(height * ratio)} style={{ display: "flex" }} />
  );
}

export function Kicker({ text, accent }: { text: string; accent: Accent }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        padding: "12px 28px",
        borderRadius: 999,
        background: accentDim(accent),
        border: `1px solid ${accentBorder(accent)}`,
      }}
    >
      <span style={{ display: "flex", fontFamily: FONT_DISPLAY, color: accentHex(accent), fontSize: 40, letterSpacing: 3, lineHeight: 1 }}>
        {text.toUpperCase()}
      </span>
    </div>
  );
}

/**
 * A support pill with a small brand-accent dot. The dot is a drawn div (not an
 * emoji glyph) so it renders identically everywhere — no CDN/twemoji dependency
 * and a cleaner, more corporate finish than emoji.
 */
export function Pill({ children, accent }: { children: string; accent: Accent }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 26px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: accentHex(accent) }} />
      <span style={{ display: "flex", fontFamily: FONT_BODY, color: BRAND.text, fontSize: 30, fontWeight: 700 }}>{children}</span>
    </div>
  );
}

/**
 * The HERO — Bebas Neue (display caps), always the largest thing on the canvas.
 * `hero` may contain one "{accent}" token, e.g. "Your knowledge. {Ranked.}";
 * that token renders in the accent colour, everything else white. Rendered
 * word-by-word so it WRAPS inside `contentWidth`; the font auto-fits so even the
 * longest single word fits the width.
 */
export function Hero({
  hero,
  accent,
  max,
  contentWidth,
}: {
  hero: string;
  accent: Accent;
  max: number;
  contentWidth: number;
}): ReactElement {
  const words: { t: string; a: boolean }[] = [];
  for (const part of hero.split(/(\{[^}]+\})/g).filter(Boolean)) {
    const isAccent = part.startsWith("{") && part.endsWith("}");
    const inner = isAccent ? part.slice(1, -1) : part;
    for (const wd of inner.split(/\s+/).filter(Boolean)) words.push({ t: wd, a: isAccent });
  }

  const longest = words.reduce((m, wd) => Math.max(m, wd.t.length), 1);
  const totalLen = words.reduce((s, wd) => s + wd.t.length + 1, 0);
  // Bebas Neue is condensed (~0.42 of cap-height wide) so it can run larger.
  const byWidth = contentWidth / (longest * 0.46);
  const byLength = (max * 16) / Math.max(8, totalLen);
  const fontSize = Math.max(80, Math.round(Math.min(max, byWidth, byLength)));
  const gap = Math.round(fontSize * 0.22);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center", gap }}>
      {words.map((wd, i) => (
        <span
          key={i}
          style={{
            display: "flex",
            fontFamily: FONT_DISPLAY,
            fontSize,
            lineHeight: 0.9,
            letterSpacing: 0,
            color: wd.a ? accentHex(accent) : BRAND.white,
          }}
        >
          {wd.t}
        </span>
      ))}
    </div>
  );
}

// ── The outer frame: header · centred content · footer · accent bar ──────────
export function PostFrame({
  size,
  accent,
  backdrop,
  badge,
  children,
  cta,
  url = "yourscore.app",
}: {
  size: IgSize;
  accent: Accent;
  backdrop: Backdrop;
  badge?: string;
  children: ReactElement | ReactElement[];
  cta?: string;
  url?: string;
}): ReactElement {
  const { w, h } = IG_DIMENSIONS[size];
  const pad = size === "story" ? 96 : 80;
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        background: bgFor(accent),
        fontFamily: FONT_BODY,
        position: "relative",
        padding: pad,
      }}
    >
      <SceneLayers backdrop={backdrop} accent={accent} w={w} h={h} />

      {/* header: real wordmark + kicker */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 1 }}>
        <Wordmark height={58} />
        {badge ? <Kicker text={badge} accent={accent} /> : <span style={{ display: "flex" }} />}
      </div>

      {/* centre — the information block, always dominant */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 28,
          zIndex: 1,
          textAlign: "center",
        }}
      >
        {children}
      </div>

      {/* footer: CTA + url */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 1 }}>
        {cta ? (
          <div style={{ display: "flex", padding: "16px 36px", borderRadius: 999, background: accentHex(accent) }}>
            <span style={{ display: "flex", fontFamily: FONT_BODY, color: BRAND.ink, fontSize: 32, fontWeight: 700, letterSpacing: 0.5 }}>{cta}</span>
          </div>
        ) : (
          <span style={{ display: "flex", fontFamily: FONT_BODY, color: BRAND.muted, fontSize: 28, fontWeight: 600 }}>Your football knowledge. Ranked.</span>
        )}
        <span style={{ display: "flex", fontFamily: FONT_BODY, color: accentHex(accent), fontSize: 30, fontWeight: 700 }}>{url}</span>
      </div>

      {/* signature accent base line */}
      <div style={{ position: "absolute", left: 0, bottom: 0, width: w, height: 12, background: accentHex(accent) }} />
    </div>
  );
}
