"use client";
/** Leagues tab — two subtabs.
 *
 *   Competition — the YourScore-wide comp: the monthly (e.g. August) table as the
 *                 hero, plus the season-long table. This leads, because the monthly
 *                 prize is what's live now (founder, 31 Jul).
 *   My Leagues  — your private leagues with friends: create, join by code, your
 *                 leagues, and public leagues to discover. Sign-in gated, since
 *                 leagues save to your account.
 *
 * Splitting them makes it clear there's one all-round YourScore competition AND a
 * separate area to play with your friends. The api() helper (shared.tsx) only does
 * GET-or-POST on a fixed path, so the my-leagues+public GET goes through a small
 * local raw fetch. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Btn, Card, GOLD, INK, LINE, LIME, MUTED, page, PANEL, PANEL_2, TEAL, tint,
} from "@/components/fantasy/shared";
import { LeagueCompetition } from "@/components/fantasy/LeagueCompetition";
import { CreateLeagueFlow, JoinLeagueFlow, LeagueEmptyState } from "@/components/fantasy/league/LeagueFlows";
import { DiscoverLeagues } from "@/components/fantasy/DiscoverLeagues";
import { BottomNav } from "@/components/ui/BottomNav";
import { VerifiedTick } from "@/components/ui/Seal";

/** A league's social links (migration 263) — Discord-like community chips.
 *  Re-declared locally (not imported) the same way this file already
 *  re-declares LeagueHighlight/MyLeague below, mirroring the API shape
 *  without pulling in the server-only lib/fantasy/leagues.ts. */
interface LeagueLinks {
  discord?: string; x?: string; instagram?: string; tiktok?: string; website?: string;
}
const LINK_META: { key: keyof LeagueLinks; label: string; accent: string; icon: React.ReactNode }[] = [
  { key: "discord", label: "Discord", accent: "#5865F2", icon: <path d="M8 8.5C10.3 7.3 13.7 7.3 16 8.5M6.5 9c-1.4 2.8-1.4 5.6 0 8.5 1.4.5 2.8.3 3.8-.6M17.5 9c1.4 2.8 1.4 5.6 0 8.5-1.4.5-2.8.3-3.8-.6M9 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0zM12.6 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0z" /> },
  { key: "x", label: "X", accent: "#eef2f0", icon: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></> },
  { key: "instagram", label: "Instagram", accent: "#E1306C", icon: <><rect x="4.5" y="4.5" width="15" height="15" rx="5" /><circle cx="12" cy="12" r="3.4" /><circle cx="16" cy="8" r="0.6" fill="currentColor" stroke="none" /></> },
  { key: "tiktok", label: "TikTok", accent: "#25F4EE", icon: <path d="M14 4v9.6a3 3 0 11-2.6-2.97M14 4a4.6 4.6 0 004.5 4.5" /> },
  { key: "website", label: "Website", accent: TEAL, icon: <><circle cx="12" cy="12" r="8" /><line x1="4" y1="12" x2="20" y2="12" /><path d="M12 4c2 2.2 3 5 3 8s-1 5.8-3 8c-2-2.2-3-5-3-8s1-5.8 3-8z" /></> },
];
/** Icon-only circular chips for a league's social links — Discord/X/Instagram/
 *  TikTok/website, only the ones set. stopPropagation so tapping a chip opens
 *  the link in a new tab instead of navigating into the league (these render
 *  inside a clickable tile everywhere they're used). */
function SocialChips({ links, size = 26 }: { links?: LeagueLinks | null; size?: number }) {
  if (!links) return null;
  const entries = LINK_META.filter((m) => links[m.key]);
  if (!entries.length) return null;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {entries.map(({ key, label, accent, icon }) => (
        <span
          key={key} role="button" tabIndex={0} aria-label={label}
          onClick={(e) => { e.stopPropagation(); window.open(links[key], "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault(); e.stopPropagation(); window.open(links[key], "_blank", "noopener,noreferrer");
          }}
          style={{
            width: size, height: size, flexShrink: 0, borderRadius: "50%", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: tint(accent, "1c"), border: `1px solid ${tint(accent, "44")}`, color: accent,
          }}
        >
          <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
        </span>
      ))}
    </span>
  );
}

