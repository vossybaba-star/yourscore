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
  Sheet, TEAL, CORAL, page, tint, type ClientPoolPlayer, type Pos,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { PlayerMarker } from "@/components/fantasy/PlayerMarker";
import { PitchSurface } from "@/components/fantasy/board/PitchSurface";
import { BenchStrip } from "@/components/fantasy/board/BenchStrip";
import { RateIntroCards } from "@/components/fantasy/RateIntroCards";
import { BottomNav } from "@/components/ui/BottomNav";
import { faceFor } from "@/lib/fantasy/faces";
import { BandGroups, scoreColor, type RatingBandsShape } from "@/components/fantasy/RatingBands";
import type { Slot } from "@/lib/fantasy/screenshotMatch";

const DRAFT_KEY = "ys-fantasy-draft";
const MAX_EDGE = 1600;

interface RatingResult {
  score: number; verdict: string; bands: RatingBandsShape; moveLine: string;
}

type Step = "upload" | "reading" | "confirm" | "rating" | "result";

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

/** The Scout's branded wait state — a real pitch with a calm teal sweep, not
 *  a spinner. Used both while the vision call reads the screenshot and, if
 *  it's still running once the intro cards finish, for the brief grading
 *  beat before the result reveals. Respects prefers-reduced-motion via the
 *  .scout-scan-sweep class in globals.css (animation dropped, sweep stays
 *  put at a fixed opacity). */
function ScoutScanState({ heading, subline }: { heading: string; subline: string }) {
  return (
    <div className="rounded-2xl" style={{ border: `1px solid ${LINE}`, overflow: "hidden" }}>
      <PitchSurface>
        <div aria-hidden className="scout-scan-sweep" style={{
          position: "absolute", left: "8%", right: "8%", height: "18%", borderRadius: 10,
          background: `linear-gradient(180deg, transparent, ${tint(TEAL, "40")}, transparent)`,
        }} />
      </PitchSurface>
      <div style={{ padding: 16, background: PANEL }}>
        <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 6 }}>{heading}</div>
        <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>{subline}</p>
      </div>
    </div>
  );
}

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

function XiMarker({
  slot, player, isCaptain, isVice, size, delayMs, selected, onSelect,
}: {
  slot: Slot; player: ClientPoolPlayer | null; isCaptain: boolean; isVice: boolean; size: number; delayMs: number;
  selected: boolean; onSelect: () => void;
}) {
  const needsCheck = slot.confidence === "low" || slot.id === null;
  const note = flagNote(slot.flags);
  const name = player?.name ?? slot.extracted.surname;
  const label = player ? surname(player.name) : slot.extracted.surname;
  const club = player?.club ?? slot.extracted.club;
  const pos = resolvedPos(slot, player);
  const avatarUrl = player?.avatarUrl ?? (player ? faceFor(player.name) : undefined) ?? null;

  // Just the face and name on the pitch — clean. The captain, vice, bench and
  // change controls live in the action bar below, shown only for the tapped
  // player, so eleven sets of buttons never crowd the pitch at once.
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="rate-marker-in"
      aria-label={`${name}${needsCheck ? `. ${note ?? "Check this pick"}` : ""}. Tap for options`}
      style={{
        flex: "1 1 0", minWidth: 0, maxWidth: 72, background: "none", cursor: "pointer",
        padding: 2, borderRadius: 12, "--stagger-delay": `${delayMs}ms`, outlineOffset: 1,
        border: "none", outline: `1.5px solid ${selected ? tint(TEAL, "cc") : "transparent"}`,
      } as CSSProperties}>
      <PlayerMarker name={name} label={label} avatarUrl={avatarUrl} club={club} size={size}
        isCaptain={isCaptain} isVice={isVice} pos={pos} doubt={needsCheck ? (note ?? "Check this pick") : undefined} />
    </button>
  );
}

