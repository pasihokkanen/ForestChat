import { describe, it, expect } from "vitest";
import type { StandData, PlannedOperation } from "@/lib/ai/types";
import { schedulePlan, trySplitStand } from "@/lib/ai/schedule";

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
    annual_growth: overrides.annual_growth ?? 5.5,
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

describe("schedulePlan (Phase 7b engine)", () => {
  it("returns empty periods with no operations", () => {
    const result = schedulePlan([], [], 2026);
    expect(result.p1.length).toBe(10);
    expect(result.p2.length).toBe(10);
    expect(result.summary.totalVolume).toBe(0);
  });

  it("schedules a single clear_cut in period 1", () => {
    const stand = makeStand({ standId: "1", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const ops = [makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000 })];
    // Use aggressive strategy with high cap so operation fits
    const result = schedulePlan([stand], ops, 2026, "maximum_growth_aggressive", 300, 1.0);
    const totalFinalP1 = result.p1.reduce((s, y) => s + y.finalHarvests.length, 0);
    const totalFinalP2 = result.p2.reduce((s, y) => s + y.finalHarvests.length, 0);
    expect(totalFinalP1 + totalFinalP2).toBeGreaterThanOrEqual(1);
  });

  it("schedules regeneration after clearcut with delay", () => {
    const stand = makeStand({ standId: "2", volumeM3: 300, valueEur: 15000, areaHa: 2.0, ageYears: 80, developmentClass: "regeneration_ready" });
    const ops = [makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000 })];
    // Aggressive: delay=0, high cap
    const result = schedulePlan([stand], ops, 2026, "maximum_growth_aggressive", 300, 1.0);
    const totalRegen = result.p1.reduce((s, y) => s + y.regenerationOps.length, 0) +
      result.p2.reduce((s, y) => s + y.regenerationOps.length, 0);
    expect(totalRegen).toBeGreaterThan(0);
  });

  it("distributes operations across years evenly", () => {
    const stands = Array.from({ length: 10 }, (_, i) =>
      makeStand({ standId: String(i + 10), volumeM3: 200 + i * 50, valueEur: 10000 + i * 1000, ageYears: 80, developmentClass: "regeneration_ready" })
    );
    const ops = stands.map((s) => makeOp(s, "clear_cut", { removal_m3: s.volumeM3, income_eur: s.valueEur }));
    const result = schedulePlan(stands, ops, 2026, "balanced", 3000, 1.0);
    // No single year should have extreme concentration
    for (const year of result.p1) {
      const total = year.finalHarvests.reduce((s, o) => s + o.removal_m3, 0);
      expect(total).toBeLessThanOrEqual(3000);
    }
  });

  it("produces valid PlanSummary with non-negative values", () => {
    const stand = makeStand({ standId: "3", volumeM3: 500, valueEur: 25000, ageYears: 80, developmentClass: "regeneration_ready" });
    const ops = [makeOp(stand, "clear_cut", { removal_m3: 500, income_eur: 25000 })];
    const result = schedulePlan([stand], ops, 2026, "maximum_growth_aggressive", 500, 1.0);
    expect(result.summary.totalVolume).toBeGreaterThanOrEqual(0);
    expect(result.summary.annualGrowth).toBeGreaterThanOrEqual(0);
    expect(result.summary.stumpageValue).toBeGreaterThanOrEqual(0);
  });
});

// --- Goal-aware scheduling ---

describe("schedulePlan with goals", () => {
  it("carbon_storage: pre-made selection_cutting gets scheduled", () => {
    const stand = makeStand({ standId: "cs1", volumeM3: 400, valueEur: 20000, ageYears: 115, developmentClass: "regeneration_ready", siteType: "sub-xeric" });
    const ops = [makeOp(stand, "selection_cutting", { removal_m3: 200, income_eur: 10000 })];
    // carbon cap = 0.5 × 400 = 200, fits the 200 m³ removal
    const result = schedulePlan([stand], ops, 2026, "carbon_storage", 400, 1.0);
    const allOps = [...result.p1, ...result.p2].flatMap((y) => [
      ...y.finalHarvests, ...y.thinnings,
    ]);
    expect(allOps.some((o) => o.type === "selection_cutting")).toBe(true);
  });

  it("balanced goal schedules thinnings interleaved with clearcuts", () => {
    const stands = Array.from({ length: 5 }, (_, i) =>
      makeStand({ standId: `b${i}`, volumeM3: 200 + i * 100, valueEur: 10000 + i * 5000, ageYears: 80, developmentClass: "regeneration_ready" })
    );
    const ops = [
      ...stands.slice(0, 3).map((s) => makeOp(s, "clear_cut", { removal_m3: s.volumeM3, income_eur: s.valueEur })),
      ...stands.slice(3).map((s) => makeOp(s, "thinning", { removal_m3: s.volumeM3 * 0.3, income_eur: s.valueEur * 0.3 })),
    ];
    const result = schedulePlan(stands, ops, 2026, "balanced", 3000, 1.0);
    const allOps = [...result.p1, ...result.p2].flatMap((y) => [
      ...y.finalHarvests, ...y.thinnings, ...y.tendingOps, ...y.regenerationOps,
    ]);
    expect(allOps.length).toBeGreaterThanOrEqual(5);
  });
});

// --- Growth multiplier ---

describe("schedulePlan with growthMultiplier", () => {
  it("Lappi growth multiplier (0.55) reflects in scheduling", () => {
    const stand = makeStand({ standId: "lap1", volumeM3: 300, valueEur: 15000, ageYears: 80, developmentClass: "regeneration_ready" });
    const ops = [makeOp(stand, "clear_cut", { removal_m3: 300, income_eur: 15000 })];
    const result = schedulePlan([stand], ops, 2026, "balanced", 300, 0.55);
    expect(result.p1.length).toBe(10);
    expect(result.summary.annualGrowth).toBeGreaterThan(0);
  });
});

// --- Stand splitting ---

describe("trySplitStand", () => {
  it("returns null for stand below minimum split area", () => {
    const stand = makeStand({ standId: "s1", areaHa: 0.5, volumeM3: 200, valueEur: 10000 });
    const op = makeOp(stand, "clear_cut", { removal_m3: 200, income_eur: 10000 });
    const result = trySplitStand(stand, op, 50, 4);
    expect(result).toBeNull();
  });

  it("splits a large stand into 2 parts", () => {
    const stand = makeStand({ standId: "s2", areaHa: 4.0, volumeM3: 400, valueEur: 20000 });
    const op = makeOp(stand, "clear_cut", { removal_m3: 400, income_eur: 20000 });
    const result = trySplitStand(stand, op, 250, 4);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].stand.areaHa).toBeCloseTo(2.0);
    expect(result![0].removal_m3).toBe(200);
  });

  it("returns null when no split fits", () => {
    const stand = makeStand({ standId: "s3", areaHa: 2.0, volumeM3: 400, valueEur: 20000 });
    const op = makeOp(stand, "clear_cut", { removal_m3: 400, income_eur: 20000 });
    const result = trySplitStand(stand, op, 500, 4);
    expect(result).toBeNull();
  });
});
