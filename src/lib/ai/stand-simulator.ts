// src/lib/ai/stand-simulator.ts
// Single-stand forward simulation — replays operations year by year,
// applying GROW + ingress + height/diameter growth. Returns state snapshots
// that are always consistent with the current operations in the DB.
//
// Used by the /api/forest/[id]/simulate endpoint for on-demand simulation
// when stand-level operations are edited.

import type { StandData, YearSnapshot, StandSnapshot, SpeciesSnapshot } from "./types";
import { getGrowthRate } from "./chart-engine";
import {
  PLANTING_DENSITY,
  PLANTING_INITIAL_HEIGHT_M,
  PLANTING_INITIAL_DIAMETER_CM,
  NATURAL_INGRESS_BASE_RATE,
  NATURAL_INGRESS_EXPONENT,
  MAX_STEMS_HA,
} from "./schedule";

// Internal mutable stand state (mirrors SimStand subset)
interface SimState {
  standId: string;
  areaHa: number;
  siteType: string;
  soilType: string;
  species: string;
  developmentClass: string;
  volumeM3: number;
  ageYears: number;
  basalArea: number;
  stemCount: number;
  meanHeight: number;
  meanDiameter: number;
  cleared: boolean;
  speciesData: {
    species: string;
    volumeM3: number;
    logPct: number;
    stemCount: number;
    meanHeight: number;
    meanDiameter: number;
    age: number;
    basalArea: number;
    areaHa: number;
  }[];
}

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
    basalArea: stand.ba,
    stemCount: stand.stemCount,
    meanHeight: stand.meanHeight,
    meanDiameter: stand.meanDiameter,
    cleared: false,
    speciesData: stand.speciesData.map((sp) => ({
      species: sp.species,
      volumeM3: sp.volumeM3,
      logPct: sp.logPct,
      stemCount: sp.stemCount,
      meanHeight: sp.meanHeight,
      meanDiameter: sp.meanDiameter,
      age: sp.age,
      basalArea: sp.basalArea,
      areaHa: sp.areaHa ?? 0,
    })),
  };
}

function snapshotState(st: SimState, year: number, isInitial: boolean): StandSnapshot {
  const totalStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);
  const oldWeightedHeight =
    totalStems > 0
      ? st.speciesData.reduce((s, sd) => s + sd.meanHeight * sd.stemCount, 0) / totalStems
      : 0;
  const heightDelta = st.meanHeight - oldWeightedHeight;
  const oldWeightedDiameter =
    totalStems > 0
      ? st.speciesData.reduce((s, sd) => s + sd.meanDiameter * sd.stemCount, 0) / totalStems
      : 0;
  const diameterDelta = st.meanDiameter - oldWeightedDiameter;

  const totalVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
  const volRatio = totalVol > 0 ? st.volumeM3 / totalVol : 1;
  const totalBA = st.speciesData.reduce((s, sp) => s + sp.basalArea, 0);
  const baRatio = totalBA > 0 ? st.basalArea / totalBA : 1;
  const totalSpeciesStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);

  const speciesSnapshots: SpeciesSnapshot[] = st.speciesData.map((sp) => ({
    species: sp.species,
    volumeM3: Math.round(sp.volumeM3 * volRatio),
    logPct: sp.logPct,
    stemCountPerHa:
      totalSpeciesStems > 0
        ? Math.round(sp.stemCount * st.stemCount / totalSpeciesStems)
        : 0,
    meanHeight: Math.round((sp.meanHeight + heightDelta) * 10) / 10,
    meanDiameter: Math.round((sp.meanDiameter + diameterDelta) * 10) / 10,
    age: st.ageYears,
    basalArea: Math.round(sp.basalArea * baRatio * 10) / 10,
    areaHa: sp.areaHa ?? 0,
  }));

  return {
    standId: st.standId,
    areaHa: st.areaHa,
    volumeM3: Math.round(st.volumeM3),
    basalArea: Math.round(st.basalArea * 10) / 10,
    stemCount: st.stemCount,
    meanHeight: Math.round(st.meanHeight * 10) / 10,
    meanDiameter: Math.round(st.meanDiameter * 10) / 10,
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
    st.basalArea = 0;
    st.ageYears = 0;
    st.stemCount = 0;
    st.meanHeight = 0;
    st.meanDiameter = 0;
    st.cleared = true;
  } else if (op.type === "selection_cutting" || op.type === "overstory_removal") {
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.basalArea = Math.round(st.basalArea * (1 - pct) * 10) / 10;
    if (op.type === "overstory_removal") {
      st.volumeM3 = Math.max(st.volumeM3, st.areaHa * 1);
      st.basalArea = Math.max(st.basalArea, 2);
      st.developmentClass = "seedling";
    }
  } else if (op.type === "thinning" || op.type === "first_thinning") {
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.basalArea = Math.round(st.basalArea * (1 - pct) * 10) / 10;
    st.stemCount = Math.round(st.stemCount * (1 - pct));
  } else if (op.type === "early_tending") {
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.stemCount = 3500; // Tapio early tending target
    st.basalArea = Math.round(st.basalArea * (1 - pct) * 10) / 10;
  } else if (op.type === "tending") {
    st.volumeM3 = Math.round(st.volumeM3 * (1 - pct));
    st.stemCount = 2000; // Tapio tending target
    st.basalArea = Math.round(st.basalArea * (1 - pct) * 10) / 10;
  } else if (op.type.includes("planting")) {
    st.cleared = false;
    const plantSpecies = op.type.replace("_planting", "");
    st.species = plantSpecies;
    const density = PLANTING_DENSITY[plantSpecies] ?? 1800;
    st.stemCount = density;
    st.meanHeight = PLANTING_INITIAL_HEIGHT_M;
    st.meanDiameter = PLANTING_INITIAL_DIAMETER_CM;
    st.ageYears = 0;
    if (st.basalArea === 0) st.basalArea = 2;
    if (st.volumeM3 === 0) st.volumeM3 = st.areaHa * 1;
    st.speciesData = [
      {
        species: plantSpecies,
        volumeM3: st.volumeM3,
        logPct: 0,
        stemCount: density,
        meanHeight: PLANTING_INITIAL_HEIGHT_M,
        meanDiameter: PLANTING_INITIAL_DIAMETER_CM,
        age: 0,
        basalArea: st.basalArea,
        areaHa: st.areaHa,
      },
    ];
  }
}

