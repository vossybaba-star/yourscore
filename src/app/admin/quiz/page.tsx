"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The weekly quiz review queue.
 *
 * The factory (scripts/quiz-factory/run-week.mjs) writes packs as drafts and stops. This
 * is where they get let out. Nothing the factory produces reaches a player until it is
 * approved here — scripts/release-packs.mjs refuses to publish a pack with approved_at
 * IS NULL, whatever its release_at says.
 *
 * The important thing on screen is the SOURCE. Every question carries the URL the
 * fact-checker independently derived its answer from, so approving is a matter of
 * spot-checking citations rather than trusting the machine.
 */

type Question = {
  question: string;
  options: Record<"A" | "B" | "C" | "D", string>;
  answer: "A" | "B" | "C" | "D";
  difficulty: string;
  verification_note?: string;
};

type Pack = {
  id: string;
  name: string;
  theme: string | null;
  parameter: string;
  questions: Question[];
  status: string;
  release_at: string | null;
  approved_at: string | null;
  metadata: { theme_source?: string; authored_on?: string } | null;
};

type RecentPack = {
  id: string;
  name: string;
  theme: string | null;
  release_at: string | null;
  play_count: number | null;
};

const DIFF_COLOR: Record<string, string> = {
  easy: "#aeea00",
  medium: "#ffb800",
  hard: "#ff9f43",
  expert: "#ff4757",
  master: "#ff4757",
};

const dateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const pretty = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "unscheduled";

function parseNote(note?: string): { source_url?: string; source_quote?: string; checked_on?: string; time_sensitive?: boolean } {
  if (!note) return {};
  try {
    return JSON.parse(note);
  } catch {
    return {};
  }
}

