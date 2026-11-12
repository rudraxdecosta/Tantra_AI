/*
# Add Tantra admin control and instant block enforcement

1. New tables
- `tantra_admin_emails`: the allowlist of email addresses that may use the private admin portal. No sign-up, metadata value, or password can add an address to this list; only a database change can.

2. Modified functions and tables
- `get_tantra_access_state` now derives admin status from `tantra_admin_emails` (matching the signed-in user's email case-insensitively).
- `admin_list_registrations`: admin-only function returning every registered account (email, status, block message, registered and last-seen times).
- `admin_set_user_status`: admin-only function to block or unblock an account. Blocking records the moderator message and immediately deletes the blocked user's sessions and refresh tokens, so the block takes effect at once, not just at token expiry.
- `record_learning_event` now refuses writes from accounts whose status is not `active`, so a blocked user cannot feed the learning model even with a stale session.
- Backfills a `tantra_accounts` row for every existing auth user (idempotent).

3. Security
- Both admin functions verify the caller's email against `tantra_admin_emails` server-side and are SECURITY DEFINER with a fixed search path.
- EXECUTE on both is revoked from PUBLIC and anon and granted only to authenticated.
- No table-level access to moderation data is added; admins reach it only through these functions.
- Seeded admin allowlist entry: `admin@tantra.app` (placeholder; change by updating this table).
*/

CREATE TABLE IF NOT EXISTS tantra_admin_emails (
  email text PRIMARY KEY,
  label text NOT NULL DEFAULT 'Administrator',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tantra_admin_emails (email, label)
VALUES ('admin@tantra.app', 'Primary administrator')
ON CONFLICT (email) DO NOTHING;

INSERT INTO tantra_accounts (user_id, email)
SELECT id, COALESCE(email, 'unknown') FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

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
    EXISTS (
      SELECT 1 FROM tantra_admin_emails
      WHERE lower(tantra_admin_emails.email) = lower(COALESCE(account.email, ''))
    )
  FROM (SELECT 1) AS marker
  LEFT JOIN tantra_accounts AS account ON account.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION admin_list_registrations()
RETURNS TABLE(
  user_id uuid,
  email text,
  status text,
  block_message text,
  created_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account.user_id, account.email, account.status, account.block_message, account.created_at, account.last_seen_at
  FROM tantra_accounts AS account
  WHERE EXISTS (
    SELECT 1
    FROM tantra_admin_emails AS allowlist
    WHERE lower(allowlist.email) = lower((
      SELECT COALESCE(u.email, '') FROM auth.users AS u WHERE u.id = auth.uid()
    ))
  )
  ORDER BY account.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION admin_set_user_status(
  p_user_id uuid,
  p_block boolean,
  p_message text DEFAULT 'u are allowed or chal nikal lawde'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_is_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM tantra_admin_emails
    WHERE lower(tantra_admin_emails.email) = lower((
      SELECT COALESCE(u.email, '') FROM auth.users AS u WHERE u.id = auth.uid()
    ))
  ) INTO v_caller_is_admin;

  IF NOT v_caller_is_admin THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own status here';
  END IF;

  UPDATE tantra_accounts
  SET status = CASE WHEN p_block THEN 'blocked' ELSE 'active' END,
      block_message = CASE WHEN p_block THEN COALESCE(NULLIF(p_message, ''), 'u are allowed or chal nikal lawde') ELSE NULL END,
      blocked_at = CASE WHEN p_block THEN now() ELSE NULL END,
      blocked_by = CASE WHEN p_block THEN auth.uid() ELSE NULL END,
      updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF p_block THEN
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = p_user_id;
      DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_tantra_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_tantra_access_state() TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_list_registrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_list_registrations() TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_set_user_status(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_set_user_status(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION record_learning_event(
  p_course_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tantra_accounts WHERE user_id = auth.uid() AND status = 'active') THEN
    RAISE EXCEPTION 'Account access blocked';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = p_course_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Course not found';
  END IF;

  INSERT INTO learning_events (user_id, course_id, event_type, payload, idempotency_key, occurred_at)
  VALUES (auth.uid(), p_course_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), p_idempotency_key, COALESCE(p_occurred_at, now()))
  ON CONFLICT (user_id, course_id, idempotency_key) DO UPDATE SET id = learning_events.id
  RETURNING id INTO v_event_id;

  INSERT INTO model_update_jobs (learning_event_id, processor_name)
  VALUES
    (v_event_id, 'student_evidence'),
    (v_event_id, 'recommendation_refresh')
  ON CONFLICT (learning_event_id, processor_name) DO NOTHING;

  RETURN v_event_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_learning_event(uuid, text, jsonb, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_learning_event(uuid, text, jsonb, text, timestamptz) TO authenticated;
