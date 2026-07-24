"use client";
/**
 * YourScore Fantasy Football — shared client theme + primitives + fetch helpers.
 *
 * ON THE HOUSE SYSTEM (rebuilt 22 Jul — founder: "it looks old and bland;
 * follow the Premier League tab"). These screens had drifted onto a bespoke
 * palette AND a bespoke font stack ('Avenir Next'), so Bebas/DM Sans never
 * loaded here — which is most of why it read as a different, older app.
 *
 * Colour semantics come from tailwind.config.ts, not from taste:
 *   lime = 38-0 / energy      teal = QUIZ + KNOWLEDGE      gold = WINS ONLY
 * Fantasy is the knowledge game, so TEAL is its accent — the same choice the
 * reference screen made (the PL tab's fantasy pitch). Gold is
 * rationed to things you WON: a gameweek total, top of a table, a month title.
 * Spending gold on every button is what made it mean nothing.
 */
import { type CSSProperties, type ReactNode } from "react";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

/** Reward only — a score, a winner, rank 1. Never a default button. */
export const GOLD = "#ffc233";
/** The fantasy accent: knowledge. Primary actions, live state, section marks. */
export const TEAL = "#00d8c0";
export const PITCH = "#080d0a";   // bg
export const PANEL = "#0e1611";   // surface
export const PANEL_2 = "#15211a"; // surface-2, for raised rows
export const LINE = "rgba(255,255,255,0.07)";
export const INK = "#eef2f0";
export const MUTED = "#8a948f";
/** Accent tint helpers — the reference's hex+alpha idiom (bg 12%, border 28%). */
export const tint = (hex: string, a = "1e") => `${hex}${a}`;

export type Pos = "GK" | "DEF" | "MID" | "FWD";
export type ChipName = "triple_captain" | "bench_boost" | "insight" | "second_chance" | "wildcard";
export interface ClientPoolPlayer {
  id: number; name: string; club: string; clubId: number; pos: Pos; price: number;
}
export interface FantasyState {
  gw: { gw: number; season: string; mode: string; status: string; deadline: string | null };
  season: { gw: number; total: number; finalised: number };
  poolVersion: string;
  openForEdits: boolean;
  canRebuild: boolean;
  squad: {
    picks: { id: number; pos: Pos; clubId: number; buyTenths: number }[];
    bankTenths: number; credits: number; xi: number[]; bench: number[];
    captain: number; vice: number; version: number;
  } | null;
  chips: {
    held: number; progress: number; gameweeksPerChip: number;
    wildcards: number; wildcardHalf: number | null; playedThisGw: ChipName | null;
  } | null;
  entry: {
    status: string;
    round: { answered: number; correct: number; creditsEarned: number; done: boolean };
    transfers: number; hits: number; lockedAt: string | null;
    result: {
      points: number;
      breakdown: { id: number; points: number; captain: boolean; subbedIn: boolean; facts?: MatchFacts }[];
      autosubs: { out: number; in: number }[]; captainUsed: number;
    } | null;
  } | null;
}

/** Routes that read rather than mutate. Everything else defaults to POST — a GET
 *  route missing from this set silently 405s. */
const GET_PATHS = new Set(["pool", "state", "form", "wildcard-value"]);
/** Dynamic GET routes, matched by prefix since the full path (e.g. `player/7`)
 *  is never a fixed string. */
const GET_PREFIXES = ["player/"];
const isGetPath = (path: string) => GET_PATHS.has(path) || GET_PREFIXES.some((p) => path.startsWith(p));

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, body === undefined
    ? { method: isGetPath(path) ? "GET" : "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

/** No fontFamily here on purpose: the root layout's Bebas/DM Sans vars then
 *  apply, which they never did while this set its own stack. */
export const page: CSSProperties = {
  minHeight: "100dvh", background: PITCH, color: INK,
  padding: "16px 16px 96px", maxWidth: 512, margin: "0 auto",
};

export function Header({ right, exit }: { right?: ReactNode; exit?: { label: string; onClick: () => void } }) {
  // Wraps, because the right slot outgrew the row: on a 375px phone the hub's
  // three chips plus a button ran off the edge, taking the last chip and the
  // button off-screen entirely with no scrollbar to hint they were there.
  //
  // `exit` is the get-me-out control. Every screen that can trap you needs one:
  // the native app has no URL bar and no browser back, so a screen without a
  // visible way out is a screen you can only leave by killing the app.
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 8, marginBottom: 14,
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {exit && (
          <button onClick={exit.onClick} aria-label={exit.label}
            className="font-body rounded-full"
            style={{
              background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED,
              fontSize: 12.5, fontWeight: 600, padding: "5px 12px", cursor: "pointer", flexShrink: 0,
            }}>← {exit.label}</button>
        )}
        <span className="font-display tracking-widest" style={{ fontSize: 15, color: TEAL }}>
          YOURSCORE FANTASY
        </span>
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{right}</span>
    </div>
  );
}

