// src/lib/ai/strategies.ts
// Phase 7b: Goal-aware scheduling strategies.
//
// Each strategy implements the SchedulingStrategy interface and controls
// how operations are selected each year from the pre-sorted candidate pool.
// The scheduling engine (schedule.ts) handles spawning, sorting, state
// mutation, and growth simulation — strategies only answer "what to pick."
//
// This file contains NO engine logic — no runScheduleEngine, no spawning,
// no growth simulation. Those live in schedule.ts.

import type { StandData, PlannedOperation, PlanGoal } from "./types";

// ── Scheduling Strategy Interface ──

export interface SchedulingStrategy {
  readonly name: string;
  /** Per-year harvest volume cap as multiplier of annual growth. */
  volumeCapMultiplier(): number;
  /**
   * Select operations to execute this year from the candidate pool.
   * Candidates arrive PRE-SORTED: thinnings before clearcuts, then by
   * dueYear (earlier first), then by goal-specific metric.
   */
  selectOperations(
    year: number,
    stands: Map<string, unknown>,
    candidates: PlannedOperation[],
    volumeCapM3: number,
    annualGrowthM3: number,
  ): { scheduled: PlannedOperation[]; remaining: PlannedOperation[] };
  /** Years to wait after clearcut before regeneration ops. */
  regenDelayYears(): number;
  /** Species preference for replanting after clearcut. */
  regenerationSpecies(stand: StandData): "spruce" | "pine" | "mixed";
  /** Years to wait after seed_tree/shelterwood appears before overstory_removal. */
  overstoryDelayYears(): number;
}

// ── Strategy Implementations ──

export const aggressiveStrategy: SchedulingStrategy = {
  name: "maximum_growth_aggressive",
  volumeCapMultiplier: () => 3.0,
  selectOperations(_year, _stands, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let used = 0;

    for (const op of candidates) {
      const vol = op.removal_m3;
      if (used + vol <= volumeCapM3 || op.removal_m3 === 0) {
        scheduled.push(op);
        used += vol;
      } else {
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  regenDelayYears: () => 0,
  regenerationSpecies: (stand) =>
    stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine",
  overstoryDelayYears: () => 5,
};

export const noCapStrategy: SchedulingStrategy = {
  name: "maximum_growth_no_cap",
  volumeCapMultiplier: () => Infinity,
  selectOperations(_year, _stands, candidates, _volumeCapM3, _annualGrowthM3) {
    return { scheduled: [...candidates], remaining: [] };
  },
  regenDelayYears: () => 0,
  regenerationSpecies: (stand) =>
    stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine",
  overstoryDelayYears: () => 5,
};

export const balancedGrowthStrategy: SchedulingStrategy = {
  name: "maximum_growth_balanced",
  volumeCapMultiplier: () => 1.25,
  selectOperations(_year, _stands, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let used = 0;

    for (const op of candidates) {
      const vol = op.removal_m3;
      if (used + vol <= volumeCapM3 || vol === 0) {
        scheduled.push(op);
        used += vol;
      } else {
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  regenDelayYears: () => 1,
  regenerationSpecies: (stand) =>
    stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine",
  overstoryDelayYears: () => 7,
};

export const carbonStorageStrategy: SchedulingStrategy = {
  name: "carbon_storage",
  volumeCapMultiplier: () => 0.5,
  selectOperations(_year, _stands, candidates, volumeCapM3, _annualGrowthM3) {
    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let used = 0;

    for (const op of candidates) {
      const vol = op.removal_m3;
      if (used + vol <= volumeCapM3 || vol === 0) {
        scheduled.push(op);
        used += vol;
      } else {
        remaining.push(op);
      }
    }
    return { scheduled, remaining };
  },
  regenDelayYears: () => 2,
  regenerationSpecies: () => "spruce",
  overstoryDelayYears: () => 10,
};

export const balancedStrategy: SchedulingStrategy = {
  name: "balanced",
  volumeCapMultiplier: () => 1.0,
  selectOperations(_year, _stands, candidates, volumeCapM3, _annualGrowthM3) {
    // Round-robin interleaving of thinnings and clearcuts.
    const groupA = candidates.filter(
      (op) => op.type === "thinning" || op.type === "first_thinning" ||
             op.type === "selection_cutting" || op.type === "overstory_removal",
    );
    const groupB = candidates.filter((op) => op.type === "clear_cut");
    const nonHarvest = candidates.filter(
      (op) => !groupA.includes(op) && !groupB.includes(op),
    );

    const scheduled: PlannedOperation[] = [];
    const remaining: PlannedOperation[] = [];
    let used = 0;

    // Accept all non-harvest ops (tendings, regen) — they don't consume cap
    for (const op of nonHarvest) {
      scheduled.push(op);
    }

    // Round-robin between thinnings and clearcuts
    let ai = 0, bi = 0;
    let pickA = true;

    while (ai < groupA.length || bi < groupB.length) {
      const pool = pickA ? groupA : groupB;
      const idx = pickA ? ai : bi;

      if (idx < pool.length) {
        const op = pool[idx];
        if (used + op.removal_m3 <= volumeCapM3) {
          scheduled.push(op);
          used += op.removal_m3;
        } else {
          remaining.push(op);
        }
        if (pickA) ai++; else bi++;
      }

      if (pickA && ai >= groupA.length) pickA = false;
      else if (!pickA && bi >= groupB.length) pickA = true;
      else pickA = !pickA;

      if (ai >= groupA.length && bi >= groupB.length) break;
    }

    return { scheduled, remaining };
  },
  regenDelayYears: () => 1,
  regenerationSpecies: (stand) =>
    stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine",
  overstoryDelayYears: () => 7,
};

// ── Strategy Factory ──

export function getStrategy(goal: PlanGoal): SchedulingStrategy {
  switch (goal) {
    case "maximum_growth_aggressive": return aggressiveStrategy;
    case "maximum_growth_balanced": return balancedGrowthStrategy;
    case "carbon_storage": return carbonStorageStrategy;
    case "balanced": return balancedStrategy;
    case "maximum_growth_no_cap": return noCapStrategy;
  }
}
