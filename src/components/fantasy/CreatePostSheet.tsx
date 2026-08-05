"use client";
/**
 * The Social composer — write a post to the public Live feed, optionally with a
 * poll (founder, 3 Aug — the feed needs somewhere to argue, not just activity).
 * MVP posts to public Social; sharing into a league already lives on each post.
 */
import { useRef, useState } from "react";
import { Btn, INK, LINE, MUTED, PANEL, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { uploadPostImage, PostImageError } from "@/lib/postMedia";

export function CreatePostSheet({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [pollOn, setPollOn] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => { setText(""); setPollOn(false); setQuestion(""); setOptions(["", ""]); setImage(null); setUploading(false); setErr(null); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true); setErr(null);
    try { setImage(await uploadPostImage(file)); }
    catch (er) { setErr(er instanceof PostImageError ? er.message : "Upload failed. Try again."); }
    setUploading(false);
  };
  const close = () => { reset(); onClose(); };
  const setOpt = (i: number, v: string) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOpt = () => setOptions((o) => (o.length < 4 ? [...o, ""] : o));
  const removeOpt = (i: number) => setOptions((o) => (o.length > 2 ? o.filter((_, j) => j !== i) : o));

  const pollValid = !!question.trim() && options.filter((o) => o.trim()).length >= 2;
  const canPost = !uploading && (text.trim().length > 0 || !!image || (pollOn && pollValid));

  const submit = async () => {
    if (!canPost || busy) return;
    setBusy(true); setErr(null);
    const body = {
      text: text.trim(),
      image: image || undefined,
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

      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />

      {image && (
        <div style={{ position: "relative", marginTop: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 12, border: `1px solid ${LINE}` }} />
          <button onClick={() => setImage(null)} aria-label="Remove image" style={{ position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 999, background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {(!image || !pollOn) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {!image && (
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
              flex: 1, cursor: uploading ? "default" : "pointer", padding: "9px 12px", borderRadius: 10, background: "transparent",
              border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 13.5, fontWeight: 700,
            }}>{uploading ? "Uploading…" : "Add image"}</button>
          )}
          {!pollOn && (
            <button onClick={() => setPollOn(true)} style={{
              flex: 1, cursor: "pointer", padding: "9px 12px", borderRadius: 10, background: "transparent",
              border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 13.5, fontWeight: 700,
            }}>Add a poll</button>
          )}
        </div>
      )}

      {pollOn && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: TEAL }}>Poll</span>
            <button onClick={() => { setPollOn(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: MUTED, fontSize: 12.5, fontWeight: 600 }}>Remove</button>
          </div>
          <input value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 120))} placeholder="Ask a question…" style={{ ...input, marginBottom: 8 }} />
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
      <Btn gold disabled={!canPost || busy} onClick={submit}>{busy ? "Posting…" : "Post"}</Btn>
    </Sheet>
  );
}
