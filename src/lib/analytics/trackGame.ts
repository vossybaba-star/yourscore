import { track } from "@vercel/analytics";
import { afLogEvent } from "@/lib/native/appsflyer";
import { afGameComplete, afInviteSent, type InviteSurface } from "@/lib/analytics/appsflyerEvents";

// Which game a Player is engaging with. Drives per-game ad audiences.
export type GameId = "38-0" | "quiz";

const GOOGLE_ADS_PLAY_SEND_TO = process.env.NEXT_PUBLIC_GOOGLE_ADS_PLAY_SEND_TO;
type GameEvent = "play" | "complete";

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: { track?: (...args: unknown[]) => void };
    gtag?: (...args: unknown[]) => void;
    snaptr?: (...args: unknown[]) => void;
  }
}

// X (Twitter) custom events must be pre-created in X Events Manager and referenced
// by ID. Each fires only once its env var is set; until then X is covered by the
// existing URL-based website audiences (/38-0/* vs quiz routes). Keys are `${event}_${game}`.
const X_EVENT_IDS: Record<string, string | undefined> = {
  "play_38-0": process.env.NEXT_PUBLIC_X_PLAY_38_0_EVENT_ID,
  "complete_38-0": process.env.NEXT_PUBLIC_X_COMPLETE_38_0_EVENT_ID,
  "play_quiz": process.env.NEXT_PUBLIC_X_PLAY_QUIZ_EVENT_ID,
  "complete_quiz": process.env.NEXT_PUBLIC_X_COMPLETE_QUIZ_EVENT_ID,
};

// Distinct custom-event names per (event, game) so every ad platform can define an
// audience from the event name alone (Meta/TikTok), with `game` also in the payload
// for platforms that segment on parameters (GA4).
function eventName(event: GameEvent, game: GameId): string {
  const g = game === "38-0" ? "380" : "Quiz";
  return event === "play" ? `Play${g}` : `Complete${g}`;
}

/**
 * Fires a single game-play signal across every ad/analytics platform, tagged with
 * which game (`38-0` vs `quiz`). Mirrors the SignupPixel pattern: every call is guarded
 * (`?.`) so a missing/blocked pixel never throws and never blocks the others.
 *
 * Call `trackGamePlay` when a Player begins a Game and `trackGameComplete` when they
 * finish one. Safe to call from any client component; no-ops during SSR.
 */
function trackGameEvent(game: GameId, event: GameEvent, props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload: Props = { game, ...props };
  const name = eventName(event, game);

  // X (Twitter) — only when an Events-Manager event ID is configured.
  const xId = X_EVENT_IDS[`${event}_${game}`];
  if (xId) window.twq?.("event", xId, payload);

  // Meta — custom event, distinct name per game.
  window.fbq?.("trackCustom", name, payload);

  // TikTok — custom event, distinct name per game.
  window.ttq?.track?.(name, payload);

  // TikTok ONLY optimises ad delivery toward its STANDARD events — custom events
  // (Play380/Complete380 etc.) are tracked + audience-eligible but NOT optimisable
  // (confirmed via TikTok's own docs, 2026-07-06). So on a *play* we additionally fire
  // the standard `ViewContent` event as TikTok's play proxy. It fires ONLY here, never
  // on page views, so `ViewContent` ≈ plays and the TikTok ad group can optimise toward
  // real players (not site browsers). TikTok-only — Meta still optimises on `Play380`,
  // X on its play event. `game` is carried so reporting still splits 38-0 vs quiz.
  // Full rationale + rollout steps: ~/.claude/.../memory/project_yourscore_tiktok_viewcontent.md
  if (event === "play") {
    window.ttq?.track?.("ViewContent", { ...payload, content_id: game, content_type: "play" });
  }

  // Snapchat — custom event slots (1 = play, 2 = complete); game carried in params.
  window.snaptr?.("track", event === "play" ? "CUSTOM_EVENT_1" : "CUSTOM_EVENT_2", payload);

  // Google Analytics 4 — single event keyed on the `game` param for audiences.
  window.gtag?.("event", event === "play" ? "play_game" : "complete_game", payload);

  // Google Ads — fires a conversion on play once the send_to label is configured.
  if (event === "play" && GOOGLE_ADS_PLAY_SEND_TO) {
    window.gtag?.("event", "conversion", { send_to: GOOGLE_ADS_PLAY_SEND_TO });
  }

  // Vercel Analytics.
  track(event === "play" ? "play_game" : "complete_game", payload);

  // AppsFlyer (native only) — log plays so app-install campaigns can optimise toward players.
  if (event === "play") {
    void afLogEvent("play_game", { game });
  } else {
    // Rich completion event + one-time first_game_complete (the activation milestone
    // the SKAN schema + quality-CPI analysis key on). Map the loose call-site props.
    const result = props.result ?? props.outcome;
    afGameComplete({
      game,
      mode: props.mode != null ? String(props.mode) : "",
      competition: props.competition != null ? String(props.competition) : undefined,
      result: result != null ? String(result) : undefined,
      score: typeof props.score === "number" ? props.score : undefined,
      isShadow: props.is_shadow === true || props.shadow === true,
    });
  }
}

