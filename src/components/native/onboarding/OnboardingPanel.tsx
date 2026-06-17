// One full-screen value panel in the onboarding carousel. Presentational only —
// content comes from the PANELS config in NativeOnboarding.tsx. Headline is an
// array of lines so the big Bebas type breaks exactly where we want it.

export function OnboardingPanel({
  tag,
  accent,
  headline,
  subcopy,
  children,
}: {
  tag: string;
  accent: string;
  headline: string[];
  subcopy: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-8 px-7 text-center">
      <span className="tag-sheet">
        <span className="dot" style={{ background: accent }} />
        {tag}
      </span>

      <div className="w-full max-w-[330px] flex items-center justify-center">{children}</div>

      <div>
        <h2 className="font-display text-[2.85rem] leading-[0.92] uppercase text-white">
          {headline.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>
        <p className="font-body text-sm text-text-muted mt-3 max-w-[300px] mx-auto leading-relaxed">
          {subcopy}
        </p>
      </div>
    </div>
  );
}
