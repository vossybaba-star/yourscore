// Server-side sanitizer for the client-supplied first-touch acquisition blob
// (see lib/analytics/acq.ts). Never trust the client: cap lengths, force plain
// strings, drop anything else. Returns insert-ready nullable columns.

const MAX_LEN = 120;

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, MAX_LEN);
  return s.length > 0 ? s : null;
}

export interface AcqColumns {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export function sanitizeAcq(raw: unknown): AcqColumns {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    source: clean(o.source),
    utm_source: clean(o.utm_source),
    utm_medium: clean(o.utm_medium),
    utm_campaign: clean(o.utm_campaign),
  };
}
