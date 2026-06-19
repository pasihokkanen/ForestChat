// src/lib/ai/forest-state.ts
//
// Forest State Estimator — delegates to stand-simulator.ts for
// Tapio-anchored height/diameter/BA growth simulation.
// Projects compartment state year by year, accounting for growth
// and operations.
//
// Returns per-stand, per-year state snapshots that consumers can aggregate.

import { simulateStand } from "./stand-simulator";
import type { DBOperation } from "./stand-simulator";
import type { StandData } from "./types";
import { meanDiameter, meanHeight } from "./tapio-growth";

// ── Input types (unchanged public API) ──

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
  /** Location-specific growth multiplier (0.55 Lappi … 1.10 Etelä-Suomi). Defaults to 1.0. */
  growth_multiplier?: number;
}

export interface OperationInput {
  compartment_id: string;
  year: number;
  type: string;
  removal_pct: number; // 0–100
}

// ── Output types (unchanged public API) ──

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

// ── Main function ──

/**
 * Project compartment states year by year using the Tapio-anchored
 * stand-simulator engine.
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
  const periodYears = endYear - startYear + 1;
  const timeline: ForestStateTimeline = new Map();

  // Index operations by compartment ID
  const opsByCompartment = new Map<string, OperationInput[]>();
  for (const op of operations) {
    const list = opsByCompartment.get(op.compartment_id) ?? [];
    list.push(op);
    opsByCompartment.set(op.compartment_id, list);
  }

  for (const c of compartments) {
    const areaHa = c.area_ha ?? 0;
    const volumeM3 = c.volume_m3 ?? 0;

    // Skip invalid compartments (same filter as old code)
    if (areaHa <= 0 || volumeM3 <= 0) {
      continue;
    }

    // Build StandData from CompartmentInput
    const ba = c.basal_area ?? 0;
    const gm = c.growth_multiplier ?? 1.0;
    const species = c.main_species ?? "pine";
    const site = c.site_type ?? "mesic";
    const age = c.age_years ?? 0;

    // Derive stem count from BA and Tapio diameter when BA is known
    let stemCount = 0;
    if (ba > 0 && age > 0) {
      const d = meanDiameter(species, site, age, gm);
      if (d > 0) {
        stemCount = Math.round(ba / (Math.PI * Math.pow(d / 200, 2)));
      }
    }

    const standData: StandData = {
      standId: c.stand_id,
      areaHa,
      siteType: site,
      soilType: c.soil_type ?? "",
      mainSpecies: species,
      developmentClass: c.development_class ?? "",
      volumeM3,
      ageYears: age,
      ba,
      stemCount,
      meanHeight: age > 0 ? meanHeight(species, site, age, gm) : 0,
      meanDiameter: age > 0 ? meanDiameter(species, site, age, gm) : 0,
      valueEur: 0,
      speciesData: [],
      site_class: site,
      is_peatland: c.soil_type === "peatland",
      annual_growth: 0,
      logM3: 0,
      pulpM3: 0,
      drainageStatus: "",
    };

    // Convert operations for this compartment to DBOperation format
    const compOps: DBOperation[] = (opsByCompartment.get(c.id) ?? []).map((op) => ({
      type: op.type,
      year: op.year,
      removal_pct: op.removal_pct,
    }));

    // Simulate
    const snapshots = simulateStand(
      standData,
      compOps,
      startYear,
      periodYears,
      gm,
    );

    // Build StandYearState[] from snapshots.
    // snapshots[0] = pre-simulation (year = startYear - 1)
    // snapshots[1+] = years startYear … endYear
    const states: StandYearState[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const yr = startYear + i - 1;
      const snap = snapshots[i].stands[0];
      const prevSnap = snapshots[i - 1].stands[0];

      // Compute harvest from operations at this year
      const yearOps = compOps.filter((op) => op.year === yr);
      let harvestM3 = 0;
      let operationType: string | null = null;
      for (const op of yearOps) {
        if (!operationType || op.type === "clear_cut") {
          operationType = op.type;
        }
        const pct = (op.removal_pct ?? 0) / 100;
        if (op.type === "clear_cut") {
          harvestM3 += prevSnap.volumeM3;
        } else {
          harvestM3 += prevSnap.volumeM3 * pct;
        }
      }

      // Derive growth: current volume − (previous volume − harvest)
      const growthM3 = snap.volumeM3 - (prevSnap.volumeM3 - harvestM3);
      const growthM3PerHa = areaHa > 0 ? growthM3 / areaHa : 0;

      states.push({
        standId: snap.standId,
        year: yr,
        volumeM3: Math.round(snap.volumeM3 * 100) / 100,
        ageYears: snap.ageYears,
        growthM3PerHa: Math.round(growthM3PerHa * 100) / 100,
        growthM3: Math.round(growthM3 * 100) / 100,
        harvestM3: Math.round(harvestM3 * 100) / 100,
        operationType,
      });
    }

    timeline.set(c.id, states);
  }

  return timeline;
}
