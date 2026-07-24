"use client";
/**
 * /fantasy/history — the credit, chip and transfer ledger.
 *
 * The audit's trust gap: credits, chips and transfers had no history, so a
 * manager couldn't answer "where did my transfer go?" or "when did I earn that
 * credit?". This is that record. Every line is derived from the entry rows, not
 * a separate log — so it can't disagree with what the game actually did.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api, Btn, Card, GOLD, Header, INK, LINE, MUTED, page, TEAL, tint,
} from "@/components/fantasy/shared";
import { BottomNav } from "@/components/ui/BottomNav";

interface LedgerItem {
  gw: number;
  kind: "round" | "cash" | "transfer" | "hit" | "chip" | "baseline";
  text: string;
  delta?: string;
  at: string | null;
}

/** Each kind gets a glyph and a colour, so the column scans by shape as well as
 *  by word — a red −4 hit shouldn't look like a green credit at a glance. */
const KIND: Record<LedgerItem["kind"], { icon: string; color: string }> = {
  round: { icon: "?", color: TEAL },
  cash: { icon: "£", color: GOLD },
  transfer: { icon: "⇄", color: INK },
  hit: { icon: "−", color: "#E08A6B" },
  chip: { icon: "◆", color: GOLD },
  baseline: { icon: "+", color: TEAL },
};

export default function HistoryPage() {
  const router = useRouter();
  const [items, setItems] = useState<LedgerItem[] | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: LedgerItem[] }>("ledger");
      setItems(r.items);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsAuth(true);
      else setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group by gameweek so the story reads a week at a time.
  const byGw = (items ?? []).reduce<Map<number, LedgerItem[]>>((m, it) => {
    (m.get(it.gw) ?? m.set(it.gw, []).get(it.gw)!).push(it);
    return m;
  }, new Map());
  const gws = Array.from(byGw.keys()).sort((a, b) => b - a);

  return (
    <>
    <main data-fantasy style={page}>
      <Header exit={{ label: "Fantasy", onClick: () => router.push("/fantasy") }} />
      <h1 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 700 }}>Your history</h1>
      <p style={{ fontSize: 13.5, color: MUTED, margin: "0 0 16px", lineHeight: 1.5 }}>
        Every credit earned, chip played and transfer made, newest first.
      </p>

      {needsAuth && (
        <Card>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Sign in to see your history</div>
          <Btn gold onClick={() => router.push("/auth/sign-in?next=/fantasy/history")}>Sign in</Btn>
        </Card>
      )}
      {err && <Card><p style={{ color: "#E08A6B", fontSize: 13.5, margin: 0 }}>{err}</p></Card>}
      {!items && !needsAuth && !err && <p style={{ color: MUTED, fontSize: 13 }}>Loading…</p>}

      {items && !items.length && (
        <Card>
          <p style={{ fontSize: 13.5, color: MUTED, margin: 0, lineHeight: 1.55 }}>
            Nothing here yet. Play your first round and make a transfer, and it&apos;ll all show up.
          </p>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {gws.map((gw) => (
          <div key={gw}>
            <div className="font-display tracking-widest"
              style={{ fontSize: 11, color: "#586058", marginBottom: 6 }}>
              GAMEWEEK {gw}
            </div>
            <Card style={{ padding: 0 }}>
              {byGw.get(gw)!.map((it, i) => {
                const k = KIND[it.kind];
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 11, padding: "11px 14px",
                    borderTop: i === 0 ? "none" : `1px solid ${LINE}`,
                  }}>
                    <span style={{
                      flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                      width: 24, height: 24, borderRadius: 7, fontSize: 12, fontWeight: 700,
                      background: tint(k.color, "18"), color: k.color, border: `1px solid ${tint(k.color, "33")}`,
                    }}>{k.icon}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: INK, lineHeight: 1.35 }}>
                      {it.text}
                    </span>
                    {it.delta && (
                      <span style={{
                        flexShrink: 0, fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: it.kind === "hit" ? "#E08A6B" : it.kind === "cash" ? GOLD : TEAL,
                      }}>{it.delta}</span>
                    )}
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
      </div>

      {items && !!items.length && (
        <div style={{ marginTop: 20 }}>
          <Btn onClick={() => router.push("/fantasy")}>Back to my team</Btn>
        </div>
      )}
    </main>
      <BottomNav />
    </>
  );
}
