-- Preflight and postflight. Expect table_exists and rls_enabled to be true.
SELECT
  COALESCE(c.relkind = 'r', false) AS table_exists,
  COALESCE(c.relrowsecurity, false) AS rls_enabled
FROM (SELECT to_regclass('public.tasks') AS relation_id) AS target
LEFT JOIN pg_class AS c ON c.oid = target.relation_id;

-- Preflight expects no rows. Postflight expects the four authenticated policies.
-- Inspect qual (USING) and with_check for the owner comparison.
SELECT
  count(*) OVER () AS policy_count,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  roles = ARRAY['authenticated'::name] AND permissive = 'PERMISSIVE' AND (
    (policyname = 'tasks_select_own' AND cmd = 'SELECT') OR
    (policyname = 'tasks_insert_own' AND cmd = 'INSERT') OR
    (policyname = 'tasks_update_own' AND cmd = 'UPDATE') OR
    (policyname = 'tasks_delete_own' AND cmd = 'DELETE')
  ) AS expected_policy
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tasks'
ORDER BY cmd, policyname;

-- Explicit grants, including any to PUBLIC or roles other than the owner.
-- Preflight allows only the reviewed service_role grants below.
-- Postflight adds authenticated CRUD. Compare the service_role rows before and after.
SELECT
  CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END AS grantee,
  g.privilege_type,
  g.is_grantable,
  CASE
    WHEN NOT g.is_grantable AND g.grantee = 'service_role'::regrole
      AND g.privilege_type IN ('REFERENCES', 'TRIGGER', 'TRUNCATE', 'MAINTAIN')
      THEN 'allowed before and after'
    WHEN NOT g.is_grantable AND g.grantee = 'authenticated'::regrole
      AND g.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      THEN 'expected only after'
    ELSE 'unexpected'
  END AS expected_phase
FROM pg_class AS c
CROSS JOIN LATERAL aclexplode(c.relacl) AS g
WHERE c.oid = to_regclass('public.tasks') AND g.grantee <> c.relowner
ORDER BY grantee, privilege_type;

-- Expect no explicit column grants either before or after.
SELECT
  a.attname AS column_name,
  CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END AS grantee,
  g.privilege_type,
  g.is_grantable
FROM pg_attribute AS a
CROSS JOIN LATERAL aclexplode(a.attacl) AS g
WHERE a.attrelid = to_regclass('public.tasks')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY column_name, grantee, privilege_type;

-- Includes inherited privileges and privileges from PUBLIC.
-- The signed-out role should have no true task privileges in either phase.
SELECT
  role_name,
  has_schema_privilege(role_name, 'public', 'USAGE') AS public_schema_usage,
  has_table_privilege(role_name, target.relation_id, 'SELECT') AS can_select,
  has_table_privilege(role_name, target.relation_id, 'INSERT') AS can_insert,
  has_table_privilege(role_name, target.relation_id, 'UPDATE') AS can_update,
  has_table_privilege(role_name, target.relation_id, 'DELETE') AS can_delete,
  has_table_privilege(role_name, target.relation_id, 'TRUNCATE') AS can_truncate,
  has_any_column_privilege(role_name, target.relation_id, 'REFERENCES') AS can_reference,
  has_table_privilege(role_name, target.relation_id, 'MAINTAIN') AS can_maintain,
  has_any_column_privilege(role_name, target.relation_id, 'SELECT, INSERT, UPDATE, REFERENCES') AS any_column_privilege
FROM (VALUES ('anon'), ('authenticated')) AS browser_role(role_name)
CROSS JOIN (SELECT to_regclass('public.tasks')::oid AS relation_id) AS target
ORDER BY role_name;
