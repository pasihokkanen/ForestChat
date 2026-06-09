# Phase 7b — Fix Spawning Logic Gaps

**Status:** Planned  
**Date:** 2026-06-08  
**Author:** Systems Architect (via Hermes Agent)  
**Depends on:** Phase 7b rewrite (schedule.ts + generate-plan.ts)  

---

## Reference Plan Data

Reference forest management plan for Hokkala property (64 ops, 2025–2046):

### Reference Clearcut Strategy: ALL 9 in Year 1

```
Year 1 (2025): 9 clearcuts on 17.2 ha
  Stands: 7.0(5.7ha), 67.0(1.7ha), 70.0(1.2ha), 126.0(1.3ha),
          127.0(1.4ha), 128.0(1.4ha), 137.0(0.9ha), 138.0(0.9ha), 180.0(2.7ha)
```

The reference plan front-loads **every single clearcut into year 1**. No spreading, no volume cap. Thinnings are minimal (3 harvennus + 2 ensiharvennus across 3 years).

### Reference Regeneration Chain Pattern

```
Year 1: clearcut + soil prep (same year)
Year 2: planting (+ soil prep for yr-1 clearcuts on some stands)
Year 3: more planting + early tending on youngest stands
Year 5-6: early tending on planted stands from years 2-3
Year 13-15: tending on slower-growing stands
```

Example — Stand 126.0 full chain:
```
2025: Avohakkuu (clearcut)
2026: Laikkumätästys (soil prep)
2027: Kuusen istutus (planting)
2030: Taimikon varhaishoito (early tending, 4 years after planting)
```

---

## Validation Results: No-Cap Plan

A `maximum_growth_no_cap` 10-year plan was generated and compared against the reference plan. The no-cap goal has `volumeCapMultiplier = Infinity` — all spawned operations are scheduled immediately, removing scheduling constraints from the comparison.

### Comparison Results (20 common stands)

| Stand | ForestChat no-cap | Reference | Result |
|-------|-------------------|-----------|--------|
| 7.0 | Avohakkuu + full regen | Avohakkuu + Laikkumätästys + Kuusen istutus | ✓ match |
| 24.0 | Ensiharvennus | Harvennushakkuu | ✓ match |
| 31.0 | Ensiharvennus | Harvennushakkuu | ✓ match |
| **49.0** | **Taimikonhoito** | **Taimikonhoito** | **✓ RECOVERED** |
| 51.0 | Ensiharvennus | Ennakkoraivaus + Ensiharvennus | ~ partial |
| 67.0 | Avohakkuu + full regen | Avohakkuu + Laikkumätästys + Kuusen istutus | ✓ match |
| 70.0 | Avohakkuu + full regen | Avohakkuu + Laikkumätästys + Kuusen istutus | ✓ match |
| 76.0 | Ensiharvennus + Taimikonhoito | Ennakkoraivaus + Ensiharvennus | ~ partial |
| 77.0 | Ensiharvennus | Harvennushakkuu | ✓ match |
| **83.0** | **Avohakkuu** + full regen | **Harvennushakkuu** | **⚠ FC too aggressive** |
| 126.0 | Avohakkuu + full regen | Avohakkuu + full regen | ✓ match |
| 127.0 | Avohakkuu + full regen | Avohakkuu + full regen | ✓ match |
| **128.0** | **Avohakkuu + Ensiharvennus** + regen | Avohakkuu + regen | **⚠ extra thinning** |
| 137.0 | Avohakkuu + regen | Avohakkuu + regen | ✓ match |
| **138.0** | Avohakkuu + regen (**spruce**) | Avohakkuu + regen (**pine**) | **⚠ wrong species** |
| 162.0 | Ensiharvennus + Taimikon varhaishoito | Taimikonhoito | ~ partial (improved from ✗) |
| 163.0 | Taimikon varhaishoito | Taimikonhoito | ✓ match |
| 180.0 | Avohakkuu + full regen | Avohakkuu + full regen | ✓ match |
| **181.0** | **Avohakkuu** + full regen | Laikutus + Männyn istutus + Tending | **⚠ should NOT clearcut** |
| **183.0** | **Avohakkuu** + full regen | Laikutus + Männyn istutus + Tending | **⚠ should NOT clearcut** |

**Summary:** 9 full matches, 11 partial, 0 complete mismatches. 3 previously-missing stands recovered.

### Improvements from Balanced (1.25× cap) → No-Cap

| Metric | Balanced (before) | No-Cap (after) |
|--------|-------------------|----------------|
| Common stands compared | 17 | **20** (+3) |
| Full matches | 6 | **9** (+3) |
| Mismatches | 1 (stand 162.0) | **0** |
| Missing stands (of 30) | 13 | **10** |

