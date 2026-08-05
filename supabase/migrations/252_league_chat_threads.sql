-- 252_league_chat_threads.sql — Social Phase 4a: league chat replies + a pinned
-- message.
--
-- comments.parent_id ALREADY EXISTS — migration 221 (comment_replies) added it
-- for pack/debate threads, one level deep, enforced by its
-- comments_validate_reply_trg trigger (same-subject, parent must exist and be
-- undeleted, no replying to a reply). League chat rides the SAME `comments`
-- table (migration 209), so a reply here is already fully wired at the
-- database level with no further DDL — this statement is a documented no-op
-- kept for portability (an environment that somehow reached 252 without 221
-- would still end up correct) and so this file is a complete, honest record
-- of what the chat's schema depends on. Ditto comments_parent_idx (mig 221):
-- it already covers `parent_id` lookups, so no second index is added here.
--
-- lib/fantasy/chat.ts's insertChatMessage flattens a reply-to-a-reply to the
-- ORIGINAL top-level message before insert (rather than let the trigger raise
-- and surface a raw Postgres error), matching the one-level model 221 already
-- encodes; the UI additionally hides the Reply affordance on a message that's
-- itself a reply, so tapping "Reply" only ever targets a top-level message.
--
-- pinned_message_id on fantasy_leagues holds at most one pinned message per
-- league (owner-set) — same one-pointer-column idiom as migration 251's
-- profiles.pinned_event_id. This is the one genuinely NEW column here.
--
-- Written but NOT applied here (reviewer applies at ship time) — pin is
-- wrapped so the app degrades gracefully while pinned_message_id is absent
-- (pin controls stay hidden, the rest of the chat loads exactly as it does
-- today), same discipline as migrations 250 and 251. Replies need nothing
-- further to ship — they're already live on this column via 221.

begin;

alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete cascade;

alter table public.fantasy_leagues add column if not exists pinned_message_id uuid;

commit;
