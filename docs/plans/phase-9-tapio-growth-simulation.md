# Phase 9: Tapio-Anchored Growth Simulation

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the heuristic height/diameter proxy and proportional BA scaling with a
physically consistent growth model where all four dimensions (height, diameter, BA, volume)
are anchored to Tapio reference data. BA is derived from volume and height via form factor;
diameter follows from BA and stem count.

**Architecture:** Hardcode Tapio H100 tables and height development percentages per
species × site type. Compute BA = V / (H × formFactor) instead of BA *= 1 + volumeRatio.
Recalibrate density factor brackets to maintain Tapio volume validation with dynamic BA input.
Extend validation test to cover height and BA at key ages.

**Tech Stack:** TypeScript, chart-engine.ts (getGrowthRate, densityFactor), schedule.ts, stand-simulator.ts

**Version:** 1.1
**Date:** 2026-06-13

**Changelog v1.1:**
- Fixed critical: T4 now includes spawning BA update (thinning thresholds must use computed BA, not stale field)
- Removed editorial meta-commentary from T3 (density recalibration)
- Merged empty T2 (height model) and T4 (BA functions) into T1 — tasks renumbered T3→T2, T5→T3, T6→T4, T7→T5, T8→T6
- Added `console.warn` for unknown species/site combinations in `meanHeight()`
- Documented per-species BA sum discrepancy in Known Limitations
- Clarified age increment for cleared stands; noted stale diameter on first call

---

## Context

### Current State

The growth simulation tracks five state variables per stand:
- **volumeM3** — driven by `getGrowthRate()`, Tapio-validated at 20 data points (±8%)
- **basalArea** — scaled proportionally: `BA *= 1 + growthM3/volumeM3` (inflated for young stands)
- **meanHeight** — 6-bracket age proxy: 0.15–0.40 m/y
- **meanDiameter** — 0.7 × height growth
- **stemCount** — operations + cubic ingress model (age ≤ 10)

The Tapio validation test uses a **constant BA input** (matureBa=16–26 frozen for 80-100 years).
In the real schedule engine, BA grows with volume, creating a feedback loop where inflated BA
skews the density factor upward.

### Problem

1. **Height and diameter are not Tapio-anchored.** The 6-bracket proxy produces height 13m
   at age 50 for pine on mesic — Tapio expects ~18m.
2. **BA is physically wrong for young stands.** `BA *= 1 + growthM3/volumeM3` inflates
   BA 4–10× for stands with low volume but high growth rates.
3. **The feedback loop is uncalibrated.** The `densityFactor` was tuned assuming a fixed
   mature BA. With dynamic BA, the multiplier stack drifts from Tapio reference.
4. **Height/diameter/BA are not validated** against Tapio data — only volume is.

### Requirements

1. Height driven by Tapio H100 curves per species × site type
2. BA derived from volume and height: `BA = V / (H × formFactor)`
3. Diameter derived from BA and stems: `D = 200 × √(BA / (N × π))`
4. Growth engine recalibrated for dynamic BA input (density factor brackets adjusted)
5. Tapio validation extended to cover height and BA at key ages
6. All existing tests pass (286 unit tests + lifecycle test + Tapio volume validation)
7. Both `schedule.ts` GROW and `stand-simulator.ts` GROW use the new model

### Design Decisions

**Why derive BA from volume instead of tracking it independently?**
BA is the cross-sectional area of stems at breast height. The physical relationship
`V = BA × H × f` holds for all even-aged stands. If volume (Tapio-validated) and height
(Tapio H100 curves) are correct, BA follows mathematically. No need for a separate
proportional model that diverges from physics.

**Why constant form factor per species?**
Form factor varies ±5% with age and site quality. A constant value (pine=0.50, spruce=0.45,
birch=0.42) is within the ±8% validation tolerance and avoids unnecessary complexity.
Seedling exception: for H < 1.3m, use `BA = N × π × (D/200)²` with planting diameter.

