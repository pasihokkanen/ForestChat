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

## Problem Statement

Cross-referencing Reference plan data against ForestChat's generated plan revealed four spawning logic gaps:

### 1. Year-1 clearcut backlog cannot fit the volume cap

**Evidence:** The reference plan schedules 9 clearcuts in year 1 (2025). ForestChat's `maximum_growth_balanced` goal has a 1.25× annual growth cap, which cannot accommodate all overdue clearcuts in year 1. Thinnings are prioritized before clearcuts (silvicultural priority), consuming cap space. Result: most clearcuts spill to overspill and never get scheduled.

**Root cause:** The very first year of a new plan has a BACKLOG of stands that are already overdue for harvest (age ≥ optMin years ago, but no previous plan harvested them). The 1.25× cap is designed for steady-state management, not for catching up on a backlog. The reference plan solves this by front-loading ALL clearcuts into year 1 regardless of cap.

**Fix:** Introduce a **year-1 backlog allowance**: in the first year only, the volume cap is relaxed to accommodate overdue operations. Two approaches:
- **Approach A (aggressive):** Year 1 volume cap = Infinity (no cap) — all overdue clearcuts + thinnings execute immediately. Regen costs are spread over years 2-4 naturally by regenDelayYears.
- **Approach B (lenient):** Year 1 cap = 3.0× annual growth (matching `maximum_growth_aggressive`). Years 2+ = 1.25×.
- **Approach C (adaptive):** Year 1 cap = sum of all overdue harvest volumes (dynamic, based on actual backlog). Ensures exactly what's needed fits.

**Recommendation:** Approach B — lenient year 1 (3.0×) with years 2+ at goal's multiplier. This is simple, predictable, and matches The reference plan's behavior of front-loading all ready stands without being completely uncapped.

### 2. Thinning spawned when clearcut is the right operation

**Evidence:** The reference plan clearcuts stands 7.0, 128.0, 83.0. ForestChat spawns Ensiharvennus + Harvennushakkuu for the same stands. Stand 83.0 even gets Avohakkuu in FC but The reference plan only schedules Harvennushakkuu — FC may be misreading the stand's maturity.

**Root cause:** In `spawnOperations()`, when a stand is clearcut-eligible (age ≥ optMin), the code spawns the clearcut AND continues past the clearcut block to potentially also spawn thinning. The `continue` on line 210 only skips thinning if a clearcut WAS spawned. But if the stand is age-eligible for clearcut, spawning a thinning first is wrong — it delays the inevitable clearcut and wastes cap space.

**Fix:** When a stand is clearcut-eligible (age ≥ optMin), skip all thinning checks for that stand. The clearcut is the correct operation. For `maximum_growth_balanced`, this prevents the "thinning → clearcut" double-spend on the same stand's volume cap across two years.

**Exception:** If the volume cap is too tight even for the clearcut, the entire stand's clearcut spills to next year — no thinning is spawned in the interim. This matches The reference plan: 8 of 9 clearcut stands get NO thinning before clearcut.

### 3. 13 Reference plan stands get zero ForestChat operations

**Three sub-cases:**

**3a. Young stands (age 0-7, volume 0, open_area/seedling_small):** 10 stands. Tending window (age 3–12 for early_tending) means they don't trigger until year 3-4 of simulation. By then, they may be lost in carryover or the volume is still 0.

**3b. Stand 49.0 (age 18, vol 230 m³, seedling_large, spruce/sub-xeric):** Age 18 is within tending window (10-25). But the stand also has high volume and BA, so it likely gets thinning spawned first. After thinning, the stand's BA drops but the `spawnedTypes` blocking prevents re-tending. **Fix:** For `seedling_large` development class, prioritize tending over thinning.

