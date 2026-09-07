-- Data-only migration: Knowledge Center dropped its separate "知识点"
-- (KnowledgeNode) browse/manage UI in favor of tags — the two overlapped
-- (both were "attach a label to a resource, browse by it"). The
-- KnowledgeNode model/table/API are untouched (kept in case something else
-- still depends on them), but any resource that was classified under a
-- knowledge point would otherwise lose that classification entirely once
-- the UI to see it is gone. This converts each *used* knowledge node into a
-- same-named resource-scoped tag and re-attaches its resources to that tag,
-- so the classification survives the UI change.
--
-- "Used" = has at least one resource_knowledge_nodes row. Unused knowledge
-- nodes (defined but never applied to a resource) have nothing to migrate
-- and are left alone, same as the KnowledgeNode table itself.

-- 1. One resource-scoped tag per (user, knowledge node name) that's actually
--    in use, skipping any that already exists (e.g. a same-named resource
--    tag the teacher created by hand before this migration ran).
INSERT INTO "tags" (id, user_id, scope, name, color, created_at)
SELECT DISTINCT gen_random_uuid(), kn.user_id, 'resource', kn.name, '#8B5CF6', now()
FROM "knowledge_nodes" kn
WHERE kn.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM "resource_knowledge_nodes" rkn WHERE rkn.knowledge_node_id = kn.id)
  AND NOT EXISTS (
    SELECT 1 FROM "tags" t WHERE t.user_id = kn.user_id AND t.scope = 'resource' AND t.name = kn.name
  );

-- 2. Attach every resource that was under a knowledge node to that node's
--    (now-guaranteed-to-exist) resource-scoped tag counterpart.
INSERT INTO "resource_tags" (resource_id, tag_id, user_id, created_at)
SELECT DISTINCT rkn.resource_id, t.id, kn.user_id, now()
FROM "resource_knowledge_nodes" rkn
JOIN "knowledge_nodes" kn ON kn.id = rkn.knowledge_node_id AND kn.deleted_at IS NULL
JOIN "tags" t ON t.user_id = kn.user_id AND t.scope = 'resource' AND t.name = kn.name
ON CONFLICT (resource_id, tag_id) DO NOTHING;
