-- Nullable, no backfill needed: NULL means "not recurring" (the existing
-- behaviour for every current row), non-null (1..7) marks a weekly-recurring
-- todo (e.g. "每周三值班").
ALTER TABLE "events" ADD COLUMN "repeat_weekday" SMALLINT;
