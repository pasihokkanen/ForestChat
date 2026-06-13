-- Phase 8 cleanup: simulation_data is now computed on-demand via
-- POST /api/forest/[id]/simulate — no longer stored in plan_metadata.
-- Migration 016

ALTER TABLE plan_metadata
DROP COLUMN IF EXISTS simulation_data;
