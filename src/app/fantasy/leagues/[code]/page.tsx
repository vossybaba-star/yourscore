"use client";
/** Private league — a Gameweek hub, not a table with a chat box under it. Opens
 *  on Hub; Chat / Table / History are internal tabs; all admin lives behind the
 *  settings icon at /[code]/settings. Auth is optional server-side (link-viewable:
 *  a guest sees the table and a JOIN card that routes through sign-in and back). */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Btn, Card, GOLD, Header, INK, LINE, Loading, MUTED, page, PANEL, PANEL_2, Sheet, Skel, TEAL, tint,
} from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";
import { VerifiedTick } from "@/components/ui/Seal";
import { trackFantasyInvite } from "@/lib/analytics/trackGame";

/** One channel in the invite sheet — an icon in its brand colour, a label, a hint. */
function InviteRow({ onClick, accent, label, sub, icon }: { onClick: () => void; accent: string; label: string; sub: string; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
      background: PANEL_2, border: `1px solid ${LINE}`, borderRadius: 12, padding: "11px 13px",
    }}>
      <span style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, background: tint(accent, "1e"), border: `1px solid ${tint(accent, "44")}`, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: INK }}>{label}</span>
        <span style={{ display: "block", fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>
      </span>
      <span style={{ color: MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  );
}
import { LeagueHub } from "@/components/fantasy/league/LeagueHub";
import { LeagueChatView } from "@/components/fantasy/league/LeagueChatView";
import { LeagueTableView } from "@/components/fantasy/league/LeagueTableView";
import { LeagueGamesView } from "@/components/fantasy/league/LeagueGamesView";
import { LeagueBubbleSwitcher } from "@/components/fantasy/league/LeagueBubbleSwitcher";
import { LeagueHistoryView } from "@/components/fantasy/league/LeagueHistoryView";
import type { ChatData, GamesPulse, LeagueDetail as BaseLeagueDetail } from "@/components/fantasy/league/types";

/** league.bio / league.links (migration 263) — not yet on the shared
 *  league/types.ts DTO, so extended locally here rather than widening that
 *  file for every consumer. The API always returns both (null/{} pre-
 *  migration or before the owner's set anything), so this is a type-only
 *  extension, not a runtime assumption. */
interface LeagueLinks {
  discord?: string; x?: string; instagram?: string; tiktok?: string; website?: string;
}
type LeagueDetail = BaseLeagueDetail & { league: BaseLeagueDetail["league"] & { bio: string | null; links: LeagueLinks } };

const LINK_META: { key: keyof LeagueLinks; label: string; accent: string; icon: React.ReactNode }[] = [
  { key: "discord", label: "Discord", accent: "#5865F2", icon: <path d="M8 8.5C10.3 7.3 13.7 7.3 16 8.5M6.5 9c-1.4 2.8-1.4 5.6 0 8.5 1.4.5 2.8.3 3.8-.6M17.5 9c1.4 2.8 1.4 5.6 0 8.5-1.4.5-2.8.3-3.8-.6M9 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0zM12.6 13a1.2 1.2 0 102.4 0 1.2 1.2 0 00-2.4 0z" /> },
  { key: "x", label: "X", accent: "#eef2f0", icon: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></> },
  { key: "instagram", label: "Instagram", accent: "#E1306C", icon: <><rect x="4.5" y="4.5" width="15" height="15" rx="5" /><circle cx="12" cy="12" r="3.4" /><circle cx="16" cy="8" r="0.6" fill="currentColor" stroke="none" /></> },
  { key: "tiktok", label: "TikTok", accent: "#25F4EE", icon: <path d="M14 4v9.6a3 3 0 11-2.6-2.97M14 4a4.6 4.6 0 004.5 4.5" /> },
  { key: "website", label: "Website", accent: TEAL, icon: <><circle cx="12" cy="12" r="8" /><line x1="4" y1="12" x2="20" y2="12" /><path d="M12 4c2 2.2 3 5 3 8s-1 5.8-3 8c-2-2.2-3-5-3-8s1-5.8 3-8z" /></> },
];
const hasLinks = (links?: LeagueLinks | null) => !!links && LINK_META.some((m) => links[m.key]);
/** Icon-only circular chips in the league header — stopPropagation isn't load-
 *  bearing here (the header has no click-through), kept anyway for consistency
 *  with the tile-list versions of this same component. */
function SocialChips({ links, size = 24 }: { links?: LeagueLinks | null; size?: number }) {
  if (!hasLinks(links)) return null;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {LINK_META.filter((m) => links![m.key]).map(({ key, label, accent, icon }) => (
        <span
          key={key} role="button" tabIndex={0} aria-label={label}
          onClick={(e) => { e.stopPropagation(); window.open(links![key], "_blank", "noopener,noreferrer"); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault(); e.stopPropagation(); window.open(links![key], "_blank", "noopener,noreferrer");
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

type Tab = "hub" | "chat" | "table" | "games" | "history";
// History lost its pill (product model 2026-08-07: four permanent tabs max).
// The view itself stays — reached from the Hub's "Season history" row and via
// ?tab=history deep links, which still resolve above.
const TABS: [Tab, string][] = [["hub", "Hub"], ["chat", "Chat"], ["table", "Table"], ["games", "Games"]];

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(jsonBody.error ?? `HTTP ${res.status}`), { status: res.status });
  return jsonBody as T;
}

export default function LeaguePage() {
  const router = useRouter();
  // `code` is STATE, not read straight off the route, so switching leagues can
  // happen IN PLACE — no route navigation, so nothing remounts, the bubble strip
  // stays put and there's no loading-flash or scroll reset (founder 8 Aug:
  // "switching between leagues should be seamless and smooth"). It still syncs to
  // the real route on a deep-link / browser back-forward.
  const routeCode = String(useParams().code ?? "").toUpperCase();
  const [code, setCode] = useState(routeCode);
  useEffect(() => { setCode(routeCode); }, [routeCode]);

  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [chat, setChat] = useState<ChatData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("hub");
  const [chatGw, setChatGw] = useState<number | null>(null);

  // Games tab badge (Phase 4A follow-through) + Hub module deep-link
  // (Phase 4B) — one pulse fetch, piggybacked on league load (NOT a new
  // heavy call: leagueDetail already loads here, this rides alongside it).
  // Badge rule (documented per the brief): a numeric count of the VIEWER'S
  // OWN action-required items only — never league-wide open-challenge
  // activity, which belongs to the Hub module's own status line instead.
  const [gamesPulse, setGamesPulse] = useState<GamesPulse | null>(null);
  // "Challenge someone" from the Hub's Games module (Phase 4B) — flips true
  // for exactly one LeagueGamesView mount, mirroring the openGwChat pattern
  // History already uses to deep-link into another tab with extra state.
  const [gamesAutoChallenge, setGamesAutoChallenge] = useState(false);
  // Which competition's detail sheet is open in Games, if any. Lives in the
  // URL as `c` (same idea as `gw` for a chat archive) so a competition can be
  // linked and survives a reload, rather than sitting only in local state.
  const [compId, setCompId] = useState<string | null>(null);
  // Seamless tab switching (founder 8 Aug: "not like you're jumping to a new
  // page"): each tab mounts once, then we show/hide it instead of unmounting —
  // so flipping between Hub / Chat / Table / Games is instant, with no reload
  // flash and scroll/state preserved. `gamesKey` forces a fresh Games mount ONLY
  // when a deep-link needs it (open a specific competition / the challenge
  // picker), never on a plain tab tap.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>(["hub"]));
  const [gamesKey, setGamesKey] = useState(0);

  // Restore + persist the tab in the URL, so back from settings/a profile returns
  // to the tab you were on. `gw` deep-links a gameweek's chat (from History);
  // `c` deep-links a competition's detail sheet (from a chat card or Hub module).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("t");
    const legacyTab = sp.get("tab");
    // `tab` is a legacy param name; `t` is canonical (what goTab writes). A
    // link carrying both never anchors on the stale one — `t` always wins —
    // and the legacy param is stripped so it can't linger across taps.
    const resolved = t ?? legacyTab;
    if (resolved === "chat" || resolved === "table" || resolved === "games" || resolved === "history") setTab(resolved);
    const gw = sp.get("gw");
    if (gw && /^\d+$/.test(gw)) setChatGw(Number(gw));
    const c = sp.get("c");
    if (c) setCompId(c);
    if (legacyTab !== null) {
      const u = new URL(window.location.href);
      u.searchParams.delete("tab");
      if (resolved) u.searchParams.set("t", resolved);
      window.history.replaceState(null, "", u);
    }
  }, []);
  const goTab = useCallback((t: Tab) => {
    setTab(t);
    if (t === "chat") setChatGw(null); // the tab bar always opens the live thread
    if (t === "games") {
      // Opening Games clears its own badge — the viewer's seen what was
      // waiting on them. Not a re-fetch: the count just goes quiet until the
      // next league load picks up anything genuinely new.
      setGamesPulse((p) => (p ? { ...p, myActionCount: 0 } : p));
      setCompId(null); // the tab bar always opens the overview, not a specific competition
    }
    const u = new URL(window.location.href);
    u.searchParams.set("t", t);
    if (t === "chat") u.searchParams.delete("gw");
    if (t === "games") u.searchParams.delete("c");
    window.history.replaceState(null, "", u);
  }, []);
  // From History: open a past gameweek's chat archive.
  const openGwChat = useCallback((gw: number) => {
    setChatGw(gw); setTab("chat");
    const u = new URL(window.location.href);
    u.searchParams.set("t", "chat"); u.searchParams.set("gw", String(gw));
    window.history.replaceState(null, "", u);
  }, []);
  // From the Hub's Games module "Challenge someone" (Phase 4B): switch to
  // Games AND tell it to open the picker itself on mount.
  const openGamesChallenge = useCallback(() => {
    setGamesAutoChallenge(true);
    setGamesKey((k) => k + 1); // fresh mount so the picker opens even if Games was already visited
    goTab("games");
  }, [goTab]);
  // A competition card's tap through (chat card or Hub module) — switch to
  // Games AND tell it which competition to open its detail sheet for, via
  // the same `c` URL param a direct link or reload would use.
  const openGamesCompetition = useCallback((competitionId: string) => {
    setCompId(competitionId); setGamesKey((k) => k + 1); setTab("games");
    const u = new URL(window.location.href);
    u.searchParams.set("t", "games"); u.searchParams.set("c", competitionId);
    window.history.replaceState(null, "", u);
  }, []);

  // Mark a tab visited the moment it becomes active, so the keep-mounted render
  // below mounts it once and then just shows/hides it.
  useEffect(() => { setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab))); }, [tab]);

  // Switch leagues IN PLACE — no router.push, so the page + bubble strip stay
  // mounted (the strip re-highlights instantly). We DON'T clear `detail`; the
  // load effect (keyed on `code`) fetches the new league while the derived
  // `switching` flag below shows a light loader in the content area only, so the
  // old league never lingers and nothing flashes. The URL is updated with
  // history.replaceState (invisible to the Next router → no navigation).
  const switchLeague = useCallback((next: string) => {
    const nc = String(next).toUpperCase();
    if (!nc || nc === code) return;
    setCode(nc);
    setTab("hub"); setVisited(new Set<Tab>(["hub"]));
    setChatGw(null); setCompId(null); setGamesKey((k) => k + 1);
    setGamesPulse(null); setErr(null); setNotFound(false);
    const u = new URL(window.location.href);
    u.pathname = `/fantasy/leagues/${nc}`;
    u.searchParams.delete("t"); u.searchParams.delete("gw"); u.searchParams.delete("c");
    window.history.replaceState(null, "", u);
    window.scrollTo({ top: 0 });
  }, [code]);

  const load = useCallback(async () => {
    try { setDetail(await apiRaw<LeagueDetail>(`leagues/${code}`)); }
    catch (e) {
      if ((e as { status?: number }).status === 404) setNotFound(true);
      else setErr((e as Error).message);
    }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  // Games tab badge — piggybacked on league load, member-only (the games
  // route itself 403s otherwise), fetched once (not polled: this is a small
  // nudge, not a live counter, and the Games tab's own view refetches for
  // real when it's actually open).
  useEffect(() => {
    if (!detail?.league.isMember) return;
    let live = true;
    fetch(`/api/fantasy/leagues/${code}/games/pulse`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setGamesPulse(d); })
      .catch(() => {});
    return () => { live = false; };
  }, [code, detail?.league.isMember]);

  const loadChat = useCallback(async () => {
    try { setChat(await apiRaw<ChatData>(`leagues/${code}/chat`)); }
    catch { /* non-member / signed out — no chat */ }
  }, [code]);
  // Club/Founder leagues and any PUBLIC league are open to read, so browse
  // their chat even signed out (founder, 7 Aug — leagues read as communities).
  // A genuinely private league still needs membership — leagueChat enforces
  // the real gate; this just mirrors it so the client doesn't fetch a 403.
  const canReadChat = !!detail && (detail.league.isMember || detail.league.kind === "club" || detail.league.kind === "founder" || detail.league.isPublic);
  useEffect(() => {
    if (!canReadChat) return;
    loadChat();
    const t = setInterval(loadChat, 15_000);
    return () => clearInterval(t);
  }, [canReadChat, loadChat]);

  // The invite is a LINK, not a code: ?join=1 drops the recipient straight into
  // the league on tap (a new user signs in and lands right back here). No code
  // to type, no extra step — the whole point of "invite a friend".
  const inviteUrl = () => `${window.location.origin}/fantasy/leagues/${code}?join=1`;
  const inviteText = () => `Join my YourScore Fantasy league "${detail?.league.name ?? ""}"`;
  const inviteMsg = () => `${inviteText()} ${inviteUrl()}`;
  const shareNative = () => { trackFantasyInvite("native"); if (navigator.share) navigator.share({ title: "YourScore Fantasy league", text: inviteText(), url: inviteUrl() }).catch(() => {}); setInviteOpen(false); };
  const shareWhatsApp = () => { trackFantasyInvite("whatsapp"); window.open(`https://wa.me/?text=${encodeURIComponent(inviteMsg())}`, "_blank", "noopener,noreferrer"); setInviteOpen(false); };
  const shareSms = () => { trackFantasyInvite("sms"); window.location.href = `sms:?&body=${encodeURIComponent(inviteMsg())}`; };
  const copyLink = async () => { trackFantasyInvite("copy"); try { await navigator.clipboard.writeText(inviteUrl()); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ } };
  const join = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await apiRaw("leagues/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) }); await load(); }
    catch (e) {
      // Preserve the full URL (incl. ?join=1) so an invited guest lands back here
      // and the auto-join completes after they sign in.
      if ((e as { status?: number }).status === 401) router.push(`/auth/sign-in?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      else setErr((e as Error).message);
    }
    setBusy(false);
  };

  // Auto-join from an invite link: once the league loads and you're not in it yet,
  // ?join=1 joins you straight away, then cleans the flag off the URL.
  const [autoJoined, setAutoJoined] = useState(false);
  useEffect(() => {
    if (autoJoined || busy || !detail || detail.league.isMember) return;
    if (new URLSearchParams(window.location.search).get("join") !== "1") return;
    setAutoJoined(true);
    void join().then(() => {
      const u = new URL(window.location.href); u.searchParams.delete("join");
      window.history.replaceState(null, "", u);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, autoJoined, busy]);

  if (notFound) return (
    <>
    <main data-fantasy style={page}>
      <Header />
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>League not found</div>
        <Btn onClick={() => router.push("/fantasy/leagues")}>← Back to leagues</Btn>
      </Card>
    </main>
      <BottomNav />
    </>
  );
  if (!detail) return (
    <main data-fantasy style={page}>
      <Header />
      <Loading label="Loading the league">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skel w="55%" h={22} /><Skel w="70%" h={12} style={{ marginBottom: 6 }} />
          <Skel h={120} r={14} /><Skel h={54} r={10} /><Skel h={54} r={10} />
        </div>
      </Loading>
    </main>
  );

  const { league } = detail;
  // True in the ~half-second after tapping another bubble, while the new
  // league's data loads (detail still holds the OLD one). Drives a light content
  // loader so the old league never shows under the new highlight.
  const switching = detail.league.code.toUpperCase() !== code;

  return (
    <>
    <main data-fantasy style={page}>
      {/* "Leagues" now means the browse/Discover list (?browse=1) — landing on
          /fantasy/leagues drops you back into a league, so link the list directly. */}
      <Header exit={{ label: "Leagues", onClick: () => router.push("/fantasy/leagues?browse=1") }} />

      {/* Bubble switcher — hop between your football groups without leaving.
          onSwitch swaps the league in place (no navigation, no remount). */}
      <LeagueBubbleSwitcher currentCode={code} onSwitch={switchLeague} current={{ name: league.name, imageUrl: league.imageUrl }} />

      {switching ? (
        <Loading label="Loading the league">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skel w="55%" h={22} /><Skel w="70%" h={12} style={{ marginBottom: 6 }} />
            <Skel h={120} r={14} /><Skel h={54} r={10} /><Skel h={54} r={10} />
          </div>
        </Loading>
      ) : (<>
      {/* Compact header (founder 8 Aug): badge, name + members, invite + settings.
          Bio/chips are kept but slimmed to one line so the header stops eating
          vertical space — no oversized crest, no two-line clamp. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: league.bio || hasLinks(league.links) ? 6 : 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          {league.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={league.imageUrl} alt="" width={46} height={46} style={{ width: 46, height: 46, borderRadius: 12, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />
          ) : (
            <span style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 12, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></svg>
            </span>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{league.name}</h1>
              {league.official && <VerifiedTick size={16} />}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {league.kind === "club" ? `${league.club ?? "Club"} fans` : league.kind === "founder" ? "Founder League" : league.isPublic ? "Public league" : "Private league"} · {league.memberCount} member{league.memberCount === 1 ? "" : "s"}
              {league.stakes && <span style={{ color: "#ffc233", fontWeight: 600 }}> · 🏆 {league.stakes}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {league.isMember && <Btn small onClick={() => setInviteOpen(true)}>Invite</Btn>}
          {league.isMember && (
            <button aria-label="League settings" onClick={() => router.push(`/fantasy/leagues/${code}/settings`)} style={{
              width: 34, height: 34, borderRadius: 10, cursor: "pointer", fontSize: 16,
              background: PANEL, border: `1px solid ${LINE}`, color: MUTED,
            }}>⚙</button>
          )}
        </div>
      </div>

      {/* Bio + socials — one slim line under the header, only when set. */}
      {(league.bio || hasLinks(league.links)) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, minWidth: 0 }}>
          {league.bio && (
            <p style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#c7d0cb", lineHeight: 1.4, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{league.bio}</p>
          )}
          {hasLinks(league.links) && <div style={{ flexShrink: 0 }}><SocialChips links={league.links} size={22} /></div>}
        </div>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "8px 0 10px" }}>{err}</p>}

      {!league.isMember && (league.kind === "club" || league.kind === "founder") ? (
        <Card style={{ margin: "10px 0 14px", border: `1px solid ${LINE}` }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>You&apos;re just looking in</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.45 }}>
            {league.kind === "club"
              ? `This is the ${league.club ?? "club"} fans' league. Have a read of the table and the chat. Only ${league.club ?? "its"} fans can post here.`
              : "This is the Founder League for the first 1,000 managers to build a squad. Build your squad and you're in."}
          </p>
        </Card>
      ) : !league.isMember && (
        <Card style={{ margin: "10px 0 14px", border: `1px solid #ffc233` }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>Fancy your chances?</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 10px", lineHeight: 1.45 }}>
            Join in and your gameweek points go straight on the table.
          </p>
          <Btn gold disabled={busy} onClick={join}>{busy ? "…" : "JOIN THIS LEAGUE"}</Btn>
        </Card>
      )}

      {/* Internal tabs — slim, one thumb-height row. Five tabs now (Games,
          Phase 4A) — font/padding trimmed slightly from the four-tab sizing
          so "History" still fits at 375px without wrapping or truncating
          (house rule: no scrolling tab bar, no icon-only tabs). */}
      <div style={{ display: "flex", gap: 3, margin: "10px 0 12px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 3 }}>
        {TABS.map(([k, label]) => {
          const active = tab === k;
          // Chat opens to anyone for a club/Founder league or any PUBLIC league
          // (browse what they talk about, signed out included); History and
          // Games still need membership.
          const chatOpen = league.isMember || league.kind === "club" || league.kind === "founder" || league.isPublic;
          const locked = (k === "chat" && !chatOpen) || ((k === "history" || k === "games") && !league.isMember);
          if (locked) return null;
          // Games tab badge (Phase 4A follow-through) — a small gold dot with
          // the viewer's own action-required count, never league-wide open
          // activity (see gamesPulse's own doc above). No badge at zero.
          const gamesBadge = k === "games" && gamesPulse && gamesPulse.myActionCount > 0 ? gamesPulse.myActionCount : null;
          return (
            <button key={k} onClick={() => goTab(k)} style={{
              flex: 1, padding: "5px 2px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              background: active ? tint(TEAL, "22") : "transparent", color: active ? TEAL : MUTED,
              border: `1px solid ${active ? tint(TEAL, "55") : "transparent"}`,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}>
              {label}
              {gamesBadge !== null && (
                <span aria-label={`${gamesBadge} action${gamesBadge === 1 ? "" : "s"} needed`} style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 15, height: 15, borderRadius: 999, padding: "0 4px",
                  background: GOLD, color: "#2A1F00", fontSize: 9.5, fontWeight: 800, lineHeight: 1,
                }}>{gamesBadge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Keep-mounted tabs — each mounts once (when first visited) and is then
          shown/hidden, so switching is instant with no reload flash. Chat and
          Games remount only on a deep-link (a gameweek archive / a specific
          competition or the challenge picker) via their keys. */}
      <div style={{ display: tab === "hub" ? "block" : "none" }}>
        {visited.has("hub") && <LeagueHub detail={detail} chat={chat} onTab={goTab} onOpenGamesChallenge={openGamesChallenge} />}
      </div>
      <div style={{ display: tab === "chat" ? "block" : "none" }}>
        {visited.has("chat") && (league.isMember || league.kind === "club" || league.kind === "founder" || league.isPublic) && (
          <LeagueChatView key={chatGw ?? "live"} code={code} initialGw={chatGw} onOpenCompetition={openGamesCompetition} />
        )}
      </div>
      <div style={{ display: tab === "table" ? "block" : "none" }}>
        {visited.has("table") && <LeagueTableView detail={detail} code={code} />}
      </div>
      <div style={{ display: tab === "games" ? "block" : "none" }}>
        {visited.has("games") && league.isMember && (
          <LeagueGamesView
            key={gamesKey}
            code={code} isOwner={league.isOwner}
            autoOpenChallenge={gamesAutoChallenge} onAutoOpenChallengeHandled={() => setGamesAutoChallenge(false)}
            initialCompetitionId={compId} onCompetitionIdChange={(id) => {
              setCompId(id);
              const u = new URL(window.location.href);
              if (id) u.searchParams.set("c", id); else u.searchParams.delete("c");
              window.history.replaceState(null, "", u);
            }}
          />
        )}
      </div>
      {tab === "history" && league.isMember && <LeagueHistoryView code={code} onOpenChat={openGwChat} />}
      </>)}

      {inviteOpen && (
        <Sheet onClose={() => setInviteOpen(false)} labelledBy="invite-title">
          <div id="invite-title" className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.1 }}>Invite friends</div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: "4px 0 14px", lineHeight: 1.45 }}>Send the link. One tap and they land straight in the league. No code to type.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {typeof navigator !== "undefined" && !!navigator.share && (
              <InviteRow onClick={shareNative} accent={TEAL} label="Share…" sub="Your phone's share sheet"
                icon={<><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4" /></>} />
            )}
            <InviteRow onClick={shareWhatsApp} accent="#25D366" label="WhatsApp" sub="Send to a chat or group"
              icon={<path d="M12 3a9 9 0 00-7.7 13.6L3 21l4.5-1.3A9 9 0 1012 3z" />} />
            <InviteRow onClick={shareSms} accent="#3aa0ff" label="Messages" sub="Text the link"
              icon={<path d="M21 11.5a8.5 8.5 0 01-12.5 7.5L3 21l2-5.5A8.5 8.5 0 1121 11.5z" />} />
            <InviteRow onClick={copyLink} accent={GOLD} label={copied ? "Link copied" : "Copy link"} sub={inviteUrl()}
              icon={<><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></>} />
          </div>
          <p style={{ fontSize: 11, color: MUTED, textAlign: "center", marginTop: 12 }}>Prefer to type it? Code <b style={{ color: "#c7d0cb", letterSpacing: "0.06em" }}>{code}</b></p>
        </Sheet>
      )}
    </main>
      <BottomNav />
    </>
  );
}
