BEGIN;

-- Review an existing relation separately before making any schema changes.
DO $$
BEGIN
  IF to_regclass('public.tasks') IS NOT NULL THEN
    RAISE EXCEPTION 'public.tasks already exists. Run verify_schema.sql and inspect the existing schema before applying changes.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  description text,
  priority text NOT NULL DEFAULT 'normal',
  due_date date,

  CONSTRAINT tasks_title_check
    CHECK (title ~ '[^[:space:]]' AND char_length(title) <= 200),
  CONSTRAINT tasks_status_check
    CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
  CONSTRAINT tasks_priority_check
    CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT tasks_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX tasks_user_status_idx ON public.tasks (user_id, status);

COMMIT;
