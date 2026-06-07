# Forest State Estimator — Plan

## Problem
Growth calculations across the codebase are either static (one growth rate for all time) or linearly projected (`volume + growth * years`) with zero accounting for operations that happen in between. A thinning in year 3 should reduce volume and increase subsequent growth rate. A clearcut should reset volume and growth to zero.

## Current broken patterns

| Location | What it does | What's wrong |
|---|---|---|
| `schedule.ts:257` | `m3Grown = volumeM3 + annual_growth * yearsFromNow` | No operation effects — assumes linear growth forever |
| `schedule.ts:414` | Same linear projection for P2 extension | Same |
| `classify.ts:242` | `futureM3 = volumeM3 + k.annual_growth * growthYears` | Same linear projection |
| `validation-tools.ts` | Single `growthRate` for all years | No per-year state — sustainability should check EACH year |
| `query-tools.ts:271` | `annualGrowth` from NULL `growth_m3_per_ha` column | Should use state estimator |

## Proposed: `estimateForestState()`

A pure function that takes a list of operations + compartments and returns per-stand, per-year state projections.

### Signature
```ts
function estimateForestState(
  compartments: CompartmentInput[],   // id, volume, age, species, site_type, soil_type, basal_area, development_class, area_ha
  operations: PlannedOperation[],     // compartment_id, year, type, removal_pct, income_eur, cost_eur
  startYear: number,
  endYear: number,
): ForestStateTimeline
```

### State model per stand per year
```ts
interface StandYearState {
  standId: string;
  year: number;
  volumeM3: number;       // standing volume at start of year
  ageYears: number;        // age at start of year
  growthM3PerHa: number;   // growth rate this year (from getGrowthRate)
  growthM3: number;        // total growth this year (rate × area)
  harvestM3: number;       // volume removed this year (0 if no harvest op)
  incomeEur: number;       // income from harvest this year
  costEur: number;         // operation cost this year
  operationType: string | null; // thinning, clearcut, etc.
}
```

### Algorithm
For each year Y from startYear to endYear:
For each stand S:
1. **Compute growth rate**: `getGrowthRate(S.site_type, S.soil_type, S.species, S.ageYears, S.basalArea, S.developmentClass)` → m³/ha/y
2. **Apply growth**: `S.volumeM3 += growthRate × S.areaHa`
3. **Apply aging**: `S.ageYears += 1`
4. **Check for operation in year Y**: if an op targets this stand this year:
   - **Thinning (30%)**: `harvest = S.volumeM3 × 0.30`, `S.volumeM3 -= harvest`, basal area reduces → next year's growth rate slightly higher (reduced competition)
   - **Clearcut (100%)**: `harvest = S.volumeM3`, `S.volumeM3 = 0`, `S.ageYears = 0`
   - **Regeneration (planting/site_prep)**: no volume effect this year, but seeds future growth
   - **Selection cutting**: partial removal like thinning
5. **Record state** for this stand/year

### Edge cases
- Stand harvested (volume=0) → growth stops until regeneration
- Stand regenerated → age resets, species may change, volume starts from 0
- Multiple operations on same stand in same year → apply both
- Operations on stands not in compartments list → warn but don't crash
- Stands with no operations → just grow and age naturally

## Consumers to update (in order)

### Phase 1: Create the function
- New file: `src/lib/ai/forest-state.ts`
- Export `estimateForestState()` 
- Export `ForestStateTimeline`, `StandYearState` types
- Unit tests with known fixtures

### Phase 2: Sustainability check
- `checkSustainability`: replace single `growthRate` with per-year state
- For full period: `estimateForestState()` → sum harvest per year → compare each year's harvest vs that year's growth
- For single year: same approach, just one year slice
- Output: show year-by-year if requested, otherwise aggregate

### Phase 3: Plan validation
- `validatePlan` Check 4: use per-year state instead of static annualGrowth
- Per-year harvest vs per-year growth (apples to apples finally)

### Phase 4: Schedule projections
- Replace `m3Grown = volumeM3 + annual_growth * yearsFromNow` in schedule.ts
- Use `estimateForestState()` to get projected volume at target year
- This automatically accounts for thinnings that happened in earlier years

### Phase 5: Plan summary
- `planSummary`: use state estimator for growth reporting instead of NULL DB column

### Phase 6: Chart engine (stretch)
- The `growth_m3_total` computed field with `broadcast: true` currently fans static growth to all years
- Could be improved to use state estimator for per-year growth variation
- Lower priority — chart engine works acceptably now

## Design principles
1. **Pure function**: deterministic, testable, no DB calls
2. **Single source of truth**: `getGrowthRate()` for per-stand growth, this function for per-year state
3. **Composable**: returns data that consumers can aggregate/summarize as needed
4. **Defensive**: null inputs → zero defaults, missing stands → logged warning, edge cases handled
