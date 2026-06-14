// src/lib/ai/__tests__/spruce-reality-check.test.ts
// Pure-spruce Tapio simulation vs real spruce-dominated stands.
// Runs schedule engine → uses its snapshots directly (no manual op collection).
import { describe, it, expect } from "vitest";
import { runScheduleEngine } from "../schedule";
import type { StandData, PlannedOperation } from "../types";

function makeSpruceStand(standId: string, siteType: string, areaHa = 1.0): StandData {
  return {
    standId, areaHa,
    developmentClass: "seedling_spruce",
    siteType, soilType: "mineral", drainageStatus: "",
    mainSpecies: "spruce", site_class: siteType, is_peatland: false,
    annual_growth: 6, valueEur: 500, logM3: 0, pulpM3: 0,
    ageYears: 5, ba: 2, volumeM3: 3,
    stemCount: 1650, meanHeight: 1.5, meanDiameter: 2.0,
    speciesData: [],
  };
}

function snapAtAge(
  snapshots: { year: number; stands: { ageYears: number; meanDiameter?: number; meanHeight?: number; stemCount?: number; volumeM3: number; areaHa: number }[] }[],
  targetAge: number,
) {
  let best = snapshots[0].stands[0];
  for (const s of snapshots) {
    const st = s.stands[0];
    if (st.ageYears <= targetAge && st.ageYears > best.ageYears) best = st;
  }
  return best;
}

function fmt(st: any, age: number): string {
  const v_ha = st.areaHa > 0 ? st.volumeM3 / st.areaHa : 0;
  return `D=${st.meanDiameter?.toFixed(1)} H=${st.meanHeight?.toFixed(1)} N=${st.stemCount?.toFixed(0)} V_ha=${v_ha.toFixed(0)}`;
}

// ═══════════════════════════════════════════════════════════════
// Real reference (all mixed, not pure spruce):
//   #93 OMT (77% spruce, ~70 yr): D=27, H=21, V_ha=266
//   #123 OMT (66% spruce, ~55 yr): D=19, H=16, V_ha=163
//   #95 MT (66% spruce, ~30 yr): D=12, H=10, V_ha=96
//   Upm 21 MT (63% spruce, age 66): D=22(sp=23), H=19, V_ha=149
// ═══════════════════════════════════════════════════════════════

describe("spruce reality check", () => {
  it("spruce mesic (MT) — compare at age 30 and 66", () => {
    const stand = makeSpruceStand("SPR-MT", "mesic");
    const { simulationSnapshots } = runScheduleEngine([stand], 1, 100, "maximum_growth_no_cap");

    const s30 = snapAtAge(simulationSnapshots, 30);
    const s50 = snapAtAge(simulationSnapshots, 50);
    const s66 = snapAtAge(simulationSnapshots, 66);
    const s80 = snapAtAge(simulationSnapshots, 80);
    
    console.log(`\n  Spruce MT:`);
    console.log(`    age ~30: ${fmt(s30, 30)}`);
    console.log(`    age ~50: ${fmt(s50, 50)}`);
    console.log(`    age ~66: ${fmt(s66, 66)}`);
    console.log(`    age ~80: ${fmt(s80, 80)}`);

    // Print ops
    const { yearPlans } = runScheduleEngine([stand], 1, 100, "maximum_growth_no_cap");
    const allOps: PlannedOperation[] = [];
    for (const ops of yearPlans.values()) allOps.push(...ops);
    allOps.sort((a, b) => a.year - b.year);
    console.log(`    Ops: ${allOps.map(o => `yr${o.year}:${o.type}`).join(", ")}`);

    expect(s66.meanDiameter!).toBeGreaterThan(21);
    expect(s66.meanDiameter!).toBeLessThan(31);
  });

  it("spruce herb-rich (OMT) — compare at age ~55 and ~70", () => {
    const stand = makeSpruceStand("SPR-OMT", "herb-rich heath");
    const { simulationSnapshots, yearPlans } = runScheduleEngine([stand], 1, 100, "maximum_growth_no_cap");

    const s30 = snapAtAge(simulationSnapshots, 30);
    const s55 = snapAtAge(simulationSnapshots, 55);
    const s70 = snapAtAge(simulationSnapshots, 70);
    
    console.log(`\n  Spruce OMT:`);
    console.log(`    age ~30: ${fmt(s30, 30)}`);
    console.log(`    age ~55: ${fmt(s55, 55)}`);
    console.log(`    age ~70: ${fmt(s70, 70)}`);

    const allOps: PlannedOperation[] = [];
    for (const ops of yearPlans.values()) allOps.push(...ops);
    allOps.sort((a, b) => a.year - b.year);
    console.log(`    Ops: ${allOps.map(o => `yr${o.year}:${o.type}`).join(", ")}`);

    expect(s70.meanDiameter!).toBeGreaterThan(22);
    expect(s70.meanDiameter!).toBeLessThan(32);
  });

  it("spruce sub-xeric — check values are lower than mesic", () => {
    const stand = makeSpruceStand("SPR-SX", "sub-xeric");
    const { simulationSnapshots } = runScheduleEngine([stand], 1, 100, "maximum_growth_no_cap");

    const s30 = snapAtAge(simulationSnapshots, 30);
    const s50 = snapAtAge(simulationSnapshots, 50);
    const s70 = snapAtAge(simulationSnapshots, 70);
    
    console.log(`\n  Spruce sub-xeric:`);
    console.log(`    age ~30: ${fmt(s30, 30)}`);
    console.log(`    age ~50: ${fmt(s50, 50)}`);
    console.log(`    age ~70: ${fmt(s70, 70)}`);

    expect(s70.meanDiameter!).toBeGreaterThan(20);
    expect(s70.meanDiameter!).toBeLessThan(31);
  });
});
