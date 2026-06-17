"use client";

import { AuthProviders } from "@/components/auth/AuthButton";

// Final onboarding step. Account creation is the primary path — we reuse the
// existing AuthProviders panel (Apple/Google/email, native OAuth via yourscore://
// already wired) rather than rebuilding auth. nextPath returns the deep-link
// reload to "/" so the gate sees the new session and tears the overlay down.
// "Continue as guest" is the secondary escape into the playable game.
export function OnboardingAuthStep({ onGuest }: { onGuest: () => void }) {
  return (
    <div className="flex flex-1 flex-col px-7 pt-safe pb-2 overflow-y-auto">
      <div className="flex flex-1 flex-col justify-center w-full max-w-[380px] mx-auto py-8">
        <h2 className="font-display text-[2.6rem] leading-[0.92] uppercase text-white">
          Create your
          <br />
          account
        </h2>
        <p className="font-body text-sm text-text-muted mt-3 mb-7">
          Save your XI, your rank and your streak — and challenge your mates.
        </p>

        <AuthProviders nextPath="/?onboarded=1" />

        <button
          onClick={onGuest}
          className="btn-ghost w-full justify-center py-3.5 mt-4 text-sm"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
