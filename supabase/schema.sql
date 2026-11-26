BEGIN;
CREATE SCHEMA IF NOT EXISTS finflow_private;
REVOKE ALL ON SCHEMA finflow_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS finflow_private.users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  password_salt bytea NOT NULL CHECK (octet_length(password_salt) = 16),
  password_hash bytea NOT NULL CHECK (octet_length(password_hash) = 64),
  name text,
  salary_day text CHECK (salary_day IN ('1','5','10','15','20','25','30')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finflow_private.accounts (
  user_id integer NOT NULL REFERENCES finflow_private.users ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);
CREATE TABLE IF NOT EXISTS finflow_private.categories (
  user_id integer NOT NULL REFERENCES finflow_private.users ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('Receita','Despesa','Transferência')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type, name)
);
CREATE TABLE IF NOT EXISTS finflow_private.sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id integer NOT NULL REFERENCES finflow_private.users ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON finflow_private.sessions(expires_at);
ALTER TABLE finflow_private.users ADD COLUMN IF NOT EXISTS password_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE finflow_private.users
  DROP CONSTRAINT IF EXISTS users_salary_day_check;
ALTER TABLE finflow_private.users
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
CREATE TABLE IF NOT EXISTS finflow_private.auth_attempts (
  bucket bigint NOT NULL,
  scope text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (bucket, scope)
);
CREATE TABLE IF NOT EXISTS finflow_private.recurring_rules (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES finflow_private.users ON DELETE CASCADE,
  fields jsonb NOT NULL,
  next_index integer NOT NULL DEFAULT 1 CHECK (next_index > 0),
  next_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_rules_due ON finflow_private.recurring_rules(user_id, next_date);
CREATE TABLE IF NOT EXISTS finflow_private.transactions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES finflow_private.users ON DELETE CASCADE,
  type text NOT NULL,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  date date NOT NULL,
  description text NOT NULL,
  payment_method text,
  status text CHECK (status IN ('Pago','Pendente')),
  destination_payment_method text,
  notes text,
  recurrence text CHECK (recurrence IN ('Semanal','Mensal','Anual')),
  installments integer CHECK (installments BETWEEN 2 AND 48),
  installment_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, type, category) REFERENCES finflow_private.categories(user_id, type, name),
  FOREIGN KEY (user_id, payment_method) REFERENCES finflow_private.accounts(user_id, name),
  FOREIGN KEY (user_id, destination_payment_method) REFERENCES finflow_private.accounts(user_id, name),
  CHECK ((type = 'Transferência' AND payment_method IS NOT NULL
    AND destination_payment_method IS NOT NULL AND payment_method <> destination_payment_method)
    OR (type <> 'Transferência' AND destination_payment_method IS NULL)),
  CHECK ((installments IS NULL AND installment_number IS NULL)
    OR (installments IS NOT NULL AND installment_number IS NOT NULL
      AND installment_number BETWEEN 1 AND installments AND recurrence IS NULL))
);
CREATE INDEX IF NOT EXISTS transactions_user_date ON finflow_private.transactions(user_id, date DESC, id DESC);
CREATE TABLE IF NOT EXISTS finflow_private.transaction_receipts (
  user_id integer NOT NULL,
  transaction_id integer NOT NULL,
  name text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, transaction_id),
  FOREIGN KEY (user_id, transaction_id) REFERENCES finflow_private.transactions(user_id, id) ON DELETE CASCADE
);

REVOKE ALL ON ALL TABLES IN SCHEMA finflow_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA finflow_private FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finflow_runtime') THEN
    CREATE ROLE finflow_runtime NOLOGIN;
  END IF;
END $$;
ALTER TABLE finflow_private.google_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finflow_private.google_oauth_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS google_identities_runtime ON finflow_private.google_identities;
CREATE POLICY google_identities_runtime ON finflow_private.google_identities
  TO finflow_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS google_oauth_flows_runtime ON finflow_private.google_oauth_flows;
CREATE POLICY google_oauth_flows_runtime ON finflow_private.google_oauth_flows
  TO finflow_runtime USING (true) WITH CHECK (true);
GRANT USAGE ON SCHEMA finflow_private TO finflow_runtime;
GRANT SELECT, INSERT ON finflow_private.users, finflow_private.accounts, finflow_private.categories TO finflow_runtime;
GRANT SELECT, INSERT, DELETE ON finflow_private.sessions TO finflow_runtime;
GRANT SELECT, INSERT ON finflow_private.google_identities TO finflow_runtime;
GRANT SELECT, INSERT, DELETE ON finflow_private.google_oauth_flows TO finflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON finflow_private.auth_attempts, finflow_private.transactions,
  finflow_private.transaction_receipts TO finflow_runtime;
GRANT SELECT, INSERT, UPDATE ON finflow_private.recurring_rules TO finflow_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA finflow_private TO finflow_runtime;
ALTER TABLE finflow_private.users
  ADD COLUMN IF NOT EXISTS phone text CHECK (length(phone) <= 32),
  ADD COLUMN IF NOT EXISTS payday_rule text CHECK (payday_rule IN ('fixed', 'fifth_business_day')),
  ADD COLUMN IF NOT EXISTS payday_day integer CHECK (payday_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
  ADD COLUMN IF NOT EXISTS carry_over boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS amount_mask boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE finflow_private.google_identities
  ADD COLUMN IF NOT EXISTS verified_email text,
  ADD COLUMN IF NOT EXISTS avatar_url text;

GRANT DELETE ON finflow_private.users TO finflow_runtime;
GRANT UPDATE (name, phone, payday_rule, payday_day, theme, carry_over, amount_mask, currency, updated_at)
  ON finflow_private.users TO finflow_runtime;
GRANT UPDATE (verified_email, avatar_url) ON finflow_private.google_identities TO finflow_runtime;
COMMIT;
