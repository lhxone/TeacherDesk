-- Introduce exam_sessions to group the per-subject "exams" rows that belong
-- to one exam occasion (e.g. "第一次月考" spanning 语文/数学/英语).
--
-- exams.exam_session_id is added nullable first, backfilled with one new
-- exam_sessions row per existing exams row (1:1, preserving current
-- behaviour), then made NOT NULL.

CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "class_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "exam_type" VARCHAR(16) NOT NULL DEFAULT 'daily',
    "exam_date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exam_sessions_class_id_exam_date_idx" ON "exam_sessions"("class_id", "exam_date");

ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one exam_sessions row per existing exams row, carrying over
-- name/exam_type/exam_date/note/class_id/created_at/updated_at so existing
-- exams keep their identity as a single-subject session.
ALTER TABLE "exams" ADD COLUMN "exam_session_id" UUID;

DO $$
DECLARE
    r RECORD;
    new_session_id UUID;
BEGIN
    FOR r IN SELECT id, class_id, name, exam_type, exam_date, note, created_at, updated_at FROM "exams" LOOP
        new_session_id := gen_random_uuid();
        INSERT INTO "exam_sessions" (id, class_id, name, exam_type, exam_date, note, created_at, updated_at)
        VALUES (new_session_id, r.class_id, r.name, r.exam_type, r.exam_date, r.note, r.created_at, r.updated_at);

        UPDATE "exams" SET exam_session_id = new_session_id WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE "exams" ALTER COLUMN "exam_session_id" SET NOT NULL;

CREATE INDEX "exams_exam_session_id_idx" ON "exams"("exam_session_id");

ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_session_id_fkey"
    FOREIGN KEY ("exam_session_id") REFERENCES "exam_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
