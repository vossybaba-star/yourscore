"use client";
/** League Settings — everything administrative, moved off the Hub: name, code +
 *  invite, stakes, visibility, the member list, and the danger zone. Only the
 *  controls that are actually wired are shown (no dead toggles). */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Btn, Card, Chip, GOLD, Header, INK, LINE, Loading, MUTED, page, PANEL, Skel, TEAL, tint,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { BottomNav } from "@/components/ui/BottomNav";
import type { LeagueDetail } from "@/components/fantasy/league/types";
import { nameOf } from "@/components/fantasy/league/types";

async function apiRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/fantasy/${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status });
  return json as T;
}
const json = (body: unknown, method = "PATCH") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 10.5, letterSpacing: "0.12em", color: MUTED, margin: "0 0 8px" }}>{title}</div>
    {children}
  </div>
);
const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${LINE}` }}>
    <span style={{ fontSize: 13, color: MUTED }}>{k}</span>
    <span style={{ fontSize: 13.5, color: INK, fontWeight: 600 }}>{v}</span>
  </div>
);

export default function LeagueSettingsPage() {
  const router = useRouter();
  const code = String(useParams().code ?? "").toUpperCase();
  const back = () => router.push(`/fantasy/leagues/${code}`);

  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [stakes, setStakes] = useState<string | null>(null); // null = not editing
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try { setDetail(await apiRaw<LeagueDetail>(`leagues/${code}`)); }
    catch (e) { setErr((e as Error).message); }
  }, [code]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: unknown) => {
    setBusy(true); setErr(null);
    try { await apiRaw(`leagues/${code}`, json(body)); await load(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const saveStakes = async () => {
    if (stakes === null) return;
    setBusy(true); setErr(null);
    try { await apiRaw(`leagues/${code}/chat`, json({ stakes })); setStakes(null); await load(); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const invite = async () => {
    const url = `${window.location.origin}/fantasy/leagues/${code}`;
    const text = `Join my YourScore Fantasy league "${detail?.league.name ?? ""}" · code ${code}`;
    if (navigator.share) { navigator.share({ title: "YourScore Fantasy league", text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ }
  };
  const leaveOrDelete = async () => {
    if (!detail) return;
    setBusy(true); setErr(null);
    try {
      await apiRaw(`leagues/${code}?mode=${detail.league.isOwner ? "delete" : "leave"}`, { method: "DELETE" });
      router.push("/fantasy/leagues");
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  if (!detail) return (
    <main data-fantasy style={page}>
      <Header right={<Btn small onClick={back}>← League</Btn>} />
      <Loading label="Loading settings"><Skel h={40} r={10} /><Skel h={160} r={10} style={{ marginTop: 8 }} /></Loading>
    </main>
  );

  const { league, season } = detail;
  const isOwner = league.isOwner;

  return (
    <>
    <main data-fantasy style={page}>
      <Header right={<Btn small onClick={back}>← League</Btn>} />
      <h1 style={{ fontSize: 22, margin: "2px 0 2px", fontWeight: 700 }}>Settings</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: "0 0 16px" }}>{league.name}</p>

      {err && <p style={{ color: "#E08A6B", fontSize: 13, margin: "0 0 12px" }}>{err}</p>}

      <Section title="LEAGUE DETAILS">
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, paddingBottom: 9 }}>
            {renaming ? (
              <div style={{ flex: 1 }}>
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} maxLength={40} autoFocus
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, fontSize: 15, fontWeight: 700, background: PANEL, color: INK, border: `1px solid ${GOLD}`, outline: "none" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <Btn small gold disabled={busy || !name.trim()} onClick={async () => { await patch({ name: name.trim() }); setRenaming(false); }}>Save</Btn>
                  <Btn small onClick={() => setRenaming(false)}>Cancel</Btn>
                </div>
              </div>
            ) : (
              <>
                <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{league.name}</span>
                {isOwner && <Btn small onClick={() => { setName(league.name); setRenaming(true); }}>Rename</Btn>}
              </>
            )}
          </div>
          <Line k="League code" v={<Chip gold>{code}</Chip>} />
          <Line k="Members" v={`${league.memberCount}`} />
          <div style={{ paddingTop: 9, borderTop: `1px solid ${LINE}` }}>
            <Btn onClick={invite}>{copied ? "Link copied" : "Invite friends"}</Btn>
          </div>
        </Card>
      </Section>

      <Section title="STAKES">
        <Card>
          {stakes === null ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13.5, color: league.stakes ? GOLD : MUTED }}>
                {league.stakes ? `🏆 ${league.stakes}` : "No stakes set. What does the loser owe?"}
              </span>
              {isOwner && <Btn small onClick={() => setStakes(league.stakes ?? "")}>{league.stakes ? "Edit" : "Set"}</Btn>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={stakes} maxLength={120} placeholder="e.g. loser buys the kebabs" autoFocus
                onChange={(e) => setStakes(e.target.value)}
                style={{ flex: 1, fontSize: 13.5, padding: "9px 11px", borderRadius: 9, background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none" }} />
              <Btn small gold disabled={busy} onClick={saveStakes}>Save</Btn>
            </div>
          )}
        </Card>
      </Section>

      {isOwner && (
        <Section title="VISIBILITY">
          <div style={{ display: "flex", gap: 6 }}>
            {(["Private", "Public"] as const).map((label, i) => {
              const wantsPublic = i === 1;
              const active = wantsPublic === league.isPublic;
              return (
                <button key={label} disabled={busy} onClick={() => patch({ isPublic: wantsPublic })} style={{
                  flex: 1, padding: "9px 4px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  background: active ? tint(TEAL, "22") : PANEL, color: active ? TEAL : INK,
                  border: `1px solid ${active ? tint(TEAL, "66") : LINE}`,
                }}>{label}</button>
              );
            })}
          </div>
          <p style={{ fontSize: 11.5, color: MUTED, margin: "8px 0 0", lineHeight: 1.4 }}>
            {league.isPublic ? "Public: anyone can find and join." : "Private: only people with the code can join."}
          </p>
        </Section>
      )}

      <Section title="MEMBERS">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {season.map((m) => (
            <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}` }}>
              <PlayerAvatar seed={m.userId} name={nameOf(m)} avatarUrl={m.avatarUrl} size={28} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {nameOf(m)}{m.isMe ? " (you)" : ""}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="DANGER ZONE">
        {confirm ? (
          <Card style={{ border: "1px solid #B85C38" }}>
            <p style={{ fontSize: 13, color: "#E08A6B", margin: "0 0 10px" }}>
              {isOwner ? "Delete this league for everyone? This can't be undone." : "Leave this league?"}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn small disabled={busy} onClick={leaveOrDelete}>{isOwner ? "Delete league" : "Leave"}</Btn>
              <Btn small onClick={() => setConfirm(false)}>Cancel</Btn>
            </div>
          </Card>
        ) : (
          <button onClick={() => setConfirm(true)} style={{ background: "none", border: "none", color: "#E08A6B", fontSize: 13, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
            {isOwner ? "Delete league" : "Leave league"}
          </button>
        )}
      </Section>
    </main>
      <BottomNav />
    </>
  );
}
