/*
# Add Tantra chat history

1. New tables
- `chat_messages`: one row per message in a student's conversation with the AI teacher. Columns: id (uuid), user_id (uuid, defaults to the signed-in user), course_id (nullable uuid, links a conversation to a course when one exists), role (text: 'user' or 'assistant'), content (text), attachment_name (nullable text), created_at (timestamptz).

2. Security
- Row level security enabled; authenticated users can SELECT, INSERT, and DELETE only their own rows, keyed on user_id = auth.uid().
- INSERT is column-restricted so a client cannot forge ownership or timestamps: user_id and created_at are filled by defaults.
- All other verbs revoked from anon and PUBLIC.

3. Important notes
- The conversation history powers the chat-first home screen. No changes to existing learning-intelligence tables.
*/

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  attachment_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_user_created_idx ON chat_messages(user_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON chat_messages FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON chat_messages FROM authenticated;
GRANT SELECT, INSERT, DELETE ON chat_messages TO authenticated;
GRANT INSERT (course_id, role, content, attachment_name) ON chat_messages TO authenticated;

DROP POLICY IF EXISTS "chat_select_own" ON chat_messages;
CREATE POLICY "chat_select_own" ON chat_messages FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "chat_insert_own" ON chat_messages;
CREATE POLICY "chat_insert_own" ON chat_messages FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "chat_delete_own" ON chat_messages;
CREATE POLICY "chat_delete_own" ON chat_messages FOR DELETE TO authenticated USING (user_id = auth.uid());
