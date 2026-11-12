/*
# Store the Gemini teacher key server-side

1. New tables
- `tantra_service_secrets`: name/value pairs for third-party API keys needed by Tantra's server-side teacher function. Initially holds the Google Gemini key used to generate lessons.

2. Security
- Row level security enabled with NO policies, and all privileges revoked from PUBLIC, anon, and authenticated. No client (anonymous or signed-in) can read or write these rows through the Data API.
- Only the server-side teacher function, running with built-in service credentials, reads the key. The key is never sent to the browser.

3. Important notes
- Storing the key here keeps it out of the frontend bundle and out of any client-reachable surface.
*/

CREATE TABLE IF NOT EXISTS tantra_service_secrets (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tantra_service_secrets (name, value)
VALUES ('GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE tantra_service_secrets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON tantra_service_secrets FROM PUBLIC, anon, authenticated;
