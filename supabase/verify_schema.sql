-- Expect table_exists and rls_enabled to both be true.
SELECT
  COALESCE(c.relkind IN ('r', 'p'), false) AS table_exists,
  COALESCE(c.relrowsecurity, false) AS rls_enabled
FROM (SELECT to_regclass('public.tasks') AS relation_id) AS target
LEFT JOIN pg_class AS c ON c.oid = target.relation_id;

-- Review all eight column definitions, including nullability and defaults.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tasks'
ORDER BY ordinal_position;

-- Expect the id primary key, auth.users foreign key with CASCADE, and three checks.
SELECT conname AS constraint_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = to_regclass('public.tasks')
  AND contype IN ('p', 'f', 'c')
ORDER BY conname;

-- Expect the primary key index and tasks_user_status_idx on (user_id, status).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'tasks'
ORDER BY indexname;

-- Expect no rows before Task 3.3.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tasks'
ORDER BY policyname;

-- Expect no grants to either browser-facing role or to PUBLIC.
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'tasks'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;
