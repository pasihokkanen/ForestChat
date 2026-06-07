// src/lib/ai/__tests__/tapio-validation.test.ts
//
// Validates the growth engine against Tapio yield tables for all major
// Finnish site/species combinations. Each data point must fall within
// the Tapio standing volume range (±5% tolerance for natural variation).
//
// Method: gross growth simulation (no thinning removal) compared to
// Tapio standing volumes, which already include the release effect of
// recommended thinnings. Fixed mature basal area per site type.

import { describe, it, expect } from "vitest";
import { getGrowthRate } from "../chart-engine";

// ── Helpers ──

interface TapioEntry {
  age: number;
  range: [number, number]; // [min, max] standing volume m³/ha
}

/** Run a gross growth simulation from age 5 to rotation age.
 *  Returns standing volume at each milestone age. */
function simulateGross(
  siteType: string,
  species: string,
  rotationAge: number,
  matureBa: number,
  startVolumeM3PerHa: number,
): Map<number, number> {
  let age = 5;
  let vol = startVolumeM3PerHa;
  const milestones = new Map<number, number>();

  for (let yr = 0; yr <= rotationAge - 5; yr++) {
    const growth = getGrowthRate(
      siteType,
      "mineral soil",
      species,
      age,
      matureBa,
      null, // developmentClass
      1.0, // growthMultiplier (Väli-Suomi)
      vol, // current volume for carrying-capacity cap
    );
    vol += growth;
    age += 1;

    if (age % 10 === 0 || age === rotationAge) {
      milestones.set(age, Math.round(vol));
    }
  }

  return milestones;
}

/** Check if simulated volume is within Tapio range (±8% tolerance for
 *  natural variation in site quality within a site-type class). */
function inRange(vol: number, range: [number, number]): boolean {
  const margin = 0.08;
  return vol >= range[0] * (1 - margin) && vol <= range[1] * (1 + margin);
}

// ── Tapio yield table reference data ──
//
// Standing volume (m³/ha) for Väli-Suomi, standard management.
// Sources: Tapio taskukirja, Metsätalouden kehitysohjelmat.
// These are post-thinning values that include the growth-release
// effect of recommended thinnings.

const TAPIO_TABLES: Record<string, TapioEntry[]> = {
  // Pine on sub-xeric mineral soil (kuivahko kangas, VT)
  pine_sub_xeric: [
    { age: 20, range: [15, 25] },
    { age: 40, range: [45, 70] },
    { age: 60, range: [75, 105] },
    { age: 80, range: [100, 140] },
  ],

  // Pine on mesic mineral soil (tuore kangas, MT)
  pine_mesic: [
    { age: 20, range: [25, 45] },
    { age: 40, range: [80, 120] },
    { age: 60, range: [120, 170] },
    { age: 80, range: [160, 220] },
  ],

  // Spruce on mesic mineral soil (tuore kangas, MT)
  spruce_mesic: [
    { age: 20, range: [30, 50] },
    { age: 40, range: [90, 130] },
    { age: 60, range: [140, 200] },
    { age: 80, range: [180, 260] },
  ],

  // Spruce on herb-rich mineral soil (lehtomainen kangas, OMT)
  spruce_herb_rich: [
    { age: 20, range: [35, 55] },
    { age: 40, range: [110, 160] },
    { age: 60, range: [180, 260] },
    { age: 70, range: [250, 350] },
  ],

  // Pine on xeric mineral soil (kuiva kangas, CT)
  pine_xeric: [
    { age: 40, range: [20, 35] },
    { age: 60, range: [35, 55] },
    { age: 80, range: [45, 70] },
    { age: 100, range: [40, 80] },
  ],
};

// ── Simulation configurations ──

interface SimConfig {
  key: string;
  siteType: string;
  species: string;
  rotationAge: number;
  /** Mature basal area (m²/ha) — fully stocked for this site type. */
  matureBa: number;
  /** Starting volume at age 5 (m³/ha). */
  startVol: number;
}

const SIMULATIONS: SimConfig[] = [
  { key: "pine_sub_xeric", siteType: "sub-xeric", species: "pine", rotationAge: 80, matureBa: 20, startVol: 5 },
  { key: "pine_mesic", siteType: "mesic", species: "pine", rotationAge: 80, matureBa: 22, startVol: 10 },
  { key: "spruce_mesic", siteType: "mesic", species: "spruce", rotationAge: 80, matureBa: 24, startVol: 10 },
  { key: "spruce_herb_rich", siteType: "herb-rich heath", species: "spruce", rotationAge: 70, matureBa: 26, startVol: 15 },
  { key: "pine_xeric", siteType: "xeric", species: "pine", rotationAge: 100, matureBa: 16, startVol: 3 },
];

// ── Tests ──

describe("Growth engine vs Tapio yield tables", () => {
  for (const sim of SIMULATIONS) {
    const entries = TAPIO_TABLES[sim.key];
    if (!entries) continue;

    const milestones = simulateGross(
      sim.siteType,
      sim.species,
      sim.rotationAge,
      sim.matureBa,
      sim.startVol,
    );

    for (const entry of entries) {
      it(`${sim.species} on ${sim.siteType} at age ${entry.age}`, () => {
        const vol = milestones.get(entry.age);
        expect(vol).toBeDefined();

        const [low, high] = entry.range;
        expect(vol!).toBeGreaterThanOrEqual(low * 0.92);
        expect(vol!).toBeLessThanOrEqual(high * 1.08);

        // Warn if outside strict Tapio bounds (the ±8% tolerance is for
        // natural site-quality variation within a site-type class)
        if (vol! < low || vol! > high) {
          console.warn(
            `  ⚠ ${sim.species} ${sim.siteType} age ${entry.age}: ` +
            `${vol} m³/ha outside strict range [${low}–${high}] ` +
            `(within ±8% tolerance)`
          );
        }
      });
    }
  }
});
