/**
 * Social feed analytics (Phase 5b, AC4 — master prompt §27). Client-side,
 * fire-and-forget, no PII beyond ids already used elsewhere in the app.
 *
 * These are product/UX diagnostics (which tab, which sort, what got tapped),
 * not acquisition/conversion events — so this follows trackGame.ts's OWN
 * `trackDiag` transport, not its full ad-platform fan-out (X/Meta/TikTok/
 * Snapchat/AppsFlyer): trackDiag's comment explains why — "Sparse events
 * starve delivery optimisation, so these deliberately stay out of the pixel
 * fan-outs." A feed tab switch or a poll vote is exactly that kind of sparse,
 * high-cardinality, non-bid event. GA4 (`gtag`) + Vercel Analytics both still
 * get every event, same as every other surface in the app.
 */
import { track } from "@vercel/analytics";
import { isNative } from "@/lib/native";

type Props = Record<string, string | number | boolean>;

function clientTag(): "native" | "web" {
  return isNative() ? "native" : "web";
}

function fire(name: string, props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload: Props = { client: clientTag(), ...props };
  window.gtag?.("event", name, payload); // Google Analytics 4
  track(name, payload);                  // Vercel Analytics
}

export function trackFeedTabChanged(tab: string): void { fire("feed_tab_changed", { tab }); }
export function trackFeedSortChanged(sort: string): void { fire("feed_sort_changed", { sort }); }
export function trackPostOpened(type: string): void { fire("post_opened", { type }); }
export function trackMediaOpened(): void { fire("media_opened"); }
export function trackComposerOpened(): void { fire("composer_opened"); }
export function trackPostCreated(props: { hasImages: boolean; hasGif: boolean; hasPoll: boolean; hasLink: boolean; attachment: string }): void {
  fire("post_created", props);
}
export function trackPostAbandoned(): void { fire("post_abandoned"); }
export function trackReactionAdded(emoji: string): void { fire("reaction_added", { emoji }); }
export function trackReplyCreated(): void { fire("reply_created"); }
export function trackRepostCreated(): void { fire("repost_created"); }
export function trackQuoteCreated(): void { fire("quote_created"); }
export function trackBookmarkAdded(): void { fire("bookmark_added"); }
export function trackShareOpened(): void { fire("share_opened"); }
export function trackFollowClicked(): void { fire("follow_clicked"); }
export function trackPollVoted(): void { fire("poll_voted"); }
export function trackDiscoverFilterSelected(filter: string): void { fire("discover_filter_selected", { filter }); }
export function trackSearchPerformed(resultCounts: Record<string, number>): void { fire("search_performed", resultCounts); }
export function trackReportSubmitted(subjectType: string): void { fire("report_submitted", { subjectType }); }
export function trackBlockUser(): void { fire("block_user"); }
export function trackMuteUser(): void { fire("mute_user"); }

// ── @mention autocomplete (Phase 1A) ─────────────────────────────────────
// Content-free by design — a `surface` label ("post" | "reply" | "chat") and
// counts only, never the handle/text itself.
export function trackMentionAutocompleteOpened(surface: string): void { fire("mention_autocomplete_opened", { surface }); }
export function trackMentionSelected(surface: string): void { fire("mention_selected", { surface }); }
export function trackMentionPublished(surface: string, count: number): void { fire("mention_published", { surface, count }); }

// ── member action sheet (Phase 1B) ───────────────────────────────────────
// Counts only, never the target's id/handle — same content-free shape as the
// mention events above.
export function trackMemberSheetOpened(context: string): void { fire("member_sheet_opened", { context }); }
export function trackMemberActionSelected(action: string): void { fire("member_action_selected", { action }); }
export function trackCompareSquadsOpened(): void { fire("compare_squads_opened"); }

// ── league-mate challenges (Phase 1C) ────────────────────────────────────
export function trackChallengeFlowOpened(): void { fire("challenge_flow_opened"); }
export function trackChallengeGameSelected(gameId: string): void { fire("challenge_game_selected", { gameId }); }
export function trackChallengeSent(gameId: string): void { fire("challenge_sent", { gameId }); }
export function trackChallengeAbandoned(): void { fire("challenge_abandoned"); }

// ── native video (composer) ──────────────────────────────────────────────
export function trackVideoPickerOpened(): void { fire("video_picker_opened"); }
export function trackVideoSelected(): void { fire("video_selected"); }
export function trackVideoUploadStarted(): void { fire("video_upload_started"); }
export function trackVideoUploadCompleted(): void { fire("video_upload_completed"); }
export function trackVideoUploadFailed(): void { fire("video_upload_failed"); }
export function trackVideoUploadRetried(): void { fire("video_upload_retried"); }
export function trackVideoRemoved(): void { fire("video_removed"); }
export function trackVideoPostPublished(): void { fire("video_post_published"); }

// ── native video (social spread, Phase 2c) ───────────────────────────────
// Counts only — where composer/playback events already exist (video_picker_
// opened, video_upload_started, etc.), replies and chat reuse them as-is;
// these two are the only genuinely new events this phase adds.
export function trackVideoReplyPublished(): void { fire("video_reply_published"); }
export function trackVideoChatMessageSent(): void { fire("video_chat_message_sent"); }

// ── native video (playback) ──────────────────────────────────────────────
export function trackVideoImpression(): void { fire("video_impression"); }
export function trackVideoPlay(mode: "auto" | "tap"): void { fire("video_play", { mode }); }
export function trackVideoSoundOn(): void { fire("video_sound_on"); }
export function trackVideoQuartile(milestone: "q25" | "q50" | "q75" | "completed"): void { fire(`video_${milestone}`); }
export function trackVideoFullscreenOpened(): void { fire("video_fullscreen_opened"); }
export function trackVideoError(): void { fire("video_error"); }
