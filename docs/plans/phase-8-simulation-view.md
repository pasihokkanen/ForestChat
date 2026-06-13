# Phase 8: Simulation Year-by-Year View

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Show per-stand year-by-year simulation state matching plan length, with all compartment_species fields and operations inline.

**Architecture:** Engine snapshots every stand after each simulation year → saved to `plan_metadata.simulation_data` (JSONB). Frontend fetches alongside operations and renders a collapsible year-by-year timeline inside the stand list, with operations appearing inline in the year blocks where they fire.

**Tech Stack:** TypeScript, schedule.ts engine, Supabase JSONB, React/Zustand

**Version:** 1.1
**Date:** 2026-06-12

**Changelog v1.1:**
- Fixed per-species height/diameter no-op formula → compute delta from initial weighted average
- Fixed per-species age always `initial+1` → use `st.ageYears`
- Added `areaHa` to `SpeciesDatum` type + `enrichCompartment()` mapping
- Clarified operation filtering uses `compartment_id → stand_id` map
- Made `schedulePlan()` return type update an explicit T2 substep
- Added stale-speciesData-after-planting to Known Limitations
- Added `"expandedContent"` to `StandDisplayRow` union update
- Added JSON parse error boundary with fallback message
- Clarified T4 → T1a overlap
- Added year-0 snapshot for pre-simulation reference
- Dropped `valueEur` from `StandSnapshot` (unused in UI)
- Added rule: only show species with stemCount > 0 in both Current State and Simulation
- Cleaned dependency graph references (removed ghost "T2 Types")

---

## Context

### Current State

The schedule engine (`schedule.ts`) mutates `SimStand` objects year by year, but only preserves state when an operation fires (via `op.stand`). Non-operational years and non-harvested stands lose all intermediate state. The user can see what operations are planned but NOT how each stand evolves through the simulation period.

The current stand list expandable rows show:
- Species rows: only species name, area, volume, log_pct (4 of 8 compartment_species fields)
- Operation rows: type, year, removal_pct, income, cost
These are interleaved — operations appear in the same list as species rows.

### Requirements

1. **Remove operations** from the stand-level expandable rows (operations move into year blocks)
2. **Keep current species state** — now showing ALL compartment_species fields (stem_count_per_ha, mean_height, mean_diameter, age, basal_area added)
3. **Show year-by-year simulation** for each stand, matching plan length (e.g., 20-year plan → 20 years)
4. **Show ALL compartment_species data fields** for each simulated year (proportionally scaled from aggregate)
5. **Operations inline** within the year blocks where they fire — easy to see cause and effect

### Design Decisions

**Why JSONB in plan_metadata and not a new table?**
- Simulation data is always fetched as one blob (all stands, all years)
- No need to query individual stand-year cells
- Simpler migration, no RLS policies needed
- data size: ~300 stands × 20 years × ~400 bytes ≈ 2.4 MB — well within JSONB limits

**Why proportional species scaling?**
The simulator tracks only aggregate stand state (volumeM3, basalArea, stemCount). Per-species breakdown (speciesData) is initialized but never mutated. To show per-species simulation state, we proportionally scale each species' volume, BA, stemCount, height, and diameter based on the aggregate changes. This is consistent with the simulator's single-growth-rate-per-stand model.

### Known Limitations

**Stale speciesData after clearcut + planting.** When a stand is clearcut and later replanted with a different species, `st.species` updates to the planted species but `speciesData` retains the original pre-clearcut array. The snapshot correctly zeros out all volumes (proportional scaling × 0 volume = 0), and aggregate values (stems, height, diameter) reflect the seedlings. The per-species breakdown shows the old species names with zero values — technically wrong but the aggregate tells the real story. Tracked for future improvement (per-species simulation).

**Species displayed only when stemCount > 0.** In both Current State and Simulation views, species rows are filtered to only show entries where `stem_count_per_ha > 0`. This prevents showing zero-volume species that exist in the DB but contribute nothing to the stand (e.g., a tiny rowan component at 0.01% volume with 0 stems).

## Data Flow

