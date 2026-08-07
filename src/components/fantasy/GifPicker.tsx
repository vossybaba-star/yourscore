"use client";
/**
 * GIF search sheet for the post composer (Phase 2a). Portaled bottom sheet like
 * the composer itself, but taller (~75vh) since it's mostly a results grid.
 * Trending loads by default; typing debounces 350ms before searching; the
 * category chips are canned searches. Picking a GIF closes the sheet and hands
 * it back to the caller (the composer previews it).
 *
 * KLIPY_API_KEY isn't provisioned yet, so /api/gif/* returns 503 gif-unavailable
 * until it is — that's the "unavailable" state below, worded so it reads as a
 * coming feature rather than a break.
 */
import { useEffect, useRef, useState } from "react";
import { INK, LINE, MUTED, Sheet, TEAL, tint } from "@/components/fantasy/shared";

export interface GifResult {
  id: string;
  title: string;
  mp4: string | null;
  webp: string | null;
  gifUrl: string | null;
  previewUrl: string | null;
  width: number;
  height: number;
}

const CATEGORIES = [
  { label: "Celebration", query: "celebration" },
  { label: "Reactions", query: "reaction" },
  { label: "Disappointment", query: "disappointment" },
  { label: "Banter", query: "banter" },
];

type LoadState = "loading" | "ready" | "empty" | "error" | "unavailable";

export function GifPicker({ open, onClose, onSelect }: {
  open: boolean; onClose: () => void; onSelect: (gif: GifResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  const runSearch = async (q: string) => {
    const id = ++reqId.current;
    setState("loading");
    try {
      const url = q.trim() ? `/api/gif/search?q=${encodeURIComponent(q.trim())}` : "/api/gif/trending";
      const r = await fetch(url);
      if (id !== reqId.current) return;
      if (r.status === 503) { setGifs([]); setState("unavailable"); return; }
      if (!r.ok) { setGifs([]); setState("error"); return; }
      const d = await r.json().catch(() => ({ gifs: [] }));
      const list: GifResult[] = Array.isArray(d.gifs) ? d.gifs : [];
      setGifs(list);
      setState(list.length ? "ready" : "empty");
    } catch {
      if (id === reqId.current) { setGifs([]); setState("error"); }
    }
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    void runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(v), 350);
  };

  const onCategory = (c: typeof CATEGORIES[number]) => {
    setQuery(c.label);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runSearch(c.query);
  };

  if (!open) return null;

  return (
    <Sheet onClose={onClose} labelledBy="gif-picker-title" variant="panel" layout="flex" height="75vh">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px", flexShrink: 0 }}>
        <span id="gif-picker-title" className="font-display" style={{ fontSize: 17, color: INK }}>Add a GIF</span>
        <button onClick={onClose} aria-label="Close" style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 44, height: 44, background: "none", border: "none", color: MUTED, fontSize: 22, cursor: "pointer", lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ padding: "0 16px 10px", flexShrink: 0 }}>
        <input value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search GIFs"
          style={{
            width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", borderRadius: 10,
            background: "rgba(255,255,255,0.03)", border: `1px solid ${LINE}`, color: INK, outline: "none",
          }} />
      </div>

      <div style={{ display: "flex", gap: 6, padding: "0 16px 10px", overflowX: "auto", flexShrink: 0 }}>
        {CATEGORIES.map((c) => (
          <button key={c.label} onClick={() => onCategory(c)} style={{
            flexShrink: 0, padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            background: query === c.label ? tint(TEAL, "22") : tint(TEAL, "12"), color: TEAL,
            border: `1px solid ${tint(TEAL, "44")}`, whiteSpace: "nowrap",
          }}>{c.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {state === "loading" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Loading GIFs</p>}
        {state === "unavailable" && (
          <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24, lineHeight: 1.5 }}>
            GIF search isn&apos;t available yet. It switches on soon.
          </p>
        )}
        {state === "error" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>Couldn&apos;t load GIFs. Try again in a moment.</p>}
        {state === "empty" && <p style={{ fontSize: 13, color: MUTED, textAlign: "center", marginTop: 24 }}>No GIFs found. Try a different search.</p>}
        {state === "ready" && (
          <div style={{ columnCount: 2, columnGap: 8 }}>
            {gifs.map((g) => (
              <button key={g.id} onClick={() => onSelect(g)} aria-label={g.title || "Select GIF"} style={{
                display: "block", width: "100%", marginBottom: 8, padding: 0, border: "none",
                borderRadius: 10, overflow: "hidden", cursor: "pointer", breakInside: "avoid", background: "none",
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.previewUrl ?? g.webp ?? g.gifUrl ?? ""} alt={g.title} loading="lazy" style={{ display: "block", width: "100%", borderRadius: 10 }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