**Why percentage-based height curve instead of Chapman-Richards?**
The Tapio height development curve (percentage of H100 by age) is directly from Finnish
forestry standards. Chapman-Richards requires per-species parameter fitting. The percentage
curve has zero parameters — just a lookup table and linear interpolation.

**Why recalibrate density factor instead of other multipliers?**
The density factor is the only multiplier that directly depends on BA. Age and species
factors are independent of BA and were already calibrated to Tapio. Adjusting density
factor brackets to compensate for lower dynamic BA preserves the existing calibration.

### Known Limitations

**No self-thinning.** Stems are controlled entirely by operations (planting density→tending→
thinning) and ingress (age ≤ 10). Natural mortality between operations is not modeled.
This is acceptable for managed Finnish stands where mortality is minor (<5% over a rotation).
Between tending (2000 stems) and first thinning, some diameter increase occurs — BA grows
with volume, so the thinning threshold still triggers at the right age.

**Form factor breaks down for very young stands.** For H < 1.3m, BA is computed from
planting diameter and stem count rather than volume/height. This covers the first 2–4
years after planting. The form factor approach works correctly from H ≥ 1.3m onward.

**Per-species BA sum ≠ stand BA in mixed stands.** The stand-level BA uses the main
species' form factor (`st.species`), while each species entry uses its own (e.g.,
pine f=0.50 vs spruce f=0.45). For mixed stands, `sum(sppBA) ≠ standBA` by ~5-10%.
This is acceptable — the per-species breakdown is already a proportional approximation
(Phase 8 Known Limitation). Pure stands are unaffected.

---

## Data Flow

```
                    ┌──────────────────────────────────┐
                    │       Tapio Reference Data        │
                    │  H100[species][siteType]          │
                    │  heightPct[age] → H = H100 × pct │
                    │  formFactor[species]              │
                    └──────────┬───────────────────────┘
                               │
                               ▼
┌──────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│ getGrowthRate│───►│ V(t) = V(t-1) + ΔV  │───►│ BA = V/(H×f)    │
│ (density     │    │ H(t) = H100 × pct   │    │ D = 200×√(BA/Nπ)│
│  recalibrated)│   │ age += 1            │    │ (snapshot only)  │
└──────────────┘    └─────────────────────┘    └──────────────────┘
       ▲                                             │
       │                                             ▼
       │                                    ┌──────────────────┐
       └────────────────────────────────────│ BA(t-1) feeds    │
                                            │ densityFactor()  │
                                            └──────────────────┘
```

---

## Task Ordering & Dependencies

```
T1 Tapio reference data + height/BA/diameter functions
       │
       ├──────────────────────────┐
       ▼                          ▼
T2 Recalibrate densityFactor  T3 Replace GROW in stand-simulator.ts
       │                          │
       └──────────┬───────────────┘
                  ▼
            T4 Replace GROW in schedule.ts (+ spawning BA update)
                  │
                  ▼
            T5 Extend Tapio validation test (height + BA checkpoints)
                  │
                  ▼
            T6 Run full test suite + lifecycle test + recalibrate
```

T2 and T3 are independent — T3 uses the functions defined in T1 but doesn't need the
recalibrated density factor (it uses `getGrowthRate()` as-is).

---

## Tasks

### T1: Hardcode Tapio reference data

**Objective:** Add Tapio H100, height development percentages, and form factors as constants.

**File:** Create `src/lib/ai/tapio-growth.ts`

**Implementation:**

