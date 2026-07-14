"use client";
/**
 * YourScore Fantasy Football — shared client theme + primitives + fetch helpers.
 * Visual identity: gold on deep pitch (same family as the warm-up game).
 */
import { type CSSProperties, type ReactNode } from "react";
import { getTeamBadgeUrlSync } from "@/lib/teamImages";

export const GOLD = "#E3B54C";
export const PITCH = "#0E1F17";
export const PANEL = "#16261C";
export const LINE = "#2A4032";
export const INK = "#EDEAE0";
export const MUTED = "#9FB2A5";

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
const GET_PATHS = new Set(["pool", "state", "form"]);

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, body === undefined
    ? { method: GET_PATHS.has(path) ? "GET" : "POST" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

export const page: CSSProperties = {
  minHeight: "100dvh", background: PITCH, color: INK,
  fontFamily: "'Avenir Next','Helvetica Neue',system-ui,sans-serif",
  padding: "18px 16px 90px", maxWidth: 560, margin: "0 auto",
};

export function Header({ right }: { right?: ReactNode }) {
  // Wraps, because the right slot outgrew the row: on a 375px phone the hub's
  // three chips plus a button ran off the edge, taking the last chip and the
  // button off-screen entirely with no scrollbar to hint they were there.
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      flexWrap: "wrap", gap: 8, marginBottom: 14,
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.14em", color: GOLD }}>
        YOURSCORE FANTASY FOOTBALL
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{right}</span>
    </div>
  );
}

export function Chip({ children, gold = false }: { children: ReactNode; gold?: boolean }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
      background: gold ? GOLD : PANEL, color: gold ? "#2A1F00" : MUTED,
      border: `1px solid ${gold ? GOLD : LINE}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

export function Btn({ children, onClick, gold = false, disabled = false, small = false }: {
  children: ReactNode; onClick?: () => void; gold?: boolean; disabled?: boolean; small?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? "8px 12px" : "13px 16px", borderRadius: 12,
      fontSize: small ? 13 : 14.5, fontWeight: 700, cursor: disabled ? "default" : "pointer",
      background: gold ? GOLD : "transparent", color: gold ? "#2A1F00" : INK,
      border: `1.5px solid ${gold ? GOLD : LINE}`, opacity: disabled ? 0.45 : 1,
      width: small ? undefined : "100%",
    }}>{children}</button>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, ...style }}>
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
