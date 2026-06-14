import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitDistributed } from "@/lib/ratelimit";

// POST /api/account/delete — permanently delete the caller's account and ALL their data.
//
// Flow (the id is ALWAYS the caller's own, from their authenticated session — never a
// client-supplied value, so one user can't delete another):
//   1. delete_user_account(uid)  — RPC clears every user row across the public schema,
//      de-linking shared content (custom quiz packs, lobbies, leagues they created).
//   2. auth.admin.deleteUser(uid) — removes the auth identity; its auth.users → profiles
//      cascade clears the profile (and anything the RPC didn't, as a backstop).
//   3. best-effort: remove their avatar object(s) from storage.
//
// Idempotent and irreversible. The client signs out + redirects on success.

export const runtime = "nodejs";

export async function POST() {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Tight limit — this is destructive and should never be hammered.
  const { ok } = await rateLimitDistributed(`account-delete:${user.id}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests — wait a moment." }, { status: 429 });

  const uid = user.id;
  const admin = createServiceClient() as unknown as SupabaseClient;

  // 1. Erase all public-schema data (clears the FK blockers a bare auth delete can't).
  const { error: rpcErr } = await admin.rpc("delete_user_account", { p_user: uid });
  if (rpcErr) {
    return NextResponse.json({ error: "Could not delete your data. Please try again." }, { status: 500 });
  }

  // 2. Remove the auth identity (cascades profiles + invalidates the account).
  const { error: authErr } = await admin.auth.admin.deleteUser(uid);
  // "User not found" means a prior attempt already removed it — treat as success.
  if (authErr && !/not\s*found/i.test(authErr.message)) {
    return NextResponse.json({ error: "Could not finish deleting your account. Please try again." }, { status: 500 });
  }

  // 3. Best-effort avatar cleanup — avatars are stored as `${uid}.<ext>`.
  try {
    const { data: files } = await admin.storage.from("avatars").list("", { search: uid });
    const paths = (files ?? []).filter((f) => f.name.startsWith(uid)).map((f) => f.name);
    if (paths.length) await admin.storage.from("avatars").remove(paths);
  } catch { /* non-fatal — the account is already gone */ }

  return NextResponse.json({ ok: true });
}