```typescript
// src/lib/ai/tapio-growth.ts
// Tapio-anchored growth parameters for Finnish commercial species.
// Sources: Tapio Metsänhoidon suositukset, taskukirja.

/** Dominant height at 100 years (m) — midpoints of Tapio ranges. */
export const H100: Record<string, Record<string, number>> = {
  pine: {
    "herb-rich heath": 28,
    mesic: 26,
    "sub-xeric": 22,
    xeric: 18,
  },
  spruce: {
    "herb-rich heath": 32,
    mesic: 29,
    "sub-xeric": 25,
  },
  silver_birch: {
    "herb-rich heath": 29,
    mesic: 26,
    "sub-xeric": 22,
  },
  downy_birch: {
    "herb-rich heath": 26,
    mesic: 23,
    "sub-xeric": 20,
  },
  larch: {
    "herb-rich heath": 30,
    mesic: 27,
    "sub-xeric": 24,
  },
  grey_alder: {
    "herb-rich heath": 24,
    mesic: 21,
    "sub-xeric": 18,
  },
};

/**
 * Height development as percentage of H100 at given age.
 * Tapio standard curve for Väli-Suomi. Linear interpolation between points.
 */
const HEIGHT_PCT: [number, number][] = [
  [5, 3],
  [10, 10],
  [15, 20],
  [20, 32],
  [25, 42],
  [30, 52],
  [40, 66],
  [50, 76],
  [60, 84],
  [70, 89],
  [80, 93],
  [90, 96],
  [100, 99],
];

/**
 * Mean height (m) at given age for a species × site type combination.
 * Returns arithmetic mean height (≈ 0.88 × dominant height for ages 5-30,
 * ≈ 0.92 × dominant height for ages 30+).
 */
export function meanHeight(
  species: string,
  siteType: string,
  ageYears: number,
): number {
  const h100 = H100[species]?.[siteType];
  if (!h100) {
    console.warn(`tapio-growth: unknown species/site "${species}/${siteType}", falling back to pine/mesic`);
    return meanHeight("pine", "mesic", ageYears);
  }

  // Interpolate height percentage from the standard curve
  let pct = 0;
  for (let i = 0; i < HEIGHT_PCT.length; i++) {
    const [age, value] = HEIGHT_PCT[i];
    if (ageYears <= age) {
      if (i === 0) {
        pct = value * (ageYears / age); // linear from 0
      } else {
        const [prevAge, prevValue] = HEIGHT_PCT[i - 1];
        const t = (ageYears - prevAge) / (age - prevAge);
        pct = prevValue + t * (value - prevValue);
      }
      break;
    }
    if (i === HEIGHT_PCT.length - 1) {
      pct = value;
    }
  }

  const hdom = (h100 * pct) / 100;

  // Convert dominant height to mean height
  const ratio = ageYears < 30 ? 0.88 : 0.92;
  return Math.round(hdom * ratio * 10) / 10;
}

/**
 * Form factor (f in V = BA × H × f) by species.
 * Pine 0.50, spruce 0.45, birch 0.42. Others default to pine.
 */
const FORM_FACTOR: Record<string, number> = {
  pine: 0.50,
  spruce: 0.45,
  silver_birch: 0.42,
  downy_birch: 0.42,
  larch: 0.48,
  grey_alder: 0.44,
};

export function formFactor(species: string): number {
  return FORM_FACTOR[species] ?? 0.50;
}

/**
 * Compute basal area (m²/ha) from volume, height, and species form factor.
 * For seedling stands (H < 1.3m or volume ≤ 0), falls back to stems×diameter formula.
 */
export function computeBA(
  volumeM3: number,
  meanHeightM: number,
  species: string,
  stemCount: number,
  meanDiameterCm: number,
): number {
  if (volumeM3 <= 0 || meanHeightM < 1.3) {
    return Math.round(stemCount * Math.PI * Math.pow(meanDiameterCm / 200, 2) * 10) / 10;
  }
  const f = formFactor(species);
  return Math.round(volumeM3 / (meanHeightM * f) * 10) / 10;
}

/**
 * Compute mean diameter (cm) from basal area and stem count.
 * D = 200 × √(BA / (N × π))
 */
export function computeDiameter(ba: number, stemCount: number): number {
  if (stemCount <= 0 || ba <= 0) return 0;
  return Math.round(200 * Math.sqrt(ba / (stemCount * Math.PI)) * 10) / 10;
}

/** Tapio reference BA ranges for validation at key ages. */
export interface TapioBARef {
  age: number;
  min: number;
  max: number;
}

/** Tapio reference BA (m²/ha) for managed (thinned) stands. */
export const TAPIO_BA_REF: Record<string, TapioBARef[]> = {
  pine_mesic: [
    { age: 20, min: 8, max: 12 },
    { age: 40, min: 16, max: 22 },
    { age: 60, min: 20, max: 26 },
    { age: 80, min: 22, max: 30 },
  ],
  pine_sub_xeric: [
    { age: 20, min: 4, max: 8 },
    { age: 40, min: 10, max: 16 },
    { age: 60, min: 14, max: 20 },
    { age: 80, min: 16, max: 22 },
  ],
  pine_xeric: [
    { age: 40, min: 5, max: 10 },
    { age: 60, min: 8, max: 14 },
    { age: 80, min: 10, max: 16 },
    { age: 100, min: 10, max: 18 },
  ],
  spruce_mesic: [
    { age: 20, min: 10, max: 15 },
    { age: 40, min: 18, max: 26 },
    { age: 60, min: 22, max: 30 },
    { age: 80, min: 26, max: 34 },
  ],
  spruce_herb_rich: [
    { age: 20, min: 12, max: 18 },
    { age: 40, min: 22, max: 30 },
    { age: 60, min: 28, max: 36 },
    { age: 70, min: 30, max: 38 },
  ],
};

/** Tapio reference mean height (m) for validation at key ages. */
export interface TapioHeightRef {
  age: number;
  min: number;
  max: number;
}

export const TAPIO_HEIGHT_REF: Record<string, TapioHeightRef[]> = {
  pine_mesic: [
    { age: 20, min: 6, max: 9 },
    { age: 40, min: 12, max: 16 },
    { age: 60, min: 16, max: 20 },
    { age: 80, min: 19, max: 23 },
  ],
  pine_sub_xeric: [
    { age: 20, min: 4, max: 7 },
    { age: 40, min: 8, max: 12 },
    { age: 60, min: 11, max: 15 },
    { age: 80, min: 13, max: 17 },
  ],
  spruce_mesic: [
    { age: 20, min: 6, max: 10 },
    { age: 40, min: 14, max: 18 },
    { age: 60, min: 18, max: 23 },
    { age: 80, min: 22, max: 26 },
  ],
  spruce_herb_rich: [
    { age: 20, min: 8, max: 12 },
    { age: 40, min: 16, max: 21 },
    { age: 60, min: 21, max: 26 },
    { age: 70, min: 24, max: 29 },
  ],
};
```

