-- Fix RLS policy on chat_sessions to allow INSERT operations.
-- The existing FOR ALL USING policy only covers SELECT/UPDATE/DELETE,
-- but INSERT requires a WITH CHECK clause.

-- Drop the old policy
DROP POLICY IF EXISTS "Owner access via forest" ON chat_sessions;

-- Re-create with per-operation policies including WITH CHECK for INSERT
CREATE POLICY "Owner access via forest" ON chat_sessions
  FOR ALL
  USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()))
  WITH CHECK (user_id = auth.uid() AND forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
