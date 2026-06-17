import { GridBackground } from "@/components/ui/GridBackground";

// Full-screen native frame shared by every onboarding step: app background, the
// faint grid overlay, a top accent glow that recolours per panel, and horizontal
// safe-area padding (this fixed overlay escapes the body's safe-area padding, so
// we re-apply it here). Children fill the remaining height as a flex column.
export function OnboardingShell({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden flex flex-col"
      style={{
        background: "var(--bg)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <style>{`
        @keyframes obFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        .ob-float { animation: obFloat 5s ease-in-out infinite; will-change: transform; }
        @media (prefers-reduced-motion: reduce) { .ob-float { animation: none; } }
      `}</style>

      <GridBackground opacity={0.025} />

      {/* Accent glow at the top, transitions as the active panel changes. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(70% 42% at 50% 0%, ${accent}29, transparent 72%)`,
          transition: "background 0.45s ease",
        }}
      />

      <div className="relative z-10 flex flex-1 flex-col min-h-0">{children}</div>
    </div>
  );
}