**Verification:**
- `npm run build` — no type errors in the new file
- Import in a test and verify H100["pine"]["mesic"] === 26

---

### T2: Recalibrate density factor for dynamic BA

**Objective:** Adjust `densityFactor()` brackets in `chart-engine.ts` so that when BA is
computed from volume/height (lower than the old proportional BA), the effective growth
multiplier stays Tapio-consistent.

**File:** Modify `src/lib/ai/chart-engine.ts` — `densityFactor()` function

**Implementation:**

The current density factor brackets use `basalArea / EXPECTED_BA[siteType]`:

| Density ratio | Current factor | New factor | Rationale |
|---------------|---------------|------------|-----------|
| BA=0 (seedling) | 0.45 | 0.45 | Unchanged — seedlings don't use BA |
| <0.50 | 0.55 | **0.70** | Dynamic BA is ~30% lower → need ~27% higher factor |
| 0.50–0.75 | 0.70 | **0.85** | Shift up one bracket to compensate |
| 0.75–1.30 | 0.85 | **0.95** | Normal tier slightly higher |
| 1.30–1.50 | 0.78 | **0.85** | Overstocked penalty milder (less overstocked with dynamic BA) |
| >1.50 | 0.65 | **0.70** | Severe overstock penalty milder |

These target brackets maintain the effective multiplier at ~0.43 (± calibration tolerance).

