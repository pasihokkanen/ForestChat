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

### 1. ~~Year-1 clearcut backlog cannot fit the volume cap~~ REMOVED

**Decision:** No special year-1 treatment. The goal's volume cap applies uniformly across all years. If the cap is tight, harvests naturally spill into later years — that's the intended behavior, not a bug.

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

### 9. Missing compartment metrics for precise tending decisions (Tapio guidelines)

**Source:** Tapio's varhaisperkaus/taimikonharvennus guidance uses `keskipituus` (mean height), `keskiläpimitta` (mean diameter), and `runkoluku` (stem count) to decide **which** tending operation to apply and **when**:

| Metric | Threshold | Operation |
|--------|-----------|-----------|
| `mean_height` | < 1m (pine) / < 1.5m (spruce) | → `early_tending` (varhaisperkaus) |
| `mean_height` | 1–7m (pine/spruce), 1–9m (birch) | → `tending` (taimikonharvennus) |
| `mean_diameter` | < 8 cm | Confirms tending phase (varttunut taimikko) |
| `mean_diameter` | ≥ 8 cm | Stand past tending → approaching first thinning |
| `stem_count` | > 4000/ha | Needs early_tending |
| `stem_count` | 2000–4000/ha | Needs tending |
| `stem_count` | 800–2000/ha | Approaching first thinning |

**Evidence:** Currently we use only `age` to distinguish early_tending (2–15) vs tending (8–30), which is a crude proxy. With real `stem_count` and `mean_height`, we can make precise decisions: a 5-year-old stand with height > 2m and 3500 stems/ha needs `tending`, not `early_tending`. A 12-year-old stand with 1500 stems/ha is already past tending.

**Current state:** The CSV parser already parses `stem_count`, `mean_height`, `mean_diameter`, `basal_area` per species, plus total-level equivalents — but the importer **drops** them at DB insert. The `compartments` table has `avg_height` and `avg_diameter` but **no `stem_count`**. The `compartment_species` table has only `species`, `volume_m3`, `log_pct`, `area_ha`.

**Fix:** 
1. **DB migration**: Add `stem_count`, `mean_height`, `mean_diameter`, `basal_area` to `compartment_species`; add `stem_count` to `compartments`
2. **CSV importer**: Save parsed fields to DB (already parsed, just not inserted)
3. **WFS importer**: Save these fields if available from WFS data
4. **Scheduling engine** (future): Use `stem_count` + `mean_height` in `spawnOperations()` to differentiate `early_tending` from `tending`, replacing the crude age-based window after data is available

**Files affected:**
| File | Change |
|------|--------|
| New migration SQL | Add columns to `compartment_species` and `compartments` |
| `csv-importer.ts` | Save parsed per-species fields to DB |
| `wfs-client.ts` / `code-tables.ts` | Save fields if available from WFS |
| `schedule.ts` | Use `stem_count` + `mean_height` in tending decisions (post-data) |
| `forest-state.ts` | Optionally track stem_count in growth simulation |
| `generate-plan.ts` | Enrichment may need species-level metrics |
| Tests | Update fixtures with new fields |

**Note:** This is a data infrastructure task — the scheduling engine changes to USE these fields will follow once the DB and import are updated. For the initial fix, the age-based windows (Step 2a) remain the primary mechanism, widened to capture all tending-eligible stands. Once real `stem_count` data is in the DB, a follow-up change will replace the age windows with stem_count/height-based decisions.

---

## Implementation Plan

### Step 1: Skip thinning when clearcut-eligible (schedule.ts, `spawnOperations`)

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

### Step 2a: Widen tending windows (schedule.ts, `spawnOperations`)

```typescript
// early_tending: was 3–12, now 2–15
if (s.ageYears >= 2 && s.ageYears <= 15) { ... }
// tending: was 10–25, now 8–30
else if (s.ageYears >= 8 && s.ageYears <= 30) { ... }
```

### Step 2b: Investigate stand 83.0 (schedule.ts, `spawnOperations`)

Add debug logging for stand 83.0 to trace why it spawns clearcut:
- Log: age, species, site_class, optMin from `getOptimalAge()`
- If optMin is unexpectedly low, fix `getOptimalAge()` fallback (Step 6)

### Step 2c: No clearcut on seed_tree (schedule.ts, `spawnOperations`)

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

### Step 3: Fix species selection (schedule.ts, `regenerationSpecies`)

Debug stand 138.0's `site_class` value. The current logic:
```typescript
stand.site_class.includes("mesic") || stand.site_class.includes("herb-rich") ? "spruce" : "pine"
```

