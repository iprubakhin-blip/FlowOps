CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  team VARCHAR(60) NOT NULL,
  priority VARCHAR(10) NOT NULL CHECK (priority IN ('low','medium','high')),
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
