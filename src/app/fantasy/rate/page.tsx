"use client";
/**
 * /fantasy/rate — rate an FPL team from a screenshot, no account needed.
 *
 * Upload a "Pick Team" screenshot -> the Scout reads it and matches it
 * against our pool -> confirm the XI on a real pitch (fix anything we
 * misread) -> a three-card "how it works" beat while the Scout grades it,
 * same score/bands a signed-in manager gets -> save it, which is where an
 * account comes in. Screenshot only, four steps, no dead ends.
 *
 * The image never leaves this component except in the one POST to
 * /api/fantasy/rate-photo — it isn't kept in any longer-lived state, isn't
 * written anywhere, and the response never echoes it back.
 */
import {
  useCallback, useEffect, useRef, useState, type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import {
  Btn, Card, ErrorState, Header, INK, LINE, MUTED, PANEL, PosTag,
  Sheet, TEAL, CORAL, GOLD, LIME, page, tint, type ClientPoolPlayer, type Pos,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { RateIntroCards } from "@/components/fantasy/RateIntroCards";
import { ScoutScanState } from "@/components/fantasy/ScoutScanState";
import { BottomNav } from "@/components/ui/BottomNav";
import { faceFor, faceUrlById } from "@/lib/fantasy/faces";
import {
  BandGroups, scoreColor, type RatingBandsShape,
} from "@/components/fantasy/RatingBands";
import type { Slot } from "@/lib/fantasy/screenshotMatch";
import {
  trackRatePhotoStarted, trackSquadExtracted, trackSquadRated,
} from "@/lib/analytics/trackGame";

// ── the upload-step landing's sample payoff card ────────────────────────────
// A STATIC preview of a real rating so a visitor sees the actual product
// before uploading anything — real pool ids/names (Haaland, O'Reilly,
// Mbeumo, Nedeljkovic), never invented players. Never fetched, never sent
// anywhere; purely a sample render of the same BandGroups/scoreColor the
// real result step uses.
const SAMPLE_SCORE = 7.4;
const SAMPLE_VERDICT = "A strong spine, but thin at the back before the fixtures turn.";
const SAMPLE_MOVE_LINE = "Consider a stronger option in place of your weakest starter.";
const SAMPLE_BANDS: RatingBandsShape = {
  strong: [
    { id: 411, name: "Erling Haaland", pos: "FWD", note: "Nailed on, huge fixture run", avatarUrl: faceUrlById(411) },
  ],
  decent: [
    { id: 387, name: "Nico O'Reilly", pos: "DEF", note: "Good returns, keep an eye on rotation", avatarUrl: faceUrlById(387) },
    { id: 427, name: "Bryan Mbeumo", pos: "MID", note: "Involved every week", avatarUrl: faceUrlById(427) },
  ],
  weak: [
    { id: 39, name: "Kosta Nedeljkovic", pos: "DEF", note: "Toughest run of the lot right now", avatarUrl: faceUrlById(39) },
  ],
};

const MAX_EDGE = 1600;

type Step = "upload" | "reading" | "confirm" | "rating";

/** Where the viewer stands when they land on the result step:
 *  - "out": no account. Both end-of-flow buttons lead to signup.
 *  - "in-no-squad": signed in, never built a squad. No signup copy needed.
 *  - "in-with-squad": signed in with a live squad — swapping in the
 *    uploaded team REPLACES it, so that choice needs its own framing. */
type AuthState = "out" | "in-no-squad" | "in-with-squad";

/** Read a file, downscale to at most MAX_EDGE on the longest edge and
 *  re-encode as JPEG — a phone screenshot is easily 10 to 15MB straight off
 *  the camera roll, well past what's worth sending for text extraction. */
async function downscaleToJpeg(file: File): Promise<{ base64: string; mediaType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("That doesn't look like an image."));
    el.src = dataUrl;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(img, 0, 0, w, h);
  const outUrl = canvas.toDataURL("image/jpeg", 0.85);
  const base64 = outUrl.split(",")[1] ?? "";
  if (!base64) throw new Error("Couldn't process that image.");
  return { base64, mediaType: "image/jpeg" };
}

function flagNote(flags: string[]): string | null {
  if (flags.includes("unresolved")) return "Couldn't find this one. Pick them.";
  if (flags.includes("clubMismatch")) return "Check the club on this one.";
  if (flags.includes("ambiguous")) return "A couple of players matched. Check this one.";
  if (flags.includes("posMismatch")) return "Check the position on this one.";
  return null;
}

const surname = (name: string) => name.trim().split(/\s+/).slice(-1)[0] ?? name;

/** "A", "A and B", "A, B and C" — for naming the picks that block grading. */
const listNames = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// ── the confirm-step pitch ──────────────────────────────────────────────
// The 11 land on a real PitchSurface, grouped by position, attackers nearest
// the top of the pitch the same way every other Fantasy scene draws a squad
// (see RulesCards.tsx's SquadScene). The 4 bench sit in the real BenchStrip.
// Tapping a marker selects it and reveals an action bar below the pitch
// (captain, vice, bench, change) for that one player, so the pitch itself stays
// clean instead of carrying eleven sets of controls at once.

const ROW_ORDER: Pos[] = ["FWD", "MID", "DEF", "GK"];

function resolvedPos(slot: Slot, player: ClientPoolPlayer | null): Pos {
  return (player?.pos ?? slot.extracted.position) as Pos;
}

function buildXiRows(slots: Slot[], poolById: (id: number | null) => ClientPoolPlayer | null) {
  const withIndex = slots.map((slot, index) => ({ slot, index }));
  return ROW_ORDER.map((pos) => ({
    pos,
    entries: withIndex.filter(({ slot }) => !slot.isBench && resolvedPos(slot, poolById(slot.id)) === pos),
  }));
}

/** Delay, in ms, for each slot's staggered landing — top row to bottom row,
 *  then the bench — so the pitch reads as populating in real time on first
 *  paint rather than appearing all at once. */
function buildStaggerDelays(slots: Slot[], poolById: (id: number | null) => ClientPoolPlayer | null): Record<number, number> {
  const order: number[] = [];
  for (const pos of ROW_ORDER) {
    slots.forEach((slot, index) => { if (!slot.isBench && resolvedPos(slot, poolById(slot.id)) === pos) order.push(index); });
  }
  slots.forEach((slot, index) => { if (slot.isBench) order.push(index); });
  const delays: Record<number, number> = {};
  order.forEach((slotIndex, i) => { delays[slotIndex] = i * 60; });
  return delays;
}

// The confirm step exists for ONE job: fix the picks we could not match, so the
// grade can run. A matched pick is therefore display-only (no tap, no options);
// only an unmatched/low-confidence pick is a button, and tapping it goes straight
// to the picker to choose who it is. Unmatched picks wear a bold coral ring
// (PlayerMarker's `flagged`) so a viewer sees which ones need them at a glance.
function XiMarker({
  slot, player, isCaptain, isVice, size, delayMs, onFix, duplicate = false, captainMode = false, onSetCaptain,
}: {
  slot: Slot; player: ClientPoolPlayer | null; isCaptain: boolean; isVice: boolean; size: number; delayMs: number;
  onFix: () => void; duplicate?: boolean; captainMode?: boolean; onSetCaptain?: () => void;
}) {
  // A duplicate (two slots resolved to the same player) is a wrong match, so it
  // needs fixing too — otherwise it would be a locked, unfixable dead end.
  const needsCheck = slot.confidence === "low" || slot.id === null || duplicate;
  const note = flagNote(slot.flags);
  const name = player?.name ?? slot.extracted.surname;
  const label = player ? surname(player.name) : slot.extracted.surname;
  const club = player?.club ?? slot.extracted.club;
  const pos = resolvedPos(slot, player);
  const avatarUrl = player?.avatarUrl ?? (player ? faceFor(player.name) : undefined) ?? null;

  const marker = (
    <PlayerMarker name={name} label={label} avatarUrl={avatarUrl} club={club} size={size}
      isCaptain={isCaptain} isVice={isVice} pos={pos}
      flagged={needsCheck} doubt={needsCheck ? (note ?? "Tap to pick who this is") : undefined} />
  );
  if (needsCheck) {
    return (
      <button type="button" onClick={onFix} className="rate-marker-in"
        aria-label={`${name}: we could not match this one. Tap to pick the right player.`}
        style={{
          flex: "1 1 0", minWidth: 0, maxWidth: 72, background: "none", cursor: "pointer",
          padding: 2, borderRadius: 12, border: "none", "--stagger-delay": `${delayMs}ms`,
        } as CSSProperties}>
        {marker}
      </button>
    );
  }
  // Captain-selection mode: no captain was read, so a matched starter becomes
  // tappable (teal cue) to make them captain. Otherwise a matched pick is static.
  if (captainMode && onSetCaptain) {
    return (
      <button type="button" onClick={onSetCaptain} className="rate-marker-in"
        aria-label={`${name}: tap to make captain.`}
        style={{
          flex: "1 1 0", minWidth: 0, maxWidth: 72, background: "none", cursor: "pointer",
          padding: 2, borderRadius: 12, border: "none", outlineOffset: 1,
          outline: `1.5px solid ${tint(TEAL, "aa")}`, "--stagger-delay": `${delayMs}ms`,
        } as CSSProperties}>
        {marker}
      </button>
    );
  }
  return (
    <div className="rate-marker-in" style={{ flex: "1 1 0", minWidth: 0, maxWidth: 72, padding: 2, "--stagger-delay": `${delayMs}ms` } as CSSProperties}>
      {marker}
    </div>
  );
}

function BenchMarker({ slot, player, size, delayMs, onFix, duplicate = false }: {
  slot: Slot; player: ClientPoolPlayer | null; size: number; delayMs: number; onFix: () => void; duplicate?: boolean;
}) {
  const needsCheck = slot.confidence === "low" || slot.id === null || duplicate;
  const note = flagNote(slot.flags);
  const name = player?.name ?? slot.extracted.surname;
  const label = player ? surname(player.name) : slot.extracted.surname;
  const club = player?.club ?? slot.extracted.club;
  const pos = resolvedPos(slot, player);
  const avatarUrl = player?.avatarUrl ?? (player ? faceFor(player.name) : undefined) ?? null;

  const marker = (
    <PlayerMarker name={name} label={label} avatarUrl={avatarUrl} club={club} size={size} pos={pos}
      flagged={needsCheck} doubt={needsCheck ? (note ?? "Tap to pick who this is") : undefined} dim />
  );
  if (!needsCheck) {
    return (
      <div className="rate-marker-in" style={{ padding: 2, "--stagger-delay": `${delayMs}ms` } as CSSProperties}>{marker}</div>
    );
  }
  return (
    <button type="button" onClick={onFix} className="rate-marker-in"
      aria-label={`${name}: we could not match this one. Tap to pick the right player.`}
      style={{ background: "none", cursor: "pointer", padding: 2, borderRadius: 12, border: "none", "--stagger-delay": `${delayMs}ms` } as CSSProperties}>
      {marker}
    </button>
  );
}

/** The replacement picker — a searchable list of the pool, defaulting to the
 *  position the screenshot read for this slot. */
function PickerSheet({ pool, defaultPos, onClose, onPick }: {
  pool: ClientPoolPlayer[]; defaultPos: string; onClose: () => void; onPick: (p: ClientPoolPlayer) => void;
}) {
  const [q, setQ] = useState("");
  const [posOnly, setPosOnly] = useState(true);
  const needle = q.trim().toLowerCase();
  const listed = pool
    .filter((p) => !posOnly || p.pos === defaultPos)
    .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.club.toLowerCase().includes(needle))
    .slice(0, 40);

  return (
    <Sheet onClose={onClose} labelledBy="rate-picker-title">
      <div id="rate-picker-title" style={{ fontSize: 15, fontWeight: 700, color: INK, marginBottom: 10 }}>Pick a player</div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or club"
        className="font-body" style={{
          width: "100%", padding: "10px 12px", borderRadius: 10, marginBottom: 8,
          background: "rgba(255,255,255,0.04)", border: `1px solid ${LINE}`, color: INK, fontSize: 14,
        }} />
      <button onClick={() => setPosOnly((v) => !v)} style={{
        fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 999, cursor: "pointer", marginBottom: 10,
        border: `1px solid ${posOnly ? tint(TEAL, "55") : LINE}`, background: posOnly ? tint(TEAL, "14") : "transparent",
        color: posOnly ? TEAL : MUTED,
      }}>
        {posOnly ? `${defaultPos} only` : "All positions"}
      </button>
      <div style={{ display: "grid", gap: 6, maxHeight: "50dvh", overflowY: "auto" }}>
        {listed.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
            background: "transparent", border: `1px solid ${LINE}`, borderRadius: 10, padding: 8,
          }}>
            <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl ?? faceFor(p.name)} size={30} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 11, color: MUTED }}>{p.club}</div>
            </div>
            <PosTag pos={p.pos} />
          </button>
        ))}
        {!listed.length && <div style={{ fontSize: 12.5, color: MUTED, padding: 10 }}>No one matches that search.</div>}
      </div>
    </Sheet>
  );
}

