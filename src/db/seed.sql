CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

INSERT INTO todos (text) VALUES
  ('Learn TanStack Start'),
  ('Build something awesome'),
  ('Deploy to production')
ON CONFLICT DO NOTHING;