```
schedule.ts                     generate-plan.ts              plan_metadata
  │                                  │                         (new column)
  │ runScheduleEngine()              │                         simulation_data
  │   ├─ for each year:              │                           JSONB
  │   │   ├─ spawn ops               │                         
  │   │   ├─ select ops              │  After schedule:
  │   │   ├─ apply ops               │  1. Build SimulationSnapshot[]
  │   │   ├─ GROW stands          ──►  2. JSON.stringify
  │   │   └─ SNAPSHOT all stands ◄──   3. upsert plan_metadata.simulation_data
  │   │      (NEW: after GROW,                                │
  │   │       before next year)                               ▼
  │   └─ return ScheduleResult      Store (new hook) ◄── Supabase fetch
  │      + simulationSnapshots          │
  │                                     ▼
  │                              StandList (new SimulationView)
  │                                └─ Current state (full species fields)
  │                                └─ Year blocks (all fields + inline ops)
```

## Dependency Graph

```
T1 (Engine snapshot + types) ───► T2 (generate-plan writes JSONB)
                                       │
                                       ▼
T3 (DB migration: simulation_data column) ── (parallel, independent)
                                       │
                                       ▼
                                 T4 (PlanMetadata type + schedulePlan return)
                                       │
                                       ▼
                                 T5 (Frontend: hook to fetch plan_metadata)
                                       │
                                       ▼
                                 T6 (Frontend: SimulationView component)
                                       │
                                       ▼
                                 T7 (StandList: expand to show simulation + full species fields)
```

T1 includes all type definitions (YearSnapshot, StandSnapshot, SpeciesSnapshot). T3 is independent of T1-T2 and can run in parallel. T4-T7 are sequential frontend work.

---

## Task Ordering & Dependencies

```
T1 Engine snapshot + types
       │
       ▼
T2 generate-plan writes JSONB + schedulePlan return update
       │
       ├──────────────────────────┐
       ▼                          ▼
T4 PlanMetadata type       T3 DB migration (parallel)
       │                          │
       └──────────┬───────────────┘
                  ▼
            T5 Fetch hook
                  │
                  ▼
            T6 SimulationView component
                  │
                  ▼
            T7 StandList integration
```

**Parallel tracks:** T3 (DB migration) and T4 (PlanMetadata type) both depend on T2 conceptually but don't block each other. T5-T7 are sequential frontend tasks that require all backend work to be done first.

---

## Tasks

### T1: Add stand snapshotting to schedule engine

**Objective:** After each simulation year's GROW step, capture every stand's state into a snapshot array.

**Files:**
- Modify: `src/lib/ai/schedule.ts` — `ScheduleResult` interface, `runScheduleEngine()`
- Modify: `src/lib/ai/types.ts` — add simulation types, add `areaHa` to `SpeciesDatum`
- Modify: `src/lib/ai/generate-plan.ts` — add `areaHa` to `enrichCompartment()` mapping

**Implementation:**

#### T1a: Add types (`src/lib/ai/types.ts`)

First, add `areaHa` to the existing `SpeciesDatum` interface (needed for snapshot scaling):

```typescript
export interface SpeciesDatum {
  species: string;
  volumeM3: number;
  logPct: number;
  stemCount: number;
  meanHeight: number;
  meanDiameter: number;
  age: number;
  basalArea: number;
  areaHa: number;   // <-- NEW: from compartment_species.area_ha
}
```

Then add the new simulation types:

```typescript
/** Snapshot of one stand at one simulation year */
export interface StandSnapshot {
  standId: string;
  areaHa: number;
  volumeM3: number;
  basalArea: number;
  stemCount: number;
  meanHeight: number;
  meanDiameter: number;
  ageYears: number;
  species: string;
  siteType: string;
  developmentClass: string;
  /** Per-species breakdown, proportionally scaled from aggregate */
  speciesData: SpeciesSnapshot[];
}

export interface SpeciesSnapshot {
  species: string;
  volumeM3: number;
  logPct: number;
  stemCountPerHa: number;
  meanHeight: number;
  meanDiameter: number;
  age: number;
  basalArea: number;
  areaHa: number;
}

/** All stand snapshots for one simulation year */
export interface YearSnapshot {
  year: number;
  stands: StandSnapshot[];
}
```

