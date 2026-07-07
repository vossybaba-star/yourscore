// First-touch acquisition source, as captured on landing by AcquisitionCapture
// (localStorage "ys:acq"). Attach this to play-creation API calls so each run /
// attempt row records which platform+campaign first brought this visitor —
// the server sanitizes before persisting.

export interface Acq {
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export function getAcq(): Acq | null {
  try {
    const raw = localStorage.getItem("ys:acq");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (k: string) => (typeof parsed[k] === "string" && parsed[k] ? (parsed[k] as string) : undefined);
    const acq: Acq = {
      source: pick("source"),
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
    };
    return acq.source || acq.utm_source ? acq : null;
  } catch {
    return null; // storage blocked or corrupt — play proceeds unattributed
  }
}
