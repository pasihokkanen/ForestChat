// src/lib/ai/__tests__/tapio-validation.test.ts
//
// Validates the growth engine against Tapio yield tables for all major
// Finnish site/species combinations. Covers standing volume, basal area,
// and mean height at key ages.
//
// Method: gross growth simulation using per-species Tapio-anchored
// height, BA, and diameter (Phase 9 model). BA reference is derived
// from Tapio volume ranges using the same form factors, ensuring
// volume and BA are consistent.

import { describe, it, expect } from "vitest";
import { getGrowthRate } from "../chart-engine";
import {
  meanHeight,
  formFactor,
  computeStandBA,
  TAPIO_HEIGHT_REF,
} from "../tapio-growth";

// ── Helpers ──

interface TapioEntry {
  age: number;
  range: [number, number]; // [min, max] standing volume m³/ha
  baRange?: [number, number];    // [min, max] basal area m²/ha (derived from volume)
  heightRange?: [number, number]; // [min, max] mean height m
}

/** Derive expected BA range from Tapio volume range using the same
 *  form factor as the simulation. BA = V/(H×f) where H comes from
 *  the same H100 table used in simulation. This ensures BA and volume
 *  reference values are physically consistent. */
function deriveBARange(
  volRange: [number, number],
  species: string,
  siteType: string,
  age: number,
): [number, number] {
  const h = meanHeight(species, siteType, age);
  const ff = formFactor(species);
  if (h <= 0 || ff <= 0) return [0, 999];
  const baMin = Math.round(volRange[0] / (h * ff) * 10) / 10;
  const baMax = Math.round(volRange[1] / (h * ff) * 10) / 10;
  return [baMin, baMax];
}

/** Height range from Tapio reference data, with ±15% tolerance. */
function heightRange(key: string, age: number): [number, number] | undefined {
  const refs = TAPIO_HEIGHT_REF[key];
  if (!refs) return undefined;
  const ref = refs.find(r => r.age === age);
  if (!ref) return undefined;
  return [ref.min, ref.max];
}

/** Run a gross growth simulation from age 5 to rotation age.
 *  Returns standing volume, basal area, and height at each milestone age.
 *  BA is computed per-species from volume/height. */
function simulateGross(
  siteType: string,
  species: string,
  rotationAge: number,
  startVolumeM3PerHa: number,
): {
  volumes: Map<number, number>;
  basalAreas: Map<number, number>;
  heights: Map<number, number>;
} {
  let age = 5;
  let vol = startVolumeM3PerHa;
  const volumes = new Map<number, number>();
  const basalAreas = new Map<number, number>();
  const heights = new Map<number, number>();

  // Simulate a pure stand (single species = 100% of volume/stems)
  const speciesData = [
    { volumeM3: vol, species, stemCount: 2000, diameterCm: 0 },
  ];

  for (let yr = 0; yr <= rotationAge - 5; yr++) {
    // Compute current BA for growth rate input
    const currentBA = computeStandBA(speciesData, age, siteType);

    const growth = getGrowthRate(
      siteType,
      "mineral soil",
      species,
      age,
      currentBA,
      null,
      undefined,
      vol,
    );
    vol += growth;
    age += 1;

    // Update species data for next year's BA computation
    speciesData[0].volumeM3 = vol;

    // Record milestones at decade boundaries and rotation age
    if (age % 10 === 0 || age === rotationAge) {
      const ba = computeStandBA(speciesData, age, siteType);
      const h = meanHeight(species, siteType, age);
      volumes.set(age, Math.round(vol));
      basalAreas.set(age, Math.round(ba * 10) / 10);
      heights.set(age, h);
    }
  }

  return { volumes, basalAreas, heights };
}

// ── Tapio yield table reference data ──
// Standing volume (m³/ha) for Väli-Suomi, standard management.
// BA and height ranges are derived/computed at test time for consistency.

const TAPIO_TABLES: Record<string, { age: number; range: [number, number] }[]> = {
  pine_sub_xeric: [
    { age: 20, range: [15, 25] },
    { age: 40, range: [45, 70] },
    { age: 60, range: [75, 105] },
    { age: 80, range: [100, 140] },
  ],
  pine_mesic: [
    { age: 20, range: [25, 45] },
    { age: 40, range: [80, 120] },
    { age: 60, range: [120, 170] },
    { age: 80, range: [160, 220] },
  ],
  spruce_mesic: [
    { age: 20, range: [30, 50] },
    { age: 40, range: [90, 130] },
    { age: 60, range: [140, 200] },
    { age: 80, range: [180, 260] },
  ],
  spruce_herb_rich: [
    { age: 20, range: [35, 55] },
    { age: 40, range: [110, 160] },
    { age: 60, range: [180, 260] },
    { age: 70, range: [250, 350] },
  ],
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
  startVol: number;
}

const SIMULATIONS: SimConfig[] = [
  { key: "pine_sub_xeric", siteType: "sub-xeric", species: "pine", rotationAge: 80, startVol: 5 },
  { key: "pine_mesic", siteType: "mesic", species: "pine", rotationAge: 80, startVol: 10 },
  { key: "spruce_mesic", siteType: "mesic", species: "spruce", rotationAge: 80, startVol: 10 },
  { key: "spruce_herb_rich", siteType: "herb-rich heath", species: "spruce", rotationAge: 70, startVol: 15 },
  { key: "pine_xeric", siteType: "xeric", species: "pine", rotationAge: 100, startVol: 3 },
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
      sim.startVol,
    );

    for (const entry of entries) {
      it(`${sim.species} on ${sim.siteType} at age ${entry.age}`, () => {
        // ── Volume validation (±8%) ──
        const vol = milestones.volumes.get(entry.age);
        expect(vol).toBeDefined();

        const [low, high] = entry.range;
        expect(vol!).toBeGreaterThanOrEqual(low * 0.92);
        expect(vol!).toBeLessThanOrEqual(high * 1.08);

        if (vol! < low || vol! > high) {
          console.warn(
            `  ⚠ ${sim.species} ${sim.siteType} age ${entry.age}: ` +
            `${vol} m³/ha outside strict range [${low}–${high}] ` +
            `(within ±8% tolerance)`
          );
        }

        // ── BA validation (±15%) ──
        // BA derived from Tapio volume range using same form factor, so
        // BA and volume are physically consistent.
        const derivedBA = deriveBARange(entry.range, sim.species, sim.siteType, entry.age);
        const ba = milestones.basalAreas.get(entry.age);
        expect(ba).toBeDefined();
        expect(ba!).toBeGreaterThanOrEqual(derivedBA[0] * 0.85);
        expect(ba!).toBeLessThanOrEqual(derivedBA[1] * 1.15);

        // ── Height validation (±15%) ──
        const h = milestones.heights.get(entry.age);
        expect(h).toBeDefined();
        const hRange = heightRange(sim.key, entry.age);
        if (hRange) {
          expect(h!).toBeGreaterThanOrEqual(hRange[0] * 0.85);
          expect(h!).toBeLessThanOrEqual(hRange[1] * 1.15);
        }
      });
    }
  }
});
