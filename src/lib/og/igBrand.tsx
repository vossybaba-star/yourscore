/**
 * igBrand — the YourScore Instagram post system, expressed as reusable next/og
 * (Satori) primitives so every generated post is on-brand BY CONSTRUCTION.
 *
 * It reuses the exact brand tokens already proven in the live share-card routes
 * (/api/og/home, /api/og/quiz, /api/draft/*-og): the green #aeea00, the dark
 * green-black gradient, the YOUR|SCORE wordmark, the bottom accent bar.
 *
 * Design law for these posts: **the information is always the dominant layer.**
 * Imagery (the gold trophy, the pitch lines) renders as a dimmed full-bleed
 * BACKDROP behind the content — it sets the mood but never out-shouts the words
 * and the number we're actually trying to communicate. The HERO slot is always
 * the largest thing on the canvas.
 *
 * Satori-safe throughout: single linear-gradient backgrounds, every text node
 * wrapped in a span/div with `display: flex`, spacing via `gap` in centred
 * columns (Satori drops marginTop on centred flex children).
 */

import type { ReactElement } from "react";

// ── Palette (lifted verbatim from the live brand) ────────────────────────────
export const BRAND = {
  green: "#aeea00",
  gold: "#ffd700",
  goldDeep: "#d4a800",
  goldLight: "#fff4b8",
  red: "#ff4757",
  white: "#ffffff",
  ink: "#0a0a0f",
  text: "#c4ccc6",
  muted: "#9aa39d",
  muted2: "#8a948f",
} as const;

export type Accent = "green" | "gold";
export const accentHex = (a: Accent) => (a === "gold" ? BRAND.gold : BRAND.green);
export const accentDim = (a: Accent) =>
  a === "gold" ? "rgba(255,215,0,0.12)" : "rgba(174,234,0,0.12)";
export const accentBorder = (a: Accent) =>
  a === "gold" ? "rgba(255,215,0,0.5)" : "rgba(174,234,0,0.5)";

// ── Canvas sizes (the three formats Instagram actually uses) ─────────────────
export type IgSize = "square" | "portrait" | "story";
export const IG_DIMENSIONS: Record<IgSize, { w: number; h: number }> = {
  square: { w: 1080, h: 1080 }, // feed post (1:1)
  portrait: { w: 1080, h: 1350 }, // feed post (4:5) — biggest feed footprint
  story: { w: 1080, h: 1920 }, // Stories / Reels cover (9:16)
};

// A single dark gradient — green-tinted for green accents, warmer for gold.
const bgFor = (a: Accent) =>
  a === "gold"
    ? "linear-gradient(150deg, #0a0a0f 0%, #141008 55%, #0b0d08 100%)"
    : "linear-gradient(150deg, #0a0a0f 0%, #0b1a12 55%, #08130d 100%)";

// ── Backdrop imagery (dimmed watermark layer) ────────────────────────────────
export type Backdrop = "trophy" | "pitch" | "grid" | "none";

/** A clean, code-drawn gold trophy. Vector — never reads as an AI image. */
function TrophyBackdrop({ size }: { size: number }): ReactElement {
  const g = BRAND.gold;
  const gd = BRAND.goldDeep;
  const gl = BRAND.goldLight;
  return (
    <svg width={size} height={size * 1.3} viewBox="0 0 200 260" style={{ display: "flex" }}>
      {/* handles */}
      <path d="M44 42 C10 42 10 116 62 116" stroke={g} strokeWidth={14} fill="none" />
      <path d="M156 42 C190 42 190 116 138 116" stroke={g} strokeWidth={14} fill="none" />
      {/* rim */}
      <rect x={38} y={30} width={124} height={16} rx={8} fill={gl} />
      {/* bowl */}
      <path d="M44 46 L156 46 L146 118 C146 150 54 150 54 118 Z" fill={g} />
      <path d="M44 46 L100 46 L100 146 C72 144 56 132 54 118 Z" fill={gd} opacity={0.55} />
      {/* stem + base */}
      <rect x={91} y={150} width={18} height={42} fill={gd} />
      <rect x={60} y={192} width={80} height={16} rx={5} fill={g} />
      <rect x={48} y={208} width={104} height={24} rx={8} fill={gd} />
      <rect x={40} y={232} width={120} height={14} rx={6} fill={g} />
    </svg>
  );
}

/** Subtle pitch / centre-circle lines — the 38-0 mood. */
function PitchBackdrop({ w, h }: { w: number; h: number }): ReactElement {
  const stroke = BRAND.green;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "flex" }}>
      <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke} strokeWidth={3} />
      <circle cx={w / 2} cy={h / 2} r={w * 0.22} stroke={stroke} strokeWidth={3} fill="none" />
      <circle cx={w / 2} cy={h / 2} r={10} fill={stroke} />
      <rect x={w * 0.5 - w * 0.18} y={-2} width={w * 0.36} height={h * 0.14} stroke={stroke} strokeWidth={3} fill="none" />
      <rect x={w * 0.5 - w * 0.18} y={h - h * 0.14} width={w * 0.36} height={h * 0.14} stroke={stroke} strokeWidth={3} fill="none" />
    </svg>
  );
}

