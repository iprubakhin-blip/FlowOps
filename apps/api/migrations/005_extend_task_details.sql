ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS due_at DATE,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_completed_at_status_chk;
ALTER TABLE tasks ADD CONSTRAINT tasks_completed_at_status_chk
  CHECK (status = 'done' OR completed_at IS NULL);

CREATE INDEX IF NOT EXISTS tasks_due_at_open_idx
  ON tasks (due_at)
  WHERE due_at IS NOT NULL AND status <> 'done';
