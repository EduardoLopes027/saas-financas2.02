BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE finflow_private.users
  ADD COLUMN IF NOT EXISTS password_enabled boolean NOT NULL DEFAULT true,
  DROP CONSTRAINT IF EXISTS users_salary_day_check,
  ADD CONSTRAINT users_salary_day_check
    CHECK (salary_day IN ('1','5','10','15','20','25','30','5-business'));

CREATE TABLE IF NOT EXISTS finflow_private.google_identities (
  subject text PRIMARY KEY CHECK (length(subject) BETWEEN 1 AND 255),
  user_id integer NOT NULL UNIQUE REFERENCES finflow_private.users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finflow_private.google_oauth_flows (
  verifier_hash text PRIMARY KEY CHECK (length(verifier_hash) = 43),
  session_hash text REFERENCES finflow_private.sessions(token_hash) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS google_oauth_flows_expiry ON finflow_private.google_oauth_flows(expires_at);
CREATE INDEX IF NOT EXISTS google_oauth_flows_session ON finflow_private.google_oauth_flows(session_hash);
ALTER TABLE finflow_private.google_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finflow_private.google_oauth_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_identities_runtime ON finflow_private.google_identities;
CREATE POLICY google_identities_runtime ON finflow_private.google_identities
  TO finflow_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS google_oauth_flows_runtime ON finflow_private.google_oauth_flows;
CREATE POLICY google_oauth_flows_runtime ON finflow_private.google_oauth_flows
  TO finflow_runtime USING (true) WITH CHECK (true);

REVOKE ALL ON finflow_private.google_identities, finflow_private.google_oauth_flows
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON finflow_private.google_identities TO finflow_runtime;
GRANT SELECT, INSERT, DELETE ON finflow_private.google_oauth_flows TO finflow_runtime;
COMMIT;
