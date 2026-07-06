"use client";

// Error boundary for the solo Quiz challenges.
import { RouteError } from "@/components/ui/RouteError";

export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="This quiz hit a snag" message="Something went wrong loading the quiz. Try again, or head home." />;
}
