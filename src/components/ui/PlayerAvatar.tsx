import { avatarPalette, avatarInitial } from "@/lib/avatar";

// A player's avatar. Uses their photo when set, otherwise a deterministic
// generated avatar (gradient + monogram) seeded by id/name — stable per person.
//
// `priority` is for HERO avatars (e.g. the fantasy teaser portrait stack). The
// default path paints the photo as a CSS background, which the browser fetches
// at low priority AFTER layout, so on a cold start it flashes empty until the
// network returns (founder, 25 Jul). The priority path renders a real
// <img loading="eager" fetchPriority="high"> over the monogram, so it joins the
// initial high-priority load and shows the monogram (never a blank hole) while
// it arrives. Opt-in, so the many list/pitch avatars are unaffected.
export function PlayerAvatar({ seed, name, avatarUrl, size = 40, ring, priority = false }: {
  seed?: string; name: string; avatarUrl?: string | null; size?: number; ring?: string; priority?: boolean;
}) {
  const p = avatarPalette(seed || name);

  if (avatarUrl && priority) {
    const border = ring ? `2px solid ${ring}` : "1px solid rgba(255,255,255,0.12)";
    return (
      <div className="rounded-full flex items-center justify-center font-display flex-shrink-0"
        style={{ position: "relative", overflow: "hidden", width: size, height: size, border, background: `linear-gradient(140deg, ${p.from}, ${p.to})`, color: p.fg }}>
        <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>{avatarInitial(name)}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl} alt="" width={size} height={size} loading="eager" decoding="async" fetchPriority="high"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  const style: React.CSSProperties = avatarUrl
    ? { width: size, height: size, background: `url(${avatarUrl}) center/cover`, border: ring ? `2px solid ${ring}` : "1px solid rgba(255,255,255,0.12)" }
    : { width: size, height: size, background: `linear-gradient(140deg, ${p.from}, ${p.to})`, color: p.fg, border: ring ? `2px solid ${ring}` : "1px solid rgba(255,255,255,0.14)" };
  return (
    <div className="rounded-full flex items-center justify-center font-display flex-shrink-0" style={style}>
      {!avatarUrl && <span style={{ fontSize: size * 0.44, lineHeight: 1 }}>{avatarInitial(name)}</span>}
    </div>
  );
}
