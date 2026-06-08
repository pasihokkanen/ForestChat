import { describe, it, expect } from "vitest";
import type { StandData } from "@/lib/ai/types";
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

describe("schedulePlan (Phase 7b rewrite — dynamic spawning)", () => {
  it("returns empty years with no stands", () => {
    const { years, summary } = schedulePlan([], 2026, 20);
    expect(years.length).toBe(20);
    expect(summary.totalVolume).toBe(0);
    expect(summary.averageHarvestPerYear).toBe(0);
  });

  it("returns correct number of years for custom period", () => {
    const { years } = schedulePlan([], 2026, 10);
    expect(years.length).toBe(10);
    expect(years[0].year).toBe(2026);
    expect(years[9].year).toBe(2035);
  });

  it("spawns a clear_cut for an over-age stand", () => {
    // mesic ceiling=220, volPerHa=10 → well under. Large area → cap fits 100 m³ removal.
    const stand = makeStand({
      standId: "1",
      volumeM3: 100, valueEur: 5000, areaHa: 10,
      ageYears: 100, ba: 25,
      siteType: "mesic", site_class: "tuore",
      annual_growth: 5.5,
    });
    const { years } = schedulePlan([stand], 2026, 20, "maximum_growth_aggressive", 1.0);
    const allClearcuts = years.flatMap((y) => y.finalHarvests);
    expect(allClearcuts.length).toBeGreaterThanOrEqual(1);
    expect(allClearcuts[0].type).toBe("clear_cut");
  });

  it("spawns a thinning for a stand with high BA", () => {
    // mesic ceiling=220, volPerHa=5 → well under. Large area → cap fits 28 m³ removal.
    const stand = makeStand({
      standId: "2",
      volumeM3: 100, valueEur: 5000, areaHa: 20,
      ageYears: 50, ba: 25,
      siteType: "mesic", site_class: "tuore",
      annual_growth: 5.5,
    });
    const { years } = schedulePlan([stand], 2026, 20, "balanced", 1.0);
    const allThinnings = years.flatMap((y) => y.thinnings);
    expect(allThinnings.length).toBeGreaterThanOrEqual(1);
  });

  it("spawns regeneration ops after clearcut", () => {
    const stand = makeStand({
      standId: "3",
      volumeM3: 100, valueEur: 5000, areaHa: 10,
      ageYears: 100, ba: 25,
      siteType: "mesic", site_class: "tuore",
      annual_growth: 5.5,
    });
    const { years } = schedulePlan([stand], 2026, 20, "maximum_growth_aggressive", 1.0);
    const allRegen = years.flatMap((y) => y.regenerationOps);
    expect(allRegen.length).toBeGreaterThan(0);
  });

  it("carbon_storage spawns selection_cutting instead of clear_cut", () => {
    // pine on sub-xeric: optMin=75, optMax=100 → optMax+15=115.
    // age 130 > 115. Large area so annual growth exceeds volume cap.
    const stand = makeStand({
      standId: "cs1",
      volumeM3: 50,
      valueEur: 3000,
      areaHa: 40,
      ageYears: 130,
      ba: 30,
      siteType: "sub-xeric",
      site_class: "kuivahko",
      annual_growth: 2.5,
    });
    const { years } = schedulePlan([stand], 2026, 20, "carbon_storage", 1.0);
    const allHarvests = years.flatMap((y) => [...y.finalHarvests, ...y.thinnings]);
    const selectionCuts = allHarvests.filter((o) => o.type === "selection_cutting");
    const clearCuts = allHarvests.filter((o) => o.type === "clear_cut");
    expect(selectionCuts.length).toBeGreaterThanOrEqual(1);
    expect(clearCuts.length).toBe(0);
  });

  it("produces valid PlanSummary with live annual growth", () => {
    const stand = makeStand({
      standId: "s5", volumeM3: 500, valueEur: 25000,
      ageYears: 100, ba: 30, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { summary } = schedulePlan([stand], 2026, 20, "maximum_growth_aggressive", 1.0);
    expect(summary.totalVolume).toBeGreaterThanOrEqual(0);
    expect(summary.annualGrowth).toBeGreaterThanOrEqual(0);
    expect(summary.stumpageValue).toBeGreaterThanOrEqual(0);
    expect(summary.averageHarvestPerYear).toBeGreaterThanOrEqual(0);
    expect(summary.totalIncome).toBeGreaterThanOrEqual(0);
    expect(summary.totalCosts).toBeGreaterThanOrEqual(0);
  });

  it("Lappi growth multiplier (0.55) affects scheduling output", () => {
    // volume under ceiling: maxYield(sub-xeric)*0.55*0.75 = 140*0.55*0.75 ≈ 57.75 m³/ha
    // 50 m³ on 2 ha = 25 m³/ha → well under cap
    const stand = makeStand({
      standId: "lap1", volumeM3: 50, valueEur: 2500,
      ageYears: 80, ba: 22, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { years, summary } = schedulePlan([stand], 2026, 20, "balanced", 0.55);
    expect(years.length).toBe(20);
    expect(summary.annualGrowth).toBeGreaterThan(0);
  });

  it("young stand does NOT trigger clearcut or thinning", () => {
    const stand = makeStand({
      standId: "young1", volumeM3: 50, valueEur: 2000,
      ageYears: 15, ba: 8, siteType: "mesic", site_class: "tuore",
      annual_growth: 3.0,
    });
    const { years } = schedulePlan([stand], 2026, 20, "maximum_growth_aggressive", 1.0);
    const allHarvests = years.flatMap((y) => [...y.finalHarvests, ...y.thinnings]);
    expect(allHarvests.length).toBe(0);
  });

  it("10-year plan returns exactly 10 years", () => {
    const stand = makeStand({
      standId: "10yr", volumeM3: 300, valueEur: 15000,
      ageYears: 100, ba: 25, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { years } = schedulePlan([stand], 2026, 10, "maximum_growth_aggressive", 1.0);
    expect(years.length).toBe(10);
  });

  it("35-year plan returns exactly 35 years", () => {
    const stand = makeStand({
      standId: "35yr", volumeM3: 300, valueEur: 15000,
      ageYears: 100, ba: 25, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { years } = schedulePlan([stand], 2026, 35, "maximum_growth_aggressive", 1.0);
    expect(years.length).toBe(35);
  });

  it("year plans are continuous and sequential", () => {
    const stand = makeStand({
      standId: "seq", volumeM3: 300, valueEur: 15000,
      ageYears: 100, ba: 25, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { years } = schedulePlan([stand], 2030, 15, "maximum_growth_aggressive", 1.0);
    expect(years.length).toBe(15);
    expect(years[0].year).toBe(2030);
    expect(years[14].year).toBe(2044);
  });
});

// --- trySplitStand stub (always returns null) ---

describe("trySplitStand (stub — splitting disabled)", () => {
  it("returns null", () => {
    const stand = makeStand({ standId: "s1", areaHa: 4.0, volumeM3: 400, valueEur: 20000 });
    const op = {
      stand,
      type: "clear_cut",
      year: 0,
      income_eur: 20000,
      cost_eur: 0,
      removal_m3: 400,
      notes: "",
    };
    const result = trySplitStand(stand, op, 250, 4);
    expect(result).toBeNull();
  });
});