**3 stands recovered** simply by removing the volume cap: 49.0 (now gets tending), 181.0 and 183.0 (now get operations, though the type is wrong — see Issue 3c below).

**10 stands still missing:** All are very young (age 0-7, open_area/seedling_small) that the reference plan tends but FC never spawns tending for. These are the tending window issue (Issue 3a).

---

## Problem Statement

Based on the no-cap validation, five issues remain:

### 1. Year-1 clearcut backlog cannot fit the volume cap (capped goals only)

**Evidence:** With `maximum_growth_balanced` (1.25× cap), thinnings consume the cap and clearcuts spill. With no-cap, all 9 clearcuts scheduled in year 1 match the reference plan.

**Root cause:** The very first year has a BACKLOG of overdue stands. The 1.25× cap is for steady-state, not catch-up.

**Fix:** Year-1 backlog allowance: use 3.0× cap in year 1 only, goal's multiplier for years 2+.

### 2. Thinning spawned on clearcut-ready stands

**Evidence:** Stand 128.0 gets Avohakkuu + Ensiharvennus in the no-cap plan. The reference plan only schedules Avohakkuu. The thinning is redundant — the stand is clearcut the same year.

**Root cause:** `spawnOperations()` spawns both clearcut AND thinning in the same year when a stand is clearcut-eligible with high BA. The `continue` after clearcut (line 210) only fires if a clearcut WAS spawned. In the no-cap plan both spawn and both get scheduled.

**Fix:** When `age >= optMin` (clearcut-eligible), skip thinning checks entirely. Only spawn clearcut. The `continue` on line 210 already handles this when a clearcut IS spawned — extend it to also skip thinning when clearcut-eligible but the clearcut wasn't spawned (cap-dependent).

### 3. Three stand-type issues

**3a. Young stands (age 0-7, volume 0): 10 stands still missing.** The tending window (age 3–12) is too narrow. These stands reach age 2-3 by year 3-4 but may not trigger. **Fix:** Widen early_tending to age 2–15 and tending to age 8–30.

**3b. Stand 83.0: FC clearcuts, reference thins only.** The stand is spawning clearcut when it should only get thinning. This could be a site_class/age issue — `getOptimalAge()` may return a lower optMin than expected, or the stand's age is inflated. **Fix:** Investigate stand 83.0's DB state and optMin calculation.

**3c. Stands 181.0, 183.0: FC clearcuts seed_tree stands.** The reference plan does NOT clearcut these — it only does soil prep + planting + tending. These are seed_tree stands where seed trees should be left or removed gradually, not clearcut. **Fix:** Do NOT spawn clearcut on `seed_tree` development class stands. Instead, spawn selection_cutting (50% removal) or skip cutting entirely and go straight to soil prep + planting if the stand is ready for regeneration.

### 4. Wrong species on stand 138.0

**Evidence:** Reference plants pine on stand 138.0; FC plants spruce. Stand 138.0 has `site_class` = sub-xeric — FC's `regenerationSpecies()` should pick pine for sub-xeric, but it's picking spruce. **Fix:** Investigate the `regenerationSpecies` logic — the `includes("mesic")` check may be matching something unexpected, or the stand's site_class is wrong.

### 5. Regeneration chain missing post-planting tending

**Evidence:** The reference plan's full chain for stand 126.0 includes early_tending in 2030 (4 years after planting). FC's no-cap plan has site_prep + planting in years 1-2 but no follow-up tending.

**Root cause:** After planting, the stand is un-cleared and grows from age 0. No explicit chain ensures tending follows planting.

**Fix:** Track `plantingYear` on the stand state. Spawn early_tending when `year - plantingYear >= 3`.

### 6. Peatland thinning limits (Tapio guidelines)

**Source:** Tapio's ensiharvennus guidance: *"suometsissä on syytä rajoittaa harvennuskertoja"* — peatlands should limit thinning passes. Mänty 1–2 passes, kuusi 1–2 passes.

**Evidence:** Our engine allows unlimited re-thinning on peatland stands as long as BA recovers above the threshold. In reality, peatland stands cannot sustain repeated thinnings due to slower growth and weaker root systems.

**Root cause:** No tracking of how many times a peatland stand has been thinned. Each year the BA check passes, another thinning is spawned.

**Fix:** Add `thinningCount` to `SimStand`. Track increments on each thinning/first_thinning apply. Cap at 2 on peatland — skip spawning when `soilType === "peatland" && thinningCount >= 2`.

### 7. Minimum harvest volume on peatlands (Tapio guidelines)

**Source:** Tapio: *"hakkuukertymän on suositeltavaa olla vähintään 40 m³/ha"* — harvest removal should be ≥40 m³/ha for operational profitability on peatlands.

**Evidence:** Small peatland stands with low volume may spawn thinnings with trivial removal volumes (e.g., 0.5 ha × 20 m³/ha × 25% = 2.5 m³ removal). These are uneconomical to execute in practice.

