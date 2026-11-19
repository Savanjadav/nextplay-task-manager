BEGIN;

-- Use the read-only checks in verify_rls.sql before running this script.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.tasks') AND relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'Expected public.tasks to be an ordinary table. Inspect the schema before applying policies.';
  END IF;
END;
$$;

-- Keep the security checks and policy changes under the same table lock.
LOCK TABLE public.tasks IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tasks'::regclass) THEN
    RAISE EXCEPTION 'RLS is disabled on public.tasks. Inspect the existing security settings.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.tasks'::regclass) THEN
    RAISE EXCEPTION 'public.tasks already has policies. Inspect them with verify_rls.sql.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS task_table
    CROSS JOIN LATERAL aclexplode(task_table.relacl) AS grant_entry
    WHERE task_table.oid = 'public.tasks'::regclass
      AND grant_entry.grantee <> task_table.relowner
      AND NOT (
        grant_entry.grantee = 'service_role'::regrole
        AND grant_entry.privilege_type IN ('REFERENCES', 'TRIGGER', 'TRUNCATE', 'MAINTAIN')
        AND NOT grant_entry.is_grantable
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS task_column
    CROSS JOIN LATERAL aclexplode(task_column.attacl) AS grant_entry
    WHERE task_column.attrelid = 'public.tasks'::regclass
      AND task_column.attnum > 0
      AND NOT task_column.attisdropped
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES ('anon'), ('authenticated')) AS browser_role(role_name)
    WHERE has_table_privilege(role_name, 'public.tasks', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       OR has_any_column_privilege(role_name, 'public.tasks', 'SELECT, INSERT, UPDATE, REFERENCES')
  ) THEN
    RAISE EXCEPTION 'public.tasks has unexpected table or column grants, or effective browser-role privileges. Inspect them with verify_rls.sql before retrying.';
  END IF;

  IF NOT has_schema_privilege('authenticated', 'public', 'USAGE') THEN
    GRANT USAGE ON SCHEMA public TO authenticated;
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;

CREATE POLICY tasks_select_own ON public.tasks
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY tasks_insert_own ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY tasks_update_own ON public.tasks
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY tasks_delete_own ON public.tasks
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

COMMIT;