**3c. Stands 181.0, 183.0 (age 93-109, seed_tree, pine/sub-xeric, low vol):** These are seed-tree stands — seed trees were left after a previous harvest. The reference plan schedules full regeneration: soil prep → planting → tending. **Fix:** Add `seed_tree` as an immediate clearcut-eligible development class (the seeds have already been collected/distributed, the seed trees should be removed, and the stand regenerated).

### 4. Regeneration chain missing post-planting tending

**Evidence:** The reference plan's full chain for stand 126.0: clearcut(2025) → soil_prep(2026) → planting(2027) → early_tending(2030). ForestChat spawns soil_prep + planting but no follow-up tending.

**Root cause:** After planting, the stand is un-cleared and age-advances from 0. By the time it reaches tending age (3), the 20-year plan period may be half over. No explicit chain is set up to ensure tending follows planting.

**Fix:** When planting is applied, record a `plantingYear` on the stand state. In subsequent years, when `year - plantingYear >= 3` and the stand is un-cleared, spawn early_tending.

---

## Implementation Plan

### Step 1: Year-1 backlog allowance (schedule.ts)

In `runScheduleEngine()`, for year == startYear (first year only), use a lenient volume cap:

```typescript
const capMultiplier = (yr === startYear) ? 3.0 : strategy.volumeCapMultiplier();
const volumeCapM3 = capMultiplier * currentAnnualGrowth;
```

This lets all overdue clearcuts fit in year 1. Remaining years use the goal's normal cap.

### Step 2: Skip thinning when clearcut-eligible (schedule.ts, spawnOperations)

After the clearcut eligibility check, if the stand is age-eligible for clearcut (`ageYears >= optMin`), skip the thinning checks entirely — even if a clearcut wasn't spawned (e.g., overspilled to carryover). The stand needs clearcut, not thinning.

```typescript
if (ccEligible && s.volumeM3 > 10) {
  // spawn clearcut (or push to carryover)
  // ...
  continue; // ALREADY EXISTS: skips thinning
}
// ADD: also skip thinning if clearcut-eligible but NOT spawned (cap too full)
if (ccEligible) {
  continue; // don't thin a clearcut-ready stand
}
```

Wait — this would skip thinning checks but also skip tending checks. Better: add a flag.

```typescript
let skipThinning = false;

if (ccEligible && s.volumeM3 > 10 && !s.spawnedTypes.has("clear_cut")) {
  // spawn clearcut
  continue; // skips thinning + tending
}
if (ccEligible) {
  skipThinning = true; // clearcut-ready but couldn't fit cap — don't thin
}

// Thinning checks only if !skipThinning
if (!skipThinning) {
  // ... thinning BA checks ...
}
```

### Step 3: Seed_tree handling (schedule.ts, spawnOperations)

Add seed_tree as an immediate clearcut trigger:

```typescript
// Before the standard clearcut check:
const isSeedTree = s.spawnedTypes.has("_seed_tree_checked") === false 
  && /* check development class */;

if (isSeedTree && s.volumeM3 > 0 && !s.spawnedTypes.has("clear_cut")) {
  s.spawnedTypes.add("clear_cut");
  // spawn clearcut (needs access to developmentClass — add to SimStand)
}
```

**Requires:** Add `developmentClass` field to `SimStand` and populate it from `StandData`.

### Step 4: Development class guard on thinning (schedule.ts)

Before spawning thinning, check development class:

```typescript
const isSeedling = ["open_area", "seedling_small", "seedling_large"].includes(s.developmentClass);
if (!isSeedling && s.basalArea >= firstThinThresh && ...) {
  // spawn thinning
}
```

This prevents stand 162.0 from getting thinning when it should get tending.

### Step 5: Prioritize tending for seedling_large stands (schedule.ts)

For `seedling_large` stands, spawn tending even if thinning would also be eligible. Tending takes priority:

```typescript
if (s.developmentClass === "seedling_large" && s.tendedYear === 0) {
  // spawn tending first, then check thinning if still needed
}
```

### Step 6: Post-planting tending chain (schedule.ts)

