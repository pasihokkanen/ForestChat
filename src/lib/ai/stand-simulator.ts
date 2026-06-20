// src/lib/ai/stand-simulator.ts
// Single-stand forward simulation — replays operations year by year,
// applying GROW + ingress + per-species Tapio-anchored height/BA/diameter.
// Returns state snapshots that are always consistent with the current
// operations in the DB.
//
// Phase 9: Replaced height/diameter proxy and proportional BA with
// per-species Tapio-anchored model (tapio-growth.ts).
//
// Used by the /api/forest/[id]/simulate endpoint for on-demand simulation
// when stand-level operations are edited.
//
// Also exported for reuse by schedule.ts so GROW and snapshot logic
// is defined in exactly one place.

import type { StandData, YearSnapshot, StandSnapshot, SpeciesSnapshot } from "./types";
import {
  PLANTING_DENSITY,
  PLANTING_INITIAL_HEIGHT_M,
  PLANTING_INITIAL_DIAMETER_CM,
  NATURAL_INGRESS_BASE_RATE,
  NATURAL_INGRESS_EXPONENT,
  MAX_STEMS_HA,
  NATURAL_INGRESS_MAX_AGE,
} from "./schedule";
import {
  meanHeight,
  meanDiameter,
  computeStandHeight,
  formFactor,
} from "./tapio-growth";
import {
  MIN_DIAMETER_INCREMENT,
  MIN_DIAMETER_INCREMENT_DEFAULT,
  MIN_HEIGHT_INCREMENT,
  MIN_HEIGHT_INCREMENT_DEFAULT,
  EARLY_TENDING_TARGET_STEMS_HA,
  TENDING_TARGET_STEMS_HA,
} from "./config";

// ═══════════════════════════════════════════════════════════════════════
// Shared interface — any stand-like object that can be grown/snapshotted.
// SimState (below) and schedule.ts's SimStand both satisfy this.
// ═══════════════════════════════════════════════════════════════════════

export interface GrowableStand {
  standId: string;
  areaHa: number;
  siteType: string;
  soilType: string;
  species: string;
  developmentClass: string;
  volumeM3: number;
  ageYears: number;
  stemCount: number;
  meanHeight: number;
  meanDiameter: number;
  /** Regional growth multiplier (1.0 = Central Finland, 0.55 = Lapland, 1.10 = South) */
  growthMultiplier: number;
  speciesData: Array<{
    species: string;
    volumeM3: number;
    logPct?: number;
    stemCount: number;
    meanHeight?: number;
    meanDiameter?: number;
    age?: number;
    areaHa?: number;
  }>;
}

// Internal mutable stand state (mirrors GrowableStand, no extra fields)
interface SimState extends GrowableStand {}

/** DB operation shape (subset of fields we need) */
export interface DBOperation {
  type: string;
  year: number;
  removal_pct: number | null;
}

function initState(stand: StandData): SimState {
  return {
    standId: stand.standId,
    areaHa: stand.areaHa,
    siteType: stand.siteType,
    soilType: stand.soilType,
    species: stand.mainSpecies,
    developmentClass: stand.developmentClass,
    volumeM3: stand.volumeM3,
    ageYears: stand.ageYears,
    stemCount: stand.stemCount,
    meanHeight: stand.meanHeight,
    meanDiameter: stand.meanDiameter,
    growthMultiplier: 1.0,
    speciesData: stand.speciesData.map((sp) => ({
      species: sp.species,
      volumeM3: sp.volumeM3,
      logPct: sp.logPct,
      stemCount: sp.stemCount,
      meanHeight: sp.meanHeight,
      meanDiameter: sp.meanDiameter,
      age: sp.age,
      areaHa: sp.areaHa ?? 0,
    })),
  };
}

/**
 * Build per-species aggregate maps for BA/height/diameter computation.
 */
export function speciesForAgg(st: GrowableStand): Array<{
  volumeM3: number; species: string; stemCount: number; diameterCm: number;
}> {
  if (st.speciesData.length === 0) {
    return [{
      volumeM3: st.volumeM3,
      species: st.species,
      stemCount: st.stemCount,
      diameterCm: st.meanDiameter,
    }];
  }
  return st.speciesData.map((sp) => ({
    volumeM3: sp.volumeM3,
    species: sp.species,
    stemCount: sp.stemCount,
    diameterCm: 0,
  }));
}

/**
 * Build a year snapshot from the current stand state.
 * Uses simulated (convergence-adjusted) D/H for the stand aggregate,
 * with per-species snapshots that each get their own stored height,
 * diameter, and computed basal area.
 */