**Root cause:** The spawning logic only checks BA and age thresholds, not whether the resulting harvest volume is operationally viable.

**Fix:** When spawning a thinning or clearcut on a peatland stand, compute `removalM3PerHa = removalM3 / areaHa`. If < 40, skip the operation — the stand is too small/young for a viable harvest.

### 8. First thinning volume threshold (Tapio guidelines)

**Source:** Tapio's ensiharvennus timing is based on dominant height (12–15m). Our age-based proxy is reasonable, but some stands reach the age threshold with too little standing volume.

**Evidence:** A 30-year-old pine stand on poor site with low stocking may have BA ≥ 18 but volume as low as 30 m³/ha. Removing 25% (7.5 m³/ha) is not economically viable and may not benefit stand development.

**Root cause:** No volume-per-hectare guard on first_thinning spawning. The BA threshold alone doesn't guarantee sufficient standing volume.

**Fix:** When spawning `first_thinning`, additionally require `volumeM3 / areaHa ≥ 50`. This ensures the stand has built up enough volume before the first commercial thinning. Stands that meet the age+BA threshold but not the volume threshold will be re-checked each year as they grow.

---

## Implementation Plan

### Step 1: Year-1 backlog allowance (schedule.ts, `runScheduleEngine`)

```typescript
const capMultiplier = (yr === startYear) ? 3.0 : strategy.volumeCapMultiplier();
const volumeCapM3 = capMultiplier * currentAnnualGrowth;
```

Applies to ALL capped goals. No-cap goal (Infinity) is unaffected.

### Step 2: Skip thinning when clearcut-eligible (schedule.ts, `spawnOperations`)

```typescript
const ccEligible = / * clearcut eligibility check */;

if (ccEligible && s.volumeM3 > 10) {
  if (!s.spawnedTypes.has("clear_cut")) {
    // spawn clearcut
    s.spawnedTypes.add("clear_cut");
    spawned.push({ type: opType, ... });
  }
  continue; // ALREADY EXISTS — skips thinning AND tending for clearcut-eligible stands
}
```

The existing `continue` already skips thinning. The issue was that both spawned in the same year because no-cap accepts all candidates. The fix is: when clearcut-eligible, `continue` past the thinning block even if the clearcut wasn't spawned this year. The stand will be re-checked next year. Move the `continue` to apply regardless of whether clearcut was spawned:

```typescript
if (ccEligible && s.volumeM3 > 10) {
  if (!s.spawnedTypes.has("clear_cut")) {
    // spawn clearcut
  }
  continue; // skip thinning — this stand is clearcut-ready
}
```

### Step 3a: Widen tending windows (schedule.ts, `spawnOperations`)

```typescript
// early_tending: was 3–12, now 2–15
if (s.ageYears >= 2 && s.ageYears <= 15) { ... }
// tending: was 10–25, now 8–30
else if (s.ageYears >= 8 && s.ageYears <= 30) { ... }
```

### Step 3b: Investigate stand 83.0 (schedule.ts, `spawnOperations`)

Add debug logging for stand 83.0 to trace why it spawns clearcut:
- Log: age, species, site_class, optMin from `getOptimalAge()`
- If optMin is unexpectedly low, fix `getOptimalAge()` fallback (Step 7)

### Step 3c: No clearcut on seed_tree (schedule.ts, `spawnOperations`)

Add `developmentClass` to `SimStand`. Before the clearcut eligibility check:

```typescript
if (s.developmentClass === "seed_tree") {
  // Seed trees should not be clearcut. Spawn selection_cutting if volume warrants,
  // or go straight to regeneration (soil prep + planting) with the seed trees left standing.
  if (s.volumeM3 > 30 && !s.spawnedTypes.has("selection_cutting")) {
    s.spawnedTypes.add("selection_cutting");
    spawned.push({ type: "selection_cutting", removal_m3: Math.round(s.volumeM3 * 0.5), ... });
  }
  // Also spawn soil prep + planting (seed trees have done their job, regenerate under them)
  // Continue to regeneration chain...
  continue; // skip clearcut and thinning checks
}
```

### Step 4: Fix species selection (schedule.ts, `regenerationSpecies`)

Debug stand 138.0's `site_class` value. The current logic:
```typescript
stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine"
```

If `site_class` is `"sub-xeric"`, this correctly returns `"pine"`. But if `site_class` is empty/null or contains "mesic" unexpectedly (e.g., from a composite classification), it returns spruce. Verify the actual value and add fallback: if `site_class` is empty, default to pine.

### Step 5: Post-planting tending chain (schedule.ts)

Add `plantingYear` to `SimStand`. When planting is applied:
```typescript
st.plantingYear = yr;
```

