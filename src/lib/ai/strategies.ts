// src/lib/ai/strategies.ts
// Phase 7b (T4/T4b): Year-by-year scheduling engine with goal-aware strategies.
//
// Replaces the static two-period bucket scheduler with an iterative,
// growth-aware engine that walks year by year through the plan period,
// simulating stand growth and dynamically spawning operations.

import type { StandData, PlannedOperation, PlanGoal } from "./types";
import { trySplitStand } from "./schedule";
import { getGrowthRate } from "./chart-engine";
import { getOptimalAge, THINNING_BA, MIN_AGE_FIRST_THINNING, MIN_AGE_THINNING } from "./config";

// ── Scheduling Strategy Interface ──

export interface SchedulingStrategy {
  name: string;
  /** Per-year harvest volume cap as multiplier of annual growth. */
  volumeCapMultiplier(): number;
  /**
   * Select operations to execute this year from the candidate pool.
   * Candidates arrive PRE-SORTED by priority (op type → dueYear → goal metric → wishes).
   */
  selectOperations(
    year: number,
    standStates: Map<string, StandYearState>,
    candidates: PlannedOperation[],
    volumeCapM3: number,
    annualGrowthM3: number,
  ): { scheduled: PlannedOperation[]; remaining: PlannedOperation[] };
  /** Max parts to split a stand harvest. 0 = never split. */
  shouldSplit(standHarvestVolumeM3: number, volumeCapM3: number): number;
  /** Years to wait after clearcut before regeneration. */
  regenDelayYears(): number;
  /** Species preference for replanting after clearcut. */
  regenerationSpecies(stand: StandData): "spruce" | "pine" | "mixed";
}

// ── Stand State Tracking ──

interface StandYearState {
  standId: string;
  areaHa: number;
  siteType: string;
  soilType: string;
  species: string;
  volumeM3: number;
  ageYears: number;
  basalArea: number;
  developmentClass: string;
  cleared: boolean;
  growthMultiplier: number;
}

function initStandState(stand: StandData, growthMultiplier = 1.0): StandYearState {
  return {
    standId: stand.standId,
    areaHa: stand.areaHa,
    siteType: stand.siteType,
    soilType: stand.soilType,
    species: stand.mainSpecies,
    volumeM3: stand.volumeM3,
    ageYears: stand.ageYears,
    basalArea: stand.ba,
    developmentClass: stand.developmentClass,
    cleared: false,
    growthMultiplier,
  };
}

// ── Candidate Priority Ordering ──

const OP_TYPE_ORDER: Record<string, number> = {
  first_thinning: 0,
  thinning: 0,
  selection_cutting: 0,
  clear_cut: 1,
};

function sortCandidates(
  candidates: PlannedOperation[],
  goal: PlanGoal,
): PlannedOperation[] {
  return [...candidates].sort((a, b) => {
    // 1. Primary: operation type (thinnings/selection_cutting before clearcuts)
    const typeA = OP_TYPE_ORDER[a.type] ?? 0;
    const typeB = OP_TYPE_ORDER[b.type] ?? 0;
    if (typeA !== typeB) return typeA - typeB;

    // 2. Secondary: waiting time (dueYear) — earlier due first
    const dueA = a.dueYear ?? 0;
    const dueB = b.dueYear ?? 0;
    if (dueA !== dueB) return dueA - dueB;

    // 3. Tertiary: goal-specific metric
    switch (goal) {
      case "maximum_growth_aggressive":
      case "maximum_growth_balanced":
        return b.removal_m3 - a.removal_m3; // biggest first
      case "carbon_storage":
      case "balanced":
        return b.stand.ageYears - a.stand.ageYears; // oldest first
      default:
        return 0;
    }
  });
}

// ── Strategy: maximum_growth_aggressive ──