Also update `enrichCompartment()` in `src/lib/ai/generate-plan.ts` (line 104) to pass `areaHa`:

```typescript
// In enrichCompartment(), add to SpeciesDatum mapping:
areaHa: sp.area_ha ?? 0,   // <-- NEW
```

#### T1b: Add `simulationSnapshots` to `ScheduleResult`

In `src/lib/ai/schedule.ts`, update `ScheduleResult`:

```typescript
export interface ScheduleResult {
  yearPlans: Map<number, PlannedOperation[]>;
  finalStates: Map<string, SimStand>;
  annualGrowthHistory: number[];
  overspillOps: number;
  overspillM3: number;
  /** Year-by-year snapshots of all stand states after GROW step */
  simulationSnapshots: YearSnapshot[];   // <-- NEW
}
```

#### T1c: Snapshot after GROW

Inside `runScheduleEngine()`, after the GROW loop (after line 923), add:

```typescript
const simulationSnapshots: YearSnapshot[] = [];  // before the year loop

// ── SNAPSHOT year 0: initial state before any simulation ──
{
  const year0Snapshot: YearSnapshot = {
    year: startYear - 1,  // year 0 = "pre-simulation"
    stands: [],
  };
  for (const st of stands.values()) {
    year0Snapshot.stands.push({
      standId: st.standId,
      areaHa: st.areaHa,
      volumeM3: Math.round(st.volumeM3),
      basalArea: Math.round(st.basalArea * 10) / 10,
      stemCount: st.stemCount,
      meanHeight: Math.round(st.meanHeight * 10) / 10,
      meanDiameter: Math.round(st.meanDiameter * 10) / 10,
      ageYears: st.ageYears,
      species: st.species,
      siteType: st.siteType,
      developmentClass: st.developmentClass,
      speciesData: st.speciesData.map(sp => ({
        species: sp.species,
        volumeM3: Math.round(sp.volumeM3),
        logPct: sp.logPct,
        stemCountPerHa: sp.stemCount,
        meanHeight: Math.round(sp.meanHeight * 10) / 10,
        meanDiameter: Math.round(sp.meanDiameter * 10) / 10,
        age: sp.age,
        basalArea: Math.round(sp.basalArea * 10) / 10,
        areaHa: sp.areaHa ?? 0,
      })),
    });
  }
  simulationSnapshots.push(year0Snapshot);
}

// Then inside the year loop, after the GROW loop, add:
// ── 7b. SNAPSHOT: capture all stand states for this year ──
const yearSnapshot: YearSnapshot = {
  year: yr,
  stands: [],
};
for (const st of stands.values()) {
  // Compute the growth delta applied to the stand (for per-species height/diameter)
  const totalStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);
  const oldWeightedHeight = totalStems > 0
    ? st.speciesData.reduce((s, sd) => s + sd.meanHeight * sd.stemCount, 0) / totalStems
    : 0;
  const heightDelta = st.meanHeight - oldWeightedHeight;
  const oldWeightedDiameter = totalStems > 0
    ? st.speciesData.reduce((s, sd) => s + sd.meanDiameter * sd.stemCount, 0) / totalStems
    : 0;
  const diameterDelta = st.meanDiameter - oldWeightedDiameter;

  // Proportionally scale species breakdown
  const totalVol = st.speciesData.reduce((s, sp) => s + sp.volumeM3, 0);
  const volRatio = totalVol > 0 ? st.volumeM3 / totalVol : 1;
  const totalBA = st.speciesData.reduce((s, sp) => s + sp.basalArea, 0);
  const baRatio = totalBA > 0 ? st.basalArea / totalBA : 1;
  const totalSpeciesStems = st.speciesData.reduce((s, sd) => s + sd.stemCount, 0);

  const speciesSnapshots: SpeciesSnapshot[] = st.speciesData.map(sp => ({
    species: sp.species,
    volumeM3: Math.round(sp.volumeM3 * volRatio),
    logPct: sp.logPct,
    stemCountPerHa: totalSpeciesStems > 0
      ? Math.round(sp.stemCount * st.stemCount / totalSpeciesStems)
      : 0,
    // Apply the same growth delta to all species (single-growth-rate model)
    meanHeight: Math.round((sp.meanHeight + heightDelta) * 10) / 10,
    meanDiameter: Math.round((sp.meanDiameter + diameterDelta) * 10) / 10,
    age: st.ageYears,  // use stand-level age (species share stand age in this model)
    basalArea: Math.round(sp.basalArea * baRatio * 10) / 10,
    areaHa: sp.areaHa ?? 0,
  }));

  yearSnapshot.stands.push({
    standId: st.standId,
    areaHa: st.areaHa,
    volumeM3: Math.round(st.volumeM3),
    basalArea: Math.round(st.basalArea * 10) / 10,
    stemCount: st.stemCount,
    meanHeight: Math.round(st.meanHeight * 10) / 10,
    meanDiameter: Math.round(st.meanDiameter * 10) / 10,
    ageYears: st.ageYears,
    species: st.species,
    siteType: st.siteType,
    developmentClass: st.developmentClass,
    speciesData: speciesSnapshots,
  });
}
simulationSnapshots.push(yearSnapshot);
```