export const trackGamePlay = (game: GameId, props?: Props): void => trackGameEvent(game, "play", props);
export const trackGameComplete = (game: GameId, props?: Props): void => trackGameEvent(game, "complete", props);

// ── Download (app-install intent) ────────────────────────────────────────────
// Fired when a Player taps a "Get the app" / App Store CTA on the web. NOTE: a real
// App Store install can't be observed from the web — this is the download-INTENT
// signal, used to build "wants the app" ad audiences and let X optimise toward
// downloads. True install attribution needs Apple App Analytics or an MMP (separate).
// X needs a pre-created Events-Manager event ID; fires only once the env var is set.
const X_DOWNLOAD_EVENT_ID = process.env.NEXT_PUBLIC_X_DOWNLOAD_EVENT_ID;

export function trackDownload(props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload: Props = { platform: "ios", ...props };

  if (X_DOWNLOAD_EVENT_ID) window.twq?.("event", X_DOWNLOAD_EVENT_ID, payload); // X (Twitter)
  window.fbq?.("trackCustom", "Download", payload);    // Meta
  window.ttq?.track?.("Download", payload);             // TikTok (standard Download event)
  window.snaptr?.("track", "CUSTOM_EVENT_3", payload); // Snapchat (1=play · 2=complete · 3=download)
  window.gtag?.("event", "download_app", payload);      // Google Analytics 4
  track("download_app", payload);                       // Vercel Analytics
}

// ── Share (viral-loop intent) ────────────────────────────────────────────────
// Fired when a Player shares a scorecard / result / invite (native share sheet or
// clipboard copy). Powers "sharers" ad audiences and virality measurement. `content`
// names what was shared (e.g. "scorecard", "live-result", "league", "h2h-invite").
// X needs a pre-created Events-Manager event ID; fires only once the env var is set.
const X_SHARE_EVENT_ID = process.env.NEXT_PUBLIC_X_SHARE_EVENT_ID;

export function trackShare(content: string, props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload: Props = { content, ...props };

  if (X_SHARE_EVENT_ID) window.twq?.("event", X_SHARE_EVENT_ID, payload); // X (Twitter)
  window.fbq?.("trackCustom", "Share", payload);        // Meta
  window.ttq?.track?.("Share", payload);                // TikTok (custom Share event)
  window.snaptr?.("track", "CUSTOM_EVENT_4", payload);  // Snapchat (1=play · 2=complete · 3=download · 4=share)
  window.gtag?.("event", "share", payload);             // Google Analytics 4
  track("share", payload);                              // Vercel Analytics

  // AppsFlyer (native only) — the viral event; map `content` → invite surface.
  const surfaceMap: Record<string, InviteSurface> = {
    scorecard: "scorecard",
    "live-result": "live-result",
    league: "league",
    "h2h-invite": "h2h",
    h2h: "h2h",
    "shadow-revenge": "shadow-revenge",
    lobby: "lobby",
  };
  afInviteSent({
    surface: surfaceMap[content] ?? "other",
    channel: typeof props.channel === "string" ? props.channel : undefined,
  });
}
