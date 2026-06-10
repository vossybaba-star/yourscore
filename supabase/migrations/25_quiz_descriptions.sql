-- Add description column to quiz_packs for richer pack cards and detail pages
ALTER TABLE quiz_packs ADD COLUMN IF NOT EXISTS description text;