And update the return:
```typescript
return { yearPlans, finalStates: stands, annualGrowthHistory, overspillOps, overspillM3, simulationSnapshots };
```

**Verification:**
- `npm run build` passes (no type errors in schedule.ts)
- Run existing tests: `npm test -- --testPathPattern forestry`
- Expected: all 286 tests still pass

💡 **Pitfall:** Per-species height and diameter use the same delta as the aggregate (stand-level `meanHeight`/`meanDiameter` change), since the model uses a single growth rate per stand. This means all species in a stand grow at the same rate — consistent with the simulator but not biologically differentiated. Per-species growth rate differentiation is out of scope.

---

### T2: Save simulation snapshots to plan_metadata + update return types

**Objective:** After schedule completes, serialize simulation snapshots into `plan_metadata.simulation_data`. Update `schedulePlan()` signature to pass through the new data.

**Files:**
- Modify: `src/lib/ai/generate-plan.ts` — `generatePlan()` around line 267
- Modify: `src/lib/ai/schedule.ts` — `schedulePlan()` return type (line 954)

**Implementation:**

#### T2a: Update `schedulePlan()` return type and destructuring

In `src/lib/ai/schedule.ts`, update the `schedulePlan()` return type (line 954-956):

```typescript
): {
  years: YearPlan[];
  summary: PlanSummary;
  simulationSnapshots: YearSnapshot[];   // <-- NEW
}
```

In the same function, update the destructuring from `runScheduleEngine()` (line 960):

```typescript
const { yearPlans, annualGrowthHistory, overspillOps, overspillM3, simulationSnapshots } = runScheduleEngine(
```

And update the return statement (line 1036):

```typescript
return { years, summary, simulationSnapshots };
```

#### T2b: Destructure in `generatePlan()` and save to metadata

In `generatePlan()`, update the `schedulePlan()` destructuring:

```typescript
const { years, summary, simulationSnapshots } = schedulePlan(/* ... */);
```

Update `schedulePlan()` to pass through `simulationSnapshots`:

```typescript
// In schedulePlan() return:
return { years, summary, simulationSnapshots };
```

Then in `generatePlan()`, add to the `metaPayload`:

```typescript
const metaPayload = {
  forest_id: forestId,
  name: `Forest Plan ${startYear}-${startYear + periodYears - 1}`,
  period_start: startYear,
  period_end: startYear + periodYears - 1,
  total_volume_m3: totalVolume,
  stumpage_value_eur: totalValue,
  annual_growth_m3: summary.annualGrowth,
  owner_stated_value_eur: null,
  goal,
  simulation_data: JSON.stringify(simulationSnapshots),  // <-- NEW
};
```

**Verification:**
- Generate a plan via the ForestChat AI
- Check Supabase dashboard: `SELECT simulation_data FROM plan_metadata WHERE forest_id = '<your-forest-id>';`
- Expected: non-null JSONB array with year entries