/** Status pill. `gold` marks a REWARD (credits in hand, a win); default is quiet. */
export function Chip({ children, gold = false, teal = false }: {
  children: ReactNode; gold?: boolean; teal?: boolean;
}) {
  const accent = gold ? GOLD : teal ? TEAL : null;
  return (
    <span className="font-body rounded-full whitespace-nowrap"
      style={{
        fontSize: 11.5, fontWeight: 600, padding: "4px 10px",
        background: accent ? tint(accent) : PANEL_2,
        color: accent ?? MUTED,
        border: `1px solid ${accent ? tint(accent, "44") : LINE}`,
      }}>{children}</span>
  );
}

/** `gold` = the screen's primary action. Kept as the prop name so every call
 *  site still reads right, but it paints TEAL — actions are knowledge-coloured
 *  here; gold is reserved for what you've won. */
export function Btn({ children, onClick, gold = false, disabled = false, small = false, glow = false }: {
  children: ReactNode; onClick?: () => void; gold?: boolean; disabled?: boolean; small?: boolean;
  /** Breathe. Reserve it for the ONE thing a screen wants you to do — if two
   *  buttons pulse, neither reads as the answer. */
  glow?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`font-body rounded-xl transition-opacity${glow && !disabled ? " animate-fantasy-glow" : ""}`}
      style={{
        padding: small ? "9px 14px" : "14px 18px",
        fontSize: small ? 13 : 15, fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        background: gold ? TEAL : PANEL_2,
        color: gold ? "#03211d" : INK,
        border: `1px solid ${gold ? TEAL : LINE}`,
        opacity: disabled ? 0.4 : 1,
        width: small ? undefined : "100%",
      }}>{children}</button>
  );
}

export function Card({ children, style, onClick }: {
  children: ReactNode; style?: CSSProperties; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className="rounded-2xl"
      style={{ background: PANEL, border: `1px solid ${LINE}`, padding: 16, ...style }}>
      {children}
    </div>
  );
}

/** Section marker — the house pattern: tiny Bebas, wide tracking, dim. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
      {children}
    </div>
  );
}

/** Club crest (local /badges/*.png). Silent if a club has no badge mapped. */
export function Crest({ club, size = 18 }: { club: string; size?: number }) {
  const src = getTeamBadgeUrlSync(club);
  if (!src) return <span style={{ width: size, height: size, display: "inline-block" }} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size}
    style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />;
}

export interface MatchFacts {
  minutes: number; goals: number; assists: number; cleanSheet: number; conceded: number;
  saves: number; pensSaved: number; pensMissed: number; yellows: number; reds: number;
  ownGoals: number; dc: number; dcRec: number;
}

/** Plain-English summary of what a player did, for the result card.
 *  Returns "" when there's no fact data (e.g. an entry scored before facts were
 *  tracked) — the render skips the line rather than wrongly say "didn't play". */
export function factLine(pos: Pos, f?: MatchFacts): string {
  if (!f) return "";
  if (f.minutes === 0) return "Didn't play";
  const bits: string[] = [`${f.minutes}'`];
  if (f.goals) bits.push(`${f.goals} goal${f.goals > 1 ? "s" : ""}`);
  if (f.assists) bits.push(`${f.assists} assist${f.assists > 1 ? "s" : ""}`);
  if (f.cleanSheet && (pos === "GK" || pos === "DEF" || pos === "MID")) bits.push("clean sheet");
  if (pos === "GK" && f.saves >= 3) bits.push(`${f.saves} saves`);
  if (f.pensSaved) bits.push(`${f.pensSaved} pen saved`);
  if ((pos === "DEF" && f.dc >= 10) || (pos !== "DEF" && f.dcRec >= 12)) bits.push("defensive actions");
  if (f.yellows) bits.push("yellow");
  if (f.reds) bits.push("red card");
  if (f.ownGoals) bits.push("own goal");
  if (f.pensMissed) bits.push("pen missed");
  return bits.join(" · ");
}

/** Point drivers that DON'T get their own column in the result table — saves,
 *  cards, defensive actions, goals conceded. Without this line a GK's 12 points
 *  look unexplained: the table shows 90 minutes and a clean sheet, not the 6 saves.
 *  Returns "" when there's nothing extra to say. */
export function extrasLine(pos: Pos, f?: MatchFacts): string {
  if (!f || f.minutes === 0) return "";
  const bits: string[] = [];
  if (pos === "GK" && f.saves > 0) bits.push(`${f.saves} save${f.saves > 1 ? "s" : ""}`);
  if (f.pensSaved) bits.push(`${f.pensSaved} pen saved`);
  if ((pos === "GK" || pos === "DEF") && f.conceded >= 2) bits.push(`${f.conceded} conceded`);
  if ((pos === "DEF" && f.dc >= 10) || (pos !== "DEF" && f.dcRec >= 12)) bits.push("defensive actions");
  if (f.yellows) bits.push("yellow");
  if (f.reds) bits.push("red card");
  if (f.ownGoals) bits.push(`${f.ownGoals} own goal`);
  if (f.pensMissed) bits.push("pen missed");
  return bits.join(" · ");
}

export const fmtM = (tenths: number) => `£${(tenths / 10).toFixed(1)}m`;
export const POS_ORDER: Pos[] = ["GK", "DEF", "MID", "FWD"];
export const QUOTA: Record<Pos, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
