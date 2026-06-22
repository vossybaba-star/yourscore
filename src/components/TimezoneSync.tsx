"use client";

import { useEffect } from "react";
import { useUser } from "@/hooks/useUser";

// Captures the device's exact IANA timezone once per session and stores it on
// the profile, so notification send-windows (commute / lunch / evening) are
// computed in the user's LOCAL time. Web + native; no UI. Cheap and idempotent.

const SYNCED_KEY = "yourscore:tz-synced:v1";

export function TimezoneSync() {
  const { user } = useUser();

  useEffect(() => {
    if (!user) return;
    try {
      if (sessionStorage.getItem(SYNCED_KEY) === "1") return;
    } catch {
      /* private mode — just re-sync, it's idempotent */
    }

    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      /* no Intl tz — nothing to send */
    }
    if (!tz) return;

    fetch("/api/me/timezone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tz }),
    })
      .then(() => {
        try {
          sessionStorage.setItem(SYNCED_KEY, "1");
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* best-effort */
      });
  }, [user]);

  return null;
}