💡 **Pitfall:** `schedulePlan()` currently destructures `{ years, summary }` from `runScheduleEngine()`. Need to add `simulationSnapshots` to the destructuring and return it.

---

### T3: DB migration — add `simulation_data` column

**Objective:** Add `simulation_data JSONB` column to `plan_metadata` table.

**File:**
- Create: `supabase/migrations/015_add_simulation_data.sql`

```sql
-- Phase 8: Add simulation_data column to plan_metadata
-- Stores year-by-year stand snapshots as JSONB
-- Migration 015

ALTER TABLE plan_metadata
ADD COLUMN IF NOT EXISTS simulation_data JSONB;

COMMENT ON COLUMN plan_metadata.simulation_data IS 'Year-by-year stand simulation snapshots. JSON array of YearSnapshot objects.';
```

**Verification:**
- Run migration: `npx supabase migration up` (or apply via Supabase dashboard)
- Check: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'plan_metadata' AND column_name = 'simulation_data';`
- Expected: `simulation_data | jsonb`

No RLS policy changes needed — `plan_metadata` inherits existing policies.

---

### T4: Update `PlanMetadata` DB type

**Objective:** Add `simulation_data` to the `PlanMetadata` TypeScript interface (matches T3's DB migration).

**Files:**
- Modify: `src/types/database.ts` — `PlanMetadata` interface

**Note:** This task adds the DB-level TypeScript type for the new column. T1a already defined the simulation types (`YearSnapshot`, `StandSnapshot`, `SpeciesSnapshot`) used at the engine/generate-plan layer. T4 bridges the gap between those types and the DB interface.

**Implementation:**

In `src/types/database.ts`:

```typescript
export interface PlanMetadata {
  // ... existing fields ...
  goal?: string | null;              // Add if missing
  simulation_data?: string | null;   // <-- NEW: JSON string of YearSnapshot[]
}
```

**Verification:**
- `npm run build` — no type errors

---

### T5: Fetch hook for plan_metadata

**Objective:** Add a React hook that fetches `plan_metadata` (including `simulation_data`) and stores it in Zustand.

**Files:**
- Create: `src/lib/hooks/use-plan-metadata.ts`
- Modify: `src/lib/store/forest-slice.ts` — store already has `planMetadata` + `setPlanMetadata`
- Modify: `src/components/forest/ForestView.tsx` — call the new hook

**Implementation:**

```typescript
// src/lib/hooks/use-plan-metadata.ts
"use client";

import { useState, useEffect } from "react";
import type { PlanMetadata } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useForestStore } from "@/lib/store";

