-- Per-week completion override for a weekly-recurring Event. A brand new
-- table with no existing data to migrate.
CREATE TABLE "event_occurrences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "event_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_occurrences_event_id_occurrence_date_key" ON "event_occurrences"("event_id", "occurrence_date");

ALTER TABLE "event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