```typescript
// src/lib/ai/chart-engine.ts — densityFactor()
//
// CURRENT brackets (effective multiplier ~0.43):
//   BA=0→0.45, <0.5→0.55, 0.5-0.75→0.70, 0.75-1.3→0.85, 1.3-1.5→0.78, >1.5→0.65
//
// WITH DYNAMIC BA: BA = V/(H×f) is ~30% lower than old proportional BA.
// Density ratios shift ~30% lower. Brackets shifted up to compensate.
//
// TARGET brackets (verified by Tapio volume validation in T6):
const densityFactor = (basalArea, siteType, developmentClass) => {
    if (basalArea == null || basalArea === 0) { /* unchanged */ }
    const density = basalArea / (EXPECTED_BA[siteType] ?? 20);
    if (density < 0.35) return 0.70;     // was <0.5→0.55
    if (density < 0.55) return 0.85;     // was 0.5-0.75→0.70
    if (density < 0.95) return 0.95;     // was 0.75-1.3→0.85
    if (density < 1.10) return 0.85;     // was 1.3-1.5→0.78
    return 0.70;                          // was 0.65
};
```

**Calibration process (T6):**
1. Apply the target brackets
2. Run `npx vitest run src/lib/ai/__tests__/tapio-validation.test.ts`
3. If all 20 volume points pass (±8%): done
4. If some points fail: adjust the bracket thresholds or values, re-run
5. The bracket with the most impact is the 0.75-1.3→0.85 tier (covers most stands)

**Verification:**
- `npm run build` — no errors
- Tapio volume validation still passes (checked in T6)

💡 **Pitfall:** The density factor changes affect the lifecycle test too.
The 200-year harvest volume bounds may need adjustment in T6.

---

### T3: Replace GROW in stand-simulator.ts

**Objective:** Replace the height/diameter proxy and proportional BA scaling in the
stand simulator's `growStand()` function with the Tapio-anchored model.

**File:** Modify `src/lib/ai/stand-simulator.ts`

**Implementation:**

Replace the current `growStand()`:

```typescript
// OLD growStand() — delete these sections:
//  - Height growth proxy (lines with PLANTING_INITIAL_HEIGHT_M, heightGrowth, etc.)
//  - Diameter growth proxy (meanDiameter += heightGrowth * 0.7)
//  - BA proportional scaling (st.basalArea * (1 + ratio))
//  - st.basalArea updates in applyOperation()
//  - st.basalArea = 0 in clear_cut, st.basalArea = 2 in planting, etc.

// NEW growStand():
function growStand(st: SimState): void {
  // Cleared stands still age (bare ground gets older), but don't grow
  if (st.cleared || st.areaHa <= 0) {
    st.ageYears += 1;
    return;
  }

  // Compute BA for growth rate input (from previous year's state).
  // st.meanDiameter may be stale on first call after model switch —
  // only matters for seedling fallback (H < 1.3m), which uses DB diameter.
  const prevBA = computeBA(
    st.volumeM3, st.meanHeight, st.species, st.stemCount, st.meanDiameter,
  );

  const growthPerHa = getGrowthRate(
    st.siteType, st.soilType, st.species,
    st.ageYears, prevBA, null,
    1.0,
    st.areaHa > 0 ? st.volumeM3 / st.areaHa : undefined,
    true,
  );
  const growthM3 = growthPerHa * st.areaHa;
  st.volumeM3 += growthM3;
  st.ageYears += 1;

  // Update height from Tapio curve
  st.meanHeight = meanHeight(st.species, st.siteType, st.ageYears);

  // Natural ingress (unchanged from current model)
  if (st.stemCount > 0 && st.ageYears <= 10 && st.stemCount < MAX_STEMS_HA) {
    const oldStemsPerHa = st.stemCount;
    const densityRatio = st.stemCount / MAX_STEMS_HA;
    const ingressRate =
      NATURAL_INGRESS_BASE_RATE * (1 - Math.pow(densityRatio, NATURAL_INGRESS_EXPONENT));
    const ingressPerHa = Math.round(
      Math.min(ingressRate, MAX_STEMS_HA - st.stemCount),
    );
    if (ingressPerHa > 0) {
      st.stemCount = oldStemsPerHa + ingressPerHa;
    }
  }

  // Compute BA and diameter from volume, height, stems
  const newBA = computeBA(
    st.volumeM3, st.meanHeight, st.species, st.stemCount, st.meanDiameter,
  );
  st.meanDiameter = computeDiameter(newBA, st.stemCount);
}
```

