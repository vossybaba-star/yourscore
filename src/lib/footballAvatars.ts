// Simple, flat, football-themed illustrated avatars. Each is a self-contained
// SVG (coloured disc + white silhouette) rendered to a data-URI that we store in
// profiles.avatar_url — so every existing `<img src={avatar_url}>` across the app
// (profile, versus, opponents, leaderboards) shows the chosen avatar with no
// per-site changes. avatar_url = null → the monogram fallback (see lib/avatar).

export interface FootballAvatar { id: string; label: string; from: string; to: string; glyph: string }

export const FOOTBALL_AVATARS: FootballAvatar[] = [
  { id: "ball", label: "Ball", from: "#2f9e44", to: "#157f3c",
    glyph: `<circle cx="32" cy="32" r="13" fill="#fff"/><path d="M32 24l4.8 3.5-1.8 5.6h-6l-1.8-5.6z" fill="#0b0b0b"/><path d="M32 20.5v3.5M24.6 27.2l3.2 2.3M39.4 27.2l-3.2 2.3M27.8 40.6l1.4-4.5M36.2 40.6l-1.4-4.5" stroke="#0b0b0b" stroke-width="1.8" stroke-linecap="round"/>` },
  { id: "jersey", label: "Jersey", from: "#4f46e5", to: "#3730a3",
    glyph: `<path d="M25 23l-6.5 4.2 3 5.5 3.5-1.8V44h14V30.9l3.5 1.8 3-5.5L42 23l-4.4 2.4a5.5 5.5 0 0 1-8.2 0z" fill="#fff"/>` },
  { id: "boot", label: "Boot", from: "#0e9f8f", to: "#0b6f66",
    glyph: `<path d="M22 27h8.6l.8 6.4 12.2 3.2c2.3.6 2 4.4-.8 4.4H24.5c-2 0-3.5-1.4-3.5-3.3V28z" fill="#fff"/><path d="M28 42.4v2.4M32 42.4v2.4M36 42.4v2.4" stroke="#0b0b0b" stroke-width="1.6" stroke-linecap="round"/>` },
  { id: "trophy", label: "Trophy", from: "#d99a06", to: "#a86f04",
    glyph: `<path d="M25 21h14v5a7 7 0 0 1-14 0z" fill="#fff"/><rect x="30" y="32" width="4" height="5" fill="#fff"/><rect x="25.5" y="41" width="13" height="3.5" rx="1" fill="#fff"/><rect x="29" y="37" width="6" height="4" fill="#fff"/><path d="M25 22.5h-4.5v2a4.5 4.5 0 0 0 4.5 4.5M39 22.5h4.5v2a4.5 4.5 0 0 1-4.5 4.5" stroke="#fff" stroke-width="2" fill="none"/>` },
  { id: "glove", label: "Keeper", from: "#2563eb", to: "#1e40af",
    glyph: `<path d="M25 45V32.2a2.2 2.2 0 0 1 4.4 0v-3.4a2.2 2.2 0 0 1 4.4 0v3.4a2.2 2.2 0 0 1 4.4 0v2a2.2 2.2 0 0 1 4.4 0V45z" fill="#fff"/>` },
  { id: "whistle", label: "Whistle", from: "#ea580c", to: "#b8460a",
    glyph: `<path d="M21 31h13.5a6.5 6.5 0 1 1-6 9H27a6 6 0 0 1-6-6z" fill="#fff"/><circle cx="30.5" cy="36.5" r="2.2" fill="url(#g)"/><path d="M34 29v3" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>` },
  { id: "scarf", label: "Scarf", from: "#e11d48", to: "#9f1239",
    glyph: `<path d="M23 24h18v5H23z" fill="#fff"/><path d="M27 29h5.5v16l-2.75-3-2.75 3z" fill="#fff"/><path d="M33.5 29H39v13l-2.75-3-2.75 3z" fill="#fff"/>` },
  { id: "flag", label: "Flag", from: "#0891b2", to: "#0e6a85",
    glyph: `<path d="M27 20v25" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M28.4 21.3l14 4.2-14 4.2z" fill="#fff"/>` },
  { id: "goal", label: "Goal", from: "#7c3aed", to: "#5b21b6",
    glyph: `<rect x="21" y="24" width="22" height="16" rx="1" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M27 24v16M32 24v16M37 24v16M21 30h22M21 35h22" stroke="#fff" stroke-width="1" opacity="0.85"/>` },
  { id: "captain", label: "Captain", from: "#db2777", to: "#9d174d",
    glyph: `<path d="M22 28h20v8H22z" fill="#fff"/><path d="M32 30.4l1.4 2.9 3.2.3-2.4 2.1.7 3.1-2.9-1.7-2.9 1.7.7-3.1-2.4-2.1 3.2-.3z" fill="url(#g)"/>` },
];

function svg(a: FootballAvatar): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.from}"/><stop offset="1" stop-color="${a.to}"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#g)"/>${a.glyph}</svg>`;
}

export function avatarDataUri(id: string): string {
  const a = FOOTBALL_AVATARS.find((x) => x.id === id);
  return a ? `data:image/svg+xml,${encodeURIComponent(svg(a))}` : "";
}

// Which catalog avatar (if any) an avatar_url corresponds to — for highlighting
// the current pick. Returns null for photos, monograms, or unknown values.
export function avatarIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const a of FOOTBALL_AVATARS) if (url === avatarDataUri(a.id)) return a.id;
  return null;
}