interface LeagueHighlight {
  tone: "chat" | "join" | "quiet" | "empty";
  author: string | null;
  text: string;
  at: string | null;
  msgCount: number;
}
interface MyLeague {
  id: string; name: string; code: string; memberCount: number; isPublic: boolean; isOwner: boolean; imageUrl?: string | null;
  highlight: LeagueHighlight;
  unread: number;
  kind: string;
  official?: boolean;
  bio?: string | null;
  links?: LeagueLinks;
}
interface PublicLeague { id: string; name: string; code: string; memberCount: number; imageUrl?: string | null; official?: boolean; bio?: string | null; links?: LeagueLinks }
// "leagues" (My Leagues) and "discover" are the primary split — the global
// bottom-nav Leagues tab, "my people" (product model 2026-08-07). Competition
// stays reachable but isn't a top-level pill any more: it's a compact
// "Global Competition →" link off My Leagues, so there's still one all-round
// YourScore competition without it competing with the friends-first split.
type Tab = "leagues" | "discover" | "competition";
const TAB_KEYS: Tab[] = ["leagues", "discover", "competition"];

/** "3m" / "5h" / "2d" — a highlight without a timestamp doesn't read as live. */
const ago = (iso: string | null): string => {
  if (!iso) return "";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

export default function LeaguesHome() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("leagues");
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // Restore the subtab from the URL on mount, and keep it there so back from a
  // profile or a league returns to the same subtab.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TAB_KEYS as string[]).includes(t)) setTab(t as Tab);
  }, []);
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("tab", tab);
    window.history.replaceState(null, "", u);
  }, [tab]);

  const refresh = useCallback(async () => {
    try {
      const r = await apiRaw<{ leagues: MyLeague[]; public: PublicLeague[] }>("leagues");
      setLeagues(r.leagues);
      setLoaded(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Land STRAIGHT in your league, not on a picker (founder 8 Aug: "the screen to
  // select the league has got to go"). Tapping Leagues drops you into your
  // primary league; the bubble switcher there hops between the rest. The list +
  // Discover stay reachable, just not as the landing — a league's "Browse all"
  // affordance links here with ?browse=1, which shows this page instead.
  const [browse, setBrowse] = useState<boolean | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => { setBrowse(new URLSearchParams(window.location.search).get("browse") === "1"); }, []);
  useEffect(() => {
    if (browse === null || browse || !loaded || leagues.length === 0) return;
    setRedirecting(true);
    router.replace(`/fantasy/leagues/${leagues[0].code}`);
  }, [browse, loaded, leagues, router]);
  // Show the list only when explicitly browsing, or when you have no league to
  // land in. Otherwise we're deciding / redirecting → a quiet loading state, so
  // the picker never flashes up.
  const showList = needsAuth || browse === true || (loaded && leagues.length === 0);

  // Invite share for a hub tile — native share sheet first, clipboard fallback
  // with a brief "Link copied" state per league (matches the [code] detail page).
  const shareInvite = async (l: MyLeague) => {
    const url = `${window.location.origin}/fantasy/leagues/${l.code}`;
    const text = `Join my YourScore Fantasy league "${l.name}"`;
    if (navigator.share) {
      try { await navigator.share({ title: "YourScore Fantasy league", text, url }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(l.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch { /* no clipboard */ }
  };

  // The crest badge (a league image once set, else a shield) shared by both tiles.
  // Community-card sized (founder, 7 Aug): 76px, rounded-2xl — the shield fallback
  // scales up with it so a picture-less league still reads as a real tile.
  const crest = (imageUrl?: string | null, size = 76) => (
    imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: Math.round(size * 0.23), objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />
    ) : (
      <span style={{ width: size, height: size, flexShrink: 0, borderRadius: Math.round(size * 0.23), background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></svg>
      </span>
    )
  );
  // A muted 1-2 line "about" strip — only when the owner's set one.
  const bioLine = (bio?: string | null) => bio ? (
    <p style={{
      fontSize: 12, color: MUTED, lineHeight: 1.4, margin: 0,
      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
    }}>{bio}</p>
  ) : null;
  const hasLinks = (links?: LeagueLinks | null) => !!links && LINK_META.some((m) => links[m.key]);

  // The small badge on the highlight strip — a chat bubble for talk, a person+ for
  // a new joiner or an empty league. SVG, never an emoji (per the UI-icon rule).
  const highlightIcon = (tone: LeagueHighlight["tone"]) => {
    const color = tone === "join" ? LIME : tone === "empty" ? GOLD : TEAL;
    const isPerson = tone === "join" || tone === "empty";
    return (
      <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 7, background: tint(color, "1c"), border: `1px solid ${tint(color, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          {isPerson
            ? <><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></>
            : <path d="M21 11.5a8.5 8.5 0 01-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1121 11.5z" />}
        </svg>
      </span>
    );
  };

  // Invite control on a hub tile — a small pill with a share glyph. Sits inside
  // the tile's <button> root, so it's a span (nested <button> is invalid HTML
  // and breaks hydration) and stops the click from bubbling into navigation.
  const inviteControl = (l: MyLeague) => {
    const copied = copiedId === l.id;
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={`Share invite link for ${l.name}`}
        onClick={(e) => { e.stopPropagation(); void shareInvite(l); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault(); e.stopPropagation(); void shareInvite(l);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0, cursor: "pointer",
          padding: "5px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
          background: copied ? tint(LIME, "1e") : tint(TEAL, "1c"),
          color: copied ? LIME : TEAL,
          border: `1px solid ${copied ? tint(LIME, "44") : tint(TEAL, "44")}`,
        }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
        </svg>
        {copied ? "Link copied" : "Invite"}
      </span>
    );
  };

  // YOUR LEAGUES tile — crest + name, then a live "what's happening" strip: the
  // latest chat line, a recent joiner, or a nudge. Brings the list to life.
  const myLeagueTile = (l: MyLeague) => {
    const h = l.highlight;
    const openChat = h.tone === "chat" || h.tone === "quiet";
    return (
      <button key={l.id} onClick={() => router.push(`/fantasy/leagues/${l.code}${openChat ? "?t=chat" : ""}`)} style={{
        width: "100%", textAlign: "left", cursor: "pointer",
        background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {crest(l.imageUrl)}
          <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            {/* The league NAME owns the first line — full width, the strongest
                identifier. Only the tick + unread badge share it (founder 7 Aug). */}
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ minWidth: 0, fontSize: 15.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              {l.official && <VerifiedTick size={14} />}
              {l.unread > 0 && (
                <span aria-label={`${l.unread} unread`} style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#04231f", background: TEAL, borderRadius: 999, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{l.unread > 99 ? "99+" : l.unread}</span>
              )}
            </span>
            {/* Secondary line: member count + subtle tags, small and muted so they
                never compete with the name above. */}
            <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", fontSize: 12, color: MUTED }}>
              <span>{l.memberCount} member{l.memberCount === 1 ? "" : "s"}{h.msgCount > 0 ? ` · ${h.msgCount} message${h.msgCount === 1 ? "" : "s"}` : ""}</span>
              {l.kind === "club" && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em", color: tint(TEAL, "cc"), background: tint(TEAL, "14"), borderRadius: 999, padding: "1px 6px" }}>Your club</span>}
              {l.kind === "founder" && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em", color: tint(GOLD, "cc"), background: tint(GOLD, "14"), borderRadius: 999, padding: "1px 6px" }}>Founder</span>}
              {l.isPublic && <span style={{ fontSize: 9.5, fontWeight: 600, color: MUTED, background: "rgba(255,255,255,0.05)", borderRadius: 999, padding: "1px 6px" }}>Public</span>}
              {/* Invite lives on this secondary line now, right-aligned, so the
                  NAME above gets the full width and stops truncating (founder 7 Aug). */}
              <span style={{ marginLeft: "auto", flexShrink: 0 }}>{inviteControl(l)}</span>
            </span>
          </span>
          <span style={{ color: TEAL, fontSize: 18, flexShrink: 0 }}>›</span>
        </div>
        {(l.bio || hasLinks(l.links)) && (
          <div style={{ marginLeft: 88, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {bioLine(l.bio)}
            {hasLinks(l.links) && <SocialChips links={l.links} size={22} />}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "8px 10px", background: PANEL_2, borderRadius: 10, border: `1px solid ${LINE}` }}>
          {highlightIcon(h.tone)}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#c7d0cb", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {h.tone === "chat" && <><b style={{ color: INK, fontWeight: 700 }}>{h.author}:</b> {h.text}</>}
            {h.tone === "join" && <><b style={{ color: INK, fontWeight: 700 }}>{h.author}</b> joined</>}
            {(h.tone === "quiet" || h.tone === "empty") && <span style={{ color: MUTED }}>{h.text}</span>}
          </span>
          {h.at && <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{ago(h.at)}</span>}
        </div>
      </button>
    );
  };

  // Competition's entry off My Leagues — a compact card/link row rather than
  // its own top-level pill, so there's still one all-round YourScore
  // competition without splitting the primary My Leagues / Discover choice
  // three ways.
  const globalCompetitionCard = (
    <button onClick={() => setTab("competition")} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
      background: `linear-gradient(150deg, ${tint(GOLD, "14")}, ${PANEL})`, border: `1px solid ${tint(GOLD, "3a")}`, borderRadius: 14, padding: 12, marginBottom: 16,
    }}>
      <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 21h8 M12 17v4 M7 4h10v4a5 5 0 01-10 0V4z M7 5H4a3 3 0 003 3 M17 5h3a3 3 0 01-3 3" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: INK }}>Global Competition</span>
        <span style={{ display: "block", fontSize: 11.5, color: MUTED, marginTop: 1 }}>This month&apos;s YourScore-wide table</span>
      </span>
      <span style={{ color: GOLD, fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  );

  const myLeagues = (
    <>
      {needsAuth ? (
        <>
          {/* Guests can look around the whole app (founder, 4 Aug) — creating
              your own league or joining one is the part that needs an
              account. Browsing every league now lives one tap away on
              Discover, so this stays a simple sign-in prompt. */}
          <Card style={{ marginTop: 2, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Have a look around</div>
            <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              Sign in to create your own league or join one with a friend.
            </p>
            <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/leagues")}>Sign in to create or join</Btn>
            <button onClick={() => setTab("discover")} style={{
              width: "100%", marginTop: 8, padding: "11px 12px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer",
              background: "transparent", color: TEAL, border: `1px solid ${tint(TEAL, "55")}`,
            }}>Browse leagues</button>
          </Card>
          {globalCompetitionCard}
        </>
      ) : (
        <>
          {!loaded ? (
            <p style={{ fontSize: 13, color: MUTED }}>Loading your leagues…</p>
          ) : leagues.length === 0 ? (
            <>
              <LeagueEmptyState onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} />
              <div style={{ marginTop: 16 }}>{globalCompetitionCard}</div>
            </>
          ) : (
            <>
              {/* Your leagues lead; creating and joining are demoted to buttons. */}
              <div style={{ marginBottom: 12 }}>
                <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>YOUR LEAGUES</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {leagues.map(myLeagueTile)}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <div style={{ flex: 1 }}><Btn gold onClick={() => setCreateOpen(true)}>Create league</Btn></div>
                <div style={{ flex: 1 }}><Btn onClick={() => setJoinOpen(true)}>Join with code</Btn></div>
              </div>

              {globalCompetitionCard}
            </>
          )}
          {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "12px 0 0" }}>{err}</p>}
        </>
      )}
    </>
  );

  // Discover — reuses DiscoverLeagues as-is (it already runs its own search
  // and YourScore/club/public sections internally); "FOR YOU" wraps it as
  // the section label, and a join-by-code card sits after it. Public leagues
  // to browse live here now, not duplicated on My Leagues.
  const discoverView = (
    <>
      <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>FOR YOU</div>
      <DiscoverLeagues />
      <Card style={{ marginTop: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 4 }}>Join private league</div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.45 }}>
          Got an invite code from a friend? Enter it here.
        </p>
        <Btn onClick={() => setJoinOpen(true)}>Enter code</Btn>
      </Card>
    </>
  );

  // Deciding or redirecting into a league → a quiet loader, never the picker.
  if (!showList && !redirecting) {
    return (
      <main data-fantasy style={page}>
        <div style={{ marginBottom: 14 }}>
          <h1 className="font-display" style={{ fontSize: 27, color: "#eef2f0", lineHeight: 1, margin: 0 }}>LEAGUES</h1>
        </div>
        <p style={{ fontSize: 13, color: MUTED }}>Opening your league…</p>
      </main>
    );
  }
  if (redirecting) {
    return (
      <main data-fantasy style={page}>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 20 }}>Opening your league…</p>
      </main>
    );
  }

  return (
    <>
    <main data-fantasy style={page}>
      {/* Leagues is a top-level destination now (product model 2026-08-07:
          "my people") — its own header, not the Fantasy chrome. */}
      <div style={{ marginBottom: 14 }}>
        <h1 className="font-display" style={{ fontSize: 27, color: "#eef2f0", lineHeight: 1, margin: 0 }}>LEAGUES</h1>
        <p className="font-body" style={{ fontSize: 13, color: "#8a948f", margin: "6px 0 0" }}>
          Your people. Friends, fantasy leagues and fan communities.
        </p>
      </div>

      {tab === "competition" ? (
        <div style={{ display: "flex", alignItems: "center", margin: "4px 0 14px" }}>
          <button onClick={() => setTab("leagues")} style={{
            display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer",
            color: TEAL, fontSize: 14, fontWeight: 700, padding: 0,
          }}>‹ My Leagues</button>
        </div>
      ) : (
        /* Primary split — My Leagues (your people) and Discover (find more). */
        <div style={{ display: "flex", gap: 6, margin: "4px 0 14px" }}>
          {([["leagues", "My Leagues"], ["discover", "Discover"]] as [Tab, string][]).map(([k, label]) => {
            const active = tab === k;
            return (
              <button key={k} onClick={() => setTab(k)} style={{
                flex: 1, padding: "10px 4px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
                border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
              }}>{label}</button>
            );
          })}
        </div>
      )}

      {tab === "competition" ? <LeagueCompetition /> : tab === "discover" ? discoverView : myLeagues}
    </main>
      <CreateLeagueFlow open={createOpen} onClose={() => setCreateOpen(false)} />
      <JoinLeagueFlow open={joinOpen} onClose={() => setJoinOpen(false)} />
      <BottomNav />
    </>
  );
}