Also simplify `applyOperation()` — remove all `st.basalArea` manipulations:

```typescript
// In clear_cut: remove `st.basalArea = 0`
// In selection_cutting/overstory_removal: remove `st.basalArea = Math.round(...)`
// In thinning/first_thinning: remove `st.basalArea = Math.round(...)`
// In early_tending/tending: remove `st.basalArea = Math.round(...)`
// In planting: remove `st.basalArea = 2` and `st.basalArea = 0` checks
```

Remove `basalArea` from `SimState` interface entirely.

Also remove the `heightDelta`/`diameterDelta`/`baRatio`/`totalBA` computations from
`snapshotState()` — BA and diameter are now computed directly:

```typescript
function snapshotState(st: SimState, year: number, isInitial: boolean): StandSnapshot {
  const standBA = computeBA(
    st.volumeM3, st.meanHeight, st.species, st.stemCount, st.meanDiameter,
  );
  const standDiamCm = computeDiameter(standBA, st.stemCount);

  const totalVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
  const volRatio = totalVol > 0 ? st.volumeM3 / totalVol : 1;
  const totalSpeciesStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);

  const speciesSnapshots: SpeciesSnapshot[] = st.speciesData.map((sp) => {
    const stemsPerHa =
      totalSpeciesStems > 0
        ? Math.round(sp.stemCount * st.stemCount / totalSpeciesStems)
        : 0;
    const sppVol = Math.round(sp.volumeM3 * volRatio);
    const sppH = meanHeight(sp.species, st.siteType, st.ageYears); // per-species height
    const sppBA = computeBA(sppVol, sppH, sp.species, stemsPerHa, 0);
    const sppDiam = computeDiameter(sppBA, stemsPerHa);
    return {
      species: sp.species,
      volumeM3: sppVol,
      logPct: sp.logPct,
      stemCountPerHa: stemsPerHa,
      meanHeight: sppH,
      meanDiameter: sppDiam,
      age: st.ageYears,
      basalArea: sppBA,
      areaHa: sp.areaHa ?? 0,
    };
  });

  return {
    standId: st.standId,
    areaHa: st.areaHa,
    volumeM3: Math.round(st.volumeM3),
    basalArea: standBA,
    stemCount: st.stemCount,
    meanHeight: st.meanHeight,
    meanDiameter: standDiamCm,
    ageYears: st.ageYears,
    species: st.species,
    siteType: st.siteType,
    developmentClass: st.developmentClass,
    speciesData: speciesSnapshots,
  };
}
```

**Verification:**
- `npm run build` — no type errors in stand-simulator.ts
- `npm run build` — full project builds

💡 **Pitfall:** The `snapshotState` no longer needs heightDelta/diameterDelta because
heights and diameters come directly from the Tapio model, not from aggregate deltas.

💡 **Pitfall:** Per-species height uses `meanHeight(sp.species, ...)`. This gives each
species its own Tapio height curve. Species share the stand age but may have different
H100 values. This is correct — a pine-under-spruce at age 40 would have a different
height than the spruce overstory.

---