export function snapshotState(
  st: GrowableStand,
  year: number,
  _isInitial: boolean,
): StandSnapshot {
  // Use simulated (convergence-adjusted) D/H, not raw Tapio table values.
  const standHeight = st.meanHeight;
  const standDiamCm = st.meanDiameter;
  const standBA = Math.round(st.stemCount * Math.PI * Math.pow(standDiamCm / 200, 2) * 10) / 10;

  // Use volRatio to ensure per-species volumes sum exactly to stand total
  const rawTotalVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
  const volRatio = rawTotalVol > 0 ? st.volumeM3 / rawTotalVol : 1;
  const totalSpeciesStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);

  // Per-species snapshots — each species gets its own Tapio height, diameter, BA
  const speciesSnapshots: SpeciesSnapshot[] = st.speciesData.map((sp) => {
    const stemsPerHa =
      totalSpeciesStems > 0
        ? Math.round(sp.stemCount * st.stemCount / totalSpeciesStems)
        : 0;
    const sppVol = Math.round(sp.volumeM3 * volRatio);
    // Use stored species-specific D/H (set by GROW/APPLY), not raw Tapio tables.
    const sppH = sp.meanHeight ?? st.meanHeight;
    const sppDiam = sp.meanDiameter ?? st.meanDiameter;
    const sppBA = Math.round(stemsPerHa * Math.PI * Math.pow(sppDiam / 200, 2) * 10) / 10;
    return {
      species: sp.species,
      volumeM3: sppVol,
      logPct: sp.logPct ?? 0,
      stemCountPerHa: stemsPerHa,
      meanHeight: sppH,
      meanDiameter: sppDiam,
      age: st.ageYears,
      basalArea: sppBA,
      areaHa: sp.areaHa ?? 0,
    };
  });

  return {
    standId: st.standId,
    areaHa: st.areaHa,
    volumeM3: Math.round(st.volumeM3),
    basalArea: standBA,
    stemCount: st.stemCount,
    meanHeight: standHeight,
    meanDiameter: standDiamCm,
    ageYears: st.ageYears,
    species: st.species,
    siteType: st.siteType,
    developmentClass: st.developmentClass,
    speciesData: speciesSnapshots,
  };
}

function applyOperation(st: SimState, op: DBOperation, year: number): void {
  const pct = (op.removal_pct ?? 0) / 100;

  if (op.type === "clear_cut") {
    st.volumeM3 = 0;
    st.ageYears = 0;
    st.stemCount = 0;
    st.meanHeight = 0;
    st.meanDiameter = 0;
    st.speciesData = [];
  } else if (op.type === "selection_cutting" || op.type === "overstory_removal") {
    const oldVol = st.volumeM3;
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    // Sync speciesData volumes proportionally
    const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
    for (const sp of st.speciesData) {
      sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
    }
    if (op.type === "overstory_removal") {
      st.volumeM3 = Math.max(st.volumeM3, st.areaHa * 1);
      st.developmentClass = "seedling";
    }
  } else if (op.type === "thinning" || op.type === "first_thinning") {
    const oldVol = st.volumeM3;
    const oldStems = st.stemCount;
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.stemCount = Math.round(st.stemCount * (1 - pct));
    // Sync speciesData volumes and stems proportionally
    const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
    const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
    for (const sp of st.speciesData) {
      sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
      sp.stemCount = Math.round(sp.stemCount * stemScale);
    }
  } else if (op.type === "early_tending") {
    const oldVol = st.volumeM3;
    const oldStems = st.stemCount;
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.stemCount = EARLY_TENDING_TARGET_STEMS_HA[st.species]?.[st.siteType]
      ?? EARLY_TENDING_TARGET_STEMS_HA[st.species]?.mesic
      ?? 3250;
    // Sync speciesData volumes and stems proportionally
    const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
    const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
    for (const sp of st.speciesData) {
      sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
      sp.stemCount = Math.round(sp.stemCount * stemScale);
    }
  } else if (op.type === "tending") {
    const oldVol = st.volumeM3;
    const oldStems = st.stemCount;
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.stemCount = TENDING_TARGET_STEMS_HA[st.species]?.[st.siteType]
      ?? TENDING_TARGET_STEMS_HA[st.species]?.mesic
      ?? 2000;
    // Sync speciesData volumes and stems proportionally
    const volScale = oldVol > 0 ? st.volumeM3 / oldVol : 1;
    const stemScale = oldStems > 0 ? st.stemCount / oldStems : 1;
    for (const sp of st.speciesData) {
      sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 10) / 10;
      sp.stemCount = Math.round(sp.stemCount * stemScale);
    }
  } else if (op.type.includes("planting")) {
    const plantSpecies = op.type.replace("_planting", "");
    st.species = plantSpecies;
    const density = PLANTING_DENSITY[plantSpecies] ?? 1800;
    st.stemCount = density;
    st.meanHeight = PLANTING_INITIAL_HEIGHT_M[plantSpecies] ?? 0.3;
    st.meanDiameter = PLANTING_INITIAL_DIAMETER_CM[plantSpecies] ?? 0.5;
    st.ageYears = 0;
    st.speciesData = [
      {
        species: plantSpecies,
        volumeM3: st.volumeM3,
        logPct: 0,
        stemCount: density,
        meanHeight: PLANTING_INITIAL_HEIGHT_M[plantSpecies] ?? 0.3,
        meanDiameter: PLANTING_INITIAL_DIAMETER_CM[plantSpecies] ?? 0.5,
        age: 0,
        areaHa: st.areaHa,
      },
    ];
  }
}

