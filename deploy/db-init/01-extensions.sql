-- Runs once, on first initialisation of an empty data volume.
-- gen_random_uuid() comes from pgcrypto on PostgreSQL 15.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
