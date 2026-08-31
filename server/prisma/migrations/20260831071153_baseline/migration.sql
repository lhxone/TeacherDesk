-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "subject" VARCHAR(32),
    "academic_year" VARCHAR(16) NOT NULL,
    "color" VARCHAR(16) NOT NULL DEFAULT '#3B82F6',
    "note" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" UUID,
    "title" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6),
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "subject" VARCHAR(32),
    "exam_type" VARCHAR(16) NOT NULL DEFAULT 'daily',
    "exam_date" DATE NOT NULL,
    "full_score" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "note" TEXT,
    "stats_cache" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "group_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id","student_id")
);

-- CreateTable
CREATE TABLE "grouping_plans" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "grouping_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "grouping_plan_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "group_index" SMALLINT NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lottery_records" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "mode" VARCHAR(16) NOT NULL DEFAULT 'plain',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lottery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" VARCHAR(255) NOT NULL,
    "auth" VARCHAR(255) NOT NULL,
    "user_agent" VARCHAR(255),
    "label" VARCHAR(64),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "device_info" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "class_id" UUID,
    "subject" VARCHAR(32),
    "weekday" SMALLINT NOT NULL,
    "period" SMALLINT NOT NULL,
    "location" VARCHAR(64),
    "repeat_rule" VARCHAR(16) NOT NULL DEFAULT 'weekly',
    "start_date" DATE,
    "end_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scores" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "is_absent" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" UUID NOT NULL,
    "seating_chart_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "row_index" SMALLINT NOT NULL,
    "col_index" SMALLINT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seating_charts" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "row_count" SMALLINT NOT NULL,
    "col_count" SMALLINT NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "seating_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sent_reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "ref_id" VARCHAR(64) NOT NULL,
    "occurs_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sent_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_tags" (
    "student_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_tags_pkey" PRIMARY KEY ("student_id","tag_id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "student_no" VARCHAR(32),
    "gender" VARCHAR(8),
    "avatar_url" VARCHAR(512),
    "phone" VARCHAR(32),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "qq" VARCHAR(20),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "color" VARCHAR(16) NOT NULL DEFAULT '#10B981',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(64) NOT NULL,
    "avatar_url" VARCHAR(512),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classes_user_id_status_idx" ON "classes"("user_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "events_user_id_start_at_idx" ON "events"("user_id" ASC, "start_at" ASC);

-- CreateIndex
CREATE INDEX "exams_class_id_exam_date_idx" ON "exams"("class_id" ASC, "exam_date" ASC);

-- CreateIndex
CREATE INDEX "grouping_plans_class_id_idx" ON "grouping_plans"("class_id" ASC);

-- CreateIndex
CREATE INDEX "lottery_records_class_id_created_at_idx" ON "lottery_records"("class_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint" ASC);

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash" ASC);

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id" ASC, "revoked_at" ASC);

-- CreateIndex
CREATE INDEX "schedule_slots_user_id_weekday_idx" ON "schedule_slots"("user_id" ASC, "weekday" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "scores_exam_id_student_id_key" ON "scores"("exam_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "scores_student_id_idx" ON "scores"("student_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_seating_chart_id_row_index_col_index_key" ON "seat_assignments"("seating_chart_id" ASC, "row_index" ASC, "col_index" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_seating_chart_id_student_id_key" ON "seat_assignments"("seating_chart_id" ASC, "student_id" ASC);

-- CreateIndex
CREATE INDEX "seating_charts_class_id_idx" ON "seating_charts"("class_id" ASC);

-- CreateIndex
CREATE INDEX "sent_reminders_occurs_at_idx" ON "sent_reminders"("occurs_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sent_reminders_user_id_kind_ref_id_occurs_at_key" ON "sent_reminders"("user_id" ASC, "kind" ASC, "ref_id" ASC, "occurs_at" ASC);

-- CreateIndex
CREATE INDEX "students_class_id_status_idx" ON "students"("class_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tags_user_id_name_key" ON "tags"("user_id" ASC, "name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email" ASC);

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grouping_plans" ADD CONSTRAINT "grouping_plans_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_grouping_plan_id_fkey" FOREIGN KEY ("grouping_plan_id") REFERENCES "grouping_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_records" ADD CONSTRAINT "lottery_records_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lottery_records" ADD CONSTRAINT "lottery_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_seating_chart_id_fkey" FOREIGN KEY ("seating_chart_id") REFERENCES "seating_charts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_charts" ADD CONSTRAINT "seating_charts_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_reminders" ADD CONSTRAINT "sent_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_tags" ADD CONSTRAINT "student_tags_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_tags" ADD CONSTRAINT "student_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial indexes (Prisma's schema language can't express a WHERE clause on
-- an index). These enforce "unique among non-deleted rows" semantics: without
-- the WHERE clause a soft-deleted row would keep blocking its student number
-- or a duplicate active chart forever. Formerly applied by a separate
-- `prisma db execute --file prisma/partial-indexes.sql` step; folded into the
-- baseline migration so `migrate deploy` applies them exactly once, in order,
-- alongside everything else.

CREATE UNIQUE INDEX "uq_students_no"
  ON "students" ("class_id", "student_no")
  WHERE "student_no" IS NOT NULL AND "deleted_at" IS NULL;

-- Only one seating chart per class may be active at a time.
CREATE UNIQUE INDEX "uq_chart_active"
  ON "seating_charts" ("class_id")
  WHERE "is_active" AND "deleted_at" IS NULL;

-- One lesson per weekday+period+repeat rule, among non-deleted slots.
CREATE UNIQUE INDEX "uq_slot_cell"
  ON "schedule_slots" ("user_id", "weekday", "period", "repeat_rule")
  WHERE "deleted_at" IS NULL;