/**
 * Advance a stand by one year: age, height, diameter, and volume
 * all derived from Tapio reference tables. Volume computed directly
 * from the standard forestry formula V = N × π × (D/200)² × H × f.
 *
 * Returns the year-over-year volume change (m³) so callers can update
 * value-side fields (e.g., valueEur).
 */
export function growStand(
  st: GrowableStand,
  _growthMultiplier = 1.0,
): number {
  // Dead stands (no stems AND no volume) don't grow
  if ((st.stemCount <= 0 && st.volumeM3 <= 0) || st.areaHa <= 0) {
    return 0;
  }

  st.ageYears += 1;
  const gm = st.growthMultiplier;

  // Height: absolute year-over-year growth from Tapio tables — no convergence.
  // Height is site-quality-driven, not density-driven, and should not be
  // pulled toward a "typical" curve. Falls back to direct table value when
  // prevTable ≤ 0.01 (age 0→1 edge case).
  {
    const currTableH = meanHeight(st.species, st.siteType, st.ageYears, 1.0);
    const prevTableH = meanHeight(st.species, st.siteType, st.ageYears - 1, 1.0);
    const tableTargetH = meanHeight(st.species, st.siteType, st.ageYears, gm);
    if (prevTableH > 0.01) {
      const absGrowth = (currTableH - prevTableH) * gm;
      const newH = Math.round((st.meanHeight + absGrowth) * 10000) / 10000;
      // Old-age height floor (same age-dependent multiplier as diameter).
      const minHIncr = (MIN_HEIGHT_INCREMENT[st.species]
        ?? MIN_HEIGHT_INCREMENT_DEFAULT) * gm;
      const ageFactor = Math.max(0.3, 1.0 - (st.ageYears - 80) / 300);
      const floorH = st.meanHeight + minHIncr * ageFactor;
      st.meanHeight = Math.max(newH, floorH);
    } else {
      st.meanHeight = Math.round(tableTargetH * 10000) / 10000;
    }
  }
  // Diameter: Tapio absolute delta + 5%/yr convergence toward D_REF curve.
  // D has a genuine biological ceiling (D_REF) — a stand below the curve
  // should catch up over time. Convergence closes the gap at 5% per year.
  // Falls back to direct table value when prevTable ≤ 0.01.
  {
    const CONVERGENCE = 0.05;
    const currTableD = meanDiameter(st.species, st.siteType, st.ageYears, 1.0);
    const prevTableD = meanDiameter(st.species, st.siteType, st.ageYears - 1, 1.0);
    const tableTargetD = meanDiameter(st.species, st.siteType, st.ageYears, gm);
    if (prevTableD > 0.01) {
      const absGrowth = (currTableD - prevTableD) * gm;
      const convergenceD = CONVERGENCE * (tableTargetD - st.meanDiameter);
      const newD = Math.round((st.meanDiameter + absGrowth + convergenceD) * 10000) / 10000;
      // Old-age floor: trees never stop growing. The floor activates when
      // Tapio+convergence growth drops below the minimum annual increment.
      // Age-dependent multiplier: floor declines from 100% at age 80 to
      // 60% at age 200, to 30% at age 290+, matching natural senescence.
      const minDIncr = (MIN_DIAMETER_INCREMENT[st.species]?.[st.siteType]
        ?? MIN_DIAMETER_INCREMENT_DEFAULT) * gm;
      const ageFactor = Math.max(0.3, 1.0 - (st.ageYears - 80) / 300);
      const floorD = st.meanDiameter + minDIncr * ageFactor;
      st.meanDiameter = Math.max(newD, floorD);
    } else {
      st.meanDiameter = Math.round(tableTargetD * 10000) / 10000;
    }
  }

  // Volume from standard forestry formula: V = N × π × (D/200)² × H × f
  const baPerHa = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);
  const f = formFactor(st.species);
  const newVolPerHa = baPerHa * st.meanHeight * f;
  const newVol = newVolPerHa * st.areaHa;

  const oldVol = st.volumeM3;
  st.volumeM3 = Math.round(newVol * 100) / 100;

  // Natural ingress: young stands gain stems from natural regeneration.
  // Density-dependent cubic model: ingress = BASE × (1 − (stems/MAX)³).
  // Parameters vary by site class — fertile sites get heavier ingress.
  const siteClass = st.siteType || "mesic";
  const maxStems = MAX_STEMS_HA[siteClass] ?? 6000;
  const baseRate = NATURAL_INGRESS_BASE_RATE[siteClass] ?? 520;
  const maxAge = NATURAL_INGRESS_MAX_AGE[siteClass] ?? 10;
  if (st.stemCount > 0 && st.ageYears <= maxAge && st.stemCount < maxStems) {
    const oldStemsPerHa = st.stemCount;
    const densityRatio = st.stemCount / maxStems;
    const ingressRate =
      baseRate * (1 - Math.pow(densityRatio, NATURAL_INGRESS_EXPONENT));
    const ingressPerHa = Math.round(
      Math.min(ingressRate, maxStems - st.stemCount),
    );
    if (ingressPerHa > 0) {
      st.stemCount = oldStemsPerHa + ingressPerHa;

      // Distribute ingress stems proportionally to existing species
      const totalSpeciesStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);
      if (st.speciesData.length > 0) {
        for (const sp of st.speciesData) {
          const share = totalSpeciesStems > 0 ? sp.stemCount / totalSpeciesStems : 1 / st.speciesData.length;
          sp.stemCount += Math.round(ingressPerHa * share);
        }
      }

      // Recompute volume with new stem count (ingress trees share mean dimensions)
      const newBa = st.stemCount * Math.PI * Math.pow(st.meanDiameter / 200, 2);
      st.volumeM3 = Math.round(newBa * st.meanHeight * f * st.areaHa * 100) / 100;
    }
  }

  // Sync speciesData volumes proportionally to new total
  if (st.speciesData.length > 0) {
    const totalSpeciesVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
    if (totalSpeciesVol > 0 && st.volumeM3 > 0) {
      const volScale = st.volumeM3 / totalSpeciesVol;
      for (const sp of st.speciesData) {
        sp.volumeM3 = Math.round(sp.volumeM3 * volScale * 100) / 100;
      }
    }
  }

  return st.volumeM3 - oldVol;
}

