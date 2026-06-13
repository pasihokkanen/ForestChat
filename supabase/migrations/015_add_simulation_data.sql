-- Phase 8: Add simulation_data column to plan_metadata
-- Stores year-by-year stand snapshots as JSONB
-- Migration 015

ALTER TABLE plan_metadata
ADD COLUMN IF NOT EXISTS simulation_data JSONB;

COMMENT ON COLUMN plan_metadata.simulation_data IS 'Year-by-year stand simulation snapshots. JSON array of YearSnapshot objects.';