const aggressiveStrategy: SchedulingStrategy = {
  name: "maximum_growth_aggressive",
  volumeCapMultiplier: () => 3.0,
  selectOperations(year, standStates, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let usedM3 = 0;

    for (const op of candidates) {
      if (usedM3 + op.removal_m3 <= volumeCapM3) {
        scheduled.push(op);
        usedM3 += op.removal_m3;
      } else {
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  shouldSplit: () => 0, // never split — regenerate ASAP
  regenDelayYears: () => 0, // replant same year
  regenerationSpecies: (stand: StandData) => {
    const site = stand.site_class;
    return site.includes("tuore") || site.includes("lehto") ? "spruce" : "pine";
  },
};

// ── Strategy: maximum_growth_balanced ──

const balancedGrowthStrategy: SchedulingStrategy = {
  name: "maximum_growth_balanced",
  volumeCapMultiplier: () => 1.25,
  selectOperations(year, standStates, candidates, volumeCapM3, annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let usedM3 = 0;

    // Priority inversion: if total harvest already exceeds annual growth,
    // skip clearcuts until all thinnings are placed
    const totalHarvestPending = candidates.reduce((s, op) => s + op.removal_m3, 0);
    const skipClearcuts = totalHarvestPending > annualGrowthM3 * 2;

    for (const op of candidates) {
      if (skipClearcuts && op.type === "clear_cut") {
        remaining.push(op);
        continue;
      }

      if (usedM3 + op.removal_m3 <= volumeCapM3) {
        scheduled.push(op);
        usedM3 += op.removal_m3;
      } else {
        // Try splitting clearcuts that exceed cap
        if (op.type === "clear_cut" && this.shouldSplit(op.removal_m3, volumeCapM3) > 0) {
          const maxParts = this.shouldSplit(op.removal_m3, volumeCapM3);
          const split = trySplitStand(op.stand, op, volumeCapM3, maxParts);
          if (split) {
            // Take only as many parts as fit
            let taken = 0;
            for (const subOp of split) {
              if (usedM3 + subOp.removal_m3 <= volumeCapM3) {
                scheduled.push(subOp);
                usedM3 += subOp.removal_m3;
                taken++;
              }
            }
            // Push remaining parts to carryover
            for (let i = taken; i < split.length; i++) {
              remaining.push(split[i]);
            }
            continue;
          }
        }
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  shouldSplit: (standVolume: number, volumeCapM3: number) => {
    if (standVolume <= volumeCapM3) return 0;
    // Try smallest N that brings each part under cap
    for (const n of [2, 3, 4]) {
      if (standVolume / n <= volumeCapM3) return n;
    }
    return 0;
  },
  regenDelayYears: () => 1, // replant next year
  regenerationSpecies: (stand: StandData) => {
    const site = stand.site_class;
    return site.includes("tuore") || site.includes("lehto") ? "spruce" : "pine";
  },
};

// ── Strategy: carbon_storage ──

const carbonStorageStrategy: SchedulingStrategy = {
  name: "carbon_storage",
  volumeCapMultiplier: () => 0.5,
  selectOperations(year, standStates, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let usedM3 = 0;

    for (const op of candidates) {
      // Skip clearcuts unless stand is significantly over-mature (≥ optMax + 15)
      if (op.type === "clear_cut") {
        const [_, optMax] = getOptimalAge(op.stand.mainSpecies, op.stand.site_class);
        if (op.stand.ageYears < optMax + 15) {
          remaining.push(op);
          continue;
        }
      }

      if (usedM3 + op.removal_m3 <= volumeCapM3) {
        scheduled.push(op);
        usedM3 += op.removal_m3;
      } else {
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  shouldSplit: () => 0, // avoid clearcuts entirely where possible
  regenDelayYears: () => 2, // allow natural seeding before planting
  regenerationSpecies: () => "spruce", // higher carbon density
};

// ── Strategy: balanced (round-robin interleaving) ──

const balancedStrategy: SchedulingStrategy = {
  name: "balanced",
  volumeCapMultiplier: () => 1.0,
  selectOperations(year, standStates, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let usedM3 = 0;

    // Separate thinnings and clearcuts for round-robin
    const thinnings = candidates.filter(
      (op) => op.type === "thinning" || op.type === "first_thinning" || op.type === "selection_cutting",
    );
    const clearcuts = candidates.filter((op) => op.type === "clear_cut");

    let ti = 0;
    let ci = 0;
    let pickThinning = true; // start with thinning

    while (ti < thinnings.length || ci < clearcuts.length) {
      const pool = pickThinning ? thinnings : clearcuts;
      const idx = pickThinning ? ti : ci;

      if (idx < pool.length) {
        const op = pool[idx];
        if (usedM3 + op.removal_m3 <= volumeCapM3) {
          scheduled.push(op);
          usedM3 += op.removal_m3;
        } else {
          remaining.push(op);
        }
        if (pickThinning) ti++;
        else ci++;
      }

      // Alternate, or skip empty pool
      if (pickThinning && ti >= thinnings.length) {
        pickThinning = false;
      } else if (!pickThinning && ci >= clearcuts.length) {
        pickThinning = true;
      } else {
        pickThinning = !pickThinning;
      }

      // Safety: if both pools exhausted
      if (ti >= thinnings.length && ci >= clearcuts.length) break;
    }

    return { scheduled, remaining };
  },
  shouldSplit: () => 0, // no splitting in balanced mode
  regenDelayYears: () => 1,
  regenerationSpecies: (stand: StandData) => {
    const site = stand.site_class;
    return site.includes("tuore") || site.includes("lehto") ? "spruce" : "pine";
  },
};

// ── Strategy Factory ──

export function getStrategy(goal: PlanGoal): SchedulingStrategy {
  switch (goal) {
    case "maximum_growth_aggressive": return aggressiveStrategy;
    case "maximum_growth_balanced": return balancedGrowthStrategy;
    case "carbon_storage": return carbonStorageStrategy;
    case "balanced": return balancedStrategy;
  }
}

// ── Dynamic Operation Spawning ──

/**
 * Check if a stand has crossed a threshold during simulation and spawn a new
 * operation into the candidate pool. Called once per year after growth.
 */
function spawnOperations(
  state: StandYearState,
  year: number,
  goal: PlanGoal,
  growthMultiplier: number,
): PlannedOperation[] {
  const spawned: PlannedOperation[] = [];
  if (state.cleared) return spawned;

  // Reconstruct a minimal StandData for operation creation
  const stand: StandData = {
    standId: state.standId,
    areaHa: state.areaHa,
    developmentClass: state.developmentClass,
    siteType: state.siteType,
    soilType: state.soilType,
    drainageStatus: "",
    mainSpecies: state.species,
    site_class: state.siteType,
    is_peatland: state.soilType === "peatland",
    annual_growth: 0,
    valueEur: 0,
    logM3: 0,
    pulpM3: 0,
    ageYears: state.ageYears,
    ba: state.basalArea,
    volumeM3: state.volumeM3,
  };

  // Check clearcut eligibility
  const [optMin, optMax] = getOptimalAge(state.species, state.siteType);
  const isOverAge = goal === "carbon_storage"
    ? state.ageYears >= optMax + 15
    : state.ageYears >= optMin;

  if (isOverAge && state.developmentClass.includes("regeneration_ready")) {
    spawned.push({
      stand,
      type: goal === "carbon_storage" ? "selection_cutting" : "clear_cut",
      year,
      income_eur: 0, // will be valued later
      cost_eur: 0,
      removal_m3: Math.round(state.volumeM3 * (goal === "carbon_storage" ? 0.5 : 1.0)),
      notes: `Spawned at age ${state.ageYears}`,
      dueYear: year,
    });
  }

  // Check thinning eligibility
  const thinThresh = THINNING_BA["harvennus"]?.[state.species] ?? 22;
  const firstThinThresh = THINNING_BA["ensiharvennus"]?.[state.species] ?? 18;
  const minFirstAge = MIN_AGE_FIRST_THINNING?.[state.species] ?? 30;
  const minThinAge = MIN_AGE_THINNING?.[state.species] ?? 40;

  if (state.basalArea >= firstThinThresh && state.ageYears >= minFirstAge &&
      !state.developmentClass.includes("mature_thinning")) {
    spawned.push({
      stand,
      type: "first_thinning",
      year,
      income_eur: 0,
      cost_eur: 0,
      removal_m3: Math.round(state.volumeM3 * 0.25),
      notes: `Spawned first thinning BA=${state.basalArea.toFixed(0)}`,
      dueYear: year,
    });
  } else if (state.basalArea >= thinThresh && state.ageYears >= minThinAge) {
    spawned.push({
      stand,
      type: "thinning",
      year,
      income_eur: 0,
      cost_eur: 0,
      removal_m3: Math.round(state.volumeM3 * 0.28),
      notes: `Spawned thinning BA=${state.basalArea.toFixed(0)}`,
      dueYear: year,
    });
  }

  // Check tending eligibility
  if (state.developmentClass.includes("seedling")) {
    if (state.ageYears >= 3 && state.ageYears <= 12) {
      spawned.push({
        stand,
        type: "early_tending",
        year,
        income_eur: 0,
        cost_eur: 0,
        removal_m3: 0,
        notes: `Spawned early tending age=${state.ageYears}`,
        dueYear: year,
      });
    } else if (state.ageYears >= 10 && state.ageYears <= 25) {
      spawned.push({
        stand,
        type: "tending",
        year,
        income_eur: 0,
        cost_eur: 0,
        removal_m3: 0,
        notes: `Spawned tending age=${state.ageYears}`,
        dueYear: year,
      });
    }
  }

  return spawned;
}

// ── Year-by-Year Scheduling Engine ──

export interface ScheduleEngineInput {
  forestStands: StandData[];
  operations: PlannedOperation[]; // initial pool from classification
  startYear: number;
  endYear: number;
  goal: PlanGoal;
  annualGrowthM3: number;
  growthMultiplier: number;
  /** Stand wishes from stand_wishes table (T8) */
  wishes?: Array<{
    stand_id: string;
    wish_type: string;
    wish_value: string | null;
  }>;
}

export interface ScheduleEngineOutput {
  yearPlans: Map<number, PlannedOperation[]>;
  finalStates: Map<string, StandYearState>;
}

export function runScheduleEngine(input: ScheduleEngineInput): ScheduleEngineOutput {
  const { forestStands, operations, startYear, endYear, goal, annualGrowthM3, growthMultiplier } = input;
  const strategy = getStrategy(goal);
  const volumeCapM3 = strategy.volumeCapMultiplier() * annualGrowthM3;

  // Initialize stand states
  const states = new Map<string, StandYearState>();
  for (const s of forestStands) {
    states.set(s.standId, initStandState(s, growthMultiplier));
  }

  // Pool: initial operations + dynamically spawned
  let pool = [...operations];

  // Apply stand wishes (T8)
  if (input.wishes) {
    for (const wish of input.wishes) {
      switch (wish.wish_type) {
        case "accelerate_harvest": {
          // Boost priority for this stand's operations
          for (const op of pool) {
            if (op.stand.standId === wish.stand_id) {
              op._priority_boost = 2.0;
            }
          }
          break;
        }
        case "delay_harvest": {
          // Set dueYear to the wish year
          const delayYear = parseInt(wish.wish_value ?? "", 10);
          if (!isNaN(delayYear)) {
            for (const op of pool) {
              if (op.stand.standId === wish.stand_id) {
                op.dueYear = delayYear;
              }
            }
          }
          break;
        }
        case "no_clearcut": {
          // Convert any clear_cut to selection_cutting
          for (let i = 0; i < pool.length; i++) {
            if (pool[i].stand.standId === wish.stand_id && pool[i].type === "clear_cut") {
              pool[i] = {
                ...pool[i],
                type: "selection_cutting",
                removal_m3: Math.round(pool[i].removal_m3 * 0.5),
                income_eur: Math.round(pool[i].income_eur * 0.5),
                notes: `${pool[i].notes} (no_clearcut wish)`,
              };
            }
          }
          break;
        }
        case "retention_pct": {
          const pct = parseInt(wish.wish_value ?? "", 10);
          if (!isNaN(pct) && pct > 0 && pct < 100) {
            for (const op of pool) {
              if (op.stand.standId === wish.stand_id && op.removal_m3 > 0) {
                op.removal_m3 = Math.round(op.removal_m3 * (1 - pct / 100));
                op.income_eur = Math.round(op.income_eur * (1 - pct / 100));
              }
            }
          }
          break;
        }
      }
    }
  }
  let carryover: PlannedOperation[] = [];
  const yearPlans = new Map<number, PlannedOperation[]>();

  for (let yr = startYear; yr <= endYear; yr++) {
    // 1. Spawn new operations from threshold crossings
    const spawned: PlannedOperation[] = [];
    for (const [id, state] of states) {
      spawned.push(...spawnOperations(state, yr, goal, growthMultiplier));
    }
    pool.push(...spawned);

    // 2. Merge pool + carryover, sort by priority
    const candidates = sortCandidates([...pool, ...carryover], goal);

    // 3. Select operations for this year
    const { scheduled, remaining } = strategy.selectOperations(
      yr, states, candidates, volumeCapM3, annualGrowthM3,
    );

    yearPlans.set(yr, scheduled);

    // 4. Apply operations to stand states
    for (const op of scheduled) {
      const st = states.get(op.stand.standId);
      if (!st) continue;

      if (op.type === "clear_cut") {
        st.volumeM3 = 0;
        st.basalArea = 0;
        st.ageYears = 0;
        st.cleared = true;
      } else if (op.type === "thinning" || op.type === "first_thinning" || op.type === "selection_cutting") {
        const pct = op.removal_m3 / (st.volumeM3 || 1);
        st.volumeM3 -= op.removal_m3;
        st.basalArea = Math.max(0, st.basalArea * (1 - Math.min(pct, 1)));
      }

      // Regeneration ops for carbon_storage: use scalping, otherwise site_prep
      if (op.type === "site_prep" || op.type === "scalping" || op.type === "ditch_mounding") {
        // un-clear happens after delay
      }
      if (op.type.includes("planting")) {
        st.cleared = false;
        if (st.basalArea === 0) st.basalArea = 2;
        if (st.volumeM3 === 0) st.volumeM3 = st.areaHa * 1;
      }
    }

    // 5. Simulate one year of growth
    for (const [_, st] of states) {
      if (!st.cleared && st.areaHa > 0) {
        const growthM3PerHa = getGrowthRate(
          st.siteType, st.soilType, st.species,
          st.ageYears, st.basalArea, st.developmentClass,
        );
        const growthM3 = growthM3PerHa * st.areaHa;
        st.volumeM3 += growthM3;
      }
      st.ageYears += 1;
    }

    // 6. Carryover: remaining from this year's candidates
    carryover = remaining;
    pool = []; // pool was consumed as part of candidates
  }

  return { yearPlans, finalStates: states };
}