### T4: Replace GROW in schedule.ts

**Objective:** Apply the same Tapio-anchored GROW model to the full schedule engine.

**File:** Modify `src/lib/ai/schedule.ts`

**Implementation:**

The changes mirror T3 but in the schedule engine's GROW loop (lines ~849-922):

1. **Import** `meanHeight`, `computeBA`, `computeDiameter` from `./tapio-growth`
2. **Replace** the GROW loop:
   - Remove height/diameter proxy (age-bracket `heightGrowth` computation, `st.meanHeight += heightGrowth`, `st.meanDiameter += heightGrowth * 0.7`)
   - Remove proportional BA scaling (`st.basalArea = st.basalArea * (1 + ratio)`)
   - Add: `st.meanHeight = meanHeight(st.species, st.siteType, st.ageYears)`
   - Add: compute BA for next year's growth rate input
3. **Keep** ingress logic unchanged
4. **Update** snapshot code (year-0 and year-loop snapshots) to use `computeBA`/`computeDiameter`
   instead of the old heightDelta/diameterDelta/baRatio pattern
5. **Remove** `st.basalArea` manipulations from `applyOperation` section for all op types:
   - `clear_cut`: remove `st.basalArea = 0`
   - `selection_cutting`/`overstory_removal`: remove BA scaling
   - `thinning`/`first_thinning`: remove BA scaling
   - `early_tending`/`tending`: remove BA scaling
   - `planting`: remove `st.basalArea = 2` and `if (st.basalArea === 0) st.basalArea = 2`
6. **Update spawning thresholds** — the `spawnOperations()` function checks `st.basalArea >= thinThresh`
   to decide whether to spawn thinnings. Since `st.basalArea` is no longer mutated, these checks
   must use dynamically computed BA instead:
   ```typescript
   // In spawnOperations(), replace every `st.basalArea` reference with:
   const currentBA = computeBA(st.volumeM3, st.meanHeight, st.species, st.stemCount, st.meanDiameter);
   if (currentBA >= firstThinThresh && ...) { /* spawn first_thinning */ }
   if (currentBA >= thinThresh && ...) { /* spawn thinning */ }
   ```
   Also update the spawning code that computes `removalFraction` from BA:
   ```typescript
   // Old: removalFraction = (st.basalArea - targetBA) / st.basalArea;
   // New:
   removalFraction = (currentBA - targetBA) / Math.max(1, currentBA);
   ```
   And update `getGrowthRate()` calls inside `spawnOperations()` to pass computed BA instead of `st.basalArea`.
7. **Keep** `st.basalArea` field on `SimStand` but deprecate it — it's no longer mutated,
   only used as a throughput for `getGrowthRate()`. Compute it inline before calling
   `getGrowthRate()`:
   ```typescript
   const growthRateBA = computeBA(st.volumeM3, st.meanHeight, st.species, st.stemCount, st.meanDiameter);
   const growthPerHa = getGrowthRate(..., growthRateBA, ...);
   ```

**Verification:**
- `npm run build` — no type errors
- All existing tests pass (checked in T6)

💡 **Pitfall:** The schedule engine's GROW is called for ALL stands every year.
Computing BA from volume/height on every GROW call is a pure math operation
(~5ns), no performance concern.

💡 **Pitfall:** The `SimStand` interface has `basalArea` field used in many places
(debug logging, spawning, operation notes). Don't remove the field entirely — just
stop mutating it. The snapshot code now computes BA from formula instead of reading
`st.basalArea`.

---

### T5: Extend Tapio validation test

**Objective:** Add height and BA checkpoints to the existing Tapio volume validation,
so all three dimensions are verified against published Tapio reference data.

**File:** Modify `src/lib/ai/__tests__/tapio-validation.test.ts`

**Implementation:**

1. Add height and BA reference data to each `TapioEntry`:
   ```typescript
   interface TapioEntry {
     age: number;
     volRange: [number, number];
     baRange?: [number, number];    // NEW
     heightRange?: [number, number]; // NEW
   }
   ```

