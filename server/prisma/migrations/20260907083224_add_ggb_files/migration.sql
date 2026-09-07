-- DropIndex
DROP INDEX "resource_chunks_content_trgm_idx";

-- DropIndex
DROP INDEX "resources_filename_trgm_idx";

-- DropIndex
DROP INDEX "resources_title_trgm_idx";

-- DropIndex
DROP INDEX "tags_name_trgm_idx";

-- CreateTable
CREATE TABLE "ggb_files" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "checksum" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "ggb_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ggb_files_user_id_deleted_at_idx" ON "ggb_files"("user_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "ggb_files" ADD CONSTRAINT "ggb_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