If `site_class` is `"sub-xeric"`, this correctly returns `"pine"`. But if `site_class` is empty/null or contains "mesic" unexpectedly (e.g., from a composite classification), it returns spruce. Verify the actual value and add fallback: if `site_class` is empty, default to pine.

### Step 4: Post-planting tending chain (schedule.ts)

Add `plantingYear` to `SimStand`. When planting is applied:
```typescript
st.plantingYear = yr;
```

In `spawnOperations()`, after the cleared-stand regeneration block, add post-planting tending. Uses the same `"early_tending"` dedup key as the standard age-based check to prevent duplicates:

```typescript
// Post-planting tending chain (triggered by planting year, not stand age)
if (!s.cleared && s.plantingYear > 0 && !s.spawnedTypes.has("early_tending")) {
  const yearsSincePlanting = year - s.plantingYear;
  if (yearsSincePlanting >= 3 && yearsSincePlanting <= 6) {
    s.spawnedTypes.add("early_tending");  // same key as standard age-based check
    spawned.push({ type: "early_tending", ... });
  }
}
```

Note: `"early_tending"` is the single dedup key shared between the age-based window (Step 2a) and this planting-year-based check. Whichever triggers first prevents the other.

### Step 5: Add developmentClass + plantingYear to SimStand initialization (schedule.ts)

Required for Steps 2c and for future dev_class guards. Add to the initialization in `runScheduleEngine()`:
```typescript
stands.set(k.standId, {
  ...
  developmentClass: k.developmentClass,
  plantingYear: 0,
});
```

### Step 6: getOptimalAge fallback (config.ts)

When `site_class` is unrecognized, fall back to `mesic`:
```typescript
export function getOptimalAge(species: string, siteClass: string): [number, number] {
  const table = OPTIMAL_AGES[species];
  if (!table) return [80, 110]; // unknown species, conservative
  return table[siteClass] ?? table["mesic"] ?? [80, 110];
}
```

### Step 7: Peatland thinning cap (schedule.ts, `spawnOperations` + apply section)

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

### Step 8: Peatland minimum harvest volume (schedule.ts, `spawnOperations`)

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

### Step 9: First thinning volume threshold (schedule.ts, `spawnOperations`)

In the first_thinning spawning block, add a volume guard:
```typescript
if (s.basalArea >= firstThinThresh && s.ageYears >= minFirstAge && !s.spawnedTypes.has("first_thinning")) {
  // Volume threshold — Tapio: first thinning needs sufficient standing volume
  const m3PerHa = s.volumeM3 / s.areaHa;
  if (m3PerHa < 50) continue; // not enough volume yet — wait for growth
  // ...existing first_thinning spawn logic...
}
```

### Step 10: SimStand initialization (schedule.ts, `runScheduleEngine`)

Initialize new fields:
```typescript
stands.set(k.standId, {
  // ...existing fields...
  thinningCount: 0,     // NEW
  plantingYear: 0,      // for Step 4
});
```

### Step 11: Database migration — add compartment metrics

**New migration file:** `supabase/migrations/013_add_compartment_metrics.sql`

```sql
-- Add per-species metrics to compartment_species
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS stem_count NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS mean_height NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS mean_diameter NUMERIC;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE compartment_species ADD COLUMN IF NOT EXISTS basal_area NUMERIC;

-- Add total stem count to compartments
ALTER TABLE compartments ADD COLUMN IF NOT EXISTS stem_count NUMERIC;

COMMENT ON COLUMN compartment_species.stem_count IS 'Stem count (runkoluku) for this species in the compartment';
COMMENT ON COLUMN compartment_species.mean_height IS 'Mean height in meters (keskipituus)';
COMMENT ON COLUMN compartment_species.mean_diameter IS 'Mean diameter in cm (keskiläpimitta)';
COMMENT ON COLUMN compartment_species.age IS 'Age of this species group (ikä)';
COMMENT ON COLUMN compartment_species.basal_area IS 'Basal area m²/ha (pohjapinta-ala)';
COMMENT ON COLUMN compartments.stem_count IS 'Total stem count (runkoluku) for the compartment';
```

### Step 12: CSV importer — save parsed metrics to DB

**File:** `src/lib/import/csv-importer.ts`

Add the parsed fields to the `compartment_species` insert:

```typescript
speciesRows.push({
  forest_id: forestId,
  compartment_id: comp.id,
  stand_id: stand.stand_id,
  species: sp.species,
  volume_m3: m3,
  log_pct: sp.log_pct,
  area_ha: Math.round(areaProportion * 1000) / 1000,
  stem_count: sp.stem_count,     // NEW
  mean_height: sp.mean_height,   // NEW
  mean_diameter: sp.mean_diameter, // NEW
  age: sp.age,                   // NEW
  basal_area: sp.basal_area,     // NEW
});
```

