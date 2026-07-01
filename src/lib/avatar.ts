// Deterministic generated avatars — every player gets a distinct, lively token
// even without a photo, so the Versus hub never looks empty. Seed by stable user
// id where possible (falls back to display name). `avatar_url` always overrides.

const PALETTE: { from: string; to: string; fg: string }[] = [
  { from: "#00d8c0", to: "#0891b2", fg: "#04231f" }, // teal
  { from: "#aeea00", to: "#65a30d", fg: "#13200a" }, // lime
  { from: "#ffc233", to: "#d97706", fg: "#241800" }, // gold
  { from: "#ff6b78", to: "#e11d48", fg: "#2a0810" }, // rose
  { from: "#a78bfa", to: "#7c3aed", fg: "#f5f3ff" }, // violet
  { from: "#38bdf8", to: "#2563eb", fg: "#04121f" }, // sky
  { from: "#34d399", to: "#059669", fg: "#04231a" }, // emerald
  { from: "#fb923c", to: "#ea580c", fg: "#2a1000" }, // orange
  { from: "#f472b6", to: "#db2777", fg: "#2a0818" }, // pink
  { from: "#22d3ee", to: "#0e7490", fg: "#042027" }, // cyan
  { from: "#c084fc", to: "#9333ea", fg: "#faf5ff" }, // purple
  { from: "#facc15", to: "#a16207", fg: "#241c00" }, // amber
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

export function avatarPalette(seed: string) {
  return PALETTE[hash(seed || "?") % PALETTE.length];
}

export function avatarInitial(name: string) {
  const t = (name ?? "").trim();
  return (t[0] ?? "?").toUpperCase();
}
