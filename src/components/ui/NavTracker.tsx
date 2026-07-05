"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordVisit } from "@/lib/nav";

// Records every client-side route change into the session nav trail so back
// pills can retrace the player's actual steps (see src/lib/nav.ts). Renders
// nothing; mounted once in the root layout inside a Suspense boundary
// (useSearchParams requires one).
export function NavTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const qs = search.toString();
    recordVisit(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, search]);
  return null;
}
