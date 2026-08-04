"use client";
/**
 * /fantasy/rate — rate an FPL team from a screenshot, no account needed.
 *
 * Upload a "Pick Team" screenshot -> we read it and match it against our pool
 * -> confirm the XI (fix anything we misread) -> the Scout grades it, same
 * score/bands a signed-in manager gets -> save it, which is where an account
 * comes in. Screenshot only, four steps, no dead ends.
 *
 * The image never leaves this component except in the one POST to
 * /api/fantasy/rate-photo — it isn't kept in any longer-lived state, isn't
 * written anywhere, and the response never echoes it back.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Btn, Card, Crest, ErrorState, Header, INK, LINE, MUTED, PANEL, PosTag,
  Sheet, TEAL, CORAL, GOLD, page, tint, type ClientPoolPlayer,
} from "@/components/fantasy/shared";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
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

/** One confirm-screen row: a resolved or unresolved slot, with a way to fix
 *  either. Low-confidence and unresolved slots get a coral outline so they
 *  stand out from the ones we're sure about. */
function SlotRow({
  slot, player, isCaptain, isVice, onPick, onSetCaptain, onSetVice, onToggleBench,
}: {
  slot: Slot; player: ClientPoolPlayer | null; isCaptain: boolean; isVice: boolean;
  onPick: () => void; onSetCaptain: () => void; onSetVice: () => void; onToggleBench: () => void;
}) {
  const needsCheck = slot.confidence === "low" || slot.id === null;
  const note = flagNote(slot.flags);
  const name = player?.name ?? slot.extracted.surname;
  const club = player?.club ?? slot.extracted.club;
  const pos = player?.pos ?? slot.extracted.position;
  const avatarUrl = player?.avatarUrl ?? (player ? faceFor(player.name) : undefined) ?? null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12,
      background: PANEL, border: `1px solid ${needsCheck ? tint(CORAL, "66") : LINE}`,
    }}>
      <PlayerAvatar name={name} avatarUrl={avatarUrl} size={38} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: slot.id ? INK : CORAL, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {name}
          </span>
          <PosTag pos={pos} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
          <Crest club={club} size={14} />
          <span style={{ fontSize: 11.5, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{club}</span>
        </div>
        {note && <div style={{ fontSize: 11, color: CORAL, marginTop: 3 }}>{note}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={onSetCaptain} aria-pressed={isCaptain}
            style={{
              width: 22, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 800, cursor: "pointer",
              border: `1px solid ${isCaptain ? GOLD : LINE}`, background: isCaptain ? tint(GOLD, "26") : "transparent",
              color: isCaptain ? GOLD : MUTED,
            }}>C</button>
          <button onClick={onSetVice} aria-pressed={isVice}
            style={{
              width: 22, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 800, cursor: "pointer",
              border: `1px solid ${isVice ? TEAL : LINE}`, background: isVice ? tint(TEAL, "26") : "transparent",
              color: isVice ? TEAL : MUTED,
            }}>V</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onToggleBench} style={{ background: "none", border: "none", color: MUTED, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {slot.isBench ? "Move to XI" : "Bench"}
          </button>
          <button onClick={onPick} style={{ background: "none", border: "none", color: TEAL, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>
            Change
          </button>
        </div>
      </div>
    </div>
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
  const [result, setResult] = useState<RatingResult | null>(null);

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

  const submitForRating = async () => {
    if (!canContinue || captainId === null) return;
    setStep("rating");
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
      setStep("result");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't rate that squad. Try again.");
      setStep("confirm");
    }
  };

  const saveAndSignIn = () => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(allIds)); } catch { /* private mode */ }
    router.push("/auth/sign-in?next=/fantasy/build");
  };

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
          <Card>
            <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 6 }}>Reading your team</div>
            <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>Give us a moment, friend.</p>
          </Card>
        )}

        {step === "confirm" && (
          <>
            <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 4 }}>Is this your team?</div>
            <p style={{ fontSize: 12.5, color: MUTED, margin: "0 0 12px", lineHeight: 1.5 }}>
              Fix anything we got wrong, set your captain and vice, then carry on.
            </p>

            <div style={{ fontSize: 11.5, letterSpacing: "0.08em", color: MUTED, fontWeight: 700, margin: "10px 2px 6px" }}>
              STARTING XI ({xiSlots.length}/11)
            </div>
            <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
              {slots.map((slot, i) => !slot.isBench && (
                <SlotRow key={i} slot={slot} player={poolById(slot.id)}
                  isCaptain={slot.id !== null && slot.id === captainId}
                  isVice={slot.id !== null && slot.id === viceId}
                  onPick={() => setPickingIndex(i)}
                  onSetCaptain={() => slot.id !== null && setCaptainId(slot.id)}
                  onSetVice={() => slot.id !== null && setViceId(slot.id)}
                  onToggleBench={() => setSlotAt(i, { ...slot, isBench: true })} />
              ))}
            </div>

            <div style={{ fontSize: 11.5, letterSpacing: "0.08em", color: MUTED, fontWeight: 700, margin: "10px 2px 6px" }}>
              BENCH ({benchSlots.length}/4)
            </div>
            <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
              {slots.map((slot, i) => slot.isBench && (
                <SlotRow key={i} slot={slot} player={poolById(slot.id)}
                  isCaptain={false} isVice={false}
                  onPick={() => setPickingIndex(i)}
                  onSetCaptain={() => {}} onSetVice={() => {}}
                  onToggleBench={() => setSlotAt(i, { ...slot, isBench: false })} />
              ))}
            </div>

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
          <Card>
            <div className="font-display" style={{ fontSize: 18, color: INK, marginBottom: 6 }}>Grading your team</div>
            <p style={{ fontSize: 13, color: MUTED, margin: 0, lineHeight: 1.5 }}>The Scout is having a look.</p>
          </Card>
        )}

        {step === "result" && result && (
          <>
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