2. Add BA and height ranges to each entry in TAPIO_TABLES using `TAPIO_BA_REF` and
   `TAPIO_HEIGHT_REF` from `tapio-growth.ts`.

3. Modify `simulateGross()` to also track BA and height at milestone ages:
   ```typescript
   function simulateGross(config): {
     volumes: Map<number, number>;
     basalAreas: Map<number, number>;
     heights: Map<number, number>;
   }
   ```

4. Add assertion blocks for BA and height:
   ```typescript
   if (entry.baRange) {
     const ba = milestones.basalAreas.get(entry.age);
     expect(ba).toBeDefined();
     const [baLow, baHigh] = entry.baRange;
     expect(ba!).toBeGreaterThanOrEqual(baLow * 0.85);
     expect(ba!).toBeLessThanOrEqual(baHigh * 1.15);
   }
   ```

5. The simulation now uses `computeBA()` and `meanHeight()` instead of a hardcoded `matureBa`.
   Remove the `matureBa` field from `SimConfig` — BA is computed from volume and height each year.

**Verification:**
- `npx vitest run src/lib/ai/__tests__/tapio-validation.test.ts` — all volume, height, and BA points pass

---

### T6: Run full test suite and recalibrate

**Objective:** Verify all tests pass and iteratively recalibrate density factor brackets
until Tapio validation is green.

**Process:**

1. Apply all changes from T1-T5
2. Run `npm run build` — fix any type errors
3. Run `npx vitest run` — all 286 tests should pass. Fix any failures.
4. Run `npx vitest run src/lib/ai/__tests__/tapio-validation.test.ts`
   - If all 20 volume + ~20 height + ~20 BA points pass: done
   - If some fail: adjust density factor brackets in T2, re-run
5. Run `npx vitest run src/lib/ai/__tests__/forest-state.test.ts` — lifecycle test
   - Harvest volume bounds may need adjustment (±10-15%) due to changed BA dynamics
6. Run `npm run build` — production build must succeed

**Verification:**
- All 286 unit/integration tests pass
- All Tapio validation points pass (volume, height, BA)
- Lifecycle test passes (200-year, 3-rotation)
- Production build succeeds

---

## Verification Checklist

- [ ] `npm run build` — no TypeScript errors
- [ ] All 286 existing tests pass (`npx vitest run`)
- [ ] Tapio volume validation: 20 data points within ±8%
- [ ] Tapio height validation: 16+ data points within ±15%
- [ ] Tapio BA validation: 16+ data points within ±15%
- [ ] Lifecycle test: 200-year, 3-rotation harvest volumes within bounds
- [ ] Height at age 50 for pine on mesic ≈ 17-19m (was 13m with proxy)
- [ ] BA for seedlings (H < 1.3m) falls back to N×π×(D/200)², not volume/height
- [ ] Post-planting speciesData still correct (planting fix from Phase 8)
- [ ] Simulation view shows BA values in Tapio range for all ages
- [ ] Generate a plan via ForestChat AI — plan generates successfully
- [ ] Expand a stand — simulation year blocks show realistic H/D/BA progression

---

## Out of Scope

- Self-thinning / natural mortality between operations
- Per-species growth rate differentiation
- Changing the VMI13 base growth rates
- Adding new Luke PxWeb API data sources
- Form factor variation by age (constant per species is sufficient)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Density recalibration doesn't converge | Tapio validation fails | Iterative tuning; can fall back to old model for volume if needed |
| Lifecycle test bounds break | CI fails | Adjust harvest bounds; the 200y test checks structural invariants, not exact BA |
| Per-species height differences look wrong | User confusion | All species share stand age; height differences from different H100 values are correct |
| Growth rate oscillations with dynamic BA | Unstable simulation | BA computed from previous year smooths the feedback; form factor caps prevent spikes |