function growStand(st: SimState): void {
  if (st.cleared || st.areaHa <= 0) {
    st.ageYears += 1;
    return;
  }

  const growthPerHa = getGrowthRate(
    st.siteType,
    st.soilType,
    st.species,
    st.ageYears,
    st.basalArea,
    null,
    1.0,
    st.areaHa > 0 ? st.volumeM3 / st.areaHa : undefined,
    true,
  );
  const growthM3 = growthPerHa * st.areaHa;
  if (st.volumeM3 > 0) {
    const ratio = growthM3 / st.volumeM3;
    st.basalArea = st.basalArea * (1 + ratio);
  }
  st.volumeM3 += growthM3;
  st.ageYears += 1;

  // Natural ingress (same logic as schedule.ts)
  if (st.stemCount > 0 && st.ageYears <= 10 && st.stemCount < MAX_STEMS_HA) {
    const oldStemsPerHa = st.stemCount;
    const densityRatio = st.stemCount / MAX_STEMS_HA;
    const ingressRate =
      NATURAL_INGRESS_BASE_RATE * (1 - Math.pow(densityRatio, NATURAL_INGRESS_EXPONENT));
    const ingressPerHa = Math.round(
      Math.min(ingressRate, MAX_STEMS_HA - st.stemCount),
    );
    if (ingressPerHa > 0) {
      const newStemsPerHa = oldStemsPerHa + ingressPerHa;
      const newHeight = PLANTING_INITIAL_HEIGHT_M;
      const newDiameterCm = PLANTING_INITIAL_DIAMETER_CM;
      st.meanHeight =
        (st.meanHeight * oldStemsPerHa + newHeight * ingressPerHa) / newStemsPerHa;
      st.meanDiameter =
        (st.meanDiameter * oldStemsPerHa + newDiameterCm * ingressPerHa) / newStemsPerHa;
      const seedlingBA = ingressPerHa * Math.PI * (newDiameterCm / 200) ** 2;
      st.basalArea += seedlingBA;
      const seedlingVol = seedlingBA * newHeight;
      st.volumeM3 += seedlingVol;
      st.stemCount = newStemsPerHa;
    }
  }

  // Height/diameter growth
  if (st.stemCount > 0) {
    const heightGrowth =
      st.ageYears <= 5
        ? 0.15
        : st.ageYears <= 15
          ? 0.4
          : st.ageYears <= 30
            ? 0.3
            : st.ageYears <= 50
              ? 0.2
              : st.ageYears <= 80
                ? 0.1
                : 0.05;
    st.meanHeight += heightGrowth;
    st.meanDiameter += heightGrowth * 0.7;
  }
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
): YearSnapshot[] {
  const state = initState(initialStand);
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
    // Apply operations this year
    const yearOps = opsByYear.get(yr) ?? [];
    for (const op of yearOps) {
      applyOperation(state, op, yr);
    }

    // GROW
    growStand(state);

    // Snapshot
    snapshots.push({
      year: yr,
      stands: [snapshotState(state, yr, false)],
    });
  }

  return snapshots;
}
