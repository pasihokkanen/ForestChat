import { describe, it } from "vitest";
import { schedulePlan } from "../schedule";
import type { StandData } from "../types";

function makeStand(overrides: Partial<StandData> & { standId: string }): StandData {
  return {
    standId: overrides.standId, areaHa: overrides.areaHa ?? 2.0,
    developmentClass: overrides.developmentClass ?? "mature_thinning",
    siteType: overrides.siteType ?? "mesic", soilType: overrides.soilType ?? "mineral soil",
    drainageStatus: overrides.drainageStatus ?? "ei ojia",
    mainSpecies: overrides.mainSpecies ?? "pine", site_class: overrides.site_class ?? "tuore",
    is_peatland: overrides.is_peatland ?? false,
    annual_growth: overrides.annual_growth ?? 5.5,
    valueEur: overrides.valueEur ?? 10000, logM3: overrides.logM3 ?? 100, pulpM3: overrides.pulpM3 ?? 100,
    ageYears: overrides.ageYears ?? 50, ba: overrides.ba ?? 20,
    volumeM3: overrides.volumeM3 ?? 200,
    stemCount: overrides.stemCount ?? 0, meanHeight: overrides.meanHeight ?? 0, meanDiameter: overrides.meanDiameter ?? 0,
    speciesData: overrides.speciesData ?? [],
  };
}

describe("debug lappi", () => {
  it("debug", () => {
    const stand = makeStand({
      standId: "lap1", volumeM3: 50, valueEur: 2500,
      ageYears: 80, ba: 22, siteType: "sub-xeric", site_class: "kuivahko",
      annual_growth: 3.0,
    });
    const { summary, years } = schedulePlan([stand], 2026, 20, "balanced", 0.55);
    console.log(`annualGrowth: ${summary.annualGrowth}`);
    console.log(`totalVolume: ${summary.totalVolume}`);
    console.log(`years: ${years.length}`);
    const allOps = years.flatMap(y => [...y.thinnings, ...y.finalHarvests]);
    console.log(`ops: ${allOps.length}  types: ${allOps.map(o => o.type).join(", ")}`);
  });
});
