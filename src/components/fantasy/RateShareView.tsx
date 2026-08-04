"use client";
/**
 * /r/[id] — the public Scout verdict. The single end page for a Scout analysis:
 * whether a visitor uploaded their own screenshot or a bot posted their team,
 * they land here. Leads with the payoff (score + read), shows the graded XI,
 * lets them SHARE it (copy / X / WhatsApp / native), and SAVE it to YourScore —
 * to their account if signed in, or by creating one if not.
 *
 * Renders from the stored snapshot passed in — no live pool read, no recompute —
 * so it is fast, immutable, and identical to the unfurl card. Auth state is the
 * one thing fetched client-side, to shape the save CTA.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Btn, Card, Header, INK, LINE, MUTED, PANEL, TEAL, GOLD, LIME, page, tint, type Pos,
} from "@/components/fantasy/shared";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { BottomNav } from "@/components/ui/BottomNav";
import { faceUrlById } from "@/lib/fantasy/faces";
import {
  BandGroups, scoreColor, HorizonTabs, HORIZON_HELPER, type Horizon,
} from "@/components/fantasy/RatingBands";
import { trackSquadRated, trackRateOutcome, trackShare } from "@/lib/analytics/trackGame";
import type { RateShareRow, RateSharePlayer } from "@/lib/fantasy/rateShareTypes";

const DRAFT_KEY = "ys-fantasy-draft";
const ROW_ORDER: Pos[] = ["FWD", "MID", "DEF", "GK"];
const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;

/** Where the viewer stands, to shape the save CTA (mirrors /fantasy/rate):
 *  "out" = no account (save = create one); "in-no-squad" = signed in, save is
 *  one tap; "in-with-squad" = signed in with a live squad, so saving REPLACES it. */
type AuthState = "out" | "in-no-squad" | "in-with-squad";

function Marker({ p, dim }: { p: RateSharePlayer; dim?: boolean }) {
  return (
    <div style={{ flex: dim ? undefined : "1 1 0", minWidth: 0, maxWidth: 72, padding: 2 }}>
      <PlayerMarker
        name={p.name} label={surname(p.name)} avatarUrl={faceUrlById(p.id) ?? null} club={p.club}
        size={dim ? 26 : 30} isCaptain={p.isCaptain} isVice={p.isVice} pos={p.pos as Pos} dim={dim} />
    </div>
  );
}

const HOOKS = [
  { accent: TEAL, title: "Graded by the Scout", body: "A real read on your XI, not a guess." },
  { accent: GOLD, title: "Monthly prizes", body: "Top the monthly table and you win." },
  { accent: LIME, title: "League chats", body: "Start a league and the group chat runs all season." },
];

