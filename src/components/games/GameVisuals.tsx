// Mock-screen graphics for Perfect 10, Higher or Lower and Guess the Player.
//
// One source, two consumers: the standalone /games page detail panels and the
// signed-out home "THE GAMES" explainer both render these, so the two surfaces
// can never drift. Keyed by the GAMES registry key (GameSwitcher), same idiom
// as the game list itself. Quiz and 38-0 have no entry here on purpose: on
// /games they get richer step carousels, on home they stay bullets-only.
//
// Built from divs, not images (nothing to ship, inherits each game's colour),
// and each one mirrors how the real game actually plays so the picture teaches
// the mechanic the bullets describe.

// Perfect 10's tower: rank 1 at the top, rungs widening down (the real game's
// rungWidthPct runs 62% at rank 1 to 100% at rank 10). Solved rungs carry a
// name, the rest are blank bars; one of three strike dots is spent.
export function Perfect10Visual() {
  const rungs = [
    { rank: 1, name: "Alan Shearer", solved: true },
    { rank: 2, name: "Harry Kane", solved: true },
    { rank: 3, name: null, solved: false },
    { rank: 4, name: "Wayne Rooney", solved: true },
    { rank: 5, name: null, solved: false },
  ];
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(255,196,0,0.15)" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="font-body text-xs uppercase tracking-widest" style={{ color: "#8a948f" }}>PL all time scorers</p>
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="rounded-full" style={{ width: 6, height: 6, background: i < 1 ? "#ff4757" : "rgba(255,255,255,0.12)" }} />
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {rungs.map((r, i) => (
          <div key={r.rank} className="mx-auto flex items-center gap-2 rounded-lg px-2.5 py-2"
            style={{
              width: `${62 + (i * 38) / 4}%`,
              background: r.solved ? "rgba(255,196,0,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${r.solved ? "rgba(255,196,0,0.35)" : "rgba(255,255,255,0.07)"}`,
            }}>
            <span className="font-display text-xs flex-shrink-0" style={{ color: r.solved ? "#ffc400" : "#586058", width: 12 }}>{r.rank}</span>
            {r.solved
              ? <span className="font-body text-xs text-white truncate">{r.name}</span>
              : <span className="rounded-full" style={{ height: 5, width: "55%", background: "rgba(255,255,255,0.08)" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// Higher or Lower: two same-position players, one stat, tap the bigger. The
// real game reveals one number and hides the other.
export function HigherLowerVisual() {
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(255,120,0,0.15)" }}>
      <p className="font-body text-xs text-center uppercase tracking-widest mb-3" style={{ color: "#8a948f" }}>Premier League goals · forwards</p>
      <div className="flex items-stretch gap-2">
        {[
          { name: "Mohamed Salah", val: "186", known: true },
          { name: "Sergio Agüero", val: "?", known: false },
        ].map((p, i) => (
          <div key={p.name} className="flex-1 rounded-xl px-3 py-3 text-center"
            style={{ background: p.known ? "rgba(255,255,255,0.03)" : "rgba(255,120,0,0.1)", border: `1px solid ${p.known ? "rgba(255,255,255,0.07)" : "rgba(255,120,0,0.4)"}` }}>
            <p className="font-body text-xs text-white/80 leading-tight mb-1.5">{p.name}</p>
            <p className="font-display text-2xl" style={{ color: p.known ? "#fff" : "#ff7800" }}>{p.val}</p>
            {!p.known && <p className="font-body text-xs mt-1" style={{ color: "#ff7800" }}>tap if more</p>}
            {i === 0 && <p className="font-body text-xs mt-1" style={{ color: "#586058" }}>goals</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Guess the Player: clues arrive one at a time (the real game shows a
// nationality flag and shirt number as visual clues), then four options.
export function GuessThePlayerVisual() {
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "#080d0a", border: "1px solid rgba(79,195,247,0.15)" }}>
      <div className="flex items-center gap-2 mb-3">
        {["🏴󠁧󠁢󠁥󠁮󠁧󠁿 England", "#7", "Winger"].map((c) => (
          <span key={c} className="font-body text-xs px-2 py-1 rounded-md"
            style={{ background: "rgba(79,195,247,0.12)", border: "1px solid rgba(79,195,247,0.3)", color: "#4fc3f7" }}>{c}</span>
        ))}
        <span className="font-body text-xs px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.03)", color: "#586058" }}>+2</span>
      </div>
      <div className="space-y-1.5">
        {[
          { l: "A", t: "Jack Grealish", on: false },
          { l: "B", t: "Phil Foden", on: true },
          { l: "C", t: "Bukayo Saka", on: false },
        ].map((o) => (
          <div key={o.l} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: o.on ? "rgba(79,195,247,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${o.on ? "rgba(79,195,247,0.4)" : "rgba(255,255,255,0.07)"}` }}>
            <span className="w-5 h-5 rounded flex items-center justify-center font-display text-xs flex-shrink-0"
              style={{ background: o.on ? "rgba(79,195,247,0.2)" : "rgba(255,255,255,0.05)", color: o.on ? "#4fc3f7" : "#8a948f" }}>{o.l}</span>
            <span className="font-body text-xs text-white">{o.t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Keyed by GAMES registry key. Games with no mock (quiz, draft) are simply
// absent, so a consumer can render `GAME_VISUALS[key]` and get undefined for
// those rather than a broken panel.
export const GAME_VISUALS: Record<string, React.ReactNode> = {
  perfect10: <Perfect10Visual />,
  "higher-lower": <HigherLowerVisual />,
  "guess-the-player": <GuessThePlayerVisual />,
};
