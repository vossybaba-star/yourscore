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

// ── Backdrop imagery (dimmed watermark layer) ────────────────────────────────
export type Backdrop = "trophy" | "pitch" | "grid" | "none";

/** A clean, code-drawn gold trophy. Vector — never reads as an AI image. */
function TrophyBackdrop({ size }: { size: number }): ReactElement {
  const g = BRAND.gold;
  const gd = "#b8860b";
  const gl = "#ffe08a";
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 200 260" style={{ display: "flex" }}>
      <path d="M44 42 C10 42 10 116 62 116" stroke={g} strokeWidth={14} fill="none" />
      <path d="M156 42 C190 42 190 116 138 116" stroke={g} strokeWidth={14} fill="none" />
      <rect x={38} y={30} width={124} height={16} rx={8} fill={gl} />
      <path d="M44 46 L156 46 L146 118 C146 150 54 150 54 118 Z" fill={g} />
      <path d="M44 46 L100 46 L100 146 C72 144 56 132 54 118 Z" fill={gd} opacity={0.55} />
      <rect x={91} y={150} width={18} height={42} fill={gd} />
      <rect x={60} y={192} width={80} height={16} rx={5} fill={g} />
      <rect x={48} y={208} width={104} height={24} rx={8} fill={gd} />
      <rect x={40} y={232} width={120} height={14} rx={6} fill={g} />
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

function BackdropLayer({ kind, w, h, accent }: { kind: Backdrop; w: number; h: number; accent: Accent }): ReactElement | null {
  if (kind === "none") return null;
  const opacity = kind === "trophy" ? 0.1 : kind === "pitch" ? 0.08 : 0.05;
  const inner =
    kind === "trophy" ? (
      <TrophyBackdrop size={Math.min(w, h) * 0.92} />
    ) : kind === "pitch" ? (
      <PitchBackdrop w={w} h={h} color={accentHex(accent)} />
    ) : (
      <GridBackdrop w={w} h={h} />
    );
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: w,
        height: h,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      {inner}
    </div>
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
      <BackdropLayer kind={backdrop} w={w} h={h} accent={accent} />

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
