"use client";
/**
 * The Social composer — write a post to the public Live feed, optionally with a
 * poll, up to four images, one GIF, a link preview, a player, or a fixture
 * (founder, 3 Aug — the feed needs somewhere to argue, not just activity;
 * Phase 2a, 5 Aug — media; Phase 2b — links, poll duration, player/fixture
 * attachments).
 * MVP posts to public Social; sharing into a league already lives on each post.
 *
 * Mutual exclusion at THIS composer's level (the server doesn't enforce any of
 * it): images and a GIF are exclusive; player and fixture are exclusive with
 * each other AND with a GIF (picking one hides the others' add buttons).
 * Images/poll/text still combine freely with a player or a fixture.
 *
 * A link preview unfurls automatically 600ms after typing stops, from the
 * FIRST http(s) URL found in the text — no button for it, since the trigger
 * is the URL itself. Dismissing it (×) only hides the card; the URL stays in
 * the text and typing a DIFFERENT URL re-unfurls.
 */
import { useEffect, useRef, useState } from "react";
import { Btn, INK, LINE, MUTED, PANEL, PANEL_2, Sheet, TEAL, tint } from "@/components/fantasy/shared";
import { uploadPostImage, PostImageError, MAX_POST_IMAGES } from "@/lib/postMedia";
import { GifPicker, type GifResult } from "@/components/fantasy/GifPicker";
import { PlayerPickerSheet, type PickablePlayer } from "@/components/fantasy/PlayerPickerSheet";
import { FixturePickerSheet, type PickableFixture } from "@/components/fantasy/FixturePickerSheet";
import { PlayerAvatar } from "@/components/ui/PlayerAvatar";
import { Crest } from "@/components/ui/Crest";
import { mentionQueryAt, applyMention, MentionDropdown } from "@/components/fantasy/MentionAutocomplete";

interface ImageSlot { key: string; url: string | null; uploading: boolean; error: string | null }
interface LinkPreview { url: string; title: string | null; description: string | null; siteName: string | null; image: string | null; domain: string }
/** The post being quoted (Phase 3a) — a compact, non-removable embed pinned
 *  under the composer. Passed in already-trimmed by the caller (FeedStream's
 *  RepostControl), so this component never needs to know the FeedEvent shape. */
export interface QuotingPost { id: string; actorName: string; actorAvatar: string | null; text: string | null; image: string | null; createdAt: string }

