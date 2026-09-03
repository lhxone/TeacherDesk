-- AlterTable
ALTER TABLE "event_occurrences" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "exam_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "knowledge_nodes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "subject" VARCHAR(32),
    "grade" VARCHAR(32),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_collections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "resource_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_tags" (
    "resource_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_tags_pkey" PRIMARY KEY ("resource_id","tag_id")
);

-- CreateTable
CREATE TABLE "resource_knowledge_nodes" (
    "resource_id" UUID NOT NULL,
    "knowledge_node_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_knowledge_nodes_pkey" PRIMARY KEY ("resource_id","knowledge_node_id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(32),
    "grade" VARCHAR(32),
    "note" TEXT,
    "collection_id" UUID,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "checksum" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "parse_error" TEXT,
    "page_count" INTEGER,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_chunks" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "page_number" INTEGER,
    "section_label" VARCHAR(255),
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_nodes_user_id_parent_id_idx" ON "knowledge_nodes"("user_id", "parent_id");

-- CreateIndex
CREATE INDEX "resource_collections_user_id_parent_id_idx" ON "resource_collections"("user_id", "parent_id");

-- CreateIndex
CREATE INDEX "resource_tags_tag_id_idx" ON "resource_tags"("tag_id");

-- CreateIndex
CREATE INDEX "resource_knowledge_nodes_knowledge_node_id_idx" ON "resource_knowledge_nodes"("knowledge_node_id");

-- CreateIndex
CREATE INDEX "resources_user_id_type_status_idx" ON "resources"("user_id", "type", "status");

-- CreateIndex
CREATE INDEX "resources_user_id_collection_id_idx" ON "resources"("user_id", "collection_id");

-- CreateIndex
CREATE INDEX "resources_user_id_is_favorite_idx" ON "resources"("user_id", "is_favorite");

-- CreateIndex
CREATE INDEX "resources_user_id_last_used_at_idx" ON "resources"("user_id", "last_used_at");

-- CreateIndex
CREATE INDEX "resource_chunks_resource_id_page_number_idx" ON "resource_chunks"("resource_id", "page_number");

-- CreateIndex
CREATE UNIQUE INDEX "resource_chunks_resource_id_ordinal_key" ON "resource_chunks"("resource_id", "ordinal");

-- AddForeignKey
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_nodes" ADD CONSTRAINT "knowledge_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_collections" ADD CONSTRAINT "resource_collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_collections" ADD CONSTRAINT "resource_collections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "resource_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_knowledge_nodes" ADD CONSTRAINT "resource_knowledge_nodes_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_knowledge_nodes" ADD CONSTRAINT "resource_knowledge_nodes_knowledge_node_id_fkey" FOREIGN KEY ("knowledge_node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "resource_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_chunks" ADD CONSTRAINT "resource_chunks_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Full-text search: pg_trgm trigram indexes, not tsvector.
--
-- Postgres's built-in text search configs (including 'simple') tokenize on
-- Unicode word boundaries: a run of CJK characters with no spaces becomes ONE
-- lexeme, not one per word. That makes tsvector/ts_rank effectively unusable
-- for Chinese substring search without a language-aware parser extension
-- (e.g. zhparser) — which needs a custom-built Postgres image, ruled out here
-- to keep the stock postgres:15-alpine image and no CI/deploy complexity.
--
-- pg_trgm indexes character trigrams instead of words, so it needs no word
-- segmentation at all and works the same for CJK and Latin text: `ILIKE
-- '%关键词%'` is index-accelerated by a GIN(… gin_trgm_ops) index, and
-- `similarity()` gives a relevance score for ranking. This is the same
-- extension Postgres itself ships for this exact problem — no Elasticsearch,
-- no separate service, no image changes.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "resources_title_trgm_idx" ON "resources" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "resources_filename_trgm_idx" ON "resources" USING GIN ("original_filename" gin_trgm_ops);
CREATE INDEX "resource_chunks_content_trgm_idx" ON "resource_chunks" USING GIN ("content" gin_trgm_ops);
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING GIN ("name" gin_trgm_ops);
