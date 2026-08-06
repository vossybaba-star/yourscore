"use client";
/**
 * Challenge prep sheet (Phase 1C) — opened from MemberActionSheet's Challenge
 * chip. Picks the (today, only) supported game, then a quiz the challenger has
 * already played — the same "your stored scorecard, not a live client score"
 * trust model /versus/challenge and /api/h2h/from-attempt already use — and
 * sends it via POST /api/fantasy/challenges (createChallenge).
 *
 * The quiz list is sourced exactly like /versus/challenge's own step 1: a
 * client-side query against quiz_attempts joined to quiz_packs for THIS
 * user (the challenger), newest first, deduped to one card per pack.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { coverUrl } from "@/lib/img";
import { GOLD, INK, LINE, MUTED, PANEL, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { supportedChallengeGames } from "@/lib/fantasy/challengeGames";
import { trackChallengeFlowOpened, trackChallengeGameSelected, trackChallengeSent, trackChallengeAbandoned } from "@/lib/analytics/trackSocial";

interface Scorecard { packId: string; name: string; score: number; correct: number; total: number; cover: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MESSAGE_MAX_LEN = 140;

export function ChallengePrepSheet({ leagueCode, opponent, createdFrom = "member_action", onSent, onClose }: {
  leagueCode: string;
  opponent: { userId: string; name: string; avatarUrl: string | null };
  /** Phase 3A — which surface opened this sheet (attribution only, see
   *  challenges.ts's normalizeCreatedFrom). Defaults to the one caller this
   *  sheet has today (MemberActionSheet's Challenge chip); a future caller
   *  from another surface passes its own value. */
  createdFrom?: string;
  /** Fired once the challenge is actually created — lets the caller flip its
   *  chip to "Pending" without waiting on a re-fetch. */
  onSent?: (created: { id: string; h2hId: string | null }) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const game = supportedChallengeGames()[0]; // today: exactly Quiz Battle

  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [cards, setCards] = useState<Scorecard[] | null>(null);
  const [picked, setPicked] = useState<Scorecard | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    trackChallengeFlowOpened();
    if (game) trackChallengeGameSelected(game.id); // implicit — there's only the one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/fantasy/leagues/${leagueCode}`)
      .then((res) => res.json())
      .then((j) => { if (live) setLeagueName(j?.league?.name ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [leagueCode]);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setCards([]); return; }
    const db = sb as Row;

    const { data: attempts } = await db
      .from("quiz_attempts")
      .select("pack_id, score, correct_count, completed_at")
      .eq("user_id", uid)
      .order("completed_at", { ascending: false })
      .limit(24);
    const rows = (attempts ?? []) as Row[];
    const packIds = Array.from(new Set(rows.map((r) => r.pack_id))).filter(Boolean);

    let packs: Record<string, Row> = {};
    if (packIds.length) {
      const { data: pk } = await db.from("quiz_packs").select("id, name, questions, metadata").in("id", packIds);
      packs = Object.fromEntries(((pk ?? []) as Row[]).map((p) => [p.id, p]));
    }
    const seen = new Set<string>();
    const list: Scorecard[] = [];
    for (const r of rows) {
      const p = packs[r.pack_id];
      if (!p || seen.has(r.pack_id)) continue;
      seen.add(r.pack_id);
      list.push({
        packId: r.pack_id, name: p.name ?? "Quiz", score: r.score ?? 0, correct: r.correct_count ?? 0,
        total: Array.isArray(p.questions) ? p.questions.length : 0, cover: p.metadata?.cover_image ?? null,
      });
    }
    setCards(list);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const closeSheet = () => {
    if (!sent) trackChallengeAbandoned();
    onClose();
  };

  const send = () => {
    if (!picked || !game || sending) return;
    setSending(true); setErr(null);
    const trimmedMessage = message.trim();
    fetch("/api/fantasy/challenges", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opponentId: opponent.userId, leagueCode, gameType: game.id, packId: picked.packId,
        message: trimmedMessage || undefined, createdFrom,
      }),
    })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j.error ?? "Could not send the challenge"); return; }
        trackChallengeSent(game.id);
        setSent(true);
        onSent?.({ id: j.id, h2hId: j.h2hId ?? null });
      })
      .catch(() => setErr("Could not send the challenge"))
      .finally(() => setSending(false));
  };

  // ── Sent ──
  if (sent) {
    return (
      <Sheet onClose={onClose} labelledBy="challenge-sent-title">
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 999, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center",
            background: tint(GOLD, "18"), border: `1px solid ${tint(GOLD, "50")}`,
          }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div id="challenge-sent-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 4 }}>Challenge sent</div>
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 18px" }}>{opponent.name} has a few days to beat your {picked?.score.toLocaleString()}.</p>
          <button onClick={() => { router.push(`/fantasy/leagues/${leagueCode}?t=chat`); onClose(); }} style={{
            width: "100%", padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer",
            background: tint(GOLD, "18"), color: GOLD, border: `1px solid ${tint(GOLD, "50")}`,
          }}>View in chat</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={closeSheet} labelledBy="challenge-title">
      <div id="challenge-title" className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 2 }}>Challenge {opponent.name}</div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px" }}>{leagueName ? `In ${leagueName}` : " "}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <PlayerAvatar seed={opponent.userId} name={opponent.name} avatarUrl={opponent.avatarUrl} size={38} />
        <div className="font-body" style={{ fontSize: 14, fontWeight: 700, color: INK }}>{opponent.name}</div>
      </div>

      {game && (
        <div style={{
          borderRadius: 12, padding: 12, marginBottom: 16,
          background: `linear-gradient(100deg, ${tint(GOLD, "12")}, ${PANEL} 60%)`,
          border: `1px solid ${tint(GOLD, "3a")}`, borderLeft: `3px solid ${GOLD}`,
        }}>
          <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: GOLD, marginBottom: 5 }}>{game.name.toUpperCase()}</div>
          <p style={{ fontSize: 12.5, color: INK, margin: "0 0 8px", lineHeight: 1.4 }}>{game.shortDesc}</p>
          <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: MUTED }}>
            <span>{game.typicalDuration}</span>
            <span>·</span>
            <span>Play anytime before it expires</span>
          </div>
        </div>
      )}

      <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>
        {picked ? "YOUR QUIZ" : "PICK A QUIZ YOU'VE PLAYED"}
      </div>

      {picked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: picked.cover ? `center/cover url(${coverUrl(picked.cover, 40)})` : tint(TEAL, "18") }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>Your score: {picked.score.toLocaleString()} · {picked.correct}/{picked.total}</div>
          </div>
          <button onClick={() => setPicked(null)} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Change</button>
        </div>
      ) : cards === null ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 16px" }}>Loading your scores…</p>
      ) : cards.length === 0 ? (
        <div style={{ textAlign: "center", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "20px 16px", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: INK, margin: "0 0 4px", fontWeight: 600 }}>Play a quiz first, then challenge your league</p>
          <a href="/play" style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: TEAL, textDecoration: "none" }}>Find a quiz →</a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16, maxHeight: 260, overflowY: "auto" }}>
          {cards.map((c) => (
            <button key={c.packId} onClick={() => setPicked(c)} style={{
              display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer",
              background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 9,
            }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, flexShrink: 0, background: c.cover ? `center/cover url(${coverUrl(c.cover, 38)})` : tint(TEAL, "18") }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: MUTED }}>Your score: {c.score.toLocaleString()} · {c.correct}/{c.total}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div style={{ marginBottom: 16 }}>
          <input
            value={message}
            maxLength={MESSAGE_MAX_LEN}
            placeholder="Add a message if you like"
            onChange={(e) => setMessage(e.target.value.replace(/[\r\n]+/g, " "))}
            style={{
              width: "100%", boxSizing: "border-box", fontSize: 13, padding: "10px 12px", borderRadius: 10,
              background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none",
            }}
          />
        </div>
      )}

      {err && <p style={{ fontSize: 12.5, color: "#E08A6B", margin: "0 0 10px" }}>{err}</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={!picked || sending} onClick={send} style={{
          flex: 1, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: picked && !sending ? "pointer" : "default",
          background: picked ? GOLD : PANEL_2, color: picked ? "#3a2600" : MUTED,
          border: `1px solid ${picked ? GOLD : LINE}`, opacity: sending ? 0.7 : 1,
        }}>{sending ? "Sending…" : "Send challenge"}</button>
        <button onClick={closeSheet} style={{
          padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer",
          background: "transparent", color: MUTED, border: `1px solid ${LINE}`,
        }}>Close</button>
      </div>
    </Sheet>
  );
}
