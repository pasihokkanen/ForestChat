-- Phase 10 (Part A): Multi-forest foundation — make chat_sessions, chart_tabs,
-- and plan_metadata user-scoped instead of forest-scoped.
-- Migration 017 — atomic deploy with code changes required.

-- ═══════════════════════════════════════════════
-- 1. chat_sessions — forest_id → nullable
-- ═══════════════════════════════════════════════

ALTER TABLE chat_sessions ALTER COLUMN forest_id DROP NOT NULL;

DROP POLICY IF EXISTS "Owner access via forest" ON chat_sessions;
CREATE POLICY "Owner access" ON chat_sessions
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owner access via session" ON chat_messages;
CREATE POLICY "Owner access" ON chat_messages
  FOR ALL
  USING (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()))
  WITH CHECK (session_id IN (SELECT id FROM chat_sessions WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- ═══════════════════════════════════════════════
-- 2. chart_tabs — forest_id → nullable, add user_id
-- ═══════════════════════════════════════════════

ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE chart_tabs ALTER COLUMN forest_id DROP NOT NULL;

-- Populate user_id for existing rows via their forest ownership
UPDATE chart_tabs SET user_id = forests.owner_id
  FROM forests WHERE chart_tabs.forest_id = forests.id;

ALTER TABLE chart_tabs ALTER COLUMN user_id SET NOT NULL;

-- Drop old forest-scoped unique constraint, add user-scoped one
ALTER TABLE chart_tabs DROP CONSTRAINT IF EXISTS chart_tabs_forest_id_chart_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_tabs_user_chart
  ON chart_tabs(user_id, chart_id);

-- RLS: user owns their chart tabs
DROP POLICY IF EXISTS "Owner access via forest" ON chart_tabs;
CREATE POLICY "Owner access" ON chart_tabs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════
-- 3. plan_metadata — forest_id → nullable, add user_id
-- ═══════════════════════════════════════════════

ALTER TABLE plan_metadata ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE plan_metadata ALTER COLUMN forest_id DROP NOT NULL;

UPDATE plan_metadata SET user_id = forests.owner_id
  FROM forests WHERE plan_metadata.forest_id = forests.id;

ALTER TABLE plan_metadata ALTER COLUMN user_id SET NOT NULL;

DROP POLICY IF EXISTS "Owner access via forest" ON plan_metadata;
CREATE POLICY "Owner access" ON plan_metadata
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