export default function RateFromScreenshotPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [err, setErr] = useState<string | null>(null);
  const [pool, setPool] = useState<ClientPoolPlayer[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [viceId, setViceId] = useState<number | null>(null);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  // The persisted share id — once the grade lands it's created server-side and
  // the flow redirects to /r/[id], the single end page for a Scout analysis.
  const [shareId, setShareId] = useState<string | null>(null);
  const [introDone, setIntroDone] = useState(false);
  // Defaults to "out". Only used now to tag the funnel-tracking calls with auth
  // context (the save CTA moved to /r/[id]), so the default just needs to be safe
  // while the check is in flight — "out" is the common case for this surface.
  const [authState, setAuthState] = useState<AuthState>("out");
  // Cancels a "reading" fetch that's still in flight when the viewer backs
  // out — the request isn't aborted, but its result is ignored so it can't
  // yank them into "confirm" after they've already left.
  const cancelledReadRef = useRef(false);

  const poolById = useCallback((id: number | null) => pool.find((p) => p.id === id) ?? null, [pool]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fantasy/state");
        if (!res.ok) { if (!cancelled) setAuthState("out"); return; }
        const json = await res.json().catch(() => null) as { squad?: unknown } | null;
        if (cancelled) return;
        setAuthState(json?.squad ? "in-with-squad" : "in-no-squad");
      } catch {
        if (!cancelled) setAuthState("out");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleFile = async (file: File) => {
    cancelledReadRef.current = false;
    setErr(null);
    setStep("reading");
    trackRatePhotoStarted({ auth: authState }); // top-of-funnel: a screenshot was picked
    try {
      const [{ base64, mediaType }, poolRes] = await Promise.all([
        downscaleToJpeg(file),
        pool.length ? Promise.resolve(null) : fetch("/api/fantasy/pool").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (poolRes) setPool((poolRes as { players: ClientPoolPlayer[] }).players);

      const res = await fetch("/api/fantasy/rate-photo", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't read that screenshot. Try again.");
      if (cancelledReadRef.current) return;

      const readSlots = json.slots as Slot[];
      setSlots(readSlots);
      const cap = readSlots.find((s) => s.isCaptain && s.id !== null);
      const vice = readSlots.find((s) => s.isVice && s.id !== null);
      setCaptainId(cap?.id ?? null);
      setViceId(vice?.id ?? null);
      // The Scout read a full XI back — the tool worked. `needs_check` is how
      // many picks came back low-confidence, so we can see read quality by cohort.
      trackSquadExtracted({
        auth: authState,
        needs_check: readSlots.filter((s) => s.confidence === "low" || s.id === null).length,
      });
      setStep("confirm");
    } catch (e) {
      if (cancelledReadRef.current) return;
      setErr(e instanceof Error ? e.message : "Couldn't read that screenshot. Try again.");
      setStep("upload");
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  };

  const setSlotAt = (i: number, next: Slot) => setSlots((s) => s.map((x, j) => (j === i ? next : x)));

  const xiSlots = slots.filter((s) => !s.isBench);
  const benchSlots = slots.filter((s) => s.isBench);
  const allIds = slots.map((s) => s.id).filter((id): id is number => id !== null);
  const uniqueIds = new Set(allIds);
  // Ids that landed in more than one slot — every slot holding one is a wrong
  // match to flag (circle + make tappable), same as an unmatched pick.
  const dupIdSet = new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i));
  const isDup = (id: number | null): boolean => id !== null && dupIdSet.has(id);
  const captainInXi = captainId !== null && xiSlots.some((s) => s.id === captainId);
  const squadReady = slots.length === 15 && allIds.length === 15 && uniqueIds.size === 15
    && xiSlots.length === 11 && benchSlots.length === 4;
  const canContinue = squadReady && captainInXi;
  // Everything matched but no captain was read — let the viewer tap one on the
  // pitch. Without this the flow could ask for a captain with no way to set it.
  const needsCaptain = squadReady && !captainInXi;
  const needsCheckCount = slots.filter((s) => s.confidence === "low" || s.id === null || isDup(s.id)).length;

  const submitForRating = async () => {
    if (!canContinue || captainId === null) return;
    setStep("rating");
    setIntroDone(false);
    setShareId(null);
    setErr(null);
    try {
      // Grade AND persist server-side, so the result is a real, shareable
      // snapshot at /r/[id] — the same page the bot posts. Returns just the id.
      const res = await fetch("/api/fantasy/rate-share", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: allIds, xi: xiSlots.map((s) => s.id), bench: benchSlots.map((s) => s.id),
          captain: captainId, vice: viceId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.id !== "string") {
        throw new Error(json.error ?? "Couldn't rate that squad. Try again.");
      }
      setShareId(json.id);
      // The payoff: a grade exists. Fires once per successful rating (re-fires
      // for a re-rate); the /r/[id] view fires its own share-tagged twin.
      trackSquadRated({ auth: authState, source: "upload" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't rate that squad. Try again.");
      setStep("confirm");
    }
  };

  // Land on /r/[id] once BOTH the three-card beat is finished and the grade has
  // been persisted — whichever comes last. If the POST beat the user to the end
  // of the cards, this redirects the instant they finish; if the cards beat the
  // POST, the ScoutScanState grading beat below holds the screen for the gap.
  useEffect(() => {
    if (step === "rating" && introDone && shareId) router.push(`/r/${shareId}`);
  }, [step, introDone, shareId, router]);

  /** Step-aware back control, shown top-left on every step. Never a dead
   *  end: "upload" is the front door, so backing out of it leaves the
   *  flow entirely instead of looping in place. */
  const goBack = () => {
    if (step === "rating") { setStep("confirm"); return; }
    if (step === "confirm") { setErr(null); setStep("upload"); return; }
    if (step === "reading") { cancelledReadRef.current = true; setErr(null); setStep("upload"); return; }
    router.push("/fantasy");
  };

  const xiRows = buildXiRows(slots, poolById);
  const staggerDelays = buildStaggerDelays(slots, poolById);

  return (
    <>
      <main data-fantasy style={page}>
        <Header exit={{ label: "Back", onClick: goBack }} />

        {step === "upload" && (
          <>
            <input ref={fileInput} type="file" accept="image/*" onChange={onFilePicked} style={{ display: "none" }} />

            {/* ── hero ── */}
            <div className="rounded-2xl" style={{
              padding: 20, marginBottom: 22, position: "relative", overflow: "hidden",
              background: `linear-gradient(160deg, ${tint(TEAL, "22")}, ${PANEL} 65%)`,
              border: `1px solid ${tint(TEAL, "44")}`,
            }}>
              <span className="font-body rounded-full" style={{
                display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                padding: "5px 12px", marginBottom: 14,
                background: tint(GOLD, "1e"), border: `1px solid ${tint(GOLD, "55")}`, color: GOLD,
              }}>
                FANTASY PL IS LIVE ON YOURSCORE
              </span>
              <div className="font-display" style={{ fontSize: 36, color: INK, lineHeight: 1.02, marginBottom: 10 }}>
                Rate your FPL team
              </div>
              <p style={{ fontSize: 14, color: MUTED, margin: "0 0 18px", lineHeight: 1.55, maxWidth: 420 }}>
                Upload one screenshot and the YourScore Scout scores it out of 10 in seconds, with your strengths, your weak spots and the one move worth making.
              </p>
              <Btn gold glow onClick={() => fileInput.current?.click()}>Upload your screenshot</Btn>
              <p style={{ fontSize: 11.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.5 }}>
                Free. We only read your team from the image, and it is never saved.
              </p>
            </div>

            {err && <div style={{ marginBottom: 20 }}><ErrorState message={err} /></div>}

            {/* ── the payoff preview ── */}
            <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
              HERE IS WHAT YOU GET BACK
            </div>
            <Card style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <span className="font-body" style={{
                  fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
                  border: `1px solid ${tint(TEAL, "55")}`, background: tint(TEAL, "14"), color: TEAL,
                }}>This month</span>
                <span className="font-body" style={{
                  fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 999,
                  border: `1px solid ${LINE}`, color: MUTED,
                }}>Season</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                <span className="font-display" style={{ fontSize: 44, lineHeight: 1, color: scoreColor(SAMPLE_SCORE) }}>
                  {SAMPLE_SCORE.toFixed(1)}
                </span>
                <span className="font-body" style={{ fontSize: 12.5, color: MUTED }}>out of 10</span>
              </div>
              <p style={{ fontSize: 14, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>{SAMPLE_VERDICT}</p>
              <BandGroups bands={SAMPLE_BANDS} />
              <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6, marginTop: 4 }}>
                WORTH A LOOK
              </div>
              <p style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: 0 }}>{SAMPLE_MOVE_LINE}</p>
            </Card>

            {/* ── why it's worth it ── */}
            <div className="font-display tracking-widest" style={{ fontSize: 12, color: "#586058", marginBottom: 8 }}>
              WHY IT IS WORTH A LOOK
            </div>
            <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
              {[
                { accent: TEAL, title: "Graded by the Scout", body: "A real read on your XI, not a guess." },
                { accent: GOLD, title: "Monthly prizes", body: "Top the monthly table and you win." },
                { accent: LIME, title: "League chats", body: "Start a league and the group chat runs all season." },
              ].map((hook) => (
                <div key={hook.title} className="rounded-2xl" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "13px 14px",
                  background: PANEL, border: `1px solid ${LINE}`,
                }}>
                  <span aria-hidden style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                    background: tint(hook.accent, "1e"), border: `1px solid ${tint(hook.accent, "55")}`,
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 2 }}>{hook.title}</div>
                    <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.4 }}>{hook.body}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── closing CTA ── */}
            <Btn gold onClick={() => fileInput.current?.click()}>Upload your screenshot</Btn>
            <p style={{ fontSize: 11.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.5, textAlign: "center" }}>
              Free. We only read your team from the image, and it is never saved.
            </p>
          </>
        )}

        {step === "reading" && (
          <ScoutScanState
            heading="The Scout is reading your team"
            subline="Matching each name on your screenshot to the real Premier League squad." />
        )}

        {step === "confirm" && (
          <>
            <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 4 }}>Is this your team?</div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              This is the team we read from your screenshot.
            </p>

            {needsCheckCount > 0 && (
              <p style={{ fontSize: 12, color: CORAL, margin: "0 0 10px", lineHeight: 1.5 }}>
                {needsCheckCount} pick{needsCheckCount === 1 ? "" : "s"} we could not match {needsCheckCount === 1 ? "is" : "are"} circled in red. Tap {needsCheckCount === 1 ? "it" : "each one"} to pick who it is.
              </p>
            )}

            <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, display: "flex", alignItems: "stretch", overflow: "hidden", marginBottom: 16 }}>
              <PitchSurface round="left">
                {xiRows.map((row) => row.entries.length > 0 && (
                  <div key={row.pos} style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                    {row.entries.map(({ slot, index }) => (
                      <XiMarker key={index} slot={slot} player={poolById(slot.id)}
                        isCaptain={slot.id !== null && slot.id === captainId}
                        isVice={slot.id !== null && slot.id === viceId}
                        size={row.entries.length >= 5 ? 26 : row.entries.length >= 4 ? 30 : 36}
                        delayMs={staggerDelays[index] ?? 0}
                        duplicate={isDup(slot.id)}
                        captainMode={needsCaptain}
                        onSetCaptain={() => { if (slot.id !== null) setCaptainId(slot.id); }}
                        onFix={() => setPickingIndex(index)} />
                    ))}
                  </div>
                ))}
              </PitchSurface>
              <BenchStrip>
                {slots.map((slot, index) => slot.isBench && (
                  <BenchMarker key={index} slot={slot} player={poolById(slot.id)} size={26} delayMs={staggerDelays[index] ?? 0}
                    duplicate={isDup(slot.id)}
                    onFix={() => setPickingIndex(index)} />
                ))}
              </BenchStrip>
            </div>

            {err && <div style={{ marginBottom: 12 }}><ErrorState message={err} /></div>}

            {!canContinue && (() => {
              // Name the exact picks that block grading rather than a vague
              // "every slot needs a player" — an unmatched name (id null) or the
              // same player picked twice is otherwise invisible to hunt for.
              const unresolved = slots.filter((s) => s.id === null).map((s) => s.extracted.surname || "one pick");
              const dupIds = Array.from(new Set(allIds.filter((id, i) => allIds.indexOf(id) !== i)));
              const dupNames = dupIds.map((id) => poolById(id)?.name ?? "a pick");
              const msg = unresolved.length
                ? `We could not match ${listNames(unresolved)}. Tap ${unresolved.length === 1 ? "the circled player" : "each circled player"} to pick who it is.`
                : dupNames.length
                ? `${listNames(dupNames)} ${dupNames.length === 1 ? "is" : "are"} picked twice. Tap ${dupNames.length === 1 ? "it" : "one"} to pick who it is.`
                : xiSlots.length !== 11 || benchSlots.length !== 4
                ? "You need exactly eleven starters and four on the bench."
                : "No captain was on your screenshot. Tap a player in your eleven to make them captain.";
              return <p style={{ fontSize: 12, color: CORAL, margin: "0 0 10px", lineHeight: 1.5 }}>{msg}</p>;
            })()}
            <Btn gold disabled={!canContinue} onClick={submitForRating}>Grade my team</Btn>

            {pickingIndex !== null && (
              <PickerSheet pool={pool} defaultPos={slots[pickingIndex].extracted.position}
                onClose={() => setPickingIndex(null)}
                onPick={(p) => {
                  setSlotAt(pickingIndex, {
                    ...slots[pickingIndex], id: p.id, confidence: "high", flags: [],
                  });
                  setPickingIndex(null);
                }} />
            )}
          </>
        )}

        {step === "rating" && (
          !introDone
            ? <RateIntroCards onDone={() => setIntroDone(true)} />
            : !shareId
            ? <ScoutScanState
                heading="The Scout is grading your team"
                subline="Weighing projections, fixtures and who is actually fit." />
            : null
        )}

      </main>
      <BottomNav />
    </>
  );
}
