CREATE TABLE "surveys" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
  "public_token" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fields" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "surveys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "surveys_status_check" CHECK ("status" IN ('draft', 'published', 'closed')),
  CONSTRAINT "surveys_version_check" CHECK ("version" > 0)
);

CREATE TABLE "survey_responses" (
  "id" UUID NOT NULL,
  "survey_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "fields" JSONB NOT NULL,
  "answers" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "survey_files" (
  "id" UUID NOT NULL,
  "response_id" UUID NOT NULL,
  "field_id" VARCHAR(64) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "storage_path" VARCHAR(512) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "survey_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "survey_files_size_check" CHECK ("file_size" > 0 AND "file_size" <= 10485760)
);

CREATE UNIQUE INDEX "surveys_public_token_key" ON "surveys"("public_token");
CREATE INDEX "surveys_user_id_deleted_at_created_at_idx" ON "surveys"("user_id", "deleted_at", "created_at");
CREATE INDEX "survey_responses_survey_id_created_at_idx" ON "survey_responses"("survey_id", "created_at");
CREATE UNIQUE INDEX "survey_files_response_id_field_id_key" ON "survey_files"("response_id", "field_id");
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_files" ADD CONSTRAINT "survey_files_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