export function usePlanMetadata(forestId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetchCounter = useForestStore((s) => s.refetchCounter);

  useEffect(() => {
    if (!forestId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchMeta = async () => {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("plan_metadata")
        .select("*")
        .eq("forest_id", forestId)
        .limit(1)
        .single();

      if (cancelled) return;

      if (fetchError && fetchError.code !== "PGRST116") {
        setError(fetchError.message);
        useForestStore.getState().setPlanMetadata(null as unknown as PlanMetadata);
      } else {
        useForestStore.getState().setPlanMetadata(
          (data as PlanMetadata) ?? (null as unknown as PlanMetadata)
        );
      }
      setLoading(false);
    };

    fetchMeta();
    return () => { cancelled = true; };
  }, [forestId, refetchCounter]);

  return { loading, error };
}
```

In `ForestView.tsx`, add:
```typescript
import { usePlanMetadata } from "@/lib/hooks/use-plan-metadata";
// ... inside the component:
usePlanMetadata(forestId);
```

**Verification:**
- Open ForestChat, navigate to a forest that has a plan
- Check React DevTools: `ForestSlice.planMetadata` should be populated
- Check `planMetadata.simulation_data` is present

---

### T6: SimulationView component

**Objective:** Create a reusable component that renders a stand's year-by-year simulation as expandable year blocks with operations inline.

**File:**
- Create: `src/components/forest/SimulationView.tsx`

**Props:**

```typescript
interface SimulationViewProps {
  /** The stand ID to display simulation for */
  standId: string;
  /** Full simulation data (all stands, all years) from plan_metadata.simulation_data */
  simulationSnapshots: YearSnapshot[];
  /** Operations for THIS stand, pre-filtered by the caller.
   *  Note: operations have compartment_id not stand_id — caller must map
   *  compartment_id → stand_id before passing. See T7 for the mapping. */
  operations: PlannedOpForView[];
  language: Language;
  labels: StandListLabels;  // for i18n
}

/** Lightweight operation view model — caller maps DB Operation → this */
interface PlannedOpForView {
  year: number;
  type: string;
  removalPct: number;
  incomeEur: number;
  costEur: number;
  notes: string;
}
```

**Rendering rules:**

- Group operations by year into a `Map<number, PlannedOpForView[]>`
- For each simulation year (including year 0 = pre-simulation):
  - Show year label (e.g., "Year 0 (initial)", "Year 1 (2026)", ...)
  - If operations fire this year: show operation badges (type, removal%, income/cost)
  - Show stand aggregate state: volume, BA, stems/ha, height, diameter, age
  - Show per-species breakdown — **only species with stemCountPerHa > 0**
- Years are collapsed by default EXCEPT: year 0, year 1, and years with operations
- Scroll-friendly: vertical layout, not a horizontal table

Layout (pseudocode):
```
── Simulation (2026–2045) ─────────────────────
▼ Year 0 (initial — before simulation)
    Vol 340 m³ | BA 24.0 | Stems 1000/ha | H 19.2m | D 22.1cm | Age 55
    Pine:     Vol 280 m³ | BA 16.0 | Stems 800/ha | H 19.2m | D 22.1cm | Age 55 | Log 60% | 1.8 ha
    Spruce:   Vol 60 m³  | BA 8.0  | Stems 200/ha | H 15.0m | D 18.5cm | Age 45 | Log 40% | 0.5 ha
▼ Year 1 (2026)
    🔧 Thinning −35% (18 m³, +2 500 €)
    After: Vol 322 m³ | BA 18.2 | Stems 588/ha | H 19.2m | D 22.1cm | Age 56
    Pine:     Vol 182 m³ | BA 10.2 | Stems 400/ha | H 19.2m | D 22.1cm | Age 56 | Log 60%
    Spruce:   Vol 140 m³ | BA 8.0  | Stems 188/ha | H 19.2m | D 22.1cm | Age 56 | Log 40%
▶ Year 2 (2027)
    Vol 342 m³ | BA 19.4 | Stems 596/ha | H 19.6m | D 22.3cm | Age 57
    Pine:     Vol 195 m³ | BA 11.0 | Stems 408/ha | H 19.6m | D 22.3cm | Age 57 | Log 60%
    Spruce:   Vol 147 m³ | BA 8.4  | Stems 188/ha | H 19.6m | D 22.3cm | Age 57 | Log 40%
▶ Year 3 (2028)
    ...
```

**Key features:**
- Year 0 shows initial DB state (pre-simulation) — collapsed by default if same as Current State
- Years are collapsed by default except Year 1 and years with operations
- Click to expand/collapse any year
- Color-coded operation badges: harvest=green, tending=orange, regeneration=blue
- **Species filtering:** only show species rows where `stemCountPerHa > 0` — avoids displaying zero-value species
- `areaHa` shown in species breakdown (per-species area from compartment_species)

**Verification:**
- Import in StandList (test rendering)
- `npm run build` — no errors

---

### T7: Update StandList — full species fields + simulation toggle

**Objective:** Replace the old expandable species+operations rows with a two-section view: Current State (full species fields) and Simulation (if plan exists).

**Files:**
- Modify: `src/components/forest/StandList.tsx`
- Modify: `src/lib/i18n.ts` — add new labels

**Implementation:**

#### T7a: Add labels to i18n

In `src/lib/i18n.ts`, add to `StandListLabels`:

```typescript
export interface StandListLabels {
  // ... existing ...
  colStems: string;
  colHeight: string;
  colDiameter: string;
  colBA: string;
  simHeader: string;
  simYearLabel: string;
  simNoData: string;
  simCurrentState: string;
}
```

Finnish:
```typescript
colStems: "Runkoluku/ha",
colHeight: "Pituus (m)",
colDiameter: "Lpm. (cm)",
colBA: "PPA (m²/ha)",
simHeader: "Simulaatio",
simYearLabel: "Vuosi",
simNoData: "Ei simulaatiodataa. Luo metsäsuunnitelma ensin.",
simCurrentState: "Nykyinen tila",
```

English:
```typescript
colStems: "Stems/ha",
colHeight: "Height (m)",
colDiameter: "Diam. (cm)",
colBA: "BA (m²/ha)",
simHeader: "Simulation",
simYearLabel: "Year",
simNoData: "No simulation data. Generate a plan first.",
simCurrentState: "Current State",
```

#### T7b: Update stand expand rows

First, update the `StandDisplayRow` type union at the top of `StandList.tsx` (line 9):

```typescript
type StandRowType = "stand" | "species" | "operation" | "empty" | "expandedContent";
```

and the union type (line 11-15):
```typescript
type StandDisplayRow =
  | { rowType: "stand"; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] }
  | { rowType: "species"; parentStandId: string; data: CompartmentSpecies }
  | { rowType: "operation"; parentStandId: string; data: Operation }
  | { rowType: "empty"; parentStandId: string }
  | { rowType: "expandedContent"; parentStandId: string; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] };
