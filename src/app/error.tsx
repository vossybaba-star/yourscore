"use client";

// App-wide error boundary: catches a thrown error in any page that has no closer
// error.tsx, so a single page crash no longer white-screens the whole app. (Root
// LAYOUT errors are still handled by global-error.tsx.)
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />;
}