export function RateShareView({ row }: { row: RateShareRow }) {
  const router = useRouter();
  const [horizon, setHorizon] = useState<Horizon>("month");
  const [authState, setAuthState] = useState<AuthState>("out");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [canNative, setCanNative] = useState(false);

  const players = row.players;
  const ids = useMemo(() => players.map((p) => p.id), [players]);
  const xi = players.filter((p) => !p.isBench);
  const bench = players.filter((p) => p.isBench);
  const h = row.rating[horizon];
  const score = row.rating.month.score;

  const xiRows = ROW_ORDER
    .map((pos) => ({ pos, entries: xi.filter((p) => (p.pos as Pos) === pos) }))
    .filter((r) => r.entries.length > 0);

  // A cold viewer seeing a real grade — the same "someone saw their rating"
  // signal the upload flow fires, tagged so the bot funnel reports separately.
  useEffect(() => {
    trackSquadRated({ source: "share", score });
  }, [score]);

  // Client-only bits: the absolute share URL and whether the OS share sheet exists.
  useEffect(() => {
    setShareUrl(window.location.href);
    setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  // Auth state shapes the save CTA. Defaults to "out" (the common case, and the
  // safe default while this resolves) — a signed-in viewer gets a beat of the
  // wrong buttons before it lands, never the reverse.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fantasy/state");
        if (!res.ok) { if (!cancelled) setAuthState("out"); return; }
        const json = await res.json().catch(() => null) as { squad?: unknown } | null;
        if (!cancelled) setAuthState(json?.squad ? "in-with-squad" : "in-no-squad");
      } catch {
        if (!cancelled) setAuthState("out");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const shareText = `My FPL team scored ${score.toFixed(1)}/10 from the YourScore Scout.`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      trackShare("rate-analysis", { channel: "copy" });
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };
  const openShare = (channel: "x" | "whatsapp", url: string) => {
    trackShare("rate-analysis", { channel });
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const onNative = async () => {
    try {
      await navigator.share({ title: "Scout's Report", text: shareText, url: shareUrl });
      trackShare("rate-analysis", { channel: "native" });
    } catch { /* dismissed */ }
  };

  const writeDraft = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
  };
  const makeThisMyTeam = () => {
    writeDraft();
    trackRateOutcome("share-make-this-my-team", authState === "out", { source: "share", auth: authState });
    router.push(authState === "out" ? "/auth/sign-in?next=/fantasy/build" : "/fantasy/build");
  };
  const buildMyOwn = () => {
    trackRateOutcome("share-build-my-own", authState === "out", { source: "share", auth: authState });
    router.push(authState === "out" ? "/auth/sign-in?next=/fantasy/build" : "/fantasy/build");
  };
  const keepMyTeam = () => {
    trackRateOutcome("share-keep-my-team", false, { source: "share", auth: authState });
    router.push("/fantasy/scout/squad");
  };

  const chip = (label: string, onClick: () => void, accent = false) => (
    <button type="button" onClick={onClick} style={{
      flex: "1 1 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "10px 8px", borderRadius: 11, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
      border: `1px solid ${accent ? tint(TEAL, "77") : LINE}`,
      background: accent ? tint(TEAL, "1e") : "transparent", color: accent ? TEAL : INK,
    }}>{label}</button>
  );

  return (
    <>
      <main data-fantasy style={page}>
        <Header />

        {/* ── eyebrow ── */}
        <div className="font-body rounded-full" style={{
          display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
          padding: "5px 12px", marginBottom: 12,
          background: tint(TEAL, "1e"), border: `1px solid ${tint(TEAL, "55")}`, color: TEAL,
        }}>
          RATED BY THE YOURSCORE SCOUT
        </div>

        {/* ── the verdict (payoff first) ── */}
        <Card style={{ marginBottom: 12 }}>
          <HorizonTabs active={horizon} onChange={setHorizon} />
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 10px", lineHeight: 1.4 }}>
            {HORIZON_HELPER[horizon]}
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
            <span className="font-display" style={{ fontSize: 52, lineHeight: 1, color: scoreColor(h.score) }}>
              {h.score.toFixed(1)}
            </span>
            <span className="font-body" style={{ fontSize: 13, color: MUTED }}>out of 10</span>
          </div>
          <p style={{ fontSize: 14.5, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>{h.verdict}</p>
          <BandGroups bands={h.bands} />
          <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6, marginTop: 4 }}>
            WORTH A LOOK
          </div>
          <p style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: 0 }}>{h.moveLine}</p>
        </Card>

        {/* ── share the report ── native Share (mobile) leads; Copy is the
             accent when there is no share sheet, so there is always one primary. */}
        <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          {canNative ? chip("Share", onNative, true) : null}
          {chip(copied ? "Copied" : "Copy link", onCopy, !canNative)}
          {chip("X", () => openShare("x", `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`))}
          {chip("WhatsApp", () => openShare("whatsapp", `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`))}
        </div>

        {/* ── the team we graded ── */}
        <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
          THE TEAM WE GRADED
        </div>
        <div className="rounded-2xl" style={{
          border: `1px solid ${LINE}`, display: "flex", alignItems: "stretch", overflow: "hidden", marginBottom: 22,
        }}>
          <PitchSurface round="left">
            {xiRows.map((r) => (
              <div key={r.pos} style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                {r.entries.map((p) => <Marker key={p.id} p={p} />)}
              </div>
            ))}
          </PitchSurface>
          <BenchStrip>
            {bench.map((p) => <Marker key={p.id} p={p} dim />)}
          </BenchStrip>
        </div>

        {/* ── save to YourScore (auth-aware) ── */}
        <div style={{
          borderRadius: 16, padding: 18, marginBottom: 16,
          background: `linear-gradient(150deg, ${tint(TEAL, "22")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "55")}`,
        }}>
          {authState === "in-with-squad" ? (
            <>
              <div className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.12, marginBottom: 6 }}>
                This team vs your squad
              </div>
              <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
                This was just a look, friend, your real squad has not moved. Like it better than what you are running now? Make it official and it replaces your current squad.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Btn onClick={keepMyTeam}>Keep my team</Btn></div>
                <div style={{ flex: 1 }}><Btn gold onClick={makeThisMyTeam}>Make this my team</Btn></div>
              </div>
            </>
          ) : authState === "in-no-squad" ? (
            <>
              <span className="font-body rounded-full" style={{
                display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
                padding: "4px 10px", marginBottom: 12,
                background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "55")}`, color: GOLD,
              }}>SAVE TO YOURSCORE</span>
              <div className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.12, marginBottom: 6 }}>
                Set this as your squad
              </div>
              <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
                Take this exact team into the builder to make it yours, friend, or start clean and build your own.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Btn onClick={buildMyOwn}>Build my own</Btn></div>
                <div style={{ flex: 1 }}><Btn gold onClick={makeThisMyTeam}>Make this my team</Btn></div>
              </div>
            </>
          ) : (
            <>
              <span className="font-body rounded-full" style={{
                display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
                padding: "4px 10px", marginBottom: 12,
                background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "55")}`, color: GOLD,
              }}>FANTASY PL IS LIVE ON YOURSCORE</span>
              <div className="font-display" style={{ fontSize: 20, color: INK, lineHeight: 1.12, marginBottom: 6 }}>
                Make this your squad
              </div>
              <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
                Create your free YourScore account, friend, and this exact team is saved for you. One transfer a gameweek, and what you know earns you more. Then take on your friends in a league that runs all season.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}><Btn onClick={buildMyOwn}>Build my own</Btn></div>
                <div style={{ flex: 1 }}><Btn gold glow onClick={makeThisMyTeam}>Make this my team</Btn></div>
              </div>
            </>
          )}
        </div>

        {/* ── why ── */}
        <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
          {HOOKS.map((hook) => (
            <div key={hook.title} className="rounded-2xl" style={{
              display: "flex", alignItems: "center", gap: 12, padding: "13px 14px",
              background: PANEL, border: `1px solid ${LINE}`,
            }}>
              <span aria-hidden style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: tint(hook.accent, "1e"), border: `1px solid ${tint(hook.accent, "55")}`,
              } as CSSProperties} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 2 }}>{hook.title}</div>
                <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{hook.body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── footer: rate your own ── */}
        <button type="button" onClick={() => router.push("/fantasy/rate")} style={{
          width: "100%", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 12,
          padding: "12px 14px", cursor: "pointer", color: MUTED, fontSize: 12.5, lineHeight: 1.4,
        }}>
          Got your own team? <span style={{ color: TEAL, fontWeight: 700 }}>Rate it with the Scout</span>
        </button>
      </main>
      <BottomNav />
    </>
  );
}
