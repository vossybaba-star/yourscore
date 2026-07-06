/**
 * sentry.mjs — Layer 5: anything new or spiking in prod errors?
 *
 * Uses the read token + the exact endpoint documented in CLAUDE.md
 * ("Debugging errors — CHECK SENTRY FIRST"). Red = a brand-new issue in the
 * window or a big spike; warn = elevated count. Thresholds are deliberately
 * conservative until a few days of real runs calibrate them.
 */

const HOST = "https://de.sentry.io";
const PROJECT = "projects/yourscore/javascript-nextjs";
const WINDOW = "6h";
const RED_NEW_ISSUE = true; // any issue born in the window
const RED_COUNT = 25;
const WARN_COUNT = 10;

// Known browser/webview noise that isn't a product bug — never red, never warn.
// "__firefox__" = Firefox iOS injecting its own content script into the page;
// it paged every run at ×100 while affecting nobody.
const NOISE = [
  /__firefox__/,
  /Java object is gone/, // Android WebView teardown race
  /ResizeObserver loop/,
  /Loading chunk .* after logout/,
];
const isNoise = (i) => NOISE.some((re) => re.test(i.title ?? ""));

export async function run(report) {
  const token = process.env.SENTRY_READ_TOKEN;
  if (!token) {
    report.add("sentry", "sweep", true, { warn: true, detail: "SENTRY_READ_TOKEN not set — skipped" });
    return;
  }

  let issues;
  try {
    // statsPeriod only accepts 24h/14d — fetch 24h, apply the 6h window locally.
    const res = await fetch(
      `${HOST}/api/0/${PROJECT}/issues/?statsPeriod=24h&query=${encodeURIComponent("is:unresolved")}&limit=25`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) throw new Error(`sentry API ${res.status}`);
    issues = await res.json();
  } catch (e) {
    report.add("sentry", "sweep", true, { warn: true, detail: `unreachable: ${e.message}` });
    return;
  }

  const cutoff = Date.now() - 6 * 3600_000;
  const noise = issues.filter(isNoise);
  issues = issues.filter((i) => !isNoise(i));
  const inWindow = issues.filter((i) => new Date(i.lastSeen).getTime() >= cutoff);
  const fresh = inWindow.filter((i) => new Date(i.firstSeen).getTime() >= cutoff);
  const spiking = inWindow.filter((i) => Number(i.count) > RED_COUNT);
  const elevated = inWindow.filter((i) => Number(i.count) > WARN_COUNT);

  const worst = fresh[0] ?? spiking[0] ?? elevated[0];
  const summary = worst ? `"${worst.title}" ×${worst.count} (${worst.culprit ?? "?"})` : "";

  if ((RED_NEW_ISSUE && fresh.length) || spiking.length) {
    report.add("sentry", "sweep", false, {
      detail: `${fresh.length} new issue(s), ${spiking.length} spiking in last ${WINDOW} — ${summary}`,
      hint: "CLAUDE.md has the curl to pull the stack trace in 5s",
    });
  } else {
    report.add("sentry", "sweep", true, {
      warn: elevated.length > 0,
      detail: elevated.length
        ? `elevated: ${summary}`
        : issues.length
          ? `quiet (top: ${issues[0].title} ×${issues[0].count})`
          : noise.length
            ? `quiet (${noise.length} known-noise issue(s) ignored)`
            : "quiet",
    });
  }
}
