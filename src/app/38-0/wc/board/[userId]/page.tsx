"use client";

/**
 * /38-0/wc/board/[userId] — drill-down from the World Cup Daily season board into one
 * player's ranked-run history. Switch between their daily drafts to see each day's XI
 * (the squad they built) and how the run went, match by match.
 *
 * Data: get_wc_player_history via /api/draft/wc/history (public read; the squad jsonb is
 * a self-contained PlacedPlayer[] so the existing <Pitch> renders it directly).
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BackPill } from "@/components/ui/BackPill";
import { Pitch } from "@/components/draft/Pitch";
import { useUser } from "@/hooks/useUser";
import type { Formation, PlacedPlayer } from "@/lib/draft/types";

type Comment = { id: string; run_id: string; author_id: string; author_name: string; author_avatar: string | null; body: string; created_at: string };

// Compact relative time for comment timestamps ("3h", "2d", "just now").
function rel(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ACCENT = "#ffb800";

type Match = {
  stage: string; idx: number;
  opponent_nation: string; opponent_crest: string | null; opponent_strength: number;
  you_goals: number; opp_goals: number;
  pens_you: number | null; pens_opp: number | null;
  won: boolean | null;
};
type Run = {
  run_id: string; run_date: string; formation: string; squad: PlacedPlayer[]; strength: number;
  status: string; stage: string;
  wins: number; draws: number; losses: number; points: number;
  quiz_correct: number | null; quiz_total: number | null;
  display_name: string; avatar_url: string | null;
  matches: Match[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// run_date is a plain "YYYY-MM-DD" — format without Date() (avoids TZ drift).
function fmtDate(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${Number(day)} ${MONTHS[(m ?? 1) - 1]}`;
}

const STAGE_LABEL: Record<string, string> = {
  group: "Group", playoff: "Play-off", r32: "Round of 32", r16: "Round of 16",
  qf: "Quarter-final", sf: "Semi-final", final: "Final",
};
// The bracket is group → ko → qf → sf → final, where the single "ko" stage plays two
// games (R32 then R16 per the WC path). Resolve a readable round name from stage + idx.
function stageLabel(stage: string, idx: number): string {
  if (stage === "ko") return idx === 0 ? "Round of 32" : "Round of 16";
  return STAGE_LABEL[stage] ?? stage;
}

// Headline for how the run ended.
function outcome(run: Run): { text: string; color: string } {
  if (run.status === "champion") return { text: "🏆 CHAMPIONS — won the World Cup", color: ACCENT };
  if (run.status === "active") return { text: "In progress", color: "#9a9ab0" };
  // eliminated
  if (run.stage === "group") return { text: "Out in the group stage", color: "#ff7a88" };
  const where = run.stage === "ko" ? "the knockouts" : (STAGE_LABEL[run.stage] ?? "the knockouts");
  return { text: `Knocked out — ${where}`, color: "#ff7a88" };
}

// Colour the quiz score by how well they did (green strong / gold ok / red weak).
function quizColor(correct: number, total: number): string {
  const r = total ? correct / total : 0;
  return r >= 0.8 ? "#00ff87" : r >= 0.5 ? ACCENT : "#ff7a88";
}

function Pill({ won }: { won: boolean | null }) {
  const cfg = won === true ? { t: "W", c: "#00ff87" } : won === false ? { t: "L", c: "#ff4757" } : { t: "D", c: ACCENT };
  return (
    <span className="font-display tabular-nums" style={{
      width: 20, height: 20, lineHeight: "20px", textAlign: "center", borderRadius: 6,
      fontSize: 11, color: cfg.c, background: `${cfg.c}1f`, display: "inline-block",
    }}>{cfg.t}</span>
  );
}

export default function PlayerHistory() {
  const params = useParams();
  const userId = String(params?.userId ?? "");
  const { user } = useUser();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [sel, setSel] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/draft/wc/history?user=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setRuns((d.runs ?? []) as Run[]); })
      .catch(() => { if (alive) setRuns([]); });
    fetch(`/api/draft/wc/comments?user=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((d) => { if (alive) setComments((d.comments ?? []) as Comment[]); })
      .catch(() => { if (alive) setComments([]); });
    return () => { alive = false; };
  }, [userId]);

  // Comments grouped by the run they're on (one fetch for the whole profile).
  const commentsByRun = useMemo(() => {
    const m: Record<string, Comment[]> = {};
    for (const c of comments) (m[c.run_id] ??= []).push(c);
    return m;
  }, [comments]);
  const canModerate = !!user && user.id === userId; // viewing your own profile → can remove any

  const name = runs?.[0]?.display_name ?? "Player";
  const season = useMemo(() => {
    const r = runs ?? [];
    return {
      wins: r.reduce((a, x) => a + x.wins, 0),
      draws: r.reduce((a, x) => a + x.draws, 0),
      losses: r.reduce((a, x) => a + x.losses, 0),
      points: r.reduce((a, x) => a + x.points, 0),
      days: r.length,
    };
  }, [runs]);

  const run = runs?.[sel];

  return (
    <div className="min-h-[100dvh] pb-32" style={{ background: "#0a0a0f", color: "#e8e8f0" }}>
      <div className="max-w-lg mx-auto px-5 pt-10">
        <BackPill href="/38-0/wc/board" label="Season board" tone="wc" />

        {/* ── Player header ── */}
        <div className="flex items-center gap-3 mt-3">
          {runs?.[0]?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={runs[0].avatar_url} alt="" width={44} height={44} style={{ width: 44, height: 44, borderRadius: 22, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 44, height: 44, borderRadius: 22, background: "rgba(255,184,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="font-display" style={{ fontSize: 18, color: ACCENT }}>{name[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display tracking-wide truncate" style={{ fontSize: 24, color: "#fff" }}>{name}</h1>
            <div className="font-body" style={{ fontSize: 12, color: "#8888aa" }}>World Cup Mastermind · ranked history</div>
          </div>
        </div>

        {/* ── Season summary ── */}
        {runs && runs.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mt-4">
            {([["W", season.wins, "#00ff87"], ["D", season.draws, ACCENT], ["L", season.losses, "#ff4757"], ["PTS", season.points, "#fff"]] as const).map(([l, v, c]) => (
              <div key={l} className="rounded-xl py-2 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="font-display tabular-nums" style={{ fontSize: 20, color: c }}>{v}</div>
                <div className="font-body" style={{ fontSize: 9, color: "#8888aa", letterSpacing: 1 }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Loading / empty ── */}
        {runs === null && <div className="py-12 text-center font-body text-sm" style={{ color: "#8888aa" }}>Loading…</div>}
        {runs?.length === 0 && (
          <div className="mt-6 rounded-2xl px-4 py-8 text-center" style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="font-body text-sm" style={{ color: "#8888aa" }}>No ranked runs yet this season.</p>
          </div>
        )}

        {/* ── Draft switcher ── */}
        {runs && runs.length > 0 && (
          <>
            <div className="mt-6 mb-3 font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1 }}>THEIR DRAFTS · TAP TO SWITCH</div>
            <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {runs.map((r, i) => {
                const active = i === sel;
                return (
                  <button key={r.run_id} onClick={() => setSel(i)}
                    className="flex-shrink-0 rounded-xl px-3 py-2 text-left transition-all active:scale-95"
                    style={{ background: active ? ACCENT : "#12121e", border: `1px solid ${active ? ACCENT : "rgba(255,255,255,0.08)"}` }}>
                    <div className="font-display tracking-wide" style={{ fontSize: 14, color: active ? "#1a1300" : "#fff" }}>{fmtDate(r.run_date)}</div>
                    <div className="font-body tabular-nums" style={{ fontSize: 11, color: active ? "rgba(26,19,0,0.7)" : "#8888aa" }}>
                      {r.wins}-{r.draws}-{r.losses}{r.status === "champion" ? " 🏆" : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Selected draft ── */}
        {run && (
          <div className="mt-4 space-y-4">
            {/* result + meta */}
            <div className="rounded-2xl p-4" style={{ background: "#12121e", border: `1px solid ${run.status === "champion" ? "rgba(255,184,0,0.4)" : "rgba(255,255,255,0.08)"}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>{fmtDate(run.run_date)} · {run.formation}</div>
                  <div className="font-display tracking-wide mt-0.5" style={{ fontSize: 15, color: outcome(run).color }}>{outcome(run).text}</div>
                </div>
                <div className="text-right">
                  <div className="font-display tabular-nums" style={{ fontSize: 26, color: "#fff" }}>
                    <span style={{ color: "#00ff87" }}>{run.wins}</span>-<span style={{ color: ACCENT }}>{run.draws}</span>-<span style={{ color: "#ff4757" }}>{run.losses}</span>
                  </div>
                  <div className="font-body" style={{ fontSize: 11, color: "#8888aa" }}>STR {Math.round(Number(run.strength))} · {run.points} pts</div>
                </div>
              </div>
              {run.quiz_total != null && (
                <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="font-body" style={{ fontSize: 12, color: "#9a9ab0" }}>🧠 Mastermind quiz</span>
                  <span className="font-display tabular-nums" style={{ fontSize: 15, color: quizColor(run.quiz_correct ?? 0, run.quiz_total) }}>
                    {run.quiz_correct ?? 0}/{run.quiz_total} correct
                  </span>
                </div>
              )}
            </div>

            {/* ── Comments on this result/squad — directly under the result tile ── */}
            <CommentThread
              runId={run.run_id}
              comments={commentsByRun[run.run_id] ?? []}
              canModerate={canModerate}
              meId={user?.id ?? null}
              onAdd={(c) => setComments((prev) => [...prev, c])}
              onRemove={(id) => setComments((prev) => prev.filter((x) => x.id !== id))}
            />

            {/* the XI */}
            <div className="rounded-2xl p-3" style={{ background: "#080d0a", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="font-body mb-2 px-1" style={{ fontSize: 11, color: ACCENT, letterSpacing: 1 }}>THE XI THEY DREW</div>
              <Pitch formation={run.formation as Formation} squad={run.squad ?? []} compact />
            </div>

            {/* match by match */}
            {run.matches.length > 0 && (
              <div className="rounded-2xl overflow-hidden" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="px-4 py-2 font-body" style={{ fontSize: 11, color: "#8888aa", letterSpacing: 1, background: "rgba(255,255,255,0.03)" }}>ROAD TO THE FINAL</div>
                {run.matches.map((m, i) => {
                  const pens = m.pens_you != null && m.pens_opp != null;
                  return (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <span className="font-body flex-shrink-0" style={{ width: 84, fontSize: 10, color: "#8888aa" }}>{stageLabel(m.stage, m.idx)}</span>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {m.opponent_crest && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.opponent_crest} alt="" width={20} height={20} style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }} />
                        )}
                        <span className="font-body truncate" style={{ fontSize: 13, color: "#fff" }}>{m.opponent_nation}</span>
                      </div>
                      <span className="font-display tabular-nums flex-shrink-0" style={{ fontSize: 14, color: "#fff" }}>
                        {m.you_goals}–{m.opp_goals}{pens && <span style={{ fontSize: 10, color: "#8888aa" }}> ({m.pens_you}-{m.pens_opp}p)</span>}
                      </span>
                      <Pill won={m.won} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentThread({ runId, comments, canModerate, meId, onAdd, onRemove }: {
  runId: string; comments: Comment[]; canModerate: boolean; meId: string | null;
  onAdd: (c: Comment) => void; onRemove: (id: string) => void;
}) {
  const MAX = 240;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/draft/wc/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", runId, body }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? "Couldn't post"); setBusy(false); return; }
      onAdd(data.comment as Comment); setText("");
    } catch { setErr("Network error — try again."); }
    setBusy(false);
  }

  async function remove(id: string) {
    try {
      const res = await fetch("/api/draft/wc/comments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", commentId: id }),
      });
      if (res.ok) onRemove(id);
    } catch { /* leave it; refresh clears */ }
  }

  return (
    <div className="rounded-2xl p-3" style={{ background: "#0d0d14", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="font-body mb-2 px-1" style={{ fontSize: 11, color: "#9fd8d8", letterSpacing: 1 }}>
        💬 COMMENTS{comments.length ? ` · ${comments.length}` : ""}
      </div>
      {comments.length === 0 && (
        <p className="font-body px-1 pb-1" style={{ fontSize: 12, color: "#6a6a82" }}>No comments yet — be the first.</p>
      )}
      <div className="flex flex-col gap-2">
        {comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex-shrink-0" style={{ width: 24, height: 24, borderRadius: 12, background: "rgba(255,184,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {c.author_avatar
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.author_avatar} alt="" width={24} height={24} style={{ width: 24, height: 24, objectFit: "cover" }} />
                : <span className="font-display" style={{ fontSize: 11, color: ACCENT }}>{(c.author_name[0] ?? "?").toUpperCase()}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-body" style={{ fontSize: 12, color: "#cfcfe6" }}>
                <b style={{ color: "#fff" }}>{c.author_name}</b> <span style={{ color: "#6a6a82" }}>· {rel(c.created_at)}</span>
              </div>
              <div className="font-body" style={{ fontSize: 13, color: "#e8e8f0", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{c.body}</div>
            </div>
            {(canModerate || c.author_id === meId) && (
              <button onClick={() => remove(c.id)} className="font-body flex-shrink-0 active:opacity-60" style={{ fontSize: 11, color: "#6a6a82" }}>Delete</button>
            )}
          </div>
        ))}
      </div>
      {meId ? (
        <div className="mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX))} placeholder="Leave a comment…" rows={2}
            className="w-full rounded-xl px-3 py-2 font-body" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 13, resize: "none" }} />
          <div className="flex items-center justify-between mt-1">
            <span className="font-body" style={{ fontSize: 10, color: err ? "#ff7a88" : "#6a6a82" }}>{err ?? `${text.length}/${MAX}`}</span>
            <button onClick={post} disabled={busy || !text.trim()} className="rounded-full px-4 py-1.5 font-display tracking-wide active:scale-95 transition-transform disabled:opacity-50"
              style={{ background: "#1d9bf0", color: "#fff", fontSize: 13 }}>{busy ? "…" : "Post"}</button>
          </div>
        </div>
      ) : (
        <p className="font-body mt-2 px-1" style={{ fontSize: 11, color: "#6a6a82" }}>Sign in to comment.</p>
      )}
    </div>
  );
}
