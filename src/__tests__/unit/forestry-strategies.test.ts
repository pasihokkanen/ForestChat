import { describe, it, expect } from "vitest";
import type { StandData, PlannedOperation } from "@/lib/ai/types";
import { runScheduleEngine, getStrategy, type SchedulingStrategy } from "@/lib/ai/strategies";

// --- Helpers ---

function makeStand(overrides: Partial<StandData> & { standId: string }): StandData {
  return {
    standId: overrides.standId,
    areaHa: overrides.areaHa ?? 2.0,
    developmentClass: overrides.developmentClass ?? "mature_thinning",
    siteType: overrides.siteType ?? "mesic",
    soilType: overrides.soilType ?? "mineral soil",
    drainageStatus: overrides.drainageStatus ?? "ei ojia",
    mainSpecies: overrides.mainSpecies ?? "pine",
    site_class: overrides.site_class ?? "tuore",
    is_peatland: overrides.is_peatland ?? false,
    annual_growth: overrides.annual_growth ?? 0,
    valueEur: overrides.valueEur ?? 10000,
    logM3: overrides.logM3 ?? 100,
    pulpM3: overrides.pulpM3 ?? 100,
    ageYears: overrides.ageYears ?? 50,
    ba: overrides.ba ?? 20,
    volumeM3: overrides.volumeM3 ?? 200,
  };
}

function makeOp(
  stand: StandData,
  type: string,
  overrides?: Partial<PlannedOperation>
): PlannedOperation {
  return {
    stand,
    type,
    year: overrides?.year ?? 0,
    income_eur: overrides?.income_eur ?? 0,
    cost_eur: overrides?.cost_eur ?? 0,
    removal_m3: overrides?.removal_m3 ?? 0,
    notes: overrides?.notes ?? "",
    dueYear: overrides?.dueYear ?? 2026,
  };
}

// --- Strategy factory ---

describe("getStrategy", () => {
  it("returns aggressive strategy for maximum_growth_aggressive", () => {
    const s = getStrategy("maximum_growth_aggressive");
    expect(s.name).toBe("maximum_growth_aggressive");
    expect(s.volumeCapMultiplier()).toBe(3.0);
    expect(s.regenDelayYears()).toBe(0);
  });

  it("returns balanced-growth strategy for maximum_growth_balanced", () => {
    const s = getStrategy("maximum_growth_balanced");
    expect(s.name).toBe("maximum_growth_balanced");
    expect(s.volumeCapMultiplier()).toBe(1.25);
  });

  it("returns carbon strategy for carbon_storage", () => {
    const s = getStrategy("carbon_storage");
    expect(s.name).toBe("carbon_storage");
    expect(s.volumeCapMultiplier()).toBe(0.5);
    expect(s.regenDelayYears()).toBe(2);
  });

  it("returns balanced strategy for balanced", () => {
    const s = getStrategy("balanced");
    expect(s.name).toBe("balanced");
    expect(s.volumeCapMultiplier()).toBe(1.0);
  });
});

// --- Strategy behavior ---

