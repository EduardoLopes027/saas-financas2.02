BEGIN;

CREATE TABLE IF NOT EXISTS finflow_private.recovery_identities (
  user_id integer PRIMARY KEY REFERENCES finflow_private.users(id) ON DELETE CASCADE,
  provider_user_id uuid NOT NULL UNIQUE,
  verified_email text NOT NULL CHECK (verified_email = lower(btrim(verified_email))),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finflow_private.recovery_attempts (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  user_id integer NOT NULL REFERENCES finflow_private.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  provider_user_id uuid,
  google_subject text,
  credential_salt bytea NOT NULL,
  expires_at bigint NOT NULL,
  CHECK (provider_user_id IS NOT NULL OR google_subject IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS recovery_attempts_expiry ON finflow_private.recovery_attempts(expires_at);
CREATE INDEX IF NOT EXISTS recovery_attempts_user ON finflow_private.recovery_attempts(user_id);

CREATE TABLE IF NOT EXISTS finflow_private.recovery_grants (
  token_hash text PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES finflow_private.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  provider_user_id uuid,
  google_subject text,
  credential_salt bytea NOT NULL,
  expires_at bigint NOT NULL,
  CHECK (provider_user_id IS NOT NULL OR google_subject IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS recovery_grants_expiry ON finflow_private.recovery_grants(expires_at);
CREATE INDEX IF NOT EXISTS recovery_grants_user ON finflow_private.recovery_grants(user_id);

ALTER TABLE finflow_private.recovery_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finflow_private.recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finflow_private.recovery_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recovery_identities_runtime ON finflow_private.recovery_identities;
CREATE POLICY recovery_identities_runtime ON finflow_private.recovery_identities
  FOR SELECT TO finflow_runtime USING (true);
DROP POLICY IF EXISTS recovery_attempts_runtime ON finflow_private.recovery_attempts;
CREATE POLICY recovery_attempts_runtime ON finflow_private.recovery_attempts
  TO finflow_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS recovery_grants_runtime ON finflow_private.recovery_grants;
CREATE POLICY recovery_grants_runtime ON finflow_private.recovery_grants
  TO finflow_runtime USING (true) WITH CHECK (true);
GRANT SELECT ON finflow_private.recovery_identities TO finflow_runtime;
GRANT SELECT, INSERT, DELETE ON finflow_private.recovery_attempts, finflow_private.recovery_grants TO finflow_runtime;
GRANT UPDATE (password_salt, password_hash, password_enabled) ON finflow_private.users TO finflow_runtime;

COMMIT;
