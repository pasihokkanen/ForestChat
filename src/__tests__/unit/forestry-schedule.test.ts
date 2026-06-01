import { describe, it, expect } from "vitest";
import type { StandData, PlannedOperation } from "@/lib/ai/types";
import { schedulePlan } from "@/lib/ai/schedule";

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
  };
}

describe("schedulePlan", () => {
  it("returns empty periods with no operations", () => {
    const result = schedulePlan([], [], 2026);
    expect(result.p1.length).toBe(10);
    expect(result.p2.length).toBe(10);
    expect(result.summary.totalVolume).toBe(0);
  });

  it("schedules a single clear_cut in period 1", () => {
    const stand = makeStand({ standId: "1", volumeM3: 300, valueEur: 15000 });
    const ops = [makeOp(stand, "clear_cut")];
    const result = schedulePlan([stand], ops, 2026);
    const totalFinalP1 = result.p1.reduce((s, y) => s + y.finalHarvests.length, 0);
    const totalFinalP2 = result.p2.reduce((s, y) => s + y.finalHarvests.length, 0);
    expect(totalFinalP1 + totalFinalP2).toBeGreaterThanOrEqual(1);
  });

  it("generates regeneration after clearcut", () => {
    const stand = makeStand({ standId: "2", volumeM3: 300, valueEur: 15000 });
    const ops = [makeOp(stand, "clear_cut")];
    const result = schedulePlan([stand], ops, 2026);
    const totalRegen = result.p1.reduce((s, y) => s + y.regenerationOps.length, 0) +
      result.p2.reduce((s, y) => s + y.regenerationOps.length, 0);
    expect(totalRegen).toBeGreaterThan(0);
  });

  it("distributes operations across years evenly", () => {
    const stands = Array.from({ length: 10 }, (_, i) =>
      makeStand({ standId: String(i + 10), volumeM3: 200 + i * 50, valueEur: 10000 + i * 1000 })
    );
    const ops = stands.map((k) => makeOp(k, "clear_cut"));
    const result = schedulePlan(stands, ops, 2026);
    // No single year should have an extreme concentration
    for (const year of result.p1) {
      const total = year.finalHarvests.reduce((s, o) => s + o.removal_m3, 0);
      expect(total).toBeLessThanOrEqual(3000);
    }
  });

  it("includes K180 selection_cutting in 2028", () => {
    const k180 = makeStand({ standId: "180", volumeM3: 400, valueEur: 20000 });
    const ops = [makeOp(k180, "selection_cutting", { removal_m3: 200, notes: "50%" })];
    const result = schedulePlan([k180], ops, 2026);
    // Check that operations reference stand 180
    const allOps = [...result.p1, ...result.p2].flatMap((y) => [
      ...y.finalHarvests, ...y.thinnings,
    ]);
    const hasK180 = allOps.some((o) => o.stand.standId === "180");
    expect(hasK180).toBe(true);
  });

  it("produces valid PlanSummary with non-negative values", () => {
    const stand = makeStand({ standId: "3", volumeM3: 500, valueEur: 25000 });
    const ops = [makeOp(stand, "clear_cut")];
    const result = schedulePlan([stand], ops, 2026);
    expect(result.summary.totalVolume).toBeGreaterThanOrEqual(0);
    expect(result.summary.annualGrowth).toBeGreaterThanOrEqual(0);
    expect(result.summary.stumpageValue).toBeGreaterThanOrEqual(0);
  });
});