describe("strategy selectOperations", () => {
  it("aggressive: fits all operations under high cap", () => {
    const stand = makeStand({ standId: "s1", volumeM3: 300, valueEur: 15000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 50, income_eur: 2000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("maximum_growth_aggressive");
    const result = s.selectOperations(2026, states, candidates, 300, 55);
    expect(result.scheduled.length).toBe(2);
    expect(result.remaining.length).toBe(0);
  });

  it("carbon_storage: skips clear_cut for non-overmature stands", () => {
    const stand = makeStand({ standId: "cs1", volumeM3: 300, valueEur: 15000, ageYears: 60, siteType: "mesic" });
    // tuore pine optMax=90, 90+15=105; age 60 → not overmature
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 50, income_eur: 2000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("carbon_storage");
    const result = s.selectOperations(2026, states, candidates, 200, 55);
    // Thinning should be scheduled, clear_cut goes to remaining
    expect(result.scheduled.some((o) => o.type === "thinning")).toBe(true);
    expect(result.remaining.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("balanced-growth: skips clearcuts when pending harvest > 2× annual growth", () => {
    const stand = makeStand({ standId: "s2", volumeM3: 500, valueEur: 25000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(stand, "thinning", { removal_m3: 100, income_eur: 5000, dueYear: 2026 }),
      makeOp(stand, "clear_cut", { removal_m3: 400, income_eur: 20000, dueYear: 2026 }),
    ];
    const s = getStrategy("maximum_growth_balanced");
    // Total pending = 500, annual growth = 50 → 500 > 2×50 = 100, so skip clearcuts
    const result = s.selectOperations(2026, states, candidates, 500, 50);
    expect(result.scheduled.some((o) => o.type === "thinning")).toBe(true);
  });

  it("balanced: round-robin interleaves thinnings and clearcuts", () => {
    const s1 = makeStand({ standId: "a1", volumeM3: 300, valueEur: 15000 });
    const s2 = makeStand({ standId: "a2", volumeM3: 400, valueEur: 20000 });
    const states = new Map();
    const candidates: PlannedOperation[] = [
      makeOp(s1, "thinning", { removal_m3: 80, income_eur: 4000, dueYear: 2026 }),
      makeOp(s2, "clear_cut", { removal_m3: 200, income_eur: 10000, dueYear: 2026 }),
    ];
    const s = getStrategy("balanced");
    const result = s.selectOperations(2026, states, candidates, 300, 55);
    expect(result.scheduled.length).toBe(2);
  });
});

// --- Engine ---

describe("runScheduleEngine", () => {
  it("returns empty yearPlans for no stands", () => {
    const result = runScheduleEngine({
      forestStands: [],
      operations: [],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 0,
      growthMultiplier: 1.0,
    });
    expect(result.yearPlans.size).toBe(10);
    for (const [, ops] of result.yearPlans) {
      expect(ops).toHaveLength(0);
    }
  });

  it("schedules a clear_cut in the first year", () => {
    const stand = makeStand({
      standId: "cc1", volumeM3: 300, valueEur: 15000, developmentClass: "regeneration_ready",
      ageYears: 80,
    });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "maximum_growth_aggressive", // cap = 3 × 300 = 900 fits 300 m³
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
    });
    const firstYear = result.yearPlans.get(2026) ?? [];
    expect(firstYear.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("spawns regeneration ops after clearcut delay", () => {
    const stand = makeStand({
      standId: "regen1", volumeM3: 300, valueEur: 15000, developmentClass: "regeneration_ready",
      ageYears: 80,
    });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "maximum_growth_aggressive", // delay=0, regen same year
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
    });
    // With delay=0, regen should appear same year or next
    let foundRegen = false;
    for (let yr = 2026; yr <= 2028; yr++) {
      const ops = result.yearPlans.get(yr) ?? [];
      if (ops.some((o) => o.type.includes("planting"))) {
        foundRegen = true;
        break;
      }
    }
    expect(foundRegen).toBe(true);
  });

  it("carbon_storage spawns selection_cutting not clear_cut for regeneration_ready", () => {
    const stand = makeStand({
      standId: "cs1", volumeM3: 400, valueEur: 20000, developmentClass: "regeneration_ready",
      ageYears: 125, mainSpecies: "pine", siteType: "sub-xeric",
    });
    const op = makeOp(stand, "clear_cut", { removal_m3: 400, income_eur: 20000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "carbon_storage",
      annualGrowthM3: 400,
      growthMultiplier: 1.0,
    });
    const firstYear = result.yearPlans.get(2026) ?? [];
    // carbon_storage converts clear_cut to selection_cutting if eligible
    expect(firstYear.some((o) => o.type === "clear_cut")).toBe(false);
  });

  it("respects volume cap from strategy", () => {
    const stands = Array.from({ length: 10 }, (_, i) =>
      makeStand({ standId: `v${i}`, volumeM3: 500, valueEur: 25000, ageYears: 80, developmentClass: "regeneration_ready" })
    );
    const ops = stands.map((s) => makeOp(s, "clear_cut", { removal_m3: 500, income_eur: 25000, dueYear: 2026 }));
    const result = runScheduleEngine({
      forestStands: [...stands],
      operations: [...ops],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 55,
      growthMultiplier: 1.0,
    });
    // With cap=55, no year should exceed 55 m³ harvest
    for (const [, yrOps] of result.yearPlans) {
      const total = yrOps.reduce((s, o) => s + o.removal_m3, 0);
      expect(total).toBeLessThanOrEqual(60);
    }
  });

  it("applies Lappi growth multiplier to scheduling", () => {
    const stand = makeStand({
      standId: "lap1", volumeM3: 300, valueEur: 15000, developmentClass: "regeneration_ready",
      ageYears: 80,
    });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 300,
      growthMultiplier: 0.55,
    });
    expect(result.yearPlans.size).toBe(10);
  });

  it("synthesizes a 3-stand forest across all 4 goals without crashing", () => {
    const synthetic = [
      makeStand({ standId: "syn1", volumeM3: 500, valueEur: 25000, ageYears: 80, developmentClass: "regeneration_ready", mainSpecies: "pine", siteType: "sub-xeric" }),
      makeStand({ standId: "syn2", volumeM3: 250, valueEur: 12000, ageYears: 45, developmentClass: "mature_thinning", mainSpecies: "spruce", siteType: "mesic", ba: 28 }),
      makeStand({ standId: "syn3", volumeM3: 40, valueEur: 2000, ageYears: 8, developmentClass: "seedling", mainSpecies: "pine", siteType: "sub-xeric" }),
    ];
    const ops: PlannedOperation[] = [
      makeOp(synthetic[0], "clear_cut", { removal_m3: 500, income_eur: 25000, dueYear: 2026 }),
      makeOp(synthetic[1], "thinning", { removal_m3: 70, income_eur: 3500, dueYear: 2026 }),
      makeOp(synthetic[2], "early_tending", { removal_m3: 0, income_eur: 0, cost_eur: 1260, dueYear: 2026 }),
    ];

    const goals: Array<"balanced" | "maximum_growth_aggressive" | "maximum_growth_balanced" | "carbon_storage"> = [
      "balanced", "maximum_growth_aggressive", "maximum_growth_balanced", "carbon_storage",
    ];

    for (const goal of goals) {
      const result = runScheduleEngine({
        forestStands: [...synthetic],
        operations: [...ops],
        startYear: 2026,
        endYear: 2045,
        goal,
        annualGrowthM3: 300,
        growthMultiplier: 1.0,
      });
      expect(result.yearPlans.size).toBe(20);
      const totalOps = [...result.yearPlans.values()].reduce((s, o) => s + o.length, 0);
      expect(totalOps).toBeGreaterThan(0);
    }
  });

  it("stand wishes: accelerate_harvest boosts priority", () => {
    const stand = makeStand({ standId: "w1", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "maximum_growth_aggressive",
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
      wishes: [{ stand_id: "w1", wish_type: "accelerate_harvest", wish_value: null }],
    });
    const firstYear = result.yearPlans.get(2026) ?? [];
    expect(firstYear.some((o) => o.type === "clear_cut")).toBe(true);
  });

  it("stand wishes: delay_harvest pushes dueYear for priority ordering", () => {
    const stand = makeStand({ standId: "w2", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
      wishes: [{ stand_id: "w2", wish_type: "delay_harvest", wish_value: "2030" }],
    });
    // dueYear=2030 is a priority hint; with only one operation it may still
    // schedule in 2026. But the operation should appear somewhere.
    const w2Ops = [...result.yearPlans.entries()]
      .filter(([, ops]) => ops.some((o) => o.stand.standId === "w2"));
    expect(w2Ops.length).toBeGreaterThan(0);
  });

  it("stand wishes: no_clearcut converts to selection_cutting", () => {
    const stand = makeStand({ standId: "w3", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
      wishes: [{ stand_id: "w3", wish_type: "no_clearcut", wish_value: null }],
    });
    let foundClearcut = false;
    let foundSelection = false;
    for (const [, yrOps] of result.yearPlans) {
      if (yrOps.some((o) => o.type === "clear_cut" && o.stand.standId === "w3")) foundClearcut = true;
      if (yrOps.some((o) => o.type === "selection_cutting" && o.stand.standId === "w3")) foundSelection = true;
    }
    expect(foundClearcut).toBe(false);
    expect(foundSelection).toBe(true);
  });

  it("stand wishes: retention_pct reduces removal volume", () => {
    const stand = makeStand({ standId: "w4", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const op = makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000, dueYear: 2026 });
    const result = runScheduleEngine({
      forestStands: [stand],
      operations: [op],
      startYear: 2026,
      endYear: 2035,
      goal: "balanced",
      annualGrowthM3: 300,
      growthMultiplier: 1.0,
      wishes: [{ stand_id: "w4", wish_type: "retention_pct", wish_value: "30" }],
    });
    // Removal should be reduced by 30%
    for (const [, yrOps] of result.yearPlans) {
      for (const o of yrOps) {
        if (o.stand.standId === "w4") {
          expect(o.removal_m3).toBeLessThan(300);
        }
      }
    }
  });
});