```

Replace the current species+operations expand logic (lines 634-689 in StandList.tsx) with:

```tsx
if (row.rowType === "stand") {
  // ... existing stand row rendering (unchanged)
}

// When expanded, show: Current State + Simulation
if (row.rowType === "expandedContent") {
  // Build compartment_id → stand_id map for filtering operations
  const compartmentMap = new Map<string, string>();
  // (row.data is the Compartment for this stand)
  if (row.data) compartmentMap.set(row.data.id, row.data.stand_id);

  // Filter to operations for THIS stand only
  const opsForStand = row.operations.filter(op => op.compartment_id === row.data.id);

  // Filter species: only show those with stem_count_per_ha > 0
  const activeSpecies = row.species.filter(sp => (sp.stem_count_per_ha ?? 0) > 0);

  return (
    <tr key={`expand-${row.parentStandId}`}>
      <td colSpan={9} className="p-0">
        <div className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
          {/* Current State — species rows with ALL fields */}
          <div className="px-4 py-2">
            <div className="text-xs font-semibold text-gray-500 mb-1">
              {L.simCurrentState}
            </div>
            {activeSpecies.map(sp => (
              <div key={sp.id} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 pl-4 mb-1">
                <span className="font-medium w-20">{displaySpecies(sp.species, language)}</span>
                <span>Vol: {Math.round(sp.volume_m3 ?? 0).toLocaleString()} m³</span>
                <span>{L.colBA}: {(sp.basal_area ?? 0).toFixed(1)}</span>
                <span>{L.colStems}: {(sp.stem_count_per_ha ?? 0).toLocaleString()}</span>
                <span>{L.colHeight}: {(sp.mean_height ?? 0).toFixed(1)}</span>
                <span>{L.colDiameter}: {(sp.mean_diameter ?? 0).toFixed(1)}</span>
                <span>{L.colAge}: {sp.age ?? ""}</span>
                <span>{L.logPct}: {sp.log_pct != null ? `${sp.log_pct}%` : "—"}</span>
                <span>{L.colArea}: {(sp.area_ha ?? 0).toFixed(1)} ha</span>
              </div>
            ))}
            {activeSpecies.length === 0 && (
              <div className="text-xs text-gray-400 italic pl-4">
                No species with stems > 0
              </div>
            )}
          </div>

          {/* Simulation — year blocks with inline operations */}
          {simulationSnapshots && simulationSnapshots.length > 0 ? (
            <SimulationView
              standId={row.data.stand_id}
              simulationSnapshots={simulationSnapshots}
              operations={opsForStand.map(op => ({
                year: op.year,
                type: op.type,
                removalPct: op.removal_pct ?? 0,
                incomeEur: op.income_eur ?? 0,
                costEur: op.cost_eur ?? 0,
                notes: op.notes ?? "",
              }))}
              language={language}
              labels={L}
            />
          ) : (
            <div className="px-4 py-2 text-xs text-gray-400 italic">
              {L.simNoData}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
```

#### T7c: Update displayRows to produce expandedContent row

Instead of iterating species+operations rows, produce a single "expandedContent" row:

```typescript
if (expandedStands.has(comp.stand_id)) {
  rows.push({ rowType: "expandedContent", parentStandId: comp.stand_id, data: comp, species, operations: ops });
}
```

Remove the old `rowType: "species"`, `rowType: "operation"`, and `rowType: "empty"` rendering — they're replaced by the single expandedContent row.

#### T7d: Wire simulation data from store with error boundary

Add to the displayRows useMemo dependencies and import:
```typescript
const planMetadata = useForestStore((s) => s.planMetadata);

const simulationSnapshots = useMemo(() => {
  if (!planMetadata?.simulation_data) return null;
  try {
    return JSON.parse(planMetadata.simulation_data) as YearSnapshot[];
  } catch (e) {
    console.error("Failed to parse simulation_data:", e);
    return null;  // graceful fallback — shows simNoData message
  }
}, [planMetadata?.simulation_data]);
```

If `simulationSnapshots` is `null` (no plan OR parse error), the UI shows `L.simNoData` (from T7b). This means:
- No plan generated → "No simulation data. Generate a plan first."
- Corrupted data → same message — user regenerates plan to fix

Pass `simulationSnapshots` to the expandedContent rendering.

**Verification:**
- Generate a new plan via ForestChat AI
- In StandList, expand a stand that has operations
- Expected: "Current State" shows ALL species fields (8 values per species)
- Expected: "Simulation" shows year blocks matching plan length
- Expected: Years with operations show operation badges
- Expected: `npm run build` passes

---

## Verification Checklist

- [ ] `npm run build` — no TypeScript errors
- [ ] All existing tests pass (`npm test -- --testPathPattern forestry`)
- [ ] `SpeciesDatum` has `areaHa` field; `enrichCompartment()` passes `sp.area_ha`
- [ ] `schedulePlan()` returns `{ years, summary, simulationSnapshots }`
- [ ] `generatePlan()` destructures `simulationSnapshots` and saves to `metaPayload.simulation_data`
- [ ] Migration 015 applies cleanly: `simulation_data JSONB` column exists
- [ ] `PlanMetadata` interface has `simulation_data?: string | null`
- [ ] `StandDisplayRow` union includes `"expandedContent"` row type
- [ ] Generate a 10-year plan via ForestChat AI → `simulation_data` column is populated
- [ ] StandList: expand a stand → "Current State" shows up to 9 fields per species (species, vol, BA, stems, height, diam, age, log%, area)
- [ ] StandList: expand a stand → "Simulation" shows year 0 (initial) + 10 simulation years
- [ ] Years with operations: operation type, removal%, income/cost are visible inline
- [ ] Years without operations: just show stand state, no empty operation rows
- [ ] Operations are NOT shown as separate rows below species (moved to year blocks)
- [ ] Species with `stem_count_per_ha = 0` are not displayed in Current State or Simulation
- [ ] Simulation per-species height/diameter increase year-over-year (not frozen)
- [ ] Simulation per-species age tracks `st.ageYears` (not always initial+1)
- [ ] Corrupted `simulation_data` JSONB → shows fallback message instead of crash
- [ ] Reload page → simulation data persists (fetched from DB)

---

## Out of Scope

- Per-species growth rate differentiation (species share one aggregate growth rate)
- Chart visualization of simulation data (separate phase)
- Export simulation to CSV/PDF
- Comparison with reference plans in UI (already done via plan comparison script)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| JSONB column too large (>100 MB) for forests with many stands | Query performance | 300 stands × 40 years × 1 KB = 12 MB max — well within limits |
| Simulation snapshot inconsistent with operations (ops applied then snapshot captures mid-state) | User confusion | Snapshot AFTER GROW, which is the end-of-year state. Operations applied before GROW show their effect in that year's snapshot. |
| Proportional species scaling introduces small rounding inconsistencies | Minor display artifacts | Acceptable — aggregate values are the source of truth |
