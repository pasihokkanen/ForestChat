// src/lib/ai/forest-state.ts
//
// Forest State Estimator — projects compartment state year by year,
// accounting for natural growth (VMI13 with species×age×density multipliers)
// and operations (thinning, clearcut, regeneration).
//
// Returns per-stand, per-year state snapshots that consumers can aggregate.

import { getGrowthRate } from "./chart-engine";

// ── Input types (minimal — both DB Compartment and StandData satisfy) ──

export interface CompartmentInput {
  id: string;
  stand_id: string;
  area_ha: number | null;
  site_type: string | null;
  soil_type: string | null;
  main_species: string | null;
  age_years: number | null;
  volume_m3: number | null;
  basal_area: number | null;
  development_class: string | null;
}

export interface OperationInput {
  compartment_id: string;
  year: number;
  type: string;
  removal_pct: number; // 0–100
}

// ── Output types ──

export interface StandYearState {
  standId: string;
  year: number;
  /** Standing volume at END of year (after growth + harvest) */
  volumeM3: number;
  /** Stand age at END of year */
  ageYears: number;
  /** Growth rate this year (m³/ha/y) based on start-of-year state */
  growthM3PerHa: number;
  /** Total volume added by growth this year (rate × area) */
  growthM3: number;
  /** Volume removed by operations this year */
  harvestM3: number;
  /** Operation type applied this year, or null if none */
  operationType: string | null;
}

export type ForestStateTimeline = Map<string, StandYearState[]>;

// ── Internal mutable state ──

interface MutableStand {
  standId: string;
  areaHa: number;
  siteType: string;
  soilType: string;
  mainSpecies: string;
  volumeM3: number;
  ageYears: number;
  basalArea: number;
  developmentClass: string;
  /** True after a clearcut if no regeneration has been scheduled yet.
   *  While cleared, growth is zero. */
  cleared: boolean;
}

// ── Helpers ──

const HARVEST_OPS = new Set([
  "clear_cut", "thinning", "first_thinning", "selection_cutting",
]);

const REGEN_OPS = new Set([
  "spruce_planting", "pine_planting", "birch_planting",
  "site_prep", "ditch_mounding", "scalping",
]);

function toMutable(c: CompartmentInput): MutableStand {
  return {
    standId: c.stand_id,
    areaHa: c.area_ha ?? 0,
    siteType: c.site_type ?? "",
    soilType: c.soil_type ?? "",
    mainSpecies: c.main_species ?? "",
    volumeM3: c.volume_m3 ?? 0,
    ageYears: c.age_years ?? 0,
    basalArea: c.basal_area ?? 0,
    developmentClass: c.development_class ?? "",
    cleared: false,
  };
}

// ── Main function ──

/**
 * Project compartment states year by year, applying growth and operations.
 *
 * Growth is computed with getGrowthRate() each year based on the stand's
 * current age, volume, and basal area — so it evolves as the stand ages
 * and as operations change its structure.
 *
 * @param compartments  Current (year-zero) compartment data
 * @param operations    All planned operations (may span multiple years)
 * @param startYear     First year to project (inclusive)
 * @param endYear       Last year to project (inclusive)
 * @returns             Per-stand, per-year state timeline
 */
export function estimateForestState(
  compartments: CompartmentInput[],
  operations: OperationInput[],
  startYear: number,
  endYear: number,
): ForestStateTimeline {
  // Index operations by (compartment_id, year) for O(1) lookup
  const opMap = new Map<string, OperationInput[]>();
  for (const op of operations) {
    const key = `${op.compartment_id}:${op.year}`;
    const list = opMap.get(key);
    if (list) list.push(op);
    else opMap.set(key, [op]);
  }

  // Initialize mutable stands
  const stands = new Map<string, MutableStand>();
  for (const c of compartments) {
    const ms = toMutable(c);
    if (ms.areaHa <= 0 || ms.volumeM3 <= 0) continue;
    stands.set(c.id, ms);
  }

  const timeline: ForestStateTimeline = new Map();
  // Pre-initialize arrays
  for (const standId of stands.keys()) {
    timeline.set(standId, []);
  }

  // Year-by-year simulation
  for (let yr = startYear; yr <= endYear; yr++) {
    for (const [compartmentId, s] of stands) {
      // ── 1. Compute growth rate from CURRENT state ──
      let growthM3PerHa = 0;
      let growthM3 = 0;

      if (!s.cleared && s.areaHa > 0) {
        growthM3PerHa = getGrowthRate(
          s.siteType,
          s.soilType,
          s.mainSpecies,
          s.ageYears,
          s.basalArea,
          s.developmentClass,
        );
        growthM3 = growthM3PerHa * s.areaHa;
      }

      // ── 2. Apply growth ──
      s.volumeM3 += growthM3;
      s.ageYears += 1;

      // ── 3. Apply operations this year ──
      let harvestM3 = 0;
      let operationType: string | null = null;

      const opsThisYear = opMap.get(`${compartmentId}:${yr}`) ?? [];
      for (const op of opsThisYear) {
        // Record the operation type (first non-clearcut, or clearcut if present)
        if (!operationType || op.type === "clear_cut") {
          operationType = op.type;
        }

        if (HARVEST_OPS.has(op.type)) {
          const pct = Math.min(op.removal_pct, 100) / 100;

          if (op.type === "clear_cut") {
            harvestM3 += s.volumeM3;
            s.volumeM3 = 0;
            s.basalArea = 0;
            s.ageYears = 0;
            s.cleared = true;
          } else {
            // thinning, first_thinning, selection_cutting
            const removed = s.volumeM3 * pct;
            harvestM3 += removed;
            s.volumeM3 -= removed;
            // Reduce basal area proportionally to volume removed
            s.basalArea = Math.max(0, s.basalArea * (1 - pct));
          }
        }

        // Regeneration: un-clears the stand so growth resumes
        if (REGEN_OPS.has(op.type)) {
          s.cleared = false;
        }
      }

      // ── 4. Record state snapshot (end-of-year) ──
      const snapshot: StandYearState = {
        standId: s.standId,
        year: yr,
        volumeM3: Math.round(s.volumeM3 * 100) / 100,
        ageYears: s.ageYears,
        growthM3PerHa: Math.round(growthM3PerHa * 100) / 100,
        growthM3: Math.round(growthM3 * 100) / 100,
        harvestM3: Math.round(harvestM3 * 100) / 100,
        operationType,
      };

      timeline.get(compartmentId)!.push(snapshot);
    }
  }

  return timeline;
}
