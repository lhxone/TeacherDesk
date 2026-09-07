-- Split the shared `tags` table into two namespaces (student vs resource)
-- via a `scope` column, so a teacher can have e.g. "课代表" independently in
-- both the class-management and Knowledge Center features without collision.
--
-- Data migration: every existing tag becomes scope='student' by default
-- (preserves student_tags associations as-is, no new rows needed there).
-- Any tag that ALSO has resource_tags rows gets a second, resource-scoped
-- copy of itself (same name/color), and every resource_tags row is
-- repointed from the old shared tag id to that new resource-scoped copy —
-- so no resource loses its tag, and the student side is untouched.

-- 1. Add the column, defaulting existing rows to 'student' (matches how
--    this table originated — student tagging shipped first).
ALTER TABLE "tags" ADD COLUMN "scope" VARCHAR(16) NOT NULL DEFAULT 'student';

-- 2. Drop the old (user_id, name) uniqueness before inserting the
--    resource-scoped duplicates below — a same-named duplicate is exactly
--    what step 3 needs to insert, so the old constraint has to go first.
DROP INDEX IF EXISTS "tags_user_id_name_key";

-- 3. For every tag that has at least one resource_tags row, create a
--    resource-scoped duplicate (new id, same user/name/color).
INSERT INTO "tags" (id, user_id, scope, name, color, created_at)
SELECT gen_random_uuid(), t.user_id, 'resource', t.name, t.color, t.created_at
FROM "tags" t
WHERE EXISTS (SELECT 1 FROM "resource_tags" rt WHERE rt.tag_id = t.id)
  AND t.scope = 'student';

-- 4. Repoint every resource_tags row from the original (still student-
--    scoped at this point) tag id to its new resource-scoped duplicate,
--    matched by user+name.
UPDATE "resource_tags" rt
SET tag_id = new_t.id
FROM "tags" old_t
JOIN "tags" new_t
  ON new_t.user_id = old_t.user_id
 AND new_t.name = old_t.name
 AND new_t.scope = 'resource'
WHERE rt.tag_id = old_t.id
  AND old_t.scope = 'student';

-- 5. Enforce the new per-scope uniqueness. The column keeps its
--    DEFAULT 'student' (matches the Prisma schema's @default) — it's just
--    a backfill/safety default, the app always sends scope explicitly on
--    create.
CREATE UNIQUE INDEX "tags_user_id_scope_name_key" ON "tags"("user_id", "scope", "name");
