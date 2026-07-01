import { avatarPalette, avatarInitial } from "@/lib/avatar";

// A player's avatar. Uses their photo when set, otherwise a deterministic
// generated avatar (gradient + monogram) seeded by id/name — stable per person.
export function PlayerAvatar({ seed, name, avatarUrl, size = 40, ring }: {
  seed?: string; name: string; avatarUrl?: string | null; size?: number; ring?: string;
}) {
  const p = avatarPalette(seed || name);
  const style: React.CSSProperties = avatarUrl
    ? { width: size, height: size, background: `url(${avatarUrl}) center/cover`, border: ring ? `2px solid ${ring}` : "1px solid rgba(255,255,255,0.12)" }
    : { width: size, height: size, background: `linear-gradient(140deg, ${p.from}, ${p.to})`, color: p.fg, border: ring ? `2px solid ${ring}` : "1px solid rgba(255,255,255,0.14)" };
  return (
    <div className="rounded-full flex items-center justify-center font-display flex-shrink-0" style={style}>
      {!avatarUrl && <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>{avatarInitial(name)}</span>}
    </div>
  );
}
