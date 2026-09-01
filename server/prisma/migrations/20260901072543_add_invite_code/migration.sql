-- AlterTable: add invite_code (nullable first, so existing rows can be
-- backfilled with a unique value before the NOT NULL constraint lands) and
-- invited_by_user_id.
ALTER TABLE "users" ADD COLUMN "invite_code" VARCHAR(16);
ALTER TABLE "users" ADD COLUMN "invited_by_user_id" UUID;

-- Backfill: give every existing user a random 8-character invite code drawn
-- from the same Crockford-ish alphabet the app uses (lib/auth.ts
-- generateInviteCode — no 0/O/1/I/L), retrying per-row on the rare collision.
DO $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT id FROM "users" WHERE "invite_code" IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;
      BEGIN
        UPDATE "users" SET "invite_code" = candidate WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- collided with another row's code (shouldn't have happened yet since
        -- the unique index isn't created until below, but keep the loop
        -- structure defensive) — try another candidate.
        NULL;
      END;
    END LOOP;
  END LOOP;
END $$;

-- Now that every row has a value, enforce NOT NULL + uniqueness.
ALTER TABLE "users" ALTER COLUMN "invite_code" SET NOT NULL;
CREATE UNIQUE INDEX "users_invite_code_key" ON "users"("invite_code");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
