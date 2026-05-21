-- MetsäApp: Initial database schema
-- Requires: PostGIS extension, Supabase Auth

-- ====================
-- PostGIS
-- ====================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ====================
-- Profiles (Supabase Auth handles users, this extends it)
-- ====================
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile" ON profiles
  FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ====================
-- Plan sharing (must be created BEFORE forests for RLS policy references)
-- ====================
CREATE TABLE IF NOT EXISTS plan_shares (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL,  -- FK added after forests table is created
  shared_with   UUID NOT NULL REFERENCES profiles(id),
  role          TEXT DEFAULT 'viewer',
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(forest_id, shared_with)
);

-- ====================
-- Forests (metsätila)
-- ====================
CREATE TABLE IF NOT EXISTS forests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES profiles(id),
  name          TEXT NOT NULL,
  municipality  TEXT,
  property_id   TEXT,
  total_area_ha NUMERIC,
  data_source   TEXT DEFAULT 'mml_wfs',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE forests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner full access" ON forests;
CREATE POLICY "Owner full access" ON forests
  FOR ALL USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Shared read access" ON forests;
CREATE POLICY "Shared read access" ON forests
  FOR SELECT USING (
    id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
  );

-- ====================
-- Property boundaries (MML:stä)
-- ====================
CREATE TABLE IF NOT EXISTS property_boundaries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL UNIQUE REFERENCES forests(id) ON DELETE CASCADE,
  property_id   TEXT NOT NULL,
  geometry      GEOMETRY(MultiPolygon, 3067),
  fetched_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_property_boundaries_geom ON property_boundaries USING GIST(geometry);

ALTER TABLE property_boundaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON property_boundaries;
CREATE POLICY "Owner access via forest" ON property_boundaries
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

-- ====================
-- Compartments (kuviot) — PostGIS geometry
-- ====================
CREATE TABLE IF NOT EXISTS compartments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  kuvio_id      TEXT NOT NULL,
  area_ha       NUMERIC,
  main_species  TEXT,
  development_class TEXT,
  site_type     TEXT,
  soil_type     TEXT,
  drainage_status TEXT,
  age_years     INTEGER,
  volume_m3     NUMERIC,
  basal_area    NUMERIC,
  avg_diameter  NUMERIC,
  avg_height    NUMERIC,
  growth_m3_per_ha NUMERIC,
  geometry      GEOMETRY(MultiPolygon, 3067),
  attributes    JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(forest_id, kuvio_id)
);

CREATE INDEX idx_compartments_geom ON compartments USING GIST(geometry);
CREATE INDEX idx_compartments_forest ON compartments(forest_id);

-- Add FK for plan_shares now that forests exists
ALTER TABLE plan_shares ADD CONSTRAINT fk_plan_shares_forest 
  FOREIGN KEY (forest_id) REFERENCES forests(id) ON DELETE CASCADE;

ALTER TABLE plan_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner manages shares" ON plan_shares;
CREATE POLICY "Owner manages shares" ON plan_shares
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS "User sees own shares" ON plan_shares;
CREATE POLICY "User sees own shares" ON plan_shares
  FOR SELECT USING (shared_with = auth.uid());

ALTER TABLE compartments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON compartments;
CREATE POLICY "Owner access via forest" ON compartments
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS "Shared read access" ON compartments;
CREATE POLICY "Shared read access" ON compartments
  FOR SELECT USING (
    forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
  );

-- ====================
-- Operations (toimenpiteet)
-- ====================
CREATE TABLE IF NOT EXISTS operations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compartment_id UUID NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  year          INTEGER NOT NULL,
  removal_pct   NUMERIC DEFAULT 100,
  income_eur    NUMERIC,
  cost_eur      NUMERIC,
  notes         TEXT,
  created_by    TEXT DEFAULT 'ai',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_operations_forest ON operations(forest_id);
CREATE INDEX idx_operations_year ON operations(forest_id, year);

ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON operations;
CREATE POLICY "Owner access via forest" ON operations
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS "Shared read access" ON operations;
CREATE POLICY "Shared read access" ON operations
  FOR SELECT USING (
    forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
  );

-- ====================
-- Timber prices
-- ====================
CREATE TABLE IF NOT EXISTS timber_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT,
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  price_data    JSONB NOT NULL
);

ALTER TABLE timber_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read" ON timber_prices;
CREATE POLICY "Authenticated read" ON timber_prices
  FOR SELECT USING (auth.role() = 'authenticated');

-- ====================
-- Plan metadata
-- ====================
CREATE TABLE IF NOT EXISTS plan_metadata (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  name          TEXT,
  period_start  INTEGER,
  period_end    INTEGER,
  total_volume_m3 NUMERIC,
  stumpage_value_eur NUMERIC,
  annual_growth_m3 NUMERIC,
  owner_stated_value_eur NUMERIC,
  prices_id     UUID REFERENCES timber_prices(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plan_metadata ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON plan_metadata;
CREATE POLICY "Owner access via forest" ON plan_metadata
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));
DROP POLICY IF EXISTS "Shared read access" ON plan_metadata;
CREATE POLICY "Shared read access" ON plan_metadata
  FOR SELECT USING (
    forest_id IN (SELECT forest_id FROM plan_shares WHERE shared_with = auth.uid())
  );

-- ====================
-- Chat
-- ====================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  forest_id     UUID NOT NULL REFERENCES forests(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id),
  title         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_sessions_forest ON chat_sessions(forest_id);

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via forest" ON chat_sessions;
CREATE POLICY "Owner access via forest" ON chat_sessions
  FOR ALL USING (forest_id IN (SELECT id FROM forests WHERE owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS chat_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  tool_calls    JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access via session" ON chat_messages;
CREATE POLICY "Owner access via session" ON chat_messages
  FOR ALL USING (session_id IN (
    SELECT id FROM chat_sessions WHERE forest_id IN (
      SELECT id FROM forests WHERE owner_id = auth.uid()
    )
  ));