function BenchMarker({ slot, player, size, delayMs, selected, onSelect }: {
  slot: Slot; player: ClientPoolPlayer | null; size: number; delayMs: number;
  selected: boolean; onSelect: () => void;
}) {
  const needsCheck = slot.confidence === "low" || slot.id === null;
  const note = flagNote(slot.flags);
  const name = player?.name ?? slot.extracted.surname;
  const label = player ? surname(player.name) : slot.extracted.surname;
  const club = player?.club ?? slot.extracted.club;
  const pos = resolvedPos(slot, player);
  const avatarUrl = player?.avatarUrl ?? (player ? faceFor(player.name) : undefined) ?? null;

  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="rate-marker-in"
      aria-label={`${name}${needsCheck ? `. ${note ?? "Check this pick"}` : ""}. Tap for options`}
      style={{
        background: "none", cursor: "pointer", padding: 2, borderRadius: 12, "--stagger-delay": `${delayMs}ms`,
        outlineOffset: 1, border: "none", outline: `1.5px solid ${selected ? tint(TEAL, "cc") : "transparent"}`,
      } as CSSProperties}>
      <PlayerMarker name={name} label={label} avatarUrl={avatarUrl} club={club} size={size} pos={pos}
        doubt={needsCheck ? (note ?? "Check this pick") : undefined} dim />
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [result, setResult] = useState<RatingResult | null>(null);
  const [introDone, setIntroDone] = useState(false);

  const poolById = useCallback((id: number | null) => pool.find((p) => p.id === id) ?? null, [pool]);

  const handleFile = async (file: File) => {
    setErr(null);
    setStep("reading");
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

      const readSlots = json.slots as Slot[];
      setSlots(readSlots);
      const cap = readSlots.find((s) => s.isCaptain && s.id !== null);
      const vice = readSlots.find((s) => s.isVice && s.id !== null);
      setCaptainId(cap?.id ?? null);
      setViceId(vice?.id ?? null);
      setStep("confirm");
    } catch (e) {
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
  const captainInXi = captainId !== null && xiSlots.some((s) => s.id === captainId);
  const canContinue = slots.length === 15 && allIds.length === 15 && uniqueIds.size === 15
    && xiSlots.length === 11 && benchSlots.length === 4 && captainInXi;
  const needsCheckCount = slots.filter((s) => s.confidence === "low" || s.id === null).length;

  const submitForRating = async () => {
    if (!canContinue || captainId === null) return;
    setStep("rating");
    setIntroDone(false);
    setResult(null);
    setErr(null);
    try {
      const res = await fetch("/api/fantasy/rate-guest", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: allIds, xi: xiSlots.map((s) => s.id), bench: benchSlots.map((s) => s.id), captain: captainId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't rate that squad. Try again.");
      setResult(json as RatingResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't rate that squad. Try again.");
      setStep("confirm");
    }
  };

  // The result only reveals once BOTH the three-card beat is finished and
  // the rating has actually landed — whichever comes last. If the POST beat
  // the user to the end of the cards, this fires the instant they finish
  // and nothing else renders in between; if the cards beat the POST, the
  // ScoutScanState grading beat below holds the screen for the gap.
  useEffect(() => {
    if (step === "rating" && introDone && result) setStep("result");
  }, [step, introDone, result]);

  const saveAndSignIn = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(allIds)); } catch { /* private mode */ }
    router.push("/auth/sign-in?next=/fantasy/build");
  };

  const xiRows = buildXiRows(slots, poolById);
  const staggerDelays = buildStaggerDelays(slots, poolById);

  return (
    <>
      <main data-fantasy style={page}>
        <Header />

        {step === "upload" && (
          <>
            <Card>
              <div className="font-display" style={{ fontSize: 22, color: INK, lineHeight: 1.1, marginBottom: 6 }}>
                Rate your FPL team
              </div>
              <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
                Upload a screenshot of your Pick Team screen and the Scout will grade it, the same way he grades every YourScore squad. No account needed to see your score.
              </p>
              <input ref={fileInput} type="file" accept="image/*" onChange={onFilePicked} style={{ display: "none" }} />
              <Btn gold onClick={() => fileInput.current?.click()}>Upload your screenshot</Btn>
              <p style={{ fontSize: 11.5, color: MUTED, margin: "10px 0 0", lineHeight: 1.5 }}>
                We only look at it to read your team. It is never saved.
              </p>
            </Card>
            {err && <div style={{ marginTop: 12 }}><ErrorState message={err} /></div>}
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
              Tap a player to change them, set your captain or move them to the bench.
            </p>

            {needsCheckCount > 0 && (
              <p style={{ fontSize: 12, color: CORAL, margin: "0 0 10px", lineHeight: 1.5 }}>
                {needsCheckCount} pick{needsCheckCount === 1 ? "" : "s"} need a check. Tap the marker to fix it.
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
                        selected={selectedIndex === index}
                        onSelect={() => setSelectedIndex(selectedIndex === index ? null : index)} />
                    ))}
                  </div>
                ))}
              </PitchSurface>
              <BenchStrip>
                {slots.map((slot, index) => slot.isBench && (
                  <BenchMarker key={index} slot={slot} player={poolById(slot.id)} size={26} delayMs={staggerDelays[index] ?? 0}
                    selected={selectedIndex === index}
                    onSelect={() => setSelectedIndex(selectedIndex === index ? null : index)} />
                ))}
              </BenchStrip>
            </div>

            {/* Action bar for the tapped player — keeps the pitch clean by
                showing captain/vice/bench/change for ONE marker at a time. */}
            {selectedIndex !== null && slots[selectedIndex] && (() => {
              const s = slots[selectedIndex];
              const p = poolById(s.id);
              const nm = p ? p.name : (s.extracted.surname || "This pick");
              const chip = (text: string, onClick: () => void, active = false) => (
                <button type="button" onClick={onClick} style={{
                  fontSize: 12, fontWeight: 700, padding: "7px 12px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${active ? TEAL : LINE}`, background: active ? tint(TEAL, "1e") : "transparent",
                  color: active ? TEAL : INK,
                }}>{text}</button>
              );
              return (
                <div style={{
                  display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "10px 12px", marginBottom: 12,
                  background: PANEL, border: `1px solid ${tint(TEAL, "55")}`, borderRadius: 12,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK, marginRight: "auto" }}>{nm}</span>
                  {!s.isBench && chip("Captain", () => { if (s.id !== null) setCaptainId(s.id); }, s.id !== null && s.id === captainId)}
                  {!s.isBench && chip("Vice", () => { if (s.id !== null) setViceId(s.id); }, s.id !== null && s.id === viceId)}
                  {!s.isBench && chip("Bench", () => { setSlotAt(selectedIndex, { ...s, isBench: true }); setSelectedIndex(null); })}
                  {s.isBench && chip("Start", () => { setSlotAt(selectedIndex, { ...s, isBench: false }); setSelectedIndex(null); })}
                  {chip("Change", () => setPickingIndex(selectedIndex))}
                </div>
              );
            })()}

            {err && <div style={{ marginBottom: 12 }}><ErrorState message={err} /></div>}

            {!canContinue && (
              <p style={{ fontSize: 12, color: CORAL, margin: "0 0 10px", lineHeight: 1.5 }}>
                {allIds.length < 15 || uniqueIds.size < 15
                  ? "Every slot needs a player before you can carry on."
                  : xiSlots.length !== 11 || benchSlots.length !== 4
                  ? "You need exactly eleven starters and four on the bench."
                  : "Pick a captain from your starting eleven."}
              </p>
            )}
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
            : !result
            ? <ScoutScanState
                heading="The Scout is grading your team"
                subline="Weighing projections, fixtures and who is actually fit." />
            : null
        )}

        {step === "result" && result && (
          <>
            <div className="rate-result-in">
              <Card>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                  <span className="font-display" style={{ fontSize: 44, lineHeight: 1, color: scoreColor(result.score) }}>
                    {result.score.toFixed(1)}
                  </span>
                  <span className="font-body" style={{ fontSize: 12.5, color: MUTED }}>out of 10</span>
                </div>
                <p style={{ fontSize: 14, color: INK, lineHeight: 1.5, margin: "0 0 12px" }}>{result.verdict}</p>
                <BandGroups bands={result.bands} />
                <div style={{ fontSize: 10.5, letterSpacing: "0.08em", color: "#586058", marginBottom: 6, marginTop: 4 }}>
                  WORTH A LOOK
                </div>
                <p style={{ fontSize: 13, color: INK, lineHeight: 1.5, margin: 0 }}>{result.moveLine}</p>
              </Card>
            </div>

            <div style={{ marginTop: 14, borderRadius: 16, padding: 18, background: `linear-gradient(150deg, ${tint(TEAL, "22")}, ${PANEL})`, border: `1px solid ${tint(TEAL, "55")}` }}>
              <div className="font-display" style={{ fontSize: 19, color: INK, lineHeight: 1.15, marginBottom: 6 }}>
                Save this team
              </div>
              <p style={{ fontSize: 13, color: MUTED, margin: "0 0 14px", lineHeight: 1.5 }}>
                Create your free YourScore account and this exact team will be waiting for you when the season opens. One transfer a gameweek, and what you know earns you more.
              </p>
              <Btn gold onClick={saveAndSignIn}>Create your account and save it</Btn>
            </div>
          </>
        )}
      </main>
      <BottomNav />
    </>
  );
}
