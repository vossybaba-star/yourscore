"use client";
/**
 * The Fantasy tab's feed-first HOME (founder, 2 Aug). Two account modes (member /
 * public), and within the member view a seamless HOME | FEED sub-tab (client-side,
 * no route change). Home = where you stand (your squad on the pitch, or a ready-
 * made squad to adopt) + the Scout's picks + your league chats. Feed = everyone's
 * activity. Visual throughout: real pitch boards, portraits, club crests and
 * drawn icons (no emoji).
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PullToRefresh } from "@/components/fantasy/PullToRefresh";
import Link from "next/link";
import {
  AMBER, Btn, CORAL, GOLD, INK, LIME, LINE, MUTED, PANEL, PosTag, TEAL, page, tint, Skel,
} from "@/components/fantasy/shared";
import { CREDIT_CAP } from "@/lib/fantasy/engine";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { SquadBoard } from "@/components/fantasy/SquadBoard";
import type { BoardPlayer } from "@/lib/fantasy/board";
import { timeAgo } from "@/lib/timeAgo";

interface FeedBoard { players: BoardPlayer[]; xi: number[]; bench: number[]; captain?: number | null; vice?: number | null }
interface FeedFace { name: string; avatarUrl: string | null }
interface FeedEvent {
  id: string; actorId: string; actorName: string; actorAvatar: string | null; actorClub?: string | null;
  type: string; sentence: string; createdAt: string;
  board?: FeedBoard | null; player?: FeedFace | null; playerId?: number | null;
}
interface ScoutPick { category: string; id: number; name: string; club: string; pos: string; price: number; avatarUrl: string | null }
interface LeagueCard { code: string; name: string; memberCount: number; latest: { author: string; preview: string } | null; msgCount: number; unread: number; imageUrl: string | null }
interface HomeData {
  you: { hasSquad: boolean; gw: number | null; phase: "pre" | "live" | "final"; deadline: string | null;
    rank: number | null; points: number; played: number; totalPlayers: number; gapToFirst: number | null;
    board: FeedBoard | null; bank: number | null };
  leagues: LeagueCard[];
  moves: FeedEvent[];
  movesScope: "following" | "global";
  followingCount: number;
  proposed: { pickIds: number[]; players: BoardPlayer[] } | null;
  todo: { squad: boolean; league: boolean; follow: boolean };
}

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
const ordinal = (n: number) => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, margin: "18px 2px 8px" }}>{children}</div>
);

// ── Drawn icons for the feed (no emoji) ──────────────────────────────────────
// Each event type owns a colour, so the feed reads as a mix — teal squads, lime
// moves, coral hauls, amber chips, gold shortlists — not a wall of one hue.
const MOVE_META: Record<string, { accent: string; glyph: React.ReactNode }> = {
  squad_complete: { accent: TEAL, glyph: <path d="M7 4l3 1.6L13 4l3 1.6L19 4l1.6 3.4-2.6 1V19H6V8.4l-2.6-1L5 4z" /> },
  transfer: { accent: LIME, glyph: <><path d="M4 8h13m0 0l-3-3m3 3l-3 3" /><path d="M20 16H7m0 0l3-3m-3 3l3 3" /></> },
  squad_update: { accent: LIME, glyph: <><path d="M4 8h13m0 0l-3-3m3 3l-3 3" /><path d="M20 16H7m0 0l3-3m-3 3l3 3" /></> },
  haul: { accent: CORAL, glyph: <path d="M12 3c2 3 4 4 4 8a4 4 0 11-8 0c0-2 1-3 2-4 0 2 1 3 2 3 .5-2 0-4-.6-5.5C12 5 12 4 12 3z" /> },
  chip: { accent: AMBER, glyph: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /> },
  rank_jump: { accent: LIME, glyph: <path d="M6 15l6-6 6 6" /> },
  shortlist_add: { accent: GOLD, glyph: <path d="M12 4l2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.4-4.6 2.4.9-5.2L4.5 9.5l5.2-.8z" /> },
};
const accentFor = (type: string): string => (type === "captain" ? GOLD : MOVE_META[type]?.accent ?? TEAL);
function MoveGlyph({ type }: { type: string }) {
  const m = MOVE_META[type];
  if (type === "captain") {
    return <span style={{ width: 22, height: 22, borderRadius: 999, background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "55")}`, color: GOLD, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>C</span>;
  }
  if (!m) return <span style={{ width: 22, height: 22 }} aria-hidden />;
  return (
    <span style={{ width: 22, height: 22, borderRadius: 999, background: tint(m.accent, "16"), border: `1px solid ${tint(m.accent, "44")}`, color: m.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{m.glyph}</svg>
    </span>
  );
}

/** A manager's face with their captain's-club crest on the corner. */
function ManagerFace({ name, avatarUrl, club, size = 32 }: { name: string; avatarUrl: string | null; club?: string | null; size?: number }) {
  return (
    <div style={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <PlayerAvatar name={name} avatarUrl={avatarUrl} size={size} />
      {club && (
        <span aria-hidden style={{ position: "absolute", bottom: -2, right: -3, width: size * 0.5, height: size * 0.5, minWidth: 14, minHeight: 14, borderRadius: "50%", background: "#0a1710", border: "1.5px solid #0a1710", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Crest club={club} size={size * 0.5} />
        </span>
      )}
    </div>
  );
}

// ── GAMEWEEK STATUS hero — where you stand right now + the one thing to do
// next (edit the squad). Shows only what the home payload actually returns:
// gameweek, deadline, rank, points, gap to first. No invented fields. ────────
function GameweekHero({ you, proposed, onAdopt, adopting }: { you: HomeData["you"]; proposed: HomeData["proposed"]; onAdopt: () => void; adopting: boolean }) {
  const router = useRouter();
  const gwLabel = you.gw ? `GAMEWEEK ${you.gw}` : "PRE-SEASON";
  const cd = countdown(you.deadline);

  if (!you.hasSquad) {
    return (
      <div style={{ borderRadius: 16, padding: 16, background: `linear-gradient(150deg, ${tint(TEAL,"1e")}, ${PANEL})`, border: `1px solid ${tint(TEAL,"44")}` }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: TEAL }}>{gwLabel}{cd ? ` · DEADLINE ${cd.toUpperCase()}` : ""}</div>
        <div className="font-display" style={{ fontSize: 23, color: INK, lineHeight: 1.06, margin: "8px 0 4px" }}>Here&apos;s a squad to start with</div>
        <p style={{ fontSize: 13, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>A ready-made, legal £100m 15. Go with it now and tweak whenever, or build your own.</p>
        {proposed && proposed.players.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <SquadBoard mode="build" players={proposed.players} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}><Btn gold disabled={adopting || !proposed} onClick={onAdopt}>{adopting ? "Setting up…" : "Use this squad"}</Btn></div>
          <div style={{ flex: 1 }}><Btn onClick={() => router.push("/fantasy/build")}>Build my own</Btn></div>
        </div>
      </div>
    );
  }
  const scored = you.rank != null;
  return (
    <div style={{ borderRadius: 16, padding: 16, background: `linear-gradient(150deg, ${tint(TEAL,"14")}, ${PANEL})`, border: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: you.phase === "final" ? GOLD : TEAL }}>
          {gwLabel} · {you.phase === "pre" ? "PRE-DEADLINE" : you.phase === "live" ? "LIVE" : "FINAL"}
        </div>
        {cd && <span style={{ fontSize: 12, color: MUTED }}>Deadline {cd}</span>}
      </div>
      {scored ? (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", margin: "10px 0 4px" }}>
          <div><div className="font-display" style={{ fontSize: 30, color: INK, lineHeight: 1 }}>{ordinal(you.rank!)}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>of {you.totalPlayers.toLocaleString()}</div></div>
          <div><div className="font-display" style={{ fontSize: 30, color: GOLD, lineHeight: 1 }}>{you.points}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>points</div></div>
          {you.gapToFirst != null && you.gapToFirst > 0 && <div><div className="font-display" style={{ fontSize: 30, color: INK, lineHeight: 1 }}>{you.gapToFirst}</div><div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>behind 1st</div></div>}
        </div>
      ) : (
        <div style={{ margin: "8px 0 4px" }}>
          <div className="font-display" style={{ fontSize: 24, color: INK, lineHeight: 1.05 }}>Your squad is in</div>
          <p style={{ fontSize: 13, color: MUTED, margin: "5px 0 0", lineHeight: 1.45 }}>The table fills the moment {you.gw ? `Gameweek ${you.gw}` : "the season"} is scored. Tweak your team right up to the deadline.</p>
        </div>
      )}
      {you.board && you.board.xi.length > 0 && (
        <div style={{ marginTop: 12, paddingBottom: 12 }}>
          <SquadBoard mode="complete" players={you.board.players} xi={you.board.xi} bench={you.board.bench} captain={you.board.captain ?? undefined} vice={you.board.vice ?? undefined} />
        </div>
      )}
      <div style={{ marginTop: 2 }}><Btn gold onClick={() => router.push("/fantasy/build")}>EDIT SQUAD</Btn></div>
    </div>
  );
}

/** A door into /fantasy/rate — upload any screenshot, the Scout grades it.
 *  Shown to signed-out visitors and members alike, as the 2nd tile on Home. */
function RatePhotoHero() {
  const router = useRouter();
  return (
    <button onClick={() => router.push("/fantasy/rate")} style={{
      width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
      borderRadius: 16, padding: 16, marginBottom: 12,
      background: `linear-gradient(150deg, ${tint(GOLD, "1c")}, ${PANEL})`, border: `1px solid ${tint(GOLD, "4a")}`,
    }}>
      <span style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, background: tint(GOLD, "1f"), border: `1px solid ${tint(GOLD, "55")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 15l4.5-4.5a2 2 0 012.8 0L14 14M13 13l1.8-1.8a2 2 0 012.8 0L21 14" /><circle cx="8" cy="8" r="1.4" fill={GOLD} stroke="none" />
        </svg>
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="font-display" style={{ fontSize: 16, color: INK, lineHeight: 1.2 }}>Rate any team from a screenshot</div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>Upload your FPL Pick Team screenshot and the Scout grades it in seconds.</div>
      </div>
      <span aria-hidden style={{ color: GOLD, fontSize: 18, flexShrink: 0 }}>→</span>
    </button>
  );
}

function JoinHook() {
  const router = useRouter();
  // Building is open to everyone — a signed-out visitor picks a full squad and
  // only needs an account to SAVE it (gated in the builder). So the primary CTA
  // goes straight to the builder; only the explicit "Sign in" link goes to auth.
  const build = () => router.push("/fantasy/build");
  const signIn = () => router.push("/auth/sign-in?next=/fantasy");
  return (
    <div style={{ borderRadius: 16, padding: 18, background: `linear-gradient(150deg, ${tint(TEAL,"22")}, ${PANEL})`, border: `1px solid ${tint(TEAL,"55")}` }}>
      <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: TEAL }}>YOURSCORE FANTASY · FREE</div>
      <div className="font-display" style={{ fontSize: 26, color: INK, lineHeight: 1.05, margin: "8px 0 4px" }}>Pick a squad. Beat your friends.</div>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.45 }}>Everyone gets one transfer a gameweek. What you know earns you more. Free forever.</p>
      <Btn gold onClick={build}>Create your free squad</Btn>
      <p style={{ fontSize: 12, color: MUTED, margin: "10px 0 0", textAlign: "center" }}>Already play? <span onClick={signIn} style={{ color: TEAL, fontWeight: 700, cursor: "pointer" }}>Sign in</span></p>
    </div>
  );
}

// ── Scout highlight — bigger, centred portraits with the player's club crest ──
const SCOUT_LABEL: Record<string, string> = { safe: "SAFE", form: "IN FORM", value: "VALUE", gamble: "GAMBLE" };
// Same category hues as the Scout's Four Picks, so a "VALUE" pick is gold here and there.
const SCOUT_CAT_COLOR: Record<string, string> = { safe: TEAL, form: LIME, value: GOLD, gamble: "#a78bfa" };
function ScoutRail({ picks, limit, label = "THE SCOUT'S PICKS", cta = "See all →", to = "/fantasy/news" }: { picks: ScoutPick[]; limit?: number; label?: string; cta?: string; to?: string }) {
  const router = useRouter();
  const shown = limit ? picks.slice(0, limit) : picks;
  if (!shown.length) return null;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 2px 8px" }}>
        <span className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>{label}</span>
        <span onClick={() => router.push(to)} style={{ fontSize: 12, fontWeight: 700, color: TEAL, cursor: "pointer" }}>{cta}</span>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, margin: "0 -16px", padding: "0 16px 4px", scrollbarWidth: "none" }}>
        {shown.map((p) => {
          const cat = SCOUT_CAT_COLOR[p.category] ?? TEAL;
          return (
          <button key={p.category} onClick={() => router.push("/fantasy/news")} style={{
            flex: "0 0 116px", textAlign: "center", cursor: "pointer",
            background: `linear-gradient(160deg, ${tint(cat, "14")}, ${PANEL} 70%)`, border: `1px solid ${tint(cat, "3a")}`, borderRadius: 12, padding: "12px 6px" }}>
            <div className="font-display tracking-widest" style={{ fontSize: 11.5, letterSpacing: "0.12em", color: cat, marginBottom: 11 }}>{SCOUT_LABEL[p.category] ?? p.category.toUpperCase()}</div>
            <div style={{ position: "relative", width: 66, height: 66, margin: "0 auto" }}>
              <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} size={66} />
              {p.club && (
                <span aria-hidden style={{ position: "absolute", bottom: -2, right: -2, width: 26, height: 26, borderRadius: "50%", background: "#0a1710", border: "2px solid #0a1710", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Crest club={p.club} size={22} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}><PosTag pos={p.pos} /></div>
            <div style={{ fontSize: 12.5, color: GOLD, fontWeight: 700, marginTop: 3 }}>£{p.price}m</div>
          </button>
          );
        })}
      </div>
    </>
  );
}

// ── NEEDS ATTENTION — a contextual list built only from signals the home
// payload already carries (todo flags, deadline proximity). Renders nothing
// when there's nothing to flag — never an empty placeholder card. ───────────
function NeedsAttention({ you, todo }: { you: HomeData["you"]; todo: HomeData["todo"] }) {
  const router = useRouter();
  const items: { key: string; accent: string; icon: React.ReactNode; text: string; to: string }[] = [];

  if (you.hasSquad && you.phase === "pre" && you.deadline) {
    const ms = new Date(you.deadline).getTime() - Date.now();
    if (ms > 0 && ms < 24 * 60 * 60 * 1000) {
      const h = Math.max(1, Math.floor(ms / 3600000));
      items.push({
        key: "deadline", accent: GOLD,
        icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
        text: `Deadline in ${h}h. Check your squad before it locks.`,
        to: "/fantasy/build",
      });
    }
  }
  if (todo.league) {
    items.push({
      key: "league", accent: LIME,
      icon: <path d="M21 11.5a8.5 8.5 0 01-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1121 11.5z" />,
      text: "You haven't joined a league yet.",
      to: "/fantasy/leagues",
    });
  }

  if (!items.length) return null;
  return (
    <>
      <SectionLabel>NEEDS ATTENTION</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((it) => (
          <button key={it.key} onClick={() => router.push(it.to)} style={{
            width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12,
          }}>
            <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 999, background: tint(it.accent, "16"), border: `1px solid ${tint(it.accent, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={it.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
            </span>
            <span style={{ flex: 1, fontSize: 13, color: INK, lineHeight: 1.35 }}>{it.text}</span>
            <span aria-hidden style={{ color: MUTED, fontSize: 16, flexShrink: 0 }}>→</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ── The transfer bank as a five-slot pip row — mirrors MovesBank's own bars
// (lib/fantasy/engine.ts CREDIT_CAP = 5) at a compact size, so the same store
// of earned moves reads the same wherever it shows up. Gold fill = held. ─────
function BankPips({ held, cap }: { held: number; cap: number }) {
  const filled = Math.max(0, Math.min(cap, held));
  return (
    <div style={{ display: "flex", gap: 5, margin: "0 0 10px" }} role="img" aria-label={`${filled} of ${cap} transfers banked`}>
      {Array.from({ length: cap }).map((_, i) => (
        <span key={i} style={{
          flex: 1, height: 6, borderRadius: 4,
          background: i < filled ? `linear-gradient(180deg, #ffd977, ${GOLD})` : "rgba(255,255,255,0.08)",
          border: `1px solid ${i < filled ? tint(GOLD, "66") : "rgba(255,255,255,0.06)"}`,
        }} />
      ))}
    </div>
  );
}

// ── EARN TRANSFERS — the weekly knowledge round, styled as a game (lime),
// not a settings card. Mirrors FantasyHub's round card copy + target route.
// Shows the real transfer bank as pips when there's a squad to hold credits;
// with no squad yet there's nothing banked, so the pips are skipped rather
// than faked. ─────────────────────────────────────────────────────────────
function EarnTransferCard({ bank }: { bank: number | null }) {
  const router = useRouter();
  return (
    <div style={{
      borderRadius: 16, padding: 16, marginTop: 12,
      background: `linear-gradient(150deg, ${tint(LIME, "1c")}, ${PANEL})`, border: `1px solid ${tint(LIME, "4a")}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill={LIME} stroke="none"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></svg>
          <span className="font-display tracking-widest" style={{ fontSize: 15, letterSpacing: "0.03em", color: LIME }}>EARN TRANSFERS</span>
        </div>
        {bank != null && <span className="font-display" style={{ fontSize: 13, color: GOLD, fontVariantNumeric: "tabular-nums" }}>{Math.max(0, Math.min(CREDIT_CAP, bank))} / {CREDIT_CAP}</span>}
      </div>
      {bank != null && <BankPips held={bank} cap={CREDIT_CAP} />}
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.45 }}>Get answers right in the weekly quiz to unlock extra moves.</p>
      <Btn lime onClick={() => router.push("/fantasy/round")}>PLAY</Btn>
    </div>
  );
}

// ── League display picture — real art when the league has one, a drawn
// shield with the league's initial otherwise (same fallback idiom as
// DiscoverLeagues' LeagueCrest, sized up for the home row). ──────────────────
function LeagueDp({ name, imageUrl, size = 56 }: { name: string; imageUrl: string | null; size?: number }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: 14, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span style={{ position: "relative", width: size, height: size, flexShrink: 0, borderRadius: 14, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", inset: 0, opacity: 0.55 }}>
        <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      </svg>
      <span className="font-display" style={{ fontSize: size * 0.36, color: TEAL, lineHeight: 1 }}>{initial}</span>
    </span>
  );
}

// ── Your league chats — or a nudge to create one ─────────────────────────────
function LeagueChats({ leagues }: { leagues: LeagueCard[] }) {
  const router = useRouter();
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "18px 2px 8px" }}>
        <span className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED }}>YOUR LEAGUES</span>
        {leagues.length > 0 && <span onClick={() => router.push("/fantasy/leagues")} style={{ fontSize: 12, fontWeight: 700, color: TEAL, cursor: "pointer" }}>See all →</span>}
      </div>
      {leagues.length === 0 ? (
        <div style={{ borderRadius: 14, padding: 16, background: `linear-gradient(150deg, ${tint(GOLD,"16")}, ${PANEL})`, border: `1px solid ${tint(GOLD,"3a")}` }}>
          <div className="font-display" style={{ fontSize: 18, color: INK, lineHeight: 1.15, marginBottom: 4 }}>You haven&apos;t got any leagues</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>Create one, invite your friends, and chat every gameweek. This is where fantasy gets fun.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><Btn gold onClick={() => router.push("/fantasy/leagues")}>Create a league</Btn></div>
            <div style={{ flex: 1 }}><Btn onClick={() => router.push("/fantasy/leagues")}>Join with code</Btn></div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leagues.map((l) => (
            <button key={l.code} onClick={() => router.push(`/fantasy/leagues/${l.code}?t=chat`)} style={{ width: "100%", textAlign: "left", cursor: "pointer", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <LeagueDp name={l.name} imageUrl={l.imageUrl} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                      {l.unread > 0 && <span aria-label={`${l.unread} unread`} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: "#04231f", background: TEAL, borderRadius: 999, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{l.unread > 99 ? "99+" : l.unread}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"}</div>
                  </div>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL, whiteSpace: "nowrap" }}>{l.latest ? "Open chat →" : "Say something →"}</span>
                </div>
                {l.latest ? (
                  <div style={{ fontSize: 12.5, color: "#c7d0cb", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b style={{ color: INK, fontWeight: 700 }}>{l.latest.author}:</b> {l.latest.preview}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: MUTED }}>Quiet so far. Get the banter going.</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── A visual feed card ───────────────────────────────────────────────────────
function MoveCard({ ev }: { ev: FeedEvent }) {
  const hasBoard = !!ev.board && ev.board.xi.length > 0;
  const hasPlayer = !hasBoard && !!ev.player;
  const accent = accentFor(ev.type);
  return (
    <div style={{
      background: `linear-gradient(100deg, ${tint(accent, "12")}, ${PANEL} 62%)`,
      border: `1px solid ${LINE}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 13, padding: 12,
    }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <ManagerFace name={ev.actorName} avatarUrl={ev.actorAvatar} club={ev.actorClub} size={32} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, color: INK, lineHeight: 1.35 }}>
            <Link href={`/profile/${ev.actorId}`} style={{ color: INK, fontWeight: 700, textDecoration: "none" }}>{ev.actorName}</Link>{" "}
            <span style={{ color: "#c7d0cb" }}>{ev.sentence}</span>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>{timeAgo(ev.createdAt)}</div>
        </div>
        <MoveGlyph type={ev.type} />
      </div>

      {hasBoard && (
        <Link href={`/profile/${ev.actorId}#fantasy-xi`} style={{ display: "block", marginTop: 11, textDecoration: "none" }}>
          <div style={{ paddingBottom: 12 }}>
            <SquadBoard mode="complete" players={ev.board!.players} xi={ev.board!.xi} bench={ev.board!.bench} captain={ev.board!.captain ?? undefined} vice={ev.board!.vice ?? undefined} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: TEAL }}>
            See {ev.actorName}&apos;s squad <span aria-hidden>›</span>
          </div>
        </Link>
      )}

      {hasPlayer && (
        <Link href={ev.playerId != null ? `/fantasy/players/${ev.playerId}` : `/profile/${ev.actorId}`}
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginTop: 11, padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
          <PlayerAvatar name={ev.player!.name} avatarUrl={ev.player!.avatarUrl} size={40} />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: INK }}>{ev.player!.name}</span>
          <span style={{ color: MUTED, fontSize: 18 }}>›</span>
        </Link>
      )}
    </div>
  );
}

// ── The rules, demoted to a quiet link near the bottom (no longer a hero card) ─
function RulesRow() {
  const router = useRouter();
  return (
    <button onClick={() => router.push("/fantasy/rules")} style={{
      width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
      background: "transparent", border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px", marginTop: 18,
    }}>
      <span className="font-display" style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, background: tint(TEAL, "12"), color: TEAL, border: `1px solid ${tint(TEAL, "2a")}` }}>?</span>
      <span style={{ minWidth: 0, flex: 1, fontSize: 13, color: MUTED }}>How YourScore Fantasy works. The full rules.</span>
      <span aria-hidden style={{ color: MUTED, fontSize: 16, flexShrink: 0 }}>→</span>
    </button>
  );
}

export function FantasyHome({ mode = "member" }: { mode?: "member" | "public" }) {
  const router = useRouter();
  const [data, setData] = useState<HomeData | null>(null);
  const [pub, setPub] = useState<{ moves: FeedEvent[]; scout: ScoutPick[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);

  // The old Home/Feed toggle is gone — the feed is now the first-class Social tab.
  // Honour any stale ?tab=feed deep-link (older shares, the launch push landing on
  // Home) by forwarding it to /fantasy/social.
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("tab") === "feed") router.replace("/fantasy/social");
    } catch { /* no search params — stay on Home */ }
  }, [router]);

  const load = useCallback(async (): Promise<HomeData | null> => {
    try {
      if (mode === "public") {
        const res = await fetch("/api/fantasy/home/public");
        if (!res.ok) throw new Error("Couldn't load the fantasy feed");
        setPub(await res.json());
        return null;
      }
      const res = await fetch("/api/fantasy/home");
      if (!res.ok) throw new Error("Couldn't load your fantasy home");
      const d: HomeData = await res.json();
      setData(d);
      return d;
    } catch (e) { setErr((e as Error).message); return null; }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  // Pull-to-refresh: reload home and report whether the feed gained anything new.
  const refresh = useCallback(async (): Promise<{ updated?: boolean }> => {
    const prevTop = data?.moves?.[0]?.id;
    const prevLen = data?.moves?.length ?? -1;
    const d = await load();
    if (!d) return {};
    return { updated: d.moves[0]?.id !== prevTop || d.moves.length !== prevLen };
  }, [data, load]);

  const adopt = async () => {
    if (!data?.proposed || adopting) return;
    setAdopting(true);
    try {
      const res = await fetch("/api/fantasy/squad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pickIds: data.proposed.pickIds }) });
      if (res.ok) { setData(null); await load(); }
    } catch { /* leave the CTA, they can retry */ }
    setAdopting(false);
  };

  // ── PUBLIC: no account ─────────────────────────────────────────────────────
  if (mode === "public") {
    return (
      <main data-fantasy style={page}>
        <FantasyHeader />
        <JoinHook />
        <div style={{ marginTop: 12 }}><RatePhotoHero /></div>
        {err ? <p style={{ fontSize: 13, color: "#E08A6B", marginTop: 12 }}>{err}</p>
          : !pub ? <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}><Skel h={64} r={12} /><Skel h={240} r={12} /><Skel h={64} r={12} /></div>
          : (
            <>
              <ScoutRail picks={pub.scout} />
              <SectionLabel>WHAT MANAGERS ARE DOING</SectionLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pub.moves.map((ev) => <MoveCard key={ev.id} ev={ev} />)}
              </div>
              <div style={{ marginTop: 16 }}><Btn gold onClick={() => router.push("/fantasy/build")}>Join in and create your squad</Btn></div>
            </>
          )}
      </main>
    );
  }

  // ── MEMBER: HOME | FEED ────────────────────────────────────────────────────
  return (
    <main data-fantasy style={page}>
      <FantasyHeader />
      {err ? (
        <p style={{ fontSize: 13, color: "#E08A6B" }}>{err}</p>
      ) : !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skel h={40} r={12} /><Skel h={130} r={16} /><Skel h={120} r={12} /><Skel h={64} r={12} />
        </div>
      ) : (
        <PullToRefresh onRefresh={refresh}>
          {/* 1. GAMEWEEK STATUS — where you stand, and the one CTA to fix your squad. */}
          <GameweekHero you={data.you} proposed={data.proposed} onAdopt={adopt} adopting={adopting} />
          {/* 2. NEEDS ATTENTION — only renders when there's a real signal to flag. */}
          <NeedsAttention you={data.you} todo={data.todo} />
          {/* 3. EARN TRANSFERS — the weekly knowledge round, played as a game. */}
          <EarnTransferCard bank={data.you.bank} />
          {/* 4. YOUR LEAGUES — one tap into the conversation. */}
          <LeagueChats leagues={data.leagues} />
          <div style={{ marginTop: 12 }}><RatePhotoHero /></div>
          <RulesRow />
        </PullToRefresh>
      )}
    </main>
  );
}
