ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS tasks_owner_id_created_at_id_idx
  ON tasks (owner_id, created_at DESC, id DESC);
