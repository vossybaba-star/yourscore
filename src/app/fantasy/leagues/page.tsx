"use client";
/** Leagues list page — Discover + Competition.
 *
 * The list-style "My Leagues" tab is GONE (founder 8 Aug): the bubble strip on a
 * league page IS your league navigation now, and tapping the bottom-nav Leagues
 * tab drops you straight into your primary league (the [code] page redirects).
 * This page is only reached deliberately:
 *   - ?browse=1        → the + bubble's "Browse" → Discover (find more leagues)
 *   - ?view=competition → the Competition bubble → the YourScore-wide tables +
 *                          club-fan board
 *   - no leagues yet    → land here on Discover, with create/join affordances
 *
 * The api() helper (shared.tsx) only does GET-or-POST on a fixed path, so the
 * my-leagues+public GET goes through a small local raw fetch. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Card, INK, LINE, MUTED, page, PANEL, TEAL, tint } from "@/components/fantasy/shared";
import { LeagueCompetition } from "@/components/fantasy/LeagueCompetition";
import { ClubTableTile } from "@/components/clubs/ClubTableTile";
import { CreateLeagueFlow, JoinLeagueFlow } from "@/components/fantasy/league/LeagueFlows";
import { DiscoverLeagues } from "@/components/fantasy/DiscoverLeagues";
import { BottomNav } from "@/components/ui/BottomNav";

/** A league's social links (migration 263) — kept only to type the API payload
 *  below; rendering of chips lives on the [code] detail page. */
interface LeagueLinks {
  discord?: string; x?: string; instagram?: string; tiktok?: string; website?: string;
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

// Two destinations only: Discover (find more) + Competition (the YourScore-wide
// tables + club-fan board, reached from the Competition bubble via ?view=competition).
type Tab = "discover" | "competition";
const TAB_KEYS: Tab[] = ["discover", "competition"];

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, code: json.code });
  return json as T;
}

export default function LeaguesHome() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("discover");
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // Restore the subtab from the URL; the Competition bubble deep-links here with
  // ?view=competition.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("view") === "competition") { setTab("competition"); return; }
    const t = sp.get("tab");
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

  // Land STRAIGHT in your league, not on a picker (founder 8 Aug). Tapping the
  // Leagues tab drops you into your primary league; the bubble switcher hops
  // between the rest. ?browse=1 / ?view=competition mean "show THIS page instead".
  const [browse, setBrowse] = useState<boolean | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setBrowse(sp.get("browse") === "1" || sp.get("view") === "competition");
  }, []);
  useEffect(() => {
    if (browse === null || browse || !loaded || leagues.length === 0) return;
    setRedirecting(true);
    router.replace(`/fantasy/leagues/${leagues[0].code}`);
  }, [browse, loaded, leagues, router]);
  // Show the list only when explicitly browsing/competition, or when you have no
  // league to land in. Otherwise we're deciding/redirecting → a quiet loader.
  const showList = needsAuth || browse === true || (loaded && leagues.length === 0);

  // Create / join (signed in) or a sign-in prompt (guest) — the affordances a
  // person with no league needs, now that they land on Discover.
  const discoverActions = needsAuth ? (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Have a look around</div>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
        Sign in to create your own league or join one with a friend.
      </p>
      <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/leagues")}>Sign in to create or join</Btn>
    </Card>
  ) : (
    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <div style={{ flex: 1 }}><Btn gold onClick={() => setCreateOpen(true)}>Create league</Btn></div>
      <div style={{ flex: 1 }}><Btn onClick={() => setJoinOpen(true)}>Join with code</Btn></div>
    </div>
  );

  const discoverView = (
    <>
      {discoverActions}
      <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>FOR YOU</div>
      <DiscoverLeagues />
      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "12px 0 0" }}>{err}</p>}
    </>
  );

  // Deciding or redirecting into a league → a quiet loader with NO heading
  // (founder 8 Aug: the old "LEAGUES" title flashed at the top before the
  // redirect landed, reading like a stale page). Landing on the Leagues tab
  // should slide straight into your league; this in-between never shows chrome.
  if ((!showList && !redirecting) || redirecting) {
    return (
      <main data-fantasy style={page}>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 24, textAlign: "center", opacity: 0.7 }}>Opening your league…</p>
      </main>
    );
  }

  return (
    <>
    <main data-fantasy style={page}>
      <div style={{ marginBottom: 14 }}>
        <h1 className="font-display" style={{ fontSize: 27, color: INK, lineHeight: 1, margin: 0 }}>LEAGUES</h1>
        <p className="font-body" style={{ fontSize: 13, color: MUTED, margin: "6px 0 0" }}>
          Find a league to join, or see the YourScore-wide competition.
        </p>
      </div>

      {/* Discover (find more) | Competition (the global tables + club-fan board). */}
      <div style={{ display: "flex", gap: 6, margin: "4px 0 14px" }}>
        {([["discover", "Discover"], ["competition", "Competition"]] as [Tab, string][]).map(([k, label]) => {
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

      {tab === "competition" ? (
        <>
          <LeagueCompetition />
          {/* Club-fan leaderboard (founder 8 Aug: Leagues is the social home for
              every game). Global YourScore board; self-hides until GW scores. */}
          <ClubTableTile />
        </>
      ) : discoverView}
    </main>
      <CreateLeagueFlow open={createOpen} onClose={() => setCreateOpen(false)} />
      <JoinLeagueFlow open={joinOpen} onClose={() => setJoinOpen(false)} />
      <BottomNav />
    </>
  );
}
