-- Partial indexes from ER.md §4 that Prisma's schema language cannot express.
-- Apply after `prisma db push` / `prisma migrate deploy`.
--
-- These enforce "unique among non-deleted rows" semantics: without the
-- WHERE clause a soft-deleted row would keep blocking its student number /
-- email forever.

DROP INDEX IF EXISTS uq_students_no;
CREATE UNIQUE INDEX uq_students_no
  ON students (class_id, student_no)
  WHERE student_no IS NOT NULL AND deleted_at IS NULL;

-- Only one seating chart per class may be active at a time.
DROP INDEX IF EXISTS uq_chart_active;
CREATE UNIQUE INDEX uq_chart_active
  ON seating_charts (class_id)
  WHERE is_active AND deleted_at IS NULL;

-- One lesson per weekday+period+repeat rule, among non-deleted slots.
DROP INDEX IF EXISTS uq_slot_cell;
CREATE UNIQUE INDEX uq_slot_cell
  ON schedule_slots (user_id, weekday, period, repeat_rule)
  WHERE deleted_at IS NULL;
