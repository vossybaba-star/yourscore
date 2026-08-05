"use client";
/**
 * A single post as its own screen (Phase 3a) — the full card (reusing
 * FeedStream's <FeedCard/> rather than duplicating its render logic) plus the
 * discussion thread, expanded by default underneath (not the card's own
 * collapsed inline copy, which `detail` suppresses on FeedCard).
 *
 * Guests can view; contributing (react/comment/repost/quote) still prompts
 * sign-in via the existing 401-redirect patterns each control already has.
 */
import { BackPill } from "@/components/ui/BackPill";
import { DiscussionThread } from "@/components/debate/DiscussionThread";
import { FeedCard, type FeedEvent } from "@/components/fantasy/FeedStream";
import { TEAL } from "@/components/fantasy/shared";

export function PostDetailView({ event }: { event: FeedEvent }) {
  const signInNext = `/fantasy/social/post/${event.id}`;
  return (
    <div>
      <BackPill fallback="/fantasy/social" />
      <div style={{ marginTop: 12 }}>
        <FeedCard ev={event} signInNext={signInNext} detail />
      </div>
      <div style={{ marginTop: 4 }}>
        <DiscussionThread subjectType="fantasy_feed" subjectId={event.id} title="Comments" accent={TEAL} signInNext={signInNext} />
      </div>
    </div>
  );
}
