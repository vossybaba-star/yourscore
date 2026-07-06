-- Allow status='expired' on rooms.
--
-- The hourly /api/cron/cleanup-lobbies sweep flips abandoned player lobbies
-- (status='lobby' older than 3h) to 'expired'. The route assumed rooms.status
-- was free text, but prod has rooms_status_check allowing only
-- lobby/live/completed — so every sweep failed with a constraint violation.
-- Widen the constraint to include 'expired'.

alter table rooms drop constraint rooms_status_check;
alter table rooms add constraint rooms_status_check
  check (status = any (array['lobby'::text, 'live'::text, 'completed'::text, 'expired'::text]));
