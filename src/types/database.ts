// ── Supabase schema types (mirrors migration) ──

export interface Forest {
  id: string;
  owner_id: string;
  name: string;
  municipality: string | null;
  property_id: string | null;
  total_area_ha: number | null;
  data_source: string;
  created_at: string;
  updated_at: string;
}

export interface Compartment {
  id: string;
  forest_id: string;
  stand_id: string;
  area_ha: number | null;
  main_species: string | null;
  development_class: string | null;
  site_type: string | null;
  soil_type: string | null;
  drainage_status: string | null;
  age_years: number | null;
  volume_m3: number | null;
  basal_area: number | null;
  avg_diameter: number | null;
  avg_height: number | null;
  stem_count: number | null;
  growth_m3_per_ha: number | null;
  geometry: GeoJSON.MultiPolygon | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface CompartmentSpecies {
  id: string;
  forest_id: string;
  compartment_id: string;
  stand_id: string;
  species: string;
  volume_m3: number;
  log_pct: number | null;
  area_ha: number;
  stem_count: number | null;
  mean_height: number | null;
  mean_diameter: number | null;
  age: number | null;
  basal_area: number | null;
  created_at: string;
}

export interface Operation {
  id: string;
  compartment_id: string;
  forest_id: string;
  type: string;
  year: number;
  removal_pct: number;
  income_eur: number | null;
  cost_eur: number | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PlanMetadata {
  id: string;
  forest_id: string;
  name: string | null;
  period_start: number | null;
  period_end: number | null;
  total_volume_m3: number | null;
  stumpage_value_eur: number | null;
  annual_growth_m3: number | null;
  owner_stated_value_eur: number | null;
  prices_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  forest_id: string;
  user_id: string;
  title: string | null;
  model: string | null;  // Per-session model override (set by /model command)
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls: unknown | null;  // JSONB: for tool role, stores { tool_call_id: string }
  created_at: string;
}

// ── Chart Query Config (Phase 4b) ──

export interface ChartQueryConfig {
  source: "operations" | "compartments" | "plan_metadata";
  join?: {
    table: "compartments";
    on: "compartment_id";
    fields: string[];
  };
  aggregate: Array<{ group_by: string }>;
  values: Array<{
    field: string;
    as: string;
    fn: "sum" | "count" | "avg" | "min" | "max";
    /** Multiply result by this factor (e.g. -1 for costs to show below zero). */
    multiply?: number;
  }>;
  filters?: Record<string, unknown>;
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
}

// ── GeoJSON feature wrapper (for MapLibre layers) ──

export interface CompartmentFeature extends GeoJSON.Feature<GeoJSON.MultiPolygon> {
  properties: {
    id: string;
    stand_id: string;
    main_species: string | null;
    development_class: string | null;
    site_type: string | null;
    area_ha: number | null;
    age_years: number | null;
    volume_m3: number | null;
    basal_area: number | null;
    avg_diameter: number | null;
    avg_height: number | null;
  };
}

export interface CompartmentFeatureCollection extends GeoJSON.FeatureCollection<GeoJSON.MultiPolygon> {
  features: CompartmentFeature[];
}