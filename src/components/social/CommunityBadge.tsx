/**
 * Disclosure label for YourScore's synthetic community accounts
 * (`profiles.source === "bot"`). Founder-specified exact copy — do not
 * reword. Shown wherever one of these accounts' identity appears: their own
 * profile, every feed post they author, post detail, quoted-post previews,
 * and Discover's suggested accounts.
 *
 * Deliberately small and muted (a disclosure, not a banner) but never
 * `aria-hidden` — it's plain text, so it reaches screen readers the same as
 * sighted users. No emoji (house rule); a plain inline SVG glyph instead.
 *
 * Server-safe (no hooks) — usable from either a server or a client component.
 */
export function CommunityBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="font-body"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        flexShrink: 0,
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 600,
        color: "#8a948f",
        whiteSpace: "nowrap",
      }}
    >
      <svg width={compact ? 10 : 11} height={compact ? 10 : 11} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" /><path d="M12 16h.01" />
      </svg>
      YourScore community account
    </span>
  );
}
