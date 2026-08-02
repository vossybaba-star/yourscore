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
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, GOLD, INK, LINE, LIME, MUTED, page, PANEL, PANEL_2, TEAL, tint,
} from "@/components/fantasy/shared";
import { FantasyHeader } from "@/components/fantasy/FantasyHeader";
import { LeagueCompetition } from "@/components/fantasy/LeagueCompetition";
import { BottomNav } from "@/components/ui/BottomNav";

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
}
interface PublicLeague { id: string; name: string; code: string; memberCount: number; imageUrl?: string | null }
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

const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10,
  fontSize: 14, background: PANEL, color: INK, border: `1px solid ${LINE}`, outline: "none",
};

export default function LeaguesHome() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("leagues");
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [publicList, setPublicList] = useState<PublicLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState("");

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

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const created = await api<{ id: string; name: string; code: string; isPublic: boolean }>(
        "leagues", { name: name.trim(), isPublic });
      router.push(`/fantasy/leagues/${created.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const joined = await api<{ id: string; name: string; code: string }>(
        "leagues/join", { code: code.trim() });
      router.push(`/fantasy/leagues/${joined.code}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
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
              {l.isPublic && <Chip>Public</Chip>}
            </span>
            <span style={{ fontSize: 12, color: MUTED }}>
              {l.memberCount} member{l.memberCount === 1 ? "" : "s"}{h.msgCount > 0 ? ` · ${h.msgCount} message${h.msgCount === 1 ? "" : "s"}` : ""}
            </span>
          </span>
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
  const leagueTile = (l: { id: string; name: string; code: string; memberCount: number; isPublic?: boolean; imageUrl?: string | null }, hint: string) => (
    <button key={l.id} onClick={() => router.push(`/fantasy/leagues/${l.code}`)} style={{
      width: "100%", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
      background: `linear-gradient(150deg, ${tint(TEAL, "10")}, ${PANEL})`, border: `1px solid ${LINE}`, borderRadius: 14, padding: 12,
    }}>
      {crest(l.imageUrl)}
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
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
        <Card style={{ marginTop: 2 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Sign in to play with friends</div>
          <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
            Leagues are saved to your YourScore account, so you&apos;ll need to be signed in.
          </p>
          <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/leagues")}>Sign in</Btn>
        </Card>
      ) : (
        <>
          {leagues.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>YOUR LEAGUES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {leagues.map(myLeagueTile)}
              </div>
            </div>
          )}

          {/* CREATE — the marketing hero of this tab. */}
          <div style={{ borderRadius: 16, padding: 16, marginBottom: 12, background: `linear-gradient(150deg, ${tint(GOLD, "16")}, ${PANEL})`, border: `1px solid ${tint(GOLD, "3a")}` }}>
            <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: GOLD, marginBottom: 3 }}>CREATE A LEAGUE</div>
            <div className="font-display" style={{ fontSize: 19, color: INK, lineHeight: 1.1, marginBottom: 3 }}>Start a league with your friends</div>
            <p style={{ fontSize: 12, color: MUTED, margin: "0 0 12px", lineHeight: 1.4 }}>Invite your group, chat every gameweek, settle who really knows their football.</p>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="League name" style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {(["Private", "Public"] as const).map((label, i) => {
                const wantsPublic = i === 1;
                const active = wantsPublic === isPublic;
                return (
                  <button key={label} onClick={() => setIsPublic(wantsPublic)} style={{
                    flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                    cursor: "pointer", background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : MUTED,
                    border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
                  }}>{label}</button>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: MUTED, margin: "0 0 10px", lineHeight: 1.4 }}>
              {isPublic ? "Public: anyone can find and join this league." : "Private: only people with your code can join."}
            </p>
            <Btn gold disabled={!name.trim() || busy} onClick={create}>{busy ? "…" : "Create league"}</Btn>
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", color: GOLD, marginBottom: 8 }}>JOIN WITH CODE</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="CODE" style={{ ...inputStyle, flex: 1, letterSpacing: "0.1em" }} />
              <Btn small gold disabled={!code.trim() || busy} onClick={join}>Join</Btn>
            </div>
          </Card>

          {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 12px" }}>{err}</p>}

          <div>
            <div className="font-display tracking-widest" style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 8 }}>PUBLIC LEAGUES</div>
            {loaded && publicList.length === 0 && (
              <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No public leagues yet. Be the first.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {publicList.map((l) => leagueTile(l, "Public league"))}
            </div>
          </div>
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
      <BottomNav />
    </>
  );
}