Also add `stem_count` to the `compartments` insert (from `stand.total_stem_count`).

### Step 13: WFS importer — save metrics if available

**Files:** `src/lib/import/wfs-client.ts`, `src/lib/import/code-tables.ts`

If the WFS response includes stem count, height, or diameter fields, map and save them to `compartment_species` and `compartments`.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/ai/schedule.ts` | Skip-thinning-when-clearcut (Step 1); widened tending windows (Step 2a); debug logging for stands 83.0, 138.0, 181.0, 183.0 (Steps 2b, 3); seed_tree no-clearcut (Step 2c); post-planting tending chain (Step 4); SimStand init with developmentClass, plantingYear, thinningCount (Steps 5, 10); peatland thinning cap (Step 7); peatland minimum harvest volume (Step 8); first thinning volume threshold (Step 9) |
| `src/lib/ai/config.ts` | `getOptimalAge()` fallback to mesic (Step 6) |
| New migration SQL | `013_add_compartment_metrics.sql` — add stem_count, mean_height, mean_diameter, age, basal_area to `compartment_species`; add `stem_count` to `compartments` (Step 11) |
| `csv-importer.ts` | Save parsed per-species stem_count, mean_height, mean_diameter, age, basal_area to DB (Step 12) |
| `wfs-client.ts` | Save stem_count/height/diameter if available from WFS (Step 13) |
| Tests | New unit tests T1–T14; update existing tests for widened windows |

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
8. Peatland stands: no stand has more than 2 thinning operations total
9. Peatland harvests: no harvest operation on peatland has removal < 40 m³/ha
10. First thinnings: all have volume ≥ 50 m³/ha at time of spawning

---

## Test Plan

### Unit tests (new)

| # | Test | Expected |
|---|------|----------|
| T1 | Clearcut-eligible stand with high BA | Only `clear_cut` spawned, no `thinning` |
| T2 | Stand with BA≥18, age≥30, volume<50 m³/ha | No `first_thinning` spawned |
| T3 | Stand with BA≥18, age≥30, volume≥50 m³/ha | `first_thinning` spawned |
| T4 | Peatland stand, thinningCount=2, BA≥22 | No thinning spawned |
| T5 | Peatland stand, thinningCount=1, BA≥22 | Thinning spawned, thinningCount incremented to 2 |
| T6 | Peatland stand, area=0.3ha, volume=20m³ | Thinning skipped (removal 5.6m³ → 18.7 m³/ha < 40) |
| T7 | Peatland stand, area=2ha, volume=200m³ | Thinning spawned (removal 56m³ → 28 m³/ha ≥ 40) |
| T8 | seed_tree stand, age≥optMin | No `clear_cut` spawned; `selection_cutting` spawned |
| T9 | Post-planting: plantingYear>0, 4 years elapsed | `early_tending` spawned (same key as age-based) |
| T10 | Post-planting + age-based both eligible | Only one `early_tending` spawned (shared dedup key) |
| T11 | Young stand age 2 with volume 0 | `early_tending` spawned (widened window) |
| T12 | Stand age 28 with volume | `tending` spawned (widened window) |
| T13 | getOptimalAge with unknown site_class | Falls back to `mesic` |
| T14 | getOptimalAge with unknown species | Returns [80, 110] |

### Updated existing tests

| Test | Change |
|------|--------|
| `schedulePlan` returns PlanSummary | Verify new summary fields if any |
| Young stand does NOT trigger clearcut or thinning | May now trigger `early_tending` with widened windows |
| `trySplitStand` stub | No change (stays null) |

### Integration tests

| # | Test | Expected |
|---|------|----------|
| I1 | `maximum_growth_no_cap` 10-year plan vs reference | 20 common stands, ≥15 full matches, 0 mismatches |
| I2 | Stand 83.0 | Thinning only, not clearcut |
| I3 | Stand 128.0 | Clearcut only, no extra thinning |
| I4 | Stand 138.0 | Pine planting, not spruce |
| I5 | Stands 181.0, 183.0 | No clearcut on seed_tree stands |
| I6 | 10 young stands | All receive tending operations |
| I7 | Peatland thinning cap | No peatland stand > 2 thinnings |
| I8 | Peatland min harvest | No peatland harvest removal < 40 m³/ha |
| I9 | First thinning volume | All first thinnings ≥ 50 m³/ha at spawn time |
