"use client";
/**
 * useShortlist — one source of truth for the Scout shortlist.
 *
 * The star on the Players browser, the Shortlist tab and the Briefing preview
 * all read and write the SAME set of saved player ids. If each kept its own
 * copy they'd drift — star a player on Players, and the Briefing wouldn't know.
 * So the ids live in a module-level store subscribed to via useSyncExternalStore:
 * every mounted consumer re-renders together, and the ids load from the API once
 * (the first hook to mount kicks the fetch; the rest reuse it).
 *
 * add/remove are OPTIMISTIC: the set updates immediately so the star fills the
 * instant you tap, and the API call runs behind it. If the call fails we roll
 * that one id back, so the UI can never claim a save that didn't land.
 *
 * NOTE: uses fetch directly rather than the shared `api` helper — that helper
 * only speaks GET/POST, and the shortlist needs DELETE too.
 */
import { useCallback, useSyncExternalStore } from "react";

let ids: number[] = [];
let loaded = false;
let loading = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}
function setIds(next: number[]) {
  ids = next;
  emit();
}

async function loadOnce() {
  if (loaded || loading) return;
  loading = true;
  try {
    const res = await fetch("/api/fantasy/shortlist", { method: "GET" });
    const json = await res.json().catch(() => ({}));
    // Degrades gracefully server-side too (missing table → { ids: [] }), so a
    // non-array here just means "nothing saved", never an error the UI shows.
    setIds(Array.isArray(json.ids) ? json.ids : []);
  } catch {
    setIds([]);
  } finally {
    loaded = true;
    loading = false;
    emit();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  void loadOnce();
  return () => { listeners.delete(cb); };
}

export interface Shortlist {
  /** Saved ids, newest first (the order the API returns). */
  ids: number[];
  /** Has the initial load finished? Lets callers hold an empty-state until true. */
  ready: boolean;
  has: (id: number) => boolean;
  /** Optimistically save. New saves go to the front (newest-first). */
  add: (id: number) => Promise<void>;
  /** Optimistically remove. */
  remove: (id: number) => Promise<void>;
}

export function useShortlist(): Shortlist {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => ids,
    () => ids, // server snapshot: empty until the client hydrates and fetches
  );
  const ready = useSyncExternalStore(subscribe, () => loaded, () => false);

  const has = useCallback((id: number) => snapshot.includes(id), [snapshot]);

  const add = useCallback(async (id: number) => {
    if (ids.includes(id)) return;
    setIds([id, ...ids]); // optimistic, newest-first
    try {
      const res = await fetch("/api/fantasy/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setIds(ids.filter((x) => x !== id)); // roll this id back on failure
    }
  }, []);

  const remove = useCallback(async (id: number) => {
    if (!ids.includes(id)) return;
    const prev = ids;
    setIds(ids.filter((x) => x !== id)); // optimistic
    try {
      const res = await fetch("/api/fantasy/shortlist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: id }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setIds(prev); // restore on failure
    }
  }, []);

  return { ids: snapshot, ready, has, add, remove };
}