Add `plantingYear` to `SimStand`. When planting is applied:

```typescript
st.plantingYear = yr;
```

In `spawnOperations()`, after the cleared-stand regeneration block:

```typescript
// Post-planting tending: 3-5 years after planting
if (!s.cleared && s.plantingYear > 0 && !s.spawnedTypes.has("post_plant_tending")) {
  const yearsSincePlanting = year - s.plantingYear;
  if (yearsSincePlanting >= 3 && yearsSincePlanting <= 5) {
    s.spawnedTypes.add("post_plant_tending");
    spawned.push({
      type: "early_tending",
      // ...
      notes: `Post-planting early tending, planted ${s.plantingYear}`,
    });
  }
}
```

### Step 7: Widen tending windows (schedule.ts)

Current:
```
early_tending: age 3–12
tending:       age 10–25
```

New:
```
early_tending: age 2–15 (catches open_area that passes age 2 in year 3)
tending:       age 8–30 (catches older seedling stands)
```

### Step 8: Update config.ts — getOptimalAge fallback

When `site_class` is unrecognized (null, empty, or missing key), fall back to `mesic` for that species instead of returning no match (which silently makes the stand never clearcut-eligible).

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/ai/schedule.ts` | Year-1 backlog allowance; skip-thinning-when-clearcut; seed_tree clearcut; dev_class guard on thinning; seedling_large tending priority; post-planting tending chain; widened tending windows; add `developmentClass` + `plantingYear` to `SimStand` |
| `src/lib/ai/config.ts` | `getOptimalAge()` fallback to mesic for unrecognized site_class |
| `src/lib/ai/types.ts` | Add `developmentClass` to `StandData` if not already present |
| `src/lib/ai/generate-plan.ts` | Pass `developmentClass` through enrichment to engine |

---

## Validation Methodology

Before implementing fixes, validate spawning thresholds against Reference plan data by running the stand state simulator to each Reference plan operation's scheduling year:

### For each reference plan operation:
1. Take the stand's **current** state from our DB (age, volume, BA, dev_class)
2. Simulate growth year-by-year from current year to the reference plan's scheduling year (e.g., stand 7.0 scheduled for clearcut in 2025 — simulate from DB year to 2025)
3. At the scheduling year, check: does our `spawnOperations()` produce the SAME operation type?
   - If YES → spawning thresholds are correct, the issue is scheduling (volume cap)
   - If NO → spawning thresholds need adjustment

### Example: Stand 7.0 (Reference clearcut 2025)

```
DB state today: age=X, vol=Y, BA=Z, dev_class=?, site_class=?
Simulate to 2025: age=X', vol=Y', BA=Z'
Check: does our engine spawn clear_cut? (age >= optMin? vol > 10?)
```

### Example: Stand 162.0 (Reference tending 2025)

```
DB state today: age=?, vol=?, BA=?, dev_class=?
Simulate to 2025: age=?, vol=?, BA=?
Check: does our engine spawn tending? Or thinning? If thinning, the dev_class guard (Step 4) should fix it.
```

### Validation script (`scripts/validate-spawning.ts`)

A standalone script that:
1. Loads compartment data from DB for all Loads reference plan stands
2. Loads reference plan operations
3. For each reference plan operation, simulates to the scheduling year and checks spawning output
4. Reports: matches, mismatches, and which threshold is failing

This validation runs BEFORE implementation to confirm root causes, and AFTER to verify fixes.

---

## Verification

After fixes:
1. Run `scripts/validate-spawning.ts` — all mismatches should be resolved
2. Re-run plan generation with `maximum_growth_balanced` goal
3. Year 1 should have all 9+ clearcuts scheduled (not overspilled)
4. 13 Reference-only stands should now have operations
5. Stand 162.0 should get tending, not thinning
6. Clearcut stands should NOT also get thinning
7. Regeneration chains should include post-planting tending
8. Check debug log for per-year cap utilization
