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
  Btn, Card, Chip, GOLD, INK, LINE, LIME, MUTED, page, PANEL, PANEL_2, TEAL, tint,
} from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { LeagueCompetition } from "@/components/fantasy/LeagueCompetition";
import { CreateLeagueFlow, JoinLeagueFlow, LeagueEmptyState } from "@/components/fantasy/league/LeagueFlows";
import { DiscoverLeagues } from "@/components/fantasy/DiscoverLeagues";
import { BottomNav } from "@/components/ui/BottomNav";
import { VerifiedTick } from "@/components/ui/Seal";

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
}
interface PublicLeague { id: string; name: string; code: string; memberCount: number; imageUrl?: string | null; official?: boolean }
type Tab = "competition" | "leagues";

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
  const [publicList, setPublicList] = useState<PublicLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // Restore the subtab from the URL on mount, and keep it there so back from a
  // profile or a league returns to the same subtab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "leagues") setTab("leagues");
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
      setPublicList(r.public);
      setLoaded(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
  const crest = (imageUrl?: string | null) => (
    imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" width={44} height={44} style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover", flexShrink: 0, border: `1px solid ${LINE}` }} />
    ) : (
      <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /></svg>
      </span>
    )
  );

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
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              {l.official && <VerifiedTick size={14} />}
              {l.unread > 0 && (
                <span aria-label={`${l.unread} unread`} style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: "#04231f", background: TEAL, borderRadius: 999, padding: "1px 7px", minWidth: 18, textAlign: "center" }}>{l.unread > 99 ? "99+" : l.unread}</span>
              )}
              {l.kind === "club" && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", color: TEAL, background: tint(TEAL, "1c"), border: `1px solid ${tint(TEAL, "44")}`, borderRadius: 999, padding: "1px 7px" }}>YOUR CLUB</span>}
              {l.kind === "founder" && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", color: GOLD, background: tint(GOLD, "1c"), border: `1px solid ${tint(GOLD, "44")}`, borderRadius: 999, padding: "1px 7px" }}>FOUNDER</span>}
              {l.isPublic && <Chip>Public</Chip>}
            </span>
            <span style={{ fontSize: 12, color: MUTED }}>
              {l.memberCount} member{l.memberCount === 1 ? "" : "s"}{h.msgCount > 0 ? ` · ${h.msgCount} message${h.msgCount === 1 ? "" : "s"}` : ""}
            </span>
          </span>
          {inviteControl(l)}
          <span style={{ color: TEAL, fontSize: 18, flexShrink: 0 }}>›</span>
        </div>
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

  // A compact discovery tile for public leagues (no chat highlight — not a member).
  const leagueTile = (l: { id: string; name: string; code: string; memberCount: number; isPublic?: boolean; imageUrl?: string | null; official?: boolean }, hint: string) => (
    <button key={l.id} onClick={() => router.push(`/fantasy/leagues/${l.code}`)} style={{
      width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
      background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12,
    }}>
      {crest(l.imageUrl)}
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
          {l.official && <VerifiedTick size={14} />}
          {l.isPublic && <Chip>Public</Chip>}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>{l.memberCount} member{l.memberCount === 1 ? "" : "s"} · <span style={{ color: TEAL, fontWeight: 700 }}>{hint}</span></span>
      </span>
      <span style={{ color: TEAL, fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  );

  const myLeagues = (
    <>
      {needsAuth ? (
        <>
          {/* Guests browse every league (founder, 4 Aug) — creating your own or
              joining one is the part that needs an account. */}
          <Card style={{ marginTop: 2, marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Have a look around</div>
            <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              Browse every league below. Sign in when you want to start your own or join one.
            </p>
            <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/leagues")}>Sign in to create or join</Btn>
          </Card>
          <DiscoverLeagues />
        </>
      ) : (
        <>
          {!loaded ? (
            <p style={{ fontSize: 13, color: MUTED }}>Loading your leagues…</p>
          ) : leagues.length === 0 ? (
            <LeagueEmptyState onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} />
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

              {/* Public leagues stay secondary — never dominate the friend leagues. */}
              {publicList.length > 0 && (
                <div>
                  <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>PUBLIC LEAGUES</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {publicList.map((l) => leagueTile(l, "Public league"))}
                  </div>
                </div>
              )}
            </>
          )}
          {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "12px 0 0" }}>{err}</p>}
        </>
      )}
    </>
  );

  return (
    <>
    <main data-fantasy style={page}>
      <FantasyHeader />

      {/* Subtabs — the YourScore-wide competition first, your own leagues second. */}
      <div style={{ display: "flex", gap: 6, margin: "4px 0 14px" }}>
        {([["leagues", "My Leagues"], ["competition", "Competition"]] as [Tab, string][]).map(([k, label]) => {
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

      {tab === "competition" ? <LeagueCompetition /> : myLeagues}
    </main>
      <CreateLeagueFlow open={createOpen} onClose={() => setCreateOpen(false)} />
      <JoinLeagueFlow open={joinOpen} onClose={() => setJoinOpen(false)} />
      <BottomNav />
    </>
  );
}
