/*
# Lock down the Tantra admin allowlist table

1. Security changes
- `tantra_admin_emails` had row level security disabled and full anonymous access, which would let anyone read or edit the admin allowlist. This migration enables row level security on it and revokes every privilege from the public, anonymous, and authenticated roles.
- The allowlist is now reachable only by the admin SECURITY DEFINER functions, which read it as the table owner. No policy is added on purpose: with RLS enabled and no policies, direct table access is denied for every role, while the admin functions continue to work because they run with owner rights.

2. Important notes
- This is a hardening fix for the private admin portal. Normal app users are unaffected.
*/

ALTER TABLE tantra_admin_emails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON tantra_admin_emails FROM PUBLIC, anon, authenticated;