const POLL_DURATIONS: { hours: 1 | 6 | 24 | 72; label: string }[] = [
  { hours: 1, label: "1 hour" }, { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" }, { hours: 72, label: "3 days" },
];

/** The first http(s) URL in a body of text, trailing punctuation trimmed off
 *  (so "check this out: https://x.com/a." doesn't unfurl with a stray dot). */
function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  if (!m) return null;
  return m[0].replace(/[),.!?;:'"]+$/, "");
}

export function CreatePostSheet({ open, onClose, onPosted, quoting = null }: {
  open: boolean; onClose: () => void; onPosted: () => void;
  /** Quote mode (Phase 3a): a compact, non-removable embed of the quoted post
   *  pinned under the composer. Requires text or media before it can post
   *  (unlike a plain post, which can also be just a poll/player/fixture). */
  quoting?: QuotingPost | null;
}) {
  const [text, setText] = useState("");
  const [pollOn, setPollOn] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [pollDuration, setPollDuration] = useState<1 | 6 | 24 | 72>(24);
  const [slots, setSlots] = useState<ImageSlot[]>([]);
  const [gif, setGif] = useState<GifResult | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [player, setPlayer] = useState<PickablePlayer | null>(null);
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [fixture, setFixture] = useState<PickableFixture | null>(null);
  const [fixturePickerOpen, setFixturePickerOpen] = useState(false);
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkDismissed, setLinkDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastUrlRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // @mention autocomplete (Phase 3b) — the caret position, tracked from every
  // event that could move it, drives the "@" + 2+ chars lookup.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const mentionQuery = mentionQueryAt(text, caret);
  const trackCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart ?? 0);
  const pickMention = (username: string) => {
    const next = applyMention(text, caret, username);
    setText(next.text.slice(0, 500));
    setCaret(next.caret);
    requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(next.caret, next.caret); });
  };

  // Unfurl the first URL in the text, 600ms after typing stops. A different
  // URL re-unfurls and un-dismisses; the same URL (including after a
  // dismiss) is left alone.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const url = firstUrl(text);
      if (url === lastUrlRef.current) return;
      lastUrlRef.current = url;
      setLinkDismissed(false);
      if (!url) { setLinkPreview(null); setLinkLoading(false); return; }
      setLinkLoading(true);
      fetch("/api/unfurl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: LinkPreview) => { if (lastUrlRef.current === url) setLinkPreview(d); })
        .catch(() => { if (lastUrlRef.current === url) setLinkPreview(null); }) // failure = no card, no error noise
        .finally(() => { if (lastUrlRef.current === url) setLinkLoading(false); });
    }, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text]);

  if (!open) return null;

  const reset = () => {
    setText(""); setPollOn(false); setQuestion(""); setOptions(["", ""]); setPollDuration(24);
    setSlots([]); setGif(null); setGifPickerOpen(false);
    setPlayer(null); setPlayerPickerOpen(false); setFixture(null); setFixturePickerOpen(false);
    setLinkPreview(null); setLinkLoading(false); setLinkDismissed(false); lastUrlRef.current = null;
    setCaret(0);
    setErr(null);
  };
  const close = () => { reset(); onClose(); };

  const uploading = slots.some((s) => s.uploading);
  const images = slots.filter((s) => s.url).map((s) => s.url as string);
  const showLink = !!linkPreview && !linkDismissed;

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

  const pickGif = (g: GifResult) => { setGif(g); setPlayer(null); setFixture(null); setGifPickerOpen(false); };
  const pickPlayer = (p: PickablePlayer) => { setPlayer(p); setGif(null); setFixture(null); setPlayerPickerOpen(false); };
  const pickFixture = (f: PickableFixture) => { setFixture(f); setGif(null); setPlayer(null); setFixturePickerOpen(false); };

  const pollValid = !!question.trim() && options.filter((o) => o.trim()).length >= 2;
  // A quote always needs its own text or media — a poll/player/fixture alone
  // isn't enough (that's indistinguishable from a plain repost, which has its
  // own action). A plain post keeps the looser rule.
  const canPost = !uploading && !busy && (
    quoting
      ? (text.trim().length > 0 || images.length > 0 || !!gif)
      : (text.trim().length > 0 || images.length > 0 || !!gif || !!player || !!fixture || (pollOn && pollValid))
  );

  const submit = async () => {
    if (!canPost) return;
    setBusy(true); setErr(null);
    const body = {
      text: text.trim(),
      images: images.length ? images : undefined,
      gif: gif ? { mp4: gif.mp4, webp: gif.webp, gifUrl: gif.gifUrl, width: gif.width, height: gif.height } : undefined,
      poll: pollOn ? { question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), durationHours: pollDuration } : undefined,
      playerId: player ? player.id : undefined,
      fixture: fixture ? { homeClub: fixture.homeClub, awayClub: fixture.awayClub, kickoffIso: fixture.kickoffIso, gw: fixture.gw } : undefined,
      link: showLink && linkPreview
        ? { url: linkPreview.url, title: linkPreview.title, description: linkPreview.description, siteName: linkPreview.siteName, image: linkPreview.image }
        : undefined,
      quoteOf: quoting ? quoting.id : undefined,
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

  // Compact scrollable toolbar (AC7) — icon + short label, one row even at 375px.
  const toolbarBtn: React.CSSProperties = {
    flexShrink: 0, display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
    padding: "8px 11px", borderRadius: 999, background: "transparent",
    border: `1px dashed ${tint(TEAL, "55")}`, color: TEAL, fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
  };
  const showPhoto = !gif && slots.length < MAX_POST_IMAGES;
  const showGif = slots.length === 0 && !player && !fixture;
  const showPlayerBtn = !gif && !fixture && !player;
  const showFixtureBtn = !gif && !player && !fixture;

  return (
    <Sheet onClose={close} labelledBy="create-post-title">
      <div id="create-post-title" className="font-display" style={{ fontSize: 19, color: INK, marginBottom: 10 }}>{quoting ? "Quote post" : "New post"}</div>

      <textarea ref={textareaRef} value={text}
        onChange={(e) => { setText(e.target.value.slice(0, 500)); trackCaret(e); }}
        onKeyUp={trackCaret} onClick={trackCaret}
        placeholder={quoting ? "Add a comment" : "Share your FPL take"} rows={4}
        style={{ ...input, resize: "none", lineHeight: 1.45 }} />
      <MentionDropdown query={mentionQuery} onSelect={pickMention} />

      {/* The quoted post — compact, non-removable (it's the whole point of a quote). */}
      {quoting && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, padding: 8, borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}` }}>
          <PlayerAvatar name={quoting.actorName} avatarUrl={quoting.actorAvatar} size={28} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quoting.actorName}</div>
            {quoting.text && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{quoting.text}</div>
            )}
          </div>
          {quoting.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={quoting.image} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
          )}
        </div>
      )}

      {linkLoading && !showLink && <p style={{ fontSize: 11.5, color: MUTED, margin: "6px 0 0" }}>Fetching a preview…</p>}
      {showLink && linkPreview && (
        <div style={{ position: "relative", display: "flex", gap: 10, marginTop: 8, padding: 8, borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}` }}>
          {linkPreview.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={linkPreview.image} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
          )}
          <div style={{ minWidth: 0, flex: 1, paddingRight: 20 }}>
            {linkPreview.title && (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{linkPreview.title}</div>
            )}
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{linkPreview.domain}</div>
          </div>
          <button onClick={() => setLinkDismissed(true)} aria-label="Remove link preview" style={{
            position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 999,
            background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1,
          }}>×</button>
        </div>
      )}

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

      {player && (
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "8px 34px 8px 10px", borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}` }}>
          <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size={36} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: INK }}>{player.name}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: MUTED }}><Crest club={player.club} size={12} /> {player.club}</span>
          </span>
          <button onClick={() => setPlayer(null)} aria-label="Remove player" style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: 999, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
        </div>
      )}

      {fixture && (
        <div style={{ position: "relative", marginTop: 10, padding: "10px 34px 10px 12px", borderRadius: 10, background: PANEL_2, border: `1px solid ${LINE}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>{fixture.homeClub} v {fixture.awayClub}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
            {new Date(fixture.kickoffIso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} · GW{fixture.gw}
          </div>
          <button onClick={() => setFixture(null)} aria-label="Remove fixture" style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: 999, background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
        {showPhoto && (
          <button onClick={() => fileRef.current?.click()} style={toolbarBtn}><span aria-hidden>📷</span>Photo</button>
        )}
        {showGif && (
          <button onClick={() => setGifPickerOpen(true)} style={toolbarBtn}><span aria-hidden>🎬</span>GIF</button>
        )}
        {!pollOn && (
          <button onClick={() => setPollOn(true)} style={toolbarBtn}><span aria-hidden>📊</span>Poll</button>
        )}
        {showPlayerBtn && (
          <button onClick={() => setPlayerPickerOpen(true)} style={toolbarBtn}><span aria-hidden>⚽</span>Player</button>
        )}
        {showFixtureBtn && (
          <button onClick={() => setFixturePickerOpen(true)} style={toolbarBtn}><span aria-hidden>🗓️</span>Fixture</button>
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
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="poll-duration" style={{ fontSize: 12, color: MUTED }}>Runs for</label>
            <select id="poll-duration" value={pollDuration} onChange={(e) => setPollDuration(Number(e.target.value) as 1 | 6 | 24 | 72)}
              style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 8, background: PANEL, border: `1px solid ${LINE}`, color: INK }}>
              {POLL_DURATIONS.map((d) => <option key={d.hours} value={d.hours}>{d.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {err && <p style={{ color: "#E08A6B", fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ fontSize: 11.5, color: MUTED, margin: "12px 0 10px" }}>Posting to For You · everyone can see it.</div>
      <Btn gold disabled={!canPost} onClick={submit}>{busy ? "Posting…" : uploading ? "Uploading…" : "Post"}</Btn>

      <GifPicker open={gifPickerOpen} onClose={() => setGifPickerOpen(false)} onSelect={pickGif} />
      <PlayerPickerSheet open={playerPickerOpen} onClose={() => setPlayerPickerOpen(false)} onSelect={pickPlayer} />
      <FixturePickerSheet open={fixturePickerOpen} onClose={() => setFixturePickerOpen(false)} onSelect={pickFixture} />
    </Sheet>
  );
}
