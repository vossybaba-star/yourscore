import type { TodaysFirstQuestion } from "@/lib/daily-game";

// Today's Game tile, for Higher or Lower, shows the ACTUAL first question of
// the round rather than a sentence about the game. Founder 2026-07-24: a tile
// that is the question is worth tapping; a tile that describes a game is not.
//
// The two names are deliberately NOT their own links. Tapping anywhere on the
// tile does the same thing: open the round at question 1, still unanswered
// ("opens", not "counts"). Answering here would mean starting a 25 second
// speed-scored clock the moment the tile scrolled into view, which would hand
// people wildly different first-question scores for no reason.
//
// Both home surfaces render this, so the signed-in and signed-out tiles cannot
// drift apart.
export function TodaysQuestionPreview({
  question,
  accent,
  compact = false,
}: {
  question: TodaysFirstQuestion;
  accent: string;
  compact?: boolean;
}) {
  return (
    <div
      className={compact ? "px-4 py-3.5" : "px-6 py-4"}
      style={{ borderTop: `1px solid ${accent}22`, background: "rgba(0,0,0,0.28)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="font-body text-[9px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 rounded-md"
          style={{ background: `${accent}1f`, color: accent, border: `1px solid ${accent}45` }}
        >
          Question 1
        </span>
        {question.position && (
          <span className="font-body text-[10px] uppercase tracking-widest" style={{ color: "#8a948f" }}>
            {question.position}
          </span>
        )}
      </div>

      <p
        className={`font-body font-semibold text-white leading-snug mb-2.5 ${compact ? "text-sm" : "text-base"}`}
      >
        {question.prompt}
      </p>

      {/* Faces are all-or-nothing. One headshot beside one empty circle reads as
          a broken image, not as a design, so the moment either player is
          unresolved both sides fall back to the plain name. */}
      <div className="grid grid-cols-2 gap-2">
        {question.options.map((o) => (
          <span
            key={o.id}
            className={`flex flex-col items-center gap-1.5 rounded-xl font-body font-semibold text-white ${
              compact ? "text-sm px-2 py-2.5" : "text-base px-2.5 py-3"
            }`}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.13)" }}
          >
            {question.hasFaces && o.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={o.photoUrl}
                alt=""
                loading="eager"
                decoding="async"
                className="rounded-full object-cover object-top"
                style={{
                  width: compact ? 44 : 54,
                  height: compact ? 44 : 54,
                  background: "rgba(255,255,255,0.06)",
                }}
              />
            )}
            <span className="block w-full text-center truncate">{o.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
