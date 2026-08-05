"use client";
/**
 * The Social composer — write a post to the public Live feed, optionally with a
 * poll, up to four images, or one GIF (founder, 3 Aug — the feed needs somewhere
 * to argue, not just activity; Phase 2a, 5 Aug — media).
 * MVP posts to public Social; sharing into a league already lives on each post.
 *
 * Images and a GIF are mutually exclusive at this composer's level (picking one
 * hides the other's add button) — the server doesn't enforce that, but nothing
 * here can produce both. Each image uploads independently as soon as it's
 * picked, so one bad file never blocks the others; Post stays disabled while any
 * upload is still running.
 */
import { useRef, useState } from "react";
import { Btn, INK, LINE, MUTED, PANEL, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { uploadPostImage, PostImageError, MAX_POST_IMAGES } from "@/lib/postMedia";
import { GifPicker, type GifResult } from "@/components/fantasy/GifPicker";

interface ImageSlot { key: string; url: string | null; uploading: boolean; error: string | null }

export function CreatePostSheet({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [pollOn, setPollOn] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [slots, setSlots] = useState<ImageSlot[]>([]);
  const [gif, setGif] = useState<GifResult | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    setText(""); setPollOn(false); setQuestion(""); setOptions(["", ""]);
    setSlots([]); setGif(null); setGifPickerOpen(false); setErr(null);
  };
  const close = () => { reset(); onClose(); };

  const uploading = slots.some((s) => s.uploading);
  const images = slots.filter((s) => s.url).map((s) => s.url as string);

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const room = MAX_POST_IMAGES - slots.length;
    const files = picked.slice(0, Math.max(0, room));
    if (!files.length) return;
    setErr(null);
    const added: ImageSlot[] = files.map(() => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url: null, uploading: true, error: null }));
    setSlots((s) => [...s, ...added]);
    files.forEach((file, i) => {
      const key = added[i].key;
      uploadPostImage(file)
        .then((url) => setSlots((s) => s.map((sl) => (sl.key === key ? { ...sl, url, uploading: false } : sl))))
        .catch((er) => {
          const msg = er instanceof PostImageError ? er.message : "Upload failed. Try again.";
          setSlots((s) => s.map((sl) => (sl.key === key ? { ...sl, uploading: false, error: msg } : sl)));
        });
    });
  };
  const removeSlot = (key: string) => setSlots((s) => s.filter((sl) => sl.key !== key));
  const moveSlot = (idx: number, dir: -1 | 1) => setSlots((s) => {
    const j = idx + dir;
    if (j < 0 || j >= s.length) return s;
    const copy = [...s];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    return copy;
  });

  const setOpt = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOpt = () => setOptions((o) => (o.length < 4 ? [...o, ""] : o));
  const removeOpt = (i: number) => setOptions((o) => (o.length > 2 ? o.filter((_, j) => j !== i) : o));

  const pollValid = !!question.trim() && options.filter((o) => o.trim()).length >= 2;
  const canPost = !uploading && !busy && (text.trim().length > 0 || images.length > 0 || !!gif || (pollOn && pollValid));

  const submit = async () => {
    if (!canPost) return;
    setBusy(true); setErr(null);
    const body = {
      text: text.trim(),
      images: images.length ? images : undefined,
      gif: gif ? { mp4: gif.mp4, webp: gif.webp, gifUrl: gif.gifUrl, width: gif.width, height: gif.height } : undefined,
      poll: pollOn ? { question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean) } : undefined,
    };
    try {
      const r = await fetch("/api/fantasy/feed/post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't post");
      reset(); onPosted(); onClose();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 10,
    background: PANEL, border: `1px solid ${LINE}`, color: INK, outline: "none",
  };

  return (
    <Sheet onClose={close} labelledBy="create-post-title">
      <div id="create-post-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 10 }}>New post</div>

      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder="Share your FPL take" rows={4}
        style={{ ...input, resize: "none", lineHeight: 1.45 }} />

      <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFiles} style={{ display: "none" }} />

      {slots.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {slots.map((slot, i) => (
            <div key={slot.key} style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", border: `1px solid ${LINE}`, background: PANEL }}>
              {slot.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slot.url} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />
              )}
              {slot.uploading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.45)" }}>
                  <span aria-hidden style={{
                    width: 20, height: 20, borderRadius: 999, border: "2px solid rgba(255,255,255,0.35)",
                    borderTopColor: "#fff", display: "block", animation: "spin 0.8s linear infinite",
                  }} />
                </div>
              )}
              {slot.error && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: 4 }}>
                  <span style={{ color: "#E08A6B", fontSize: 9.5, textAlign: "center", lineHeight: 1.2 }}>{slot.error}</span>
                </div>
              )}
              <button onClick={() => removeSlot(slot.key)} aria-label="Remove image" style={{
                position: "absolute", top: 3, right: 3, width: 20, height: 20, borderRadius: 999,
                background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1,
              }}>×</button>
              {slots.length > 1 && (
                <div style={{ position: "absolute", bottom: 3, left: 3, right: 3, display: "flex", justifyContent: "space-between" }}>
                  <button onClick={() => moveSlot(i, -1)} disabled={i === 0} aria-label="Move left" style={{
                    width: 18, height: 18, borderRadius: 999, background: "rgba(0,0,0,0.65)", color: "#fff",
                    border: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.35 : 1, fontSize: 11, lineHeight: 1,
                  }}>‹</button>
                  <button onClick={() => moveSlot(i, 1)} disabled={i === slots.length - 1} aria-label="Move right" style={{
                    width: 18, height: 18, borderRadius: 999, background: "rgba(0,0,0,0.65)", color: "#fff",
                    border: "none", cursor: i === slots.length - 1 ? "default" : "pointer", opacity: i === slots.length - 1 ? 0.35 : 1, fontSize: 11, lineHeight: 1,
                  }}>›</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {gif && (
        <div style={{ position: "relative", marginTop: 10 }}>
          {gif.mp4 ? (
            <video src={gif.mp4} loop muted playsInline autoPlay style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 12, border: `1px solid ${LINE}` }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gif.webp ?? gif.gifUrl ?? ""} alt="" style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 12, border: `1px solid ${LINE}` }} />
          )}
          <button onClick={() => setGif(null)} aria-label="Remove GIF" style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {!gif && slots.length < MAX_POST_IMAGES && (
          <button onClick={() => fileRef.current?.click()} style={{
            flex: 1, cursor: "pointer", padding: "9px 12px", borderRadius: 10, background: "transparent",
            border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 13.5, fontWeight: 700, minWidth: 110,
          }}>Add image</button>
        )}
        {slots.length === 0 && (
          <button onClick={() => setGifPickerOpen(true)} style={{
            flex: 1, cursor: "pointer", padding: "9px 12px", borderRadius: 10, background: "transparent",
            border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 13.5, fontWeight: 700, minWidth: 110,
          }}>Add a GIF</button>
        )}
        {!pollOn && (
          <button onClick={() => setPollOn(true)} style={{
            flex: 1, cursor: "pointer", padding: "9px 12px", borderRadius: 10, background: "transparent",
            border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 13.5, fontWeight: 700, minWidth: 110,
          }}>Add a poll</button>
        )}
      </div>

      {pollOn && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL }}>Poll</span>
            <button onClick={() => { setPollOn(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 12.5, fontWeight: 600 }}>Remove</button>
          </div>
          <input value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 120))} placeholder="Ask a question" style={{ ...input, marginBottom: 8 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {options.map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={o} onChange={(e) => setOpt(i, e.target.value.slice(0, 60))} placeholder={`Option ${i + 1}`} style={{ ...input, flex: 1 }} />
                {options.length > 2 && (
                  <button onClick={() => removeOpt(i)} aria-label="Remove option" style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 18, lineHeight: 1, padding: "0 4px" }}>×</button>
                )}
              </div>
            ))}
          </div>
          {options.length < 4 && (
            <button onClick={addOpt} style={{ marginTop: 8, background: "none", border: "none", cursor: "pointer", color: TEAL, fontSize: 13, fontWeight: 700 }}>+ Add option</button>
          )}
        </div>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ fontSize: 11.5, color: MUTED, margin: "12px 0 10px" }}>Posting to For You · everyone can see it.</div>
      <Btn gold disabled={!canPost} onClick={submit}>{busy ? "Posting…" : uploading ? "Uploading…" : "Post"}</Btn>

      <GifPicker open={gifPickerOpen} onClose={() => setGifPickerOpen(false)} onSelect={(g) => { setGif(g); setGifPickerOpen(false); }} />
    </Sheet>
  );
}