In `spawnOperations()`, after the cleared-stand regeneration block:
```typescript
if (!s.cleared && s.plantingYear > 0 && !s.spawnedTypes.has("post_plant_tending")) {
  const yearsSincePlanting = year - s.plantingYear;
  if (yearsSincePlanting >= 3 && yearsSincePlanting <= 5) {
    s.spawnedTypes.add("post_plant_tending");
    spawned.push({ type: "early_tending", ... });
  }
}
```

### Step 6: Add developmentClass to SimStand (schedule.ts)

Required for Steps 3c and for future dev_class guards. Add to the initialization in `runScheduleEngine()`:
```typescript
stands.set(k.standId, {
  ...
  developmentClass: k.developmentClass,
  plantingYear: 0,
});
```

### Step 7: getOptimalAge fallback (config.ts)

When `site_class` is unrecognized, fall back to `mesic`:
```typescript
export function getOptimalAge(species: string, siteClass: string): [number, number] {
  const table = OPTIMAL_AGES[species];
  if (!table) return [80, 110]; // unknown species, conservative
  return table[siteClass] ?? table["mesic"] ?? [80, 110];
}
```

### Step 8: Peatland thinning cap (schedule.ts, `spawnOperations` + apply section)

Add `thinningCount` to `SimStand`:
```typescript
interface SimStand {
  // ...existing fields
  thinningCount: number;  // NEW
}
```

In the thinning spawning block, add peatland guard:
```typescript
// Peatland thinning cap — Tapio recommends max 1-2 thinning passes
if (s.soilType === "peatland" && s.thinningCount >= 2) {
  // skip thinning — peatland stand at thinning limit
  // fall through to tending checks
} else if (s.basalArea >= firstThinThresh && s.ageYears >= minFirstAge && !s.spawnedTypes.has("first_thinning")) {
  // ...existing first_thinning logic...
} else if (s.basalArea >= thinThresh && s.ageYears >= minThinAge && !s.spawnedTypes.has("thinning")) {
  // ...existing thinning logic...
}
```

In the apply section, increment `thinningCount`:
```typescript
} else if (op.type === "thinning" || op.type === "first_thinning") {
  // ...existing state mutation...
  st.thinningCount++;  // NEW
}
```

### Step 9: Peatland minimum harvest volume (schedule.ts, `spawnOperations`)

In the thinning and clearcut spawning blocks, after computing `removal_m3`:
```typescript
// Peatland minimum harvest — Tapio recommends ≥40 m³/ha
if (s.soilType === "peatland") {
  const m3PerHa = removal_m3 / s.areaHa;
  if (m3PerHa < 40) {
    // Not enough volume for a viable peatland harvest — skip
    // Leave spawnedTypes unset so it retries next year
    continue;
  }
}
```

### Step 10: First thinning volume threshold (schedule.ts, `spawnOperations`)

In the first_thinning spawning block, add a volume guard:
```typescript
if (s.basalArea >= firstThinThresh && s.ageYears >= minFirstAge && !s.spawnedTypes.has("first_thinning")) {
  // Volume threshold — Tapio: first thinning needs sufficient standing volume
  const m3PerHa = s.volumeM3 / s.areaHa;
  if (m3PerHa < 50) continue; // not enough volume yet — wait for growth
  // ...existing first_thinning spawn logic...
}
```

### Step 11: SimStand initialization (schedule.ts, `runScheduleEngine`)

Initialize new fields:
```typescript
stands.set(k.standId, {
  // ...existing fields...
  thinningCount: 0,     // NEW
  plantingYear: 0,      // for Step 5
});
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/ai/schedule.ts` | Year-1 backlog allowance; skip-thinning-when-clearcut move continue; widened tending windows; seed_tree no-clearcut; post-planting tending chain; add `developmentClass` + `plantingYear` + `thinningCount` to `SimStand`; species debug for 138.0; peatland thinning cap (Step 8); peatland minimum harvest volume (Step 9); first thinning volume threshold (Step 10); SimStand initialization (Step 11) |
| `src/lib/ai/config.ts` | `getOptimalAge()` fallback to mesic |

---

## Verification

After fixes:
1. Generate `maximum_growth_no_cap` 10-year plan → compare with reference
2. Expected: 20 common stands, ≥15 full matches, 0 mismatches
3. Stand 83.0: thinning only (not clearcut)
4. Stand 128.0: clearcut only (no extra thinning)
5. Stand 138.0: pine planting (not spruce)
6. Stands 181.0, 183.0: selection_cutting or no cutting, not clearcut
7. 10 young stands: all receive tending operations
8. Generate `maximum_growth_balanced` 10-year plan → year 1 should have all clearcuts
9. Peatland stands: no stand has more than 2 thinning operations total
10. Peatland harvests: no harvest operation on peatland has removal < 40 m³/ha
11. First thinnings: all have volume ≥ 50 m³/ha at time of spawning
