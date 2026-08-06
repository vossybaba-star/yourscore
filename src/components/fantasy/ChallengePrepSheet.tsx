"use client";
/**
 * Challenge prep sheet (Phase 1C, expanded Phase 3B) — opened from
 * MemberActionSheet's Challenge chip. Three supported games now (Quiz
 * Battle, Quiz Duel, Gameday Quiz — see challengeGames.ts), so this now has
 * a game-choice step before the pack list, where Phase 1C only ever rendered
 * the one card. Once a game's picked, sends via POST /api/fantasy/challenges
 * (createChallenge) exactly as before.
 *
 * Pack sources differ per game — all three still trust a SERVER-held number,
 * never a client-computed one, they just differ in WHICH stored number:
 *   - Quiz Battle: the challenger's own quiz_attempts scorecard for a pack
 *     they've already played (same "your stored scorecard" trust model
 *     /versus/challenge and /api/h2h/from-attempt use).
 *   - Gameday Quiz: the same quiz_attempts source, filtered to packs
 *     carrying the gameday metadata marker (isGamedayPack) — a gameday pack
 *     IS an ordinary quiz_attempts row, just gated to matchday packs.
 *   - Quiz Duel: neither side has played, so there's no scorecard to read —
 *     GET /api/fantasy/challenges/packs?game=duel lists published packs the
 *     CALLER hasn't played (and, since it's given, the opponent hasn't
 *     either), no scores attached because none exist yet.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { coverUrl } from "@/lib/img";
import { GOLD, INK, LINE, MUTED, PANEL, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { supportedChallengeGames, type ChallengeGame } from "@/lib/fantasy/challengeGames";
import { isGamedayPack } from "@/lib/fantasy/challenges-pure";
import { trackChallengeFlowOpened, trackChallengeGameSelected, trackChallengeSent, trackChallengeAbandoned } from "@/lib/analytics/trackSocial";

/** A pack card the sheet can send — Quiz Battle/Gameday carry a real score
 *  (an already-played scorecard); Quiz Duel doesn't (score/correct undefined
 *  — neither side has played it yet). Never rendered as "0" when undefined —
 *  the two card renderers below are separate for exactly this reason. */
interface Scorecard { packId: string; name: string; score: number; correct: number; total: number; cover: string | null }
interface DuelPack { packId: string; name: string; total: number; cover: string | null }
/** What's actually picked — Scorecard's score/correct widened to optional so
 *  one state var covers both sources without an intersection type (which
 *  defeats "score" in picked narrowing below). */