export default function QuizReviewPage() {
  const [drafts, setDrafts] = useState<Pack[]>([]);
  const [recent, setRecent] = useState<RecentPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/quiz-packs");
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const json = await res.json();
      setDrafts(json.drafts ?? []);
      setRecent(json.recent ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(packId: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(packId);
    try {
      const res = await fetch("/api/admin/quiz-packs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId, action, ...extra }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const pending = drafts.filter((p) => !p.approved_at);
  const approved = drafts.filter((p) => p.approved_at);

  return (
    <div className="p-8 max-w-5xl">
      <header className="mb-8">
        <h1 className="font-display text-3xl text-white tracking-wide">QUIZ REVIEW</h1>
        <p className="font-body text-sm mt-1" style={{ color: "#6b6b85" }}>
          Nothing goes live until you approve it. Approved packs release on their own date.
        </p>
      </header>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-lg font-body text-sm" style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "#ff4757" }}>
          {error}
        </div>
      )}

      {loading && <p className="font-body text-sm" style={{ color: "#6b6b85" }}>Loading…</p>}

      {!loading && !drafts.length && (
        <div className="px-5 py-8 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="font-body text-sm" style={{ color: "#6b6b85" }}>
            No drafts waiting. The factory runs Monday — if it&apos;s midweek and this is empty, check that the job ran.
          </p>
        </div>
      )}

      {/* ── Awaiting approval ─────────────────────────────────────────────── */}
      {!!pending.length && (
        <Section title={`Awaiting your approval (${pending.length})`} accent="#ffb800">
          {pending.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              open={open === p.id}
              busy={busy === p.id}
              onToggle={() => setOpen(open === p.id ? null : p.id)}
              onApprove={(releaseAt) => act(p.id, "approve", { releaseAt })}
              onReject={() => act(p.id, "reject")}
              onReschedule={(releaseAt) => act(p.id, "reschedule", { releaseAt })}
            />
          ))}
        </Section>
      )}

      {/* ── Approved, waiting on their release date ───────────────────────── */}
      {!!approved.length && (
        <Section title={`Approved — scheduled (${approved.length})`} accent="#aeea00">
          {approved.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              open={open === p.id}
              busy={busy === p.id}
              onToggle={() => setOpen(open === p.id ? null : p.id)}
              onUnapprove={() => act(p.id, "unapprove")}
              onReschedule={(releaseAt) => act(p.id, "reschedule", { releaseAt })}
            />
          ))}
        </Section>
      )}

      {/* ── Already out ───────────────────────────────────────────────────── */}
      {!!recent.length && (
        <Section title="Recently released" accent="#6b6b85">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            {recent.map((p, i) => (
              <div
                key={p.id}
                className="px-4 py-3 flex items-center justify-between"
                style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : undefined, background: "rgba(255,255,255,0.02)" }}
              >
                <span className="font-body text-sm text-white">{p.theme ?? p.name}</span>
                <span className="font-body text-xs" style={{ color: "#6b6b85" }}>
                  {pretty(p.release_at)} · {p.play_count ?? 0} plays
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <p className="font-body text-xs mb-3 tracking-widest uppercase font-bold" style={{ color: accent }}>
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function PackCard({
  pack, open, busy, onToggle, onApprove, onUnapprove, onReject, onReschedule,
}: {
  pack: Pack;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove?: (releaseAt: string) => void;
  onUnapprove?: () => void;
  onReject?: () => void;
  onReschedule?: (releaseAt: string) => void;
}) {
  const [releaseAt, setReleaseAt] = useState(dateInput(pack.release_at));
  const qs = pack.questions ?? [];

  const mix = qs.reduce<Record<string, number>>((acc, q) => {
    acc[q.difficulty] = (acc[q.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  // If the answer is always A, the shuffle didn't run — worth seeing at a glance.
  const spread = qs.reduce<Record<string, number>>((acc, q) => {
    acc[q.answer] = (acc[q.answer] ?? 0) + 1;
    return acc;
  }, {});
  const unsourced = qs.filter((q) => !parseNote(q.verification_note).source_url).length;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <button onClick={onToggle} className="text-left flex-1">
            <p className="font-display text-xl text-white tracking-wide">{pack.theme ?? pack.name}</p>
            <p className="font-body text-xs mt-1" style={{ color: "#6b6b85" }}>
              {qs.length} questions · releases {pretty(pack.release_at)}
              {pack.metadata?.theme_source ? ` · ${pack.metadata.theme_source}` : ""}
              {" · "}
              {Object.entries(mix).map(([d, n]) => `${n} ${d}`).join(", ")}
            </p>
            <p className="font-body text-xs mt-1" style={{ color: "#6b6b85" }}>
              answers {["A", "B", "C", "D"].map((l) => `${l}:${spread[l] ?? 0}`).join(" ")}
              {unsourced > 0 && (
                <span style={{ color: "#ff4757" }}> · {unsourced} without a source</span>
              )}
            </p>
          </button>
          <span className="font-body text-xs" style={{ color: "#6b6b85" }}>{open ? "▲" : "▼"}</span>
        </div>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <input
            type="date"
            value={releaseAt}
            onChange={(e) => setReleaseAt(e.target.value)}
            className="px-3 py-2 rounded-lg font-body text-sm"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
          />
          {onApprove && (
            <button
              disabled={busy || !releaseAt}
              onClick={() => onApprove(releaseAt)}
              className="px-4 py-2 rounded-lg font-body text-sm font-bold disabled:opacity-40"
              style={{ background: "#aeea00", color: "#07070d" }}
            >
              {busy ? "…" : "Approve"}
            </button>
          )}
          {onUnapprove && (
            <button
              disabled={busy}
              onClick={onUnapprove}
              className="px-4 py-2 rounded-lg font-body text-sm font-bold disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.06)", color: "#fff" }}
            >
              Un-approve
            </button>
          )}
          {onReschedule && (
            <button
              disabled={busy || !releaseAt || releaseAt === dateInput(pack.release_at)}
              onClick={() => onReschedule(releaseAt)}
              className="px-4 py-2 rounded-lg font-body text-sm disabled:opacity-30"
              style={{ background: "rgba(255,255,255,0.06)", color: "#fff" }}
            >
              Reschedule
            </button>
          )}
          {onReject && (
            <button
              disabled={busy}
              onClick={onReject}
              className="px-4 py-2 rounded-lg font-body text-sm ml-auto disabled:opacity-40"
              style={{ background: "rgba(255,71,87,0.12)", color: "#ff4757" }}
            >
              Reject
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {qs.map((q, i) => {
            const note = parseNote(q.verification_note);
            return (
              <div key={i} className="px-5 py-4" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
                <div className="flex items-start gap-3">
                  <span className="font-body text-xs font-bold mt-0.5" style={{ color: DIFF_COLOR[q.difficulty] ?? "#6b6b85", minWidth: 52 }}>
                    {q.difficulty}
                  </span>
                  <div className="flex-1">
                    <p className="font-body text-sm text-white font-semibold">{i + 1}. {q.question}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      {(["A", "B", "C", "D"] as const).map((l) => (
                        <p
                          key={l}
                          className="font-body text-xs"
                          style={{ color: q.answer === l ? "#aeea00" : "#6b6b85", fontWeight: q.answer === l ? 700 : 400 }}
                        >
                          {l}) {q.options?.[l]} {q.answer === l && "✓"}
                        </p>
                      ))}
                    </div>

                    {/* The citation is the whole point of this screen. */}
                    {note.source_url ? (
                      <p className="font-body text-xs mt-2" style={{ color: "#6b6b85" }}>
                        {note.source_quote && <span className="italic">&ldquo;{note.source_quote}&rdquo; — </span>}
                        <a href={note.source_url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "#00ff87" }}>
                          source
                        </a>
                        {note.checked_on && <span> · checked {note.checked_on}</span>}
                        {note.time_sensitive && <span style={{ color: "#ffb800" }}> · time-sensitive</span>}
                      </p>
                    ) : (
                      <p className="font-body text-xs mt-2" style={{ color: "#ff4757" }}>
                        no source — this should not have passed the gate
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
