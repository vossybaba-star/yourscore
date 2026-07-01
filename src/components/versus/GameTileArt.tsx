// Built-graphic backgrounds for the Versus game tiles — illustrative art around
// the gameplay (a formation on a pitch for 38-0; answer cards + speed for Quiz
// Battle), not screenshots. Rendered behind the tile's gradient overlay.

const LIME = "#aeea00";
const TEAL = "#00d8c0";

// 38-0 — a 4-3-3 laid out on a stylised pitch.
export function PitchArt() {
  const dots = [
    [80, 130], // GK
    [34, 102], [62, 107], [98, 107], [126, 102], // DEF
    [46, 72], [80, 74], [114, 72], // MID
    [46, 40], [80, 36], [114, 40], // FWD
  ];
  return (
    <svg viewBox="0 0 160 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <g stroke={LIME} strokeOpacity="0.22" strokeWidth="1" fill="none">
        <rect x="10" y="8" width="140" height="134" rx="5" />
        <line x1="10" y1="75" x2="150" y2="75" />
        <circle cx="80" cy="75" r="17" />
        <rect x="47" y="8" width="66" height="24" />
        <rect x="47" y="118" width="66" height="24" />
      </g>
      <g fill={LIME}>
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 0 ? 3.5 : 4} fillOpacity={i === 0 ? 0.65 : 0.9} />
        ))}
      </g>
    </svg>
  );
}

// Quiz Battle — tilted answer cards, a big "?", and speed lines.
export function QuizArt() {
  return (
    <svg viewBox="0 0 160 150" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
      <g stroke={TEAL} strokeOpacity="0.16" strokeWidth="2.5" strokeLinecap="round">
        <line x1="8" y1="26" x2="42" y2="26" />
        <line x1="4" y1="40" x2="28" y2="40" />
        <line x1="10" y1="122" x2="40" y2="122" />
        <line x1="6" y1="108" x2="26" y2="108" />
      </g>
      <rect x="38" y="52" width="84" height="54" rx="9" transform="rotate(-9 80 79)" fill={TEAL} fillOpacity="0.10" stroke={TEAL} strokeOpacity="0.35" />
      <rect x="44" y="42" width="84" height="54" rx="9" transform="rotate(7 86 69)" fill={TEAL} fillOpacity="0.16" stroke={TEAL} strokeOpacity="0.5" />
      <text x="86" y="82" fontSize="38" fontWeight="800" fill={TEAL} fillOpacity="0.9" textAnchor="middle" fontFamily="system-ui, sans-serif" transform="rotate(7 86 69)">?</text>
    </svg>
  );
}
