"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Friend-invite landing: someone shared their /add/<id> link. Resolve who they
// are and let the viewer add them in one tap (POST /api/friends auto-accepts if
// a reverse request already exists). Signed-out viewers sign in first.

type State =
  | { kind: "loading" }
  | { kind: "self"; name: string }
  | { kind: "signed-out"; name: string }
  | { kind: "ready"; name: string }
  | { kind: "friends"; name: string }
  | { kind: "sent"; name: string }
  | { kind: "missing" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AddFriendPage() {
  const { id } = useParams<{ id: string }>(); // slug: a username or a raw user id
  const [state, setState] = useState<State>({ kind: "loading" });
  const [targetId, setTargetId] = useState<string | null>(null); // resolved canonical user id
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      // Resolve the slug to a user: exact id for UUIDs, else case-insensitive username.
      const { data: prof } = UUID_RE.test(id)
        ? await sb.from("profiles").select("id, display_name").eq("id", id).maybeSingle()
        : await sb.from("profiles").select("id, display_name").ilike("username", id).maybeSingle();
      if (!prof) { setState({ kind: "missing" }); return; }
      setTargetId(prof.id);
      const name = prof.display_name ?? "A YourScore player";

      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setState({ kind: "signed-out", name }); return; }
      if (user.id === prof.id) { setState({ kind: "self", name }); return; }

      const res = await fetch(`/api/friends?with=${prof.id}`);
      const { status } = await res.json();
      if (status === "friends") setState({ kind: "friends", name });
      else if (status === "pending_sent") setState({ kind: "sent", name });
      else setState({ kind: "ready", name });
    })();
  }, [id]);

  async function add() {
    if (busy || state.kind !== "ready" || !targetId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ friendId: targetId }) });
      const data = await res.json();
      if (res.ok && (data.status === "sent" || data.status === "now_friends" || data.status === "already_friends")) {
        setState({ kind: data.status === "sent" ? "sent" : "friends", name: state.name });
        return;
      }
    } catch { /* fall through */ }
    setBusy(false);
  }

  const s = state;
  return (
    <main className="min-h-dvh grid place-items-center bg-bg px-6">
      <div className="text-center max-w-sm">
        {s.kind === "loading" && <p className="font-body text-sm text-text-muted">Loading…</p>}
        {s.kind === "missing" && (<>
          <p className="font-display text-xl text-white">This invite link isn&apos;t valid</p>
          <Link href="/versus" className="inline-block mt-5 rounded-2xl px-6 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Go to Versus →</Link>
        </>)}
        {(s.kind === "ready" || s.kind === "signed-out" || s.kind === "self" || s.kind === "friends" || s.kind === "sent") && (
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center font-display text-2xl text-white" style={{ background: "rgba(0,216,192,0.15)", border: "1px solid rgba(0,216,192,0.35)" }}>
            {(s.name[0] ?? "?").toUpperCase()}
          </div>
        )}
        {s.kind === "ready" && (<>
          <p className="font-display text-xl text-white">Add {s.name} on YourScore?</p>
          <p className="font-body text-sm text-text-muted mt-1.5 mb-6">Challenge each other on quizzes and 38-0.</p>
          <button onClick={add} disabled={busy} className="rounded-2xl px-7 py-3 font-display tracking-wide disabled:opacity-60" style={{ background: "#00d8c0", color: "#04231f" }}>{busy ? "Adding…" : `Add ${s.name} →`}</button>
        </>)}
        {s.kind === "signed-out" && (<>
          <p className="font-display text-xl text-white">{s.name} wants to play you</p>
          <p className="font-body text-sm text-text-muted mt-1.5 mb-6">Sign in to add them on YourScore.</p>
          <Link href={`/auth/sign-in?next=/add/${id}`} className="inline-block rounded-2xl px-7 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Sign in →</Link>
        </>)}
        {s.kind === "self" && (<>
          <p className="font-display text-xl text-white">This is your invite link</p>
          <p className="font-body text-sm text-text-muted mt-1.5 mb-6">Share it with friends so they can add you.</p>
          <Link href="/versus?view=friends" className="inline-block rounded-2xl px-7 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Your friends →</Link>
        </>)}
        {s.kind === "friends" && (<>
          <p className="font-display text-xl text-white">You&apos;re friends with {s.name}</p>
          <Link href={`/versus/challenge`} className="inline-block mt-5 rounded-2xl px-7 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Challenge them →</Link>
        </>)}
        {s.kind === "sent" && (<>
          <p className="font-display text-xl text-white">Request sent to {s.name}</p>
          <p className="font-body text-sm text-text-muted mt-1.5 mb-6">They&apos;ll get a heads-up to accept.</p>
          <Link href="/versus" className="inline-block rounded-2xl px-7 py-3 font-display tracking-wide" style={{ background: "#00d8c0", color: "#04231f" }}>Back to Versus →</Link>
        </>)}
      </div>
    </main>
  );
}
