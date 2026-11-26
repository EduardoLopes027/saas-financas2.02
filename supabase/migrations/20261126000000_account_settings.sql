BEGIN;

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
