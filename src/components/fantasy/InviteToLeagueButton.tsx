"use client";
/**
 * A trigger that opens the InviteToLeagueSheet for one user. A client island so
 * it can live on server-rendered pages (the profile) as well as client ones (the
 * discover search rows). Style it via `variant`: "full" (a page action button)
 * or "chip" (a compact inline pill).
 */
import { useState } from "react";
import { InviteToLeagueSheet } from "@/components/fantasy/InviteToLeagueSheet";
import { INK, LINE, PANEL_2, TEAL, tint } from "@/components/fantasy/shared";

export function InviteToLeagueButton({ userId, userName, variant = "full" }: {
  userId: string; userName: string; variant?: "full" | "chip";
}) {
  const [open, setOpen] = useState(false);

  const style = variant === "full"
    ? { width: "100%", padding: "12px", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer",
        background: tint(TEAL, "14"), color: TEAL, border: `1px solid ${tint(TEAL, "44")}` }
    : { flexShrink: 0, padding: "7px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        background: PANEL_2, color: INK, border: `1px solid ${LINE}`, whiteSpace: "nowrap" as const };

  return (
    <>
      <button onClick={() => setOpen(true)} style={style as React.CSSProperties}>
        {variant === "full" ? "Invite to a league" : "Invite"}
      </button>
      {open && (
        <InviteToLeagueSheet inviteeId={userId} inviteeName={userName || "this manager"} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
