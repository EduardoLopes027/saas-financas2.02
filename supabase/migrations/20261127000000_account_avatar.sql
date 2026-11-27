BEGIN;

ALTER TABLE finflow_private.users
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS avatar_google_suppressed boolean NOT NULL DEFAULT false;

GRANT UPDATE (avatar_url, avatar_google_suppressed) ON finflow_private.users TO finflow_runtime;

COMMIT;
