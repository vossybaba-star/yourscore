"use client";
/** Leagues home — create, join by code, your leagues, and public leagues to
 *  discover. The api() helper (shared.tsx) only ever does GET-or-POST on a
 *  fixed path, so the my-leagues+public GET (which shares a path with the
 *  create POST) goes through a small local raw fetch instead. */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, Chip, GOLD, Header, INK, LINE, MUTED, page, PANEL,
} from "@/components/fantasy/shared";

interface MyLeague {
  id: string; name: string; code: string; memberCount: number; isPublic: boolean; isOwner: boolean;
}
interface PublicLeague { id: string; name: string; code: string; memberCount: number }

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

const rowStyle: CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
  padding: "11px 12px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`,
  color: INK, cursor: "pointer", textAlign: "left",
};

export default function LeaguesHome() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<MyLeague[]>([]);
  const [publicList, setPublicList] = useState<PublicLeague[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState("");

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

  if (needsAuth) return (
    <main style={page}>
      <Header />
      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Sign in to play with friends</div>
        <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
          Leagues are saved to your YourScore account, so you&apos;ll need to be signed in.
        </p>
        <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/leagues")}>Sign in</Btn>
      </Card>
    </main>
  );

  return (
    <main style={page}>
      <Header right={<Btn small onClick={() => router.push("/fantasy")}>← My team</Btn>} />
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 700 }}>Leagues</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
        Create a league, share the code, see who really knows football.
      </p>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", color: GOLD, marginBottom: 8 }}>
          CREATE A LEAGUE
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="League name"
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {(["Private", "Public"] as const).map((label, i) => {
            const wantsPublic = i === 1;
            const active = wantsPublic === isPublic;
            return (
              <button key={label} onClick={() => setIsPublic(wantsPublic)} style={{
                flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                cursor: "pointer", background: active ? GOLD : PANEL, color: active ? "#2A1F00" : INK,
                border: `1px solid ${active ? GOLD : LINE}`,
              }}>{label}</button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: MUTED, margin: "0 0 10px", lineHeight: 1.4 }}>
          {isPublic
            ? "Public — anyone can find and join this league."
            : "Private — only people with your code can join."}
        </p>
        <Btn gold disabled={!name.trim() || busy} onClick={create}>
          {busy ? "…" : "Create league"}
        </Btn>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.1em", color: GOLD, marginBottom: 8 }}>
          JOIN WITH CODE
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
            placeholder="CODE"
            style={{ ...inputStyle, flex: 1, letterSpacing: "0.1em" }}
          />
          <Btn small gold disabled={!code.trim() || busy} onClick={join}>Join</Btn>
        </div>
      </Card>

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 12px" }}>{err}</p>}

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>YOUR LEAGUES</div>
        {loaded && leagues.length === 0 && (
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
            No leagues yet — create one and send your friends the code.
          </p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {leagues.map((l) => (
            <button key={l.id} onClick={() => router.push(`/fantasy/leagues/${l.code}`)} style={rowStyle}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{l.name}</span>
                  {l.isPublic && <Chip>Public</Chip>}
                </span>
                <span style={{ fontSize: 11.5, color: MUTED }}>
                  {l.memberCount} member{l.memberCount === 1 ? "" : "s"}
                </span>
              </span>
              <span style={{ color: MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>PUBLIC LEAGUES</div>
        {loaded && publicList.length === 0 && (
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No public leagues yet — be the first.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {publicList.map((l) => (
            <button key={l.id} onClick={() => router.push(`/fantasy/leagues/${l.code}`)} style={rowStyle}>
              <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{l.name}</span>
                <span style={{ fontSize: 11.5, color: MUTED }}>
                  {l.memberCount} member{l.memberCount === 1 ? "" : "s"}
                </span>
              </span>
              <span style={{ color: MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