/**
 * Simulate a single stand forward from its initial state through the plan period,
 * applying DB operations in year order.
 *
 * Returns year-by-year snapshots including a year-0 "pre-simulation" snapshot.
 * Always computed from current DB state — no cached/stale data.
 */
export function simulateStand(
  initialStand: StandData,
  operations: DBOperation[],
  startYear: number,
  periodYears: number,
  growthMultiplier = 1.0,
): YearSnapshot[] {
  const state = initState(initialStand);
  state.growthMultiplier = growthMultiplier;
  const snapshots: YearSnapshot[] = [];

  // Year 0: pre-simulation snapshot
  snapshots.push({
    year: startYear - 1,
    stands: [snapshotState(state, startYear - 1, true)],
  });

  // Group operations by year
  const opsByYear = new Map<number, DBOperation[]>();
  for (const op of operations) {
    if (!opsByYear.has(op.year)) opsByYear.set(op.year, []);
    opsByYear.get(op.year)!.push(op);
  }

  const endYear = startYear + periodYears - 1;
  for (let yr = startYear; yr <= endYear; yr++) {
    // GROW first (natural growth through the year)
    growStand(state, growthMultiplier);

    // Apply operations at end of year (GROW then apply so snapshot shows operation target values)
    const yearOps = opsByYear.get(yr) ?? [];
    for (const op of yearOps) {
      applyOperation(state, op, yr);
    }

    // Snapshot
    snapshots.push({
      year: yr,
      stands: [snapshotState(state, yr, false)],
    });
  }

  return snapshots;
}