/** A faint dot-grid — the Quiz / data mood. */
function GridBackdrop({ w, h }: { w: number; h: number }): ReactElement {
  const dots: ReactElement[] = [];
  const step = 84;
  for (let y = step; y < h; y += step) {
    for (let x = step; x < w; x += step) {
      dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={3} fill={BRAND.green} />);
    }
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "flex" }}>
      {dots}
    </svg>
  );
}

function BackdropLayer({ kind, w, h }: { kind: Backdrop; w: number; h: number }): ReactElement | null {
  if (kind === "none") return null;
  // Low opacity = mood, not message. The content layer always wins.
  const opacity = kind === "trophy" ? 0.1 : kind === "pitch" ? 0.08 : 0.06;
  const inner =
    kind === "trophy" ? (
      <TrophyBackdrop size={Math.min(w, h) * 0.92} />
    ) : kind === "pitch" ? (
      <PitchBackdrop w={w} h={h} />
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
export function Wordmark({ scale = 1 }: { scale?: number }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      <span style={{ color: BRAND.white, fontSize: 38 * scale, fontWeight: 900, letterSpacing: 1 }}>YOUR</span>
      <span style={{ color: BRAND.green, fontSize: 38 * scale, fontWeight: 900, letterSpacing: 1 }}>SCORE</span>
    </div>
  );
}

export function Kicker({ text, accent }: { text: string; accent: Accent }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        padding: "11px 26px",
        borderRadius: 999,
        background: accentDim(accent),
        border: `1px solid ${accentBorder(accent)}`,
      }}
    >
      <span style={{ display: "flex", color: accentHex(accent), fontSize: 30, fontWeight: 800, letterSpacing: 4 }}>
        {text.toUpperCase()}
      </span>
    </div>
  );
}

/**
 * A support pill with a small brand-accent dot. The dot is a drawn div (not an
 * emoji glyph) so it renders identically everywhere — no CDN/twemoji dependency,
 * no broken-glyph risk, and a cleaner, more corporate finish than emoji.
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
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.14)",
      }}
    >
      <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: accentHex(accent) }} />
      <span style={{ display: "flex", color: BRAND.text, fontSize: 30, fontWeight: 700 }}>{children}</span>
    </div>
  );
}

/**
 * The HERO — always the largest thing on the canvas. `hero` may contain one
 * "{accent}" wrapped token, e.g. "Your football knowledge. {Ranked.}" — that
 * token renders in the accent colour, everything else white.
 *
 * Rendered word-by-word so the headline WRAPS naturally inside `contentWidth`
 * (each word is its own span; `gap` supplies the spaces and the line spacing).
 * The font size auto-fits: it shrinks so even the longest single word fits the
 * width, but it is always the dominant element on the canvas.
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
  // Tokenise into words, tracking which came from inside the {accent} braces.
  const words: { t: string; a: boolean }[] = [];
  for (const part of hero.split(/(\{[^}]+\})/g).filter(Boolean)) {
    const isAccent = part.startsWith("{") && part.endsWith("}");
    const inner = isAccent ? part.slice(1, -1) : part;
    for (const wd of inner.split(/\s+/).filter(Boolean)) words.push({ t: wd, a: isAccent });
  }

  const longest = words.reduce((m, wd) => Math.max(m, wd.t.length), 1);
  const totalLen = words.reduce((s, wd) => s + wd.t.length + 1, 0);
  const byWidth = contentWidth / (longest * 0.6); // longest word must fit the width
  const byLength = (max * 13) / Math.max(8, totalLen); // overall balance for long lines
  const fontSize = Math.max(60, Math.round(Math.min(max, byWidth, byLength)));
  const gap = Math.round(fontSize * 0.26);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "center", gap }}>
      {words.map((wd, i) => (
        <span
          key={i}
          style={{
            display: "flex",
            fontSize,
            fontWeight: 900,
            lineHeight: 1.0,
            letterSpacing: -2,
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
  date,
  children,
  cta,
  url = "yourscore.app",
}: {
  size: IgSize;
  accent: Accent;
  backdrop: Backdrop;
  badge?: string;
  date?: string;
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
        fontFamily: "sans-serif",
        position: "relative",
        padding: pad,
      }}
    >
      <BackdropLayer kind={backdrop} w={w} h={h} />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 1 }}>
        <Wordmark />
        {badge ? <Kicker text={badge} accent={accent} /> : date ? (
          <span style={{ display: "flex", color: BRAND.muted, fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>{date}</span>
        ) : null}
      </div>

      {/* centre — the information block, always dominant */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          gap: 30,
          zIndex: 1,
          textAlign: "center",
        }}
      >
        {children}
      </div>

      {/* footer: CTA + url */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 1 }}>
        {cta ? (
          <div style={{ display: "flex", padding: "16px 34px", borderRadius: 999, background: accentHex(accent) }}>
            <span style={{ display: "flex", color: BRAND.ink, fontSize: 32, fontWeight: 900, letterSpacing: 0.5 }}>{cta}</span>
          </div>
        ) : (
          <span style={{ display: "flex", color: BRAND.muted, fontSize: 28, fontWeight: 600 }}>Your football knowledge. Ranked.</span>
        )}
        <span style={{ display: "flex", color: accentHex(accent), fontSize: 30, fontWeight: 800 }}>{url}</span>
      </div>

      {/* signature accent base line */}
      <div style={{ position: "absolute", left: 0, bottom: 0, width: w, height: 12, background: accentHex(accent) }} />
    </div>
  );
}