type PickedPack = { packId: string; name: string; total: number; cover: string | null; score?: number; correct?: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

const MESSAGE_MAX_LEN = 140;

export function ChallengePrepSheet({ leagueCode, opponent, createdFrom = "member_action", initialGame, rematchOf, onSent, onClose }: {
  leagueCode: string;
  opponent: { userId: string; name: string; avatarUrl: string | null };
  /** Phase 3A — which surface opened this sheet (attribution only, see
   *  challenges.ts's normalizeCreatedFrom). Defaults to the one caller this
   *  sheet has today (MemberActionSheet's Challenge chip); a future caller
   *  from another surface passes its own value. */
  createdFrom?: string;
  /** Phase 3C — a Rematch tap preselects the completed challenge's own game
   *  (a rematch keeps the same game, product decision, locked) and skips
   *  straight to its pack step — the back arrow still lets the sender change
   *  it, same as picking normally would have got them here. Matched against
   *  supportedChallengeGames() by id; an unrecognised/omitted value falls
   *  back to the ordinary picker (or its Phase 1C single-game skip) below. */
  initialGame?: string;
  /** Phase 3C — set only when this sheet was opened from a Rematch tap
   *  (never a fresh Challenge) — passed straight through on the create POST.
   *  createChallenge validates it server-side (checkRematchEligibility); this
   *  sheet does no eligibility checking of its own, the caller only ever
   *  offers Rematch where it's already known to apply (a completed card the
   *  viewer took part in). */
  rematchOf?: string;
  /** Fired once the challenge is actually created — lets the caller flip its
   *  chip to "Pending" without waiting on a re-fetch. */
  onSent?: (created: { id: string; h2hId: string | null }) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const games = supportedChallengeGames();
  const preselectedGame = initialGame ? (games.find((g) => g.id === initialGame) ?? null) : null;

  const [leagueName, setLeagueName] = useState<string | null>(null);
  // null = only one game is offered, or a rematch preselected one (skip the
  // picker either way); "loading" state is implicit via that short-circuit
  // below.
  const [selectedGame, setSelectedGame] = useState<ChallengeGame | null>(
    preselectedGame ?? (games.length === 1 ? games[0] : null),
  );

  // Quiz Battle / Gameday Quiz — one shared load (the challenger's own played
  // packs), Gameday just filters it down client-side via isGamedayPack.
  const [scorecardCards, setScorecardCards] = useState<(Scorecard & { metadata: unknown })[] | null>(null);
  // Quiz Duel — a different source entirely, loaded lazily once that game's picked.
  const [duelCards, setDuelCards] = useState<DuelPack[] | null>(null);

  const [picked, setPicked] = useState<PickedPack | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    trackChallengeFlowOpened();
    // implicit selection — either there's only the one game, or a rematch
    // preselected it — neither is a real tap on the game-choice screen.
    if (selectedGame) trackChallengeGameSelected(selectedGame.id);
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

  const loadScorecards = useCallback(async () => {
    const sb = createClient();
    const { data: auth } = await sb.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) { setScorecardCards([]); return; }
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
      const { data: pk } = await db.from("quiz_packs").select("id, name, question_count, metadata").in("id", packIds);
      packs = Object.fromEntries(((pk ?? []) as Row[]).map((p) => [p.id, p]));
    }
    const seen = new Set<string>();
    const list: (Scorecard & { metadata: unknown })[] = [];
    for (const r of rows) {
      const p = packs[r.pack_id];
      if (!p || seen.has(r.pack_id)) continue;
      seen.add(r.pack_id);
      list.push({
        packId: r.pack_id, name: p.name ?? "Quiz", score: r.score ?? 0, correct: r.correct_count ?? 0,
        total: (p.question_count as number | null) ?? 0, cover: p.metadata?.cover_image ?? null,
        metadata: p.metadata ?? null,
      });
    }
    setScorecardCards(list);
  }, []);

  const loadDuelPacks = useCallback(() => {
    fetch(`/api/fantasy/challenges/packs?game=duel&opponent=${encodeURIComponent(opponent.userId)}`)
      .then((res) => res.json())
      .then((j) => setDuelCards((j?.packs as DuelPack[] | undefined) ?? []))
      .catch(() => setDuelCards([]));
  }, [opponent.userId]);

  // Load whichever source the picked game needs, once (not re-fetched on
  // every game switch — a "change game" tap just re-reads what's cached).
  useEffect(() => {
    if (!selectedGame) return;
    if ((selectedGame.id === "quiz_battle" || selectedGame.id === "gameday_quiz") && scorecardCards === null) {
      void loadScorecards();
    }
    if (selectedGame.id === "quiz_duel" && duelCards === null) {
      loadDuelPacks();
    }
  }, [selectedGame, scorecardCards, duelCards, loadScorecards, loadDuelPacks]);

  const gamedayCards = useMemo(
    () => (scorecardCards ?? []).filter((c) => isGamedayPack(c.metadata)),
    [scorecardCards],
  );

  const chooseGame = (g: ChallengeGame) => {
    trackChallengeGameSelected(g.id);
    setSelectedGame(g);
    setPicked(null);
  };
  const changeGame = () => {
    setSelectedGame(null);
    setPicked(null);
  };

  const closeSheet = () => {
    if (!sent) trackChallengeAbandoned();
    onClose();
  };

  const send = () => {
    if (!picked || !selectedGame || sending) return;
    setSending(true); setErr(null);
    const trimmedMessage = message.trim();
    fetch("/api/fantasy/challenges", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opponentId: opponent.userId, leagueCode, gameType: selectedGame.id, packId: picked.packId,
        message: trimmedMessage || undefined, createdFrom, rematchOf,
      }),
    })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setErr(j.error ?? "Could not send the challenge"); return; }
        trackChallengeSent(selectedGame.id);
        setSent(true);
        onSent?.({ id: j.id, h2hId: j.h2hId ?? null });
      })
      .catch(() => setErr("Could not send the challenge"))
      .finally(() => setSending(false));
  };

  // ── Sent ──
  if (sent) {
    const sentSub = typeof picked?.score === "number"
      ? `${opponent.name} has a few days to beat your ${picked.score.toLocaleString()}.`
      : `You'll both get a nudge once it's decided.`;
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
          <p style={{ fontSize: 13, color: MUTED, margin: "0 0 18px" }}>{sentSub}</p>
          <button onClick={() => { router.push(`/fantasy/leagues/${leagueCode}?t=chat`); onClose(); }} style={{
            width: "100%", padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer",
            background: tint(GOLD, "18"), color: GOLD, border: `1px solid ${tint(GOLD, "50")}`,
          }}>View in chat</button>
        </div>
      </Sheet>
    );
  }

  // ── Game choice (Phase 3B — more than one supported game) ──
  if (!selectedGame) {
    return (
      <Sheet onClose={closeSheet} labelledBy="challenge-title">
        <div id="challenge-title" className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 2 }}>Challenge {opponent.name}</div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px" }}>{leagueName ? `In ${leagueName}` : " "}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <PlayerAvatar seed={opponent.userId} name={opponent.name} avatarUrl={opponent.avatarUrl} size={38} />
          <div className="font-body" style={{ fontSize: 14, fontWeight: 700, color: INK }}>{opponent.name}</div>
        </div>
        <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>PICK A GAME</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {games.map((g) => (
            <button key={g.id} onClick={() => chooseGame(g)} style={{
              textAlign: "left", cursor: "pointer", borderRadius: 12, padding: 12,
              background: `linear-gradient(100deg, ${tint(GOLD, "12")}, ${PANEL} 60%)`,
              border: `1px solid ${tint(GOLD, "3a")}`, borderLeft: `3px solid ${GOLD}`,
            }}>
              <div className="font-display tracking-widest" style={{ fontSize: 10.5, color: GOLD, marginBottom: 5 }}>{g.name.toUpperCase()}</div>
              <p style={{ fontSize: 12.5, color: INK, margin: "0 0 8px", lineHeight: 1.4 }}>{g.shortDesc}</p>
              <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: MUTED }}>
                <span>{g.typicalDuration}</span>
              </div>
            </button>
          ))}
        </div>
        <button onClick={closeSheet} style={{
          width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer",
          background: "transparent", color: MUTED, border: `1px solid ${LINE}`,
        }}>Close</button>
      </Sheet>
    );
  }

  const game = selectedGame;
  const isDuel = game.id === "quiz_duel";
  const isGameday = game.id === "gameday_quiz";
  const cards: (Scorecard | DuelPack)[] | null = isDuel ? duelCards : isGameday ? gamedayCards : scorecardCards;
  const packListLabel = picked ? "YOUR QUIZ" : isDuel ? "PICK A QUIZ NEITHER OF YOU HAS PLAYED" : "PICK A QUIZ YOU'VE PLAYED";
  const emptyTitle = isGameday
    ? "Play a Gameday pack first, then send this one."
    : isDuel
      ? "No fresh packs to duel over right now."
      : "Play a quiz first, then challenge your league";

  return (
    <Sheet onClose={closeSheet} labelledBy="challenge-title">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        {games.length > 1 && (
          <button onClick={changeGame} aria-label="Change game" style={{
            display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 999,
            background: PANEL_2, border: `1px solid ${LINE}`, color: MUTED, cursor: "pointer", flexShrink: 0, padding: 0,
          }}>←</button>
        )}
        <div id="challenge-title" className="font-display" style={{ fontSize: 18, color: INK }}>Challenge {opponent.name}</div>
      </div>
      <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 14px" }}>{leagueName ? `In ${leagueName}` : " "}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <PlayerAvatar seed={opponent.userId} name={opponent.name} avatarUrl={opponent.avatarUrl} size={38} />
        <div className="font-body" style={{ fontSize: 14, fontWeight: 700, color: INK }}>{opponent.name}</div>
      </div>

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

      <div className="font-body" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: MUTED, marginBottom: 8 }}>
        {packListLabel}
      </div>

      {picked ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: picked.cover ? `center/cover url(${coverUrl(picked.cover, 40)})` : tint(TEAL, "18") }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{picked.name}</div>
            <div style={{ fontSize: 11.5, color: MUTED }}>
              {typeof picked.score === "number" ? `Your score: ${picked.score.toLocaleString()} · ${picked.correct}/${picked.total}` : `${picked.total} questions`}
            </div>
          </div>
          <button onClick={() => setPicked(null)} style={{ background: "none", border: "none", color: TEAL, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Change</button>
        </div>
      ) : cards === null ? (
        <p style={{ fontSize: 12.5, color: MUTED, margin: "6px 0 16px" }}>Loading{isDuel ? " packs" : " your scores"}…</p>
      ) : cards.length === 0 ? (
        <div style={{ textAlign: "center", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "20px 16px", marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: INK, margin: "0 0 4px", fontWeight: 600 }}>{emptyTitle}</p>
          {!isDuel && <a href="/play" style={{ display: "inline-block", marginTop: 8, fontSize: 12.5, fontWeight: 700, color: TEAL, textDecoration: "none" }}>Find a quiz →</a>}
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
                <div style={{ fontSize: 11, color: MUTED }}>
                  {"score" in c ? `Your score: ${c.score.toLocaleString()} · ${c.correct}/${c.total}` : `${c.total} questions`}
                </div>
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
