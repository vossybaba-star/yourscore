import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitDistributed } from "@/lib/ratelimit";
import { createDraftDb } from "@/lib/draft/server";
import {
  PENDING_COLS, completePendingPens, isPending, pendingView, replayPending,
  type PendingRow,
} from "@/lib/draft/pens-resolve";
import { shootoutStatus } from "@/lib/draft/pens";

// The solo interactive shootout (ranked async + challenge links).
// GET  ?matchId=…            → current kicks + whose input is due (resume support).
// POST {matchId,action,zone} → resolve one kick server-side and return the new state.
// The zone choice is the ONLY client input; outcomes come from the peppered seed,
// so a client can neither precompute the keeper nor pick-and-choose results.

async function loadRow(matchId: string, userId: string): Promise<PendingRow | { error: string; status: number }> {
  const db = createDraftDb();
  const { data: row } = await db
    .from("draft_matches")
    .select(PENDING_COLS)
    .eq("id", matchId)
    .maybeSingle();
  if (!row) return { error: "Match not found", status: 404 };
  const p = row as unknown as PendingRow;
  if (!p.detail?.pensState) return { error: "No shootout on this match", status: 409 };
  if (p.detail.pensState.userId !== userId) return { error: "Not your shootout", status: 403 };
  return p;
}

export async function GET(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const matchId = req.nextUrl.searchParams.get("matchId") ?? "";
  const row = await loadRow(matchId, user.id);
  if ("error" in row) return NextResponse.json({ error: row.error }, { status: row.status });
  return NextResponse.json(pendingView(row));
}

export async function POST(req: NextRequest) {
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const { ok } = await rateLimitDistributed(`draft-pens:${user.id}`, 40, 60_000);
  if (!ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  let body: { matchId?: string; action?: string; zone?: number } = {};
  try { body = await req.json(); } catch { /* below */ }
  const matchId = typeof body.matchId === "string" ? body.matchId : "";
  const action = body.action === "shot" || body.action === "dive" ? body.action : null;
  const zone = Number.isInteger(body.zone) ? (body.zone as number) : -1;
  if (!matchId || !action) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (action === "shot" && (zone < 0 || zone > 5)) return NextResponse.json({ error: "Bad zone" }, { status: 400 });
  if (action === "dive" && (zone < 0 || zone > 2)) return NextResponse.json({ error: "Bad dive" }, { status: 400 });

  const row = await loadRow(matchId, user.id);
  if ("error" in row) return NextResponse.json({ error: row.error }, { status: row.status });
  // Already settled (raced a sweep / double-submit after the end) → just report it.
  if (!isPending(row)) return NextResponse.json(pendingView(row));

  const s = row.detail.pensState!;
  // Alternation guard: the replayed state decides whose input is due right now.
  const kicks = replayPending(row.id, s);
  const st = shootoutStatus(kicks.a, kicks.b, "alternating");
  if (st.decided) {
    const done = await completePendingPens(createDraftDb(), row);
    return NextResponse.json(pendingView(done));
  }
  const due = st.next === s.userSide ? "shot" : "dive";
  if (action !== due) return NextResponse.json({ error: `Expected a ${due}` }, { status: 409 });

  const nextState = {
    ...s,
    shots: action === "shot" ? [...s.shots, zone] : s.shots,
    dives: action === "dive" ? [...s.dives, zone] : s.dives,
  };
  const db = createDraftDb();
  const detail = { ...row.detail, pensState: nextState };
  const { data: updated } = await db
    .from("draft_matches")
    .update({ detail: detail as unknown as never })
    .eq("id", row.id)
    .filter("detail->>outcome", "eq", "pens_pending")
    .select(PENDING_COLS)
    .maybeSingle();
  if (!updated) {
    // Settled underneath us — re-read and report the final state.
    const fresh = await loadRow(matchId, user.id);
    return "error" in fresh
      ? NextResponse.json({ error: fresh.error }, { status: fresh.status })
      : NextResponse.json(pendingView(fresh));
  }

  const after = updated as unknown as PendingRow;
  const replayed = replayPending(after.id, after.detail.pensState!);
  if (shootoutStatus(replayed.a, replayed.b, "alternating").decided) {
    const done = await completePendingPens(db, after);
    return NextResponse.json(pendingView(done));
  }
  return NextResponse.json(pendingView(after));
}
