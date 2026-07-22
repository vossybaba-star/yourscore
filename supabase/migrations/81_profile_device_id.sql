-- Durable anonymous device id, linked to the profile at signup (via
-- /api/profile/source). Survives the guest→signup transition so a player's
-- pre-signup guest activity can later be attributed to their account. Written
-- once and never overwritten (first-touch), same pattern as the acquisition
-- source added in 74_profile_acquisition_source.sql.
alter table profiles
  add column if not exists device_id text;

-- Look-ups go device_id → profile (given a guest device, find the account it
-- became), so index the column. Not unique: two people can share a device.
create index if not exists profiles_device_id_idx on profiles (device_id);
