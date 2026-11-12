/*
# Add Tantra account moderation

1. New tables
- `tantra_accounts`: one private account record per Supabase Auth user, including email, active/blocked status, block message, timestamps, and last activity.
- `tantra_admins`: an explicit allowlist of users who may use the private admin portal. Normal signup never creates a row here.
- `tantra_google_connections`: server-owned metadata for a future Google Drive/Sheets connection; tokens are never exposed to the browser.

2. New functions and trigger
- New-user trigger creates a Tantra account record when Supabase Auth creates a user.
- `get_tantra_access_state` returns only the signed-in user's current access status and whether that user is allowlisted as an admin.
- `touch_tantra_account` records a safe last-seen timestamp for the signed-in account.
- `is_tantra_account_active` is a server-side helper for blocked-account enforcement in later policy updates.

3. Security
- Account status, block message, admin membership, and Google connection details are not client-writable.
- Students can read only their own account status.
- Admin membership is not granted by signup, email text, or user-editable metadata.
- All new tables use row-level security and deny anonymous access.
*/

CREATE TABLE IF NOT EXISTS tantra_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  block_message text,
  blocked_at timestamptz,
  blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tantra_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Administrator',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tantra_google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_drive' CHECK (provider = 'google_drive'),
  spreadsheet_id text,
  spreadsheet_name text,
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'connected', 'needs_attention')),
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_user_id, provider)
);

CREATE INDEX IF NOT EXISTS tantra_accounts_status_idx ON tantra_accounts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS tantra_accounts_last_seen_idx ON tantra_accounts(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS tantra_google_connections_admin_idx ON tantra_google_connections(admin_user_id, status);

CREATE OR REPLACE FUNCTION sync_tantra_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tantra_accounts (user_id, email)
  VALUES (NEW.id, COALESCE(NEW.email, 'unknown'))
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_tantra_account ON auth.users;
CREATE TRIGGER on_auth_user_created_tantra_account
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION sync_tantra_account();

CREATE OR REPLACE FUNCTION is_tantra_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tantra_accounts
    WHERE user_id = auth.uid() AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION get_tantra_access_state()
RETURNS TABLE(status text, block_message text, is_admin boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(account.status, 'active'),
    account.block_message,
    EXISTS (SELECT 1 FROM tantra_admins WHERE user_id = auth.uid())
  FROM (SELECT 1) AS marker
  LEFT JOIN tantra_accounts AS account ON account.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION touch_tantra_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tantra_accounts
  SET last_seen_at = now(), updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_tantra_account() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION is_tantra_account_active() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_tantra_access_state() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION touch_tantra_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_tantra_account_active() TO authenticated;
GRANT EXECUTE ON FUNCTION get_tantra_access_state() TO authenticated;
GRANT EXECUTE ON FUNCTION touch_tantra_account() TO authenticated;

ALTER TABLE tantra_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tantra_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE tantra_google_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON tantra_accounts, tantra_admins, tantra_google_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON tantra_accounts TO authenticated;

DROP POLICY IF EXISTS "tantra_accounts_select_own" ON tantra_accounts;
CREATE POLICY "tantra_accounts_select_own" ON tantra_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
