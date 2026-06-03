# Phase 6 — Stand & Operation Lists with Cross-Component Highlighting

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add tabbed navigation with hierarchical stand list and filterable operation list, fix broken chart↔map highlighting, and wire bidirectional cross-component interaction (list↔chart↔map).

**Architecture:** A `MainTabBar` wraps the existing Map, a new hierarchical `StandList`, and a new filterable `OperationList`. A shared `highlightedStandIds` mechanism connects all three. AI chat tools (`search_stands`, `query_operations`) already exist — a new `show_in_ui` SSE event pushes results to the relevant tab.

**Tech Stack:** Next.js 16, React 19, Zustand 5, TanStack Table 8, MapLibre GL 5, Recharts 3, Tailwind CSS 4

**Version:** 2.2
**Date:** 2026-06-02
**Status:** ✅ Implemented 2026-06-03

**Changelog v2.2 (architectural review):**
- Split T2 into T2a (tree table, 2h) and T2b (filter bar, 1.5h) — honest tracking of filter bar complexity
- Moved `aiStandFilters` and `aiOperationFilters` from visualization-slice to tab-slice (correct home — these serve lists, not charts)
- Added T1.3a: decision table for medium/small breakpoint tab + chart overlay orthogonality
- Added T5.2 structured-return approach: `ToolResult.data` field for extracting stand IDs without text parsing
- Fixed filter shapes claim: they're a **subset** of tool parameters, not an exact mirror
- Fixed T6.1 test assertion: `aria-current="page"` instead of fragile `className` check
- Added `aria-current` to MainTabBar component code in T1.2

**Changelog v2.1:**
- Added filter bar to StandList (species, development_class, site_type, age range, area range, volume range)
- Added `aiStandFilters` to store so AI chat can push filter criteria to StandList
- Fixed T5 to cover both stands and operations equally (not operations-only)
- Fixed: scaled back operation-level chart highlighting claim — aggregated chart data has no per-op IDs
- Added `pendingStandSelection` to map slice — handles "Show on map" race condition
- Map tab now uses CSS visibility (not conditional rendering) for instant switching
- Added T6: smoke tests for MainTabBar, StandList, OperationList
- AI filter push now collapses all expanded stands (filter is a new context)

**Changelog v2.0:**
- Added hierarchical tree structure for stand list (stand → species → operations)
- Added filterable/sortable operation list with date range, type, stand filters
- Added bidirectional cross-component highlighting (list↔chart↔map)
- Added "Show on map" button instead of auto-switching tabs
- Added AI chat → list integration via SSE `show_in_ui` event
- Fixed broken `getActiveOpacity` in ChartCard (was always returning 1)
- Stand list shows expandable children (species + operations per stand)

---

## Architecture Overview

### Layout
```
[ChartsPanel] | [TabContainer]                    | [ChatPanel]
                 ├── Map (existing, inside tab)
                 ├── Stands (hierarchical tree table)
                 └── Operations (flat filterable table)
```

### Cross-Component Highlighting Data Flow
```
                 ┌──────────────────────────────────────┐
                 │        Zustand Store                  │
                 │                                       │
                 │  highlightedStandIds: string[]        │
                 │  highlightedOperationIds: string[]    │
                 │  activeMainTab: MainTab               │
                 │                                       │
                 │  setHighlightedStands(ids)            │
                 │  setHighlightedOperations(ids)        │
                 │  setActiveMainTab(tab)                │
                 └──────┬───────────┬──────────┬────────┘
                        │           │          │
             ┌──────────▼──┐  ┌────▼─────┐  ┌─▼──────────┐
             │   Map       │  │ Charts   │  │ Lists      │
             │             │  │          │  │            │
             │ Click stand │  │ Click bar│  │ Click row  │
             │ → highlight │  │ →highlght│  │ →highlight │
             │   on map    │  │  dim othr│  │  on map    │
             │   + lists   │  │  + lists │  │  + charts  │
             │   + charts  │  │  + map   │  │            │
             └─────────────┘  └──────────┘  └────────────┘
```

### AI Chat → Lists Integration
```
AI tool: search_stands / query_operations
    │
    ▼
SSE event: show_in_ui { target: "stands"|"operations", data: {...} }
    │
    ▼
Client: switch to target tab, populate filtered results
```

---

## Task Ordering & Dependencies

```
T0: Fix chart opacity (broken getActiveOpacity)
 │
 ├──► T1: Tab infrastructure + Layout refactor
 │      │
 │      ├──► T2a: Hierarchical Stand List (tree table)
 │      │      │
 │      │      ├──► T2b: Stand List Filter Bar
 │      │      │      │
 │      │      │      ▼
 │      │      │    T4: Cross-component highlighting (list↔chart↔map)
 │      │      │
 │      │      └──► T3: Filterable Operation List
 │      │             │
 │      │             ▼
 │      │           T4: Cross-component highlighting (list↔chart↔map)
 │      │
 │      └──► T5: AI chat → list integration (SSE show_in_ui)
 │
 └──► T6: Smoke tests
```

T0 is critical — fixes the already-broken chart opacity. T1 is a shared prerequisite. T2a (tree table) and T3 can run in parallel after T1. T2b (filter bar) depends on T2a. T4 wires highlighting across all components (list↔chart↔map). T5 adds AI integration and depends on T4 for highlight state propagation (the SSE handler calls `setHighlightedStands`). T6 runs last.

---

## T0: Fix Chart Opacity (Broken getActiveOpacity)

**Objective:** Fix the chart bar/slice highlighting so clicking a stand on the map actually dims non-matching bars in the chart.

**Time estimate:** 0.5h

### Problem

In `ChartCard.tsx` line 310-313, `getActiveOpacity` always returns 1. The chart never dims non-highlighted bars. The map highlight works (gold outline on selected stands), but the chart side of the bidirectional link is broken.

```typescript
// BROKEN: always returns 1
const getActiveOpacity = (_entry: Record<string, unknown>): number => {
  if (tab.standDimension && highlightedStandIds.length > 0) return 1;
  return 1;
};
```

### Fix

**Modify:** `src/components/charts/ChartCard.tsx`

Replace `getActiveOpacity` and the `isActive` function with a single working implementation:

```typescript
// Determine if a data point corresponds to a highlighted stand
const isDataPointHighlighted = (entry: Record<string, unknown>): boolean => {
  if (!tab.standDimension || highlightedStandIds.length === 0) return true;
  const entryStandId = entry[tab.standDimension];
  if (entryStandId == null) return true;
  return highlightedStandIds.includes(String(entryStandId));
};
```

Then apply this to all chart types' Cell rendering. For bar charts, each `<Bar>` needs a `<Cell>` with conditional opacity:

```tsx
// In the bar chart case:
<Bar dataKey={tab.yKey} fill="#4CAF50" radius={[4, 4, 0, 0]}>
  {translatedData.map((entry, index) => {
    const highlighted = isDataPointHighlighted(entry);
    return (
      <Cell
        key={`cell-${index}`}
        fill={highlighted ? CHART_COLORS[index % CHART_COLORS.length] : "#e5e5e5"}
        fillOpacity={highlighted ? 1 : 0.25}
      />
    );
  })}
</Bar>
```

Apply the same pattern to: stacked_bar, line, area, pie, donut, horizontal_bar, scatter charts.

**⚠️ Pitfall:** Pie/donut charts render slices differently. For pies, the `<Pie>` component uses `<Cell>` children. Each Cell needs conditional `fill` and `opacity` based on `isDataPointHighlighted`.

**⚠️ Pitfall:** Scatter charts use `<Scatter>` with individual points. Each point shape needs conditional opacity.

**Verify:**
- Create a chart with `stand_dimension` set (e.g., income by stand)
- Click a stand on the map → chart bars dim except the clicked stand's bar
- Click the chart bar → map highlights that stand
- Click background → all highlights clear, all bars full opacity

---

## T1: Tab Infrastructure & PanelLayout Refactor

**Objective:** Add tab state, MainTabBar, and refactor PanelLayout. Same as v1.0 T1 but with `activeMainTab` NOT auto-switched on row click.

**Time estimate:** 1.5h

### T1.1 — Create tab Zustand slice

**Create:** `src/lib/store/tab-slice.ts`

```typescript
import type { StateCreator } from "zustand";

export type MainTab = "map" | "stands" | "operations";

export interface TabSlice {
  activeMainTab: MainTab;
  setActiveMainTab: (tab: MainTab) => void;
}

export const createTabSlice: StateCreator<TabSlice> = (set) => ({
  activeMainTab: "map",
  setActiveMainTab: (tab) => set({ activeMainTab: tab }),
});
```

**Modify:** `src/lib/store/index.ts` — add `TabSlice` to store type and `createTabSlice(...a)` to create call.

### T1.2 — Create MainTabBar component

**Create:** `src/components/layout/MainTabBar.tsx`

```typescript
"use client";

import { useForestStore } from "@/lib/store";
import type { MainTab } from "@/lib/store/tab-slice";

const TAB_DEFS: { id: MainTab; label: string; icon: string }[] = [
  { id: "map", label: "Map", icon: "🗺️" },
  { id: "stands", label: "Stands", icon: "🌲" },
  { id: "operations", label: "Operations", icon: "🪓" },
];

export default function MainTabBar() {
  const activeMainTab = useForestStore((s) => s.activeMainTab);
  const setActiveMainTab = useForestStore((s) => s.setActiveMainTab);

  return (
    <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 shrink-0">
      {TAB_DEFS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveMainTab(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm border-r border-gray-200 dark:border-gray-700 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
            activeMainTab === tab.id
              ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 font-medium border-b-2 border-b-blue-600 dark:border-b-blue-400"
              : "text-gray-600 dark:text-gray-400"
          }`}
          aria-current={activeMainTab === tab.id ? "page" : undefined}
        >
          <span className="text-base">{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
```

### T1.3 — Refactor PanelLayout

**Modify:** `src/components/layout/PanelLayout.tsx`

Change props from `mapPanel` to `tabs: { map, stands, operations }`. Import `MainTabBar`. Replace the map area div with a tab container in all three breakpoints.

**⚠️ Map tab uses CSS visibility, not conditional rendering.** MapLibre initialization takes ~500ms-1s. Destroying and recreating on every tab switch is too slow. The map tab content is always mounted but hidden via `hidden` class:

```tsx
{/* Map tab — always mounted, hidden when inactive */}
<div className={activeMainTab === "map" ? "flex-1 relative min-h-0" : "hidden"}>
  {tabs.map}
</div>
{/* Stands/Operations tabs — conditionally rendered (no heavy init) */}
{activeMainTab === "stands" && (
  <div className="flex-1 relative min-h-0">{tabs.stands}</div>
)}
{activeMainTab === "operations" && (
  <div className="flex-1 relative min-h-0">{tabs.operations}</div>
)}
```

This keeps the MapLibre instance alive, preserves viewport state, and gives instant tab switches back to Map. Stand and operation tabs use conditional rendering (they're just tables, no expensive init). GPU cost of hidden map: ~2-5MB VRAM for 161 polygons — negligible.

**This also eliminates the race condition partially addressed in T1.5** — since the map is always mounted, `map` state is never null after first load. T1.5 still handles the edge case where "Show on map" is clicked before the very first map render.

### T1.3a — Medium/small breakpoint tab + chart overlay interaction

The medium and small breakpoints already have an independent chart toggle overlay. The tab bar adds a second control surface. They **do not** compose — tab switching and chart toggling are orthogonal:

| User action | What happens |
|---|---|
| Switch tab (Map→Stands→Operations) | Chart overlay stays as-is (open or closed, independent) |
| Toggle chart overlay (open/close) | Active tab stays as-is |
| AI pushes results to a tab | Switches to that tab, chart overlay unaffected |
| Switch tab while chart overlay is open | Chart overlay stays open (not auto-closed) |

The tab bar replaces only the current map area's top section. The chart toggle button (📊 badge) remains in its existing position and is **not** moved inside the tab bar.

### T1.4 — Update ForestView

**Modify:** `src/components/forest/ForestView.tsx`

Pass `tabs` prop instead of `mapPanel`. Import `StandList` and `OperationList`. Keep StandLayer/StandLegend inside the map tab.

### T1.5 — Pending stand selection (map slice extension)

**Modify:** `src/lib/store/map-slice.ts`

Add `pendingStandSelection` to handle the "Show on map" race condition — when the user clicks "Show on map" before the Map tab has ever been visited, `MapView` hasn't mounted and `map` is null. Queue the selection and apply it when `onMapReady` fires:

```typescript
export interface MapSlice {
  // ... existing ...
  pendingStandSelection: string | null;
  setPendingStandSelection: (standId: string | null) => void;
  consumePendingSelection: () => string | null; // returns and clears
}

export const createMapSlice: StateCreator<MapSlice> = (set, get) => ({
  // ... existing ...
  pendingStandSelection: null,
  setPendingStandSelection: (standId) => set({ pendingStandSelection: standId }),
  consumePendingSelection: () => {
    const id = get().pendingStandSelection;
    if (id) set({ pendingStandSelection: null });
    return id;
  },
});
```

**Usage in "Show on map" button (StandList + OperationList):**

```typescript
const handleShowOnMap = (standId: string) => {
  const state = useForestStore.getState();
  const map = /* map ref from ForestView context */;

  if (map) {
    // Map is ready — select immediately
    state.selectStand(standId);
    // fitBounds, etc.
  } else {
    // Map not mounted yet — queue for later
    state.setPendingStandSelection(standId);
  }
  state.setActiveMainTab("map");
};
```

**Usage in ForestView's onMapReady:**

```typescript
<MapView
  onMapReady={(mapInstance) => {
    setMap(mapInstance);
    // Apply any pending selection
    const pending = useForestStore.getState().consumePendingSelection();
    if (pending) {
      useForestStore.getState().selectStand(pending);
      // fitBounds to the stand after a short delay (map needs to render)
    }
  }}
/>
```

---

## T2a: Hierarchical Stand List (Tree Table)

**Objective:** Expandable tree table where each stand row can expand to show its species (from compartment_species) and planned operations.

**Time estimate:** 2h

### T2.1 — Component structure

**Create:** `src/components/forest/StandList.tsx`

The table has two levels:
1. **Parent row (stand):** stand_id, main_species, area_ha, volume_m3, age_years, development_class, site_type, growth_m3_per_ha. Has a chevron (▶/▼) toggle on the left.
2. **Child rows (expanded):**
   - **Species section:** rows showing each species (species name, volume_m3, log_pct, area_ha). Indented, slightly different background.
   - **Operations section:** rows showing each operation (type, year, removal_pct, income_eur, cost_eur). Indented.

### Implementation approach

Use a flat array with a `rowType` discriminator and indentation:

```typescript
type StandRow =
  | { rowType: "stand"; data: Compartment; species: CompartmentSpecies[]; operations: Operation[] }
  | { rowType: "species"; parentStandId: string; data: CompartmentSpecies }
  | { rowType: "operation"; parentStandId: string; data: OperationRow };
```

State: `expandedStands: Set<string>` (stand_ids that are expanded).

When a stand row is clicked (on the chevron), toggle `expandedStands`. Render stand rows + their children for expanded stands.

### T2.2 — Table rendering

```tsx
export default function StandList() {
  const compartments = useForestStore((s) => s.compartments);
  const compartmentSpecies = useForestStore((s) => s.compartmentSpecies);
  const operations = useForestStore((s) => s.operations);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const selectStand = useForestStore((s) => s.selectStand);
  
  const [expandedStands, setExpandedStands] = useState<Set<string>>(new Set());
  const [globalFilter, setGlobalFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Build flat display rows
  const displayRows = useMemo(() => {
    const rows: StandDisplayRow[] = [];
    for (const comp of compartments) {
      const species = compartmentSpecies.filter(s => s.stand_id === comp.stand_id);
      const ops = operations.filter(o => o.compartment_id === comp.id);
      
      // Apply global filter
      const matches = globalFilter === "" || 
        comp.stand_id.includes(globalFilter) ||
        (comp.main_species ?? "").toLowerCase().includes(globalFilter.toLowerCase()) ||
        (comp.development_class ?? "").toLowerCase().includes(globalFilter.toLowerCase());
      
      if (globalFilter && !matches) continue;
      
      rows.push({ rowType: "stand", data: comp, species, operations: ops });
      
      if (expandedStands.has(comp.stand_id)) {
        // Species sub-rows
        for (const sp of species) {
          rows.push({ rowType: "species", parentStandId: comp.stand_id, data: sp });
        }
        // Operation sub-rows
        for (const op of ops) {
          rows.push({ rowType: "operation", parentStandId: comp.stand_id, data: op });
        }
        // If no children, show empty state
        if (species.length === 0 && ops.length === 0) {
          rows.push({ rowType: "empty", parentStandId: comp.stand_id });
        }
      }
    }
    return rows;
  }, [compartments, compartmentSpecies, operations, expandedStands, globalFilter]);

  // ... render rows ...
}
```

### T2.3 — Row rendering

Each row type has a different visual treatment:

- **stand:** Full columns, chevron toggle on left. Click row → highlight on map + charts. "Show on map" button on right.
- **species:** Indented 32px, columns: species, volume_m3, log_pct, area_ha. Lighter background.
- **operation:** Indented 32px, columns: type, year, removal_pct, income_eur, cost_eur. Lighter background.

### T2.4 — "Show on map" button

Each stand row has a small button (📍 or "Show") that does:
1. `selectStand(standId)` — selects stand on map
2. `setActiveMainTab("map")` — switches to map tab

The row click itself does NOT switch tabs — it only highlights.

### T2.5 — Column sorting

Add click-to-sort on column headers (stand_id, species, area, volume, age). Only sorts stand rows; children stay grouped under their parent.

**Verify:**
- Stands tab shows all stands
- Click chevron → species and operations appear indented under the stand
- Click another chevron → first collapses, second expands
- Click stand row → map highlights stand, chart bars update opacity
- Click "Show on map" → switches to map tab with stand selected
- Global filter: type "pine" → only stands with pine filter
- Sort by area → stands reorder, children stay grouped
- Dark mode: all colors adapt

---

## T2b: Stand List Filter Bar

**Objective:** Add a filter bar above the tree table with multi-select, range, and text filters. Wire AI-pushed filters from `aiStandFilters`.

**Time estimate:** 1.5h

**Prerequisite:** T2a (tree table must exist before filter bar can filter it).

The StandList needs the same filterable treatment as the OperationList. A dedicated filter bar above the tree table:

```
[Species: ▼ multi] [Dev. Class: ▼ multi] [Age: ____] – [____] [Area (ha): ____] – [____] [🔍 Search: ___________]
```

Filter state:
```typescript
const [speciesFilter, setSpeciesFilter] = useState<Set<string>>(new Set());
const [devClassFilter, setDevClassFilter] = useState<Set<string>>(new Set());
const [siteTypeFilter, setSiteTypeFilter] = useState<Set<string>>(new Set());
const [ageMin, setAgeMin] = useState<number | null>(null);
const [ageMax, setAgeMax] = useState<number | null>(null);
const [areaMin, setAreaMin] = useState<number | null>(null);
const [areaMax, setAreaMax] = useState<number | null>(null);
const [volumeMin, setVolumeMin] = useState<number | null>(null);
const [volumeMax, setVolumeMax] = useState<number | null>(null);
const [globalFilter, setGlobalFilter] = useState("");
```

The filter logic applies in the `displayRows` useMemo before building rows. Each stand is checked against all active filters — all must match (AND logic). Only species, dev_class, and global filter use include-matching; age/area/volume use range matching.

**AI-controlled filters:** Read from `aiStandFilters` in the tab slice (added in T5.4). When `aiStandFilters` changes, populate the local filter state AND collapse all expanded stands (a new filter context means the previous expand state is stale):

```typescript
const aiStandFilters = useForestStore((s) => s.aiStandFilters);

useEffect(() => {
  if (aiStandFilters) {
    if (aiStandFilters.species) setSpeciesFilter(new Set(aiStandFilters.species));
    if (aiStandFilters.development_classes) setDevClassFilter(new Set(aiStandFilters.development_classes));
    if (aiStandFilters.age_min != null) setAgeMin(aiStandFilters.age_min);
    if (aiStandFilters.age_max != null) setAgeMax(aiStandFilters.age_max);
    // ... etc for area, volume, site_types
    // Collapse all — filter is a new context
    setExpandedStands(new Set());
  }
}, [aiStandFilters]);
```

**Active filter chips:** Same pattern as OperationList — removable chips below the filter bar: `[Species: pine ✕] [Age: >60 ✕]`

**Verify:**
- Filter by species dropdown → only pine/spruce/etc stands shown
- Filter by development_class → only regeneration_ready, etc.
- Filter by age range → "older than 60" → age_min: 60
- Filter by area range → "larger than 2 ha" → area_min: 2
- Combined filters: species=pine + age>60 → intersection
- AI pushed filters populate the filter bar automatically
- AI filter push → all expanded stands collapse (filter is a new context)
- Filters can be cleared individually (chips) or all at once

---

## T3: Filterable Operation List

**Objective:** Flat, sortable, filterable table of all operations with compartment data joined in. Dedicated filter bar with year range, type, stand_id, species filters.

**Time estimate:** 2h

### T3.1 — Component

**Create:** `src/components/forest/OperationList.tsx`

```tsx
export default function OperationList() {
  const operations = useForestStore((s) => s.operations);
  const compartments = useForestStore((s) => s.compartments);
  const highlightedStandIds = useForestStore((s) => s.highlightedStandIds);
  const highlightedOperationIds = useForestStore((s) => s.highlightedOperationIds);
  const setHighlightedStands = useForestStore((s) => s.setHighlightedStands);
  const setHighlightedOperations = useForestStore((s) => s.setHighlightedOperations);
  
  // Filters
  const [yearFrom, setYearFrom] = useState<number | null>(null);
  const [yearTo, setYearTo] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [standFilter, setStandFilter] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState<Set<string>>(new Set());
  const [globalFilter, setGlobalFilter] = useState("");
  
  // Sort state from TanStack Table
  // ...
}
```

### T3.2 — Filter bar

A dedicated filter bar at the top of the table with:

```
[Year: ____] to [____]  [Type: ▼ multi-select]  [Stand: ____]  [Species: ▼]  [🔍 Search: ___________]
```

- **Year range:** two number inputs (from/to)
- **Type:** multi-select checkboxes (clear_cut, thinning, first_thinning, selection_cutting, site_prep, planting, tending, early_tending)
- **Stand:** text input matching stand_id
- **Species:** multi-select checkboxes (pine, spruce, silver_birch, downy_birch, larch, grey_alder)
- **Global search:** free-text across all columns

Active filters show as removable chips below the bar: `[Year: 2030-2035 ✕] [Type: clear_cut ✕]`

### T3.3 — Join data

Same as v1.0 plan: join operations with compartments via a Map for O(1) lookup.

### T3.4 — Columns

| Column | Description |
|---|---|
| Stand | stand_id (monospace, small) |
| Type | Display-friendly type name |
| Year | Numeric |
| Species | main_species |
| Area (ha) | From compartment |
| Vol. (m³) | From compartment |
| Removal % | removal_pct with "%" suffix |
| Income (€) | Green "+" prefix, zero → blank |
| Cost (€) | Orange "−" prefix, zero → blank |
| Dev. Class | From compartment |
| Actions | "Show on map" button |

### T3.5 — Row click behavior

- Click row → highlights the stand on map + in charts (via highlightedStandIds)
- Click row → also highlights the specific operation row (via highlightedOperationIds, for list-row visual feedback only — charts cannot use per-op IDs due to aggregation)
- Does NOT auto-switch to map tab
- "Show on map" button → switches to map tab

**Verify:**
- Operations tab shows all operations
- Filter by year range 2030-2035 → only operations in that range
- Filter by type "clear_cut" → only clearcuts
- Combine filters: year 2030-2035 + type clear_cut → intersection
- Click row → map highlights, chart bars update
- Sort by income descending → highest income first
- Empty state when no operations exist

---

## T4: Cross-Component Highlighting

**Objective:** Wire bidirectional highlighting so clicking in any component (list, chart, map) updates all others.

**Time estimate:** 2h

### T4.1 — Extend visualization slice

**Modify:** `src/lib/store/visualization-slice.ts`

Add `highlightedOperationIds` for list-row-only highlighting (chart highlighting only uses `highlightedStandIds` — see rationale below):

```typescript
export interface VisualizationSlice {
  // ... existing fields ...
  highlightedOperationIds: string[];
  setHighlightedOperations: (ids: string[]) => void;
}
```

**⚠️ Why operation-level highlighting is list-only:** Charts use aggregated data from `query_config` — a single bar (e.g., "Year 2028: €15,000") represents many operations. Individual operation IDs are lost in aggregation. Charts only respond to `highlightedStandIds` (via `standDimension`). The `highlightedOperationIds` field exists solely to apply blue row backgrounds in OperationList — it provides visual feedback for which operation row was clicked, independent of stand highlighting.

### T4.2 — StandList row click → map + charts

When a stand row is clicked:
```typescript
const handleStandRowClick = (standId: string) => {
  const current = useForestStore.getState().highlightedStandIds;
  // Toggle: clicking same stand deselects
  const newIds = current.includes(standId) 
    ? current.filter(id => id !== standId) 
    : [standId];
  setHighlightedStands(newIds);
  if (newIds.length > 0) {
    selectStand(newIds[0]); // also select on map for popup
  } else {
    selectStand(null);
  }
};
```

The map already reads `highlightedStandIds` and applies gold outline. Charts (after T0 fix) read it and adjust bar/slice opacity.

### T4.3 — OperationList row click → map + charts

When an operation row is clicked:
```typescript
const handleOperationRowClick = (standId: string, operationId: string) => {
  // Highlight the stand on map
  setHighlightedStands([standId]);
  selectStand(standId);
  // Also highlight the specific operation for chart correlation
  setHighlightedOperations([operationId]);
};
```

### T4.4 — Map click → lists + charts

Map click already sets `highlightedStandIds` and `selectedStandId` in StandLayer (lines 317-318). After T0, this automatically propagates to chart opacity. Lists need to read `highlightedStandIds` to apply row highlighting:

In StandList: 
```typescript
const isStandHighlighted = (standId: string) => highlightedStandIds.includes(standId);
// Apply bg-blue-100 class to highlighted rows
```

In OperationList:
```typescript
const isOperationHighlighted = (standId: string, opId: string) => 
  highlightedStandIds.includes(standId) || highlightedOperationIds.includes(opId);
```

### T4.5 — Chart click → map + lists

Chart click already sets `highlightedStandIds` (lines 247-249). This propagates to map (gold outline) and lists (row highlighting).

### T4.6 — Clear highlights

- Click map background → clears all (already implemented in StandLayer line 323-326)
- Escape key → clears all highlights (`useEffect` in ForestView or tab container)
- Click already-highlighted item → toggle off

**Verify:**
1. Click stand in StandList → map highlights, chart bars update opacity
2. Click operation in OperationList → map highlights, chart bars update
3. Click bar in chart → map highlights stand, both lists highlight matching rows
4. Click stand on map → chart bars update, both lists highlight matching rows
5. Click map background → all highlights clear
6. Press Escape → all highlights clear

---

## T5: AI Chat → List Integration

**Objective:** When the AI queries stands/operations in response to user request (e.g., "show me all clear-cuts from 2030-2035"), the results appear in the appropriate tab.

**Time estimate:** 1.5h

### T5.1 — New SSE event type

**Modify:** `src/lib/chat/sse.ts`

Add to the SseEvent union:
```typescript
| { type: "show_in_ui"; target: "stands" | "operations"; filters?: Record<string, unknown>; standIds?: string[] }
```

### T5.2 — Send event from tool executor

**Modify:** `src/lib/chat/tool-executor.ts`

**Design constraint:** Currently `searchStands` and `queryOperations` (in `query-tools.ts`) return a plain text `ToolResult` blob. Extracting structured stand IDs from a text blob is fragile. Instead, the tool executor needs structured return data:

**Approach:** Extend the return from `searchStands` and `queryOperations` to include a `data` field with the raw query results (array of DB rows). The `ToolResult` type gains an optional `data?: Record<string, unknown>[]` field. The tool executor reads `result.data` to extract `standIds` for the SSE event without parsing text. The text blob in `result.result` is still used for the AI's text response.

```typescript
// Extended ToolResult:
export interface ToolResult {
  success: boolean;
  result: string;
  error?: string;
  data?: Record<string, unknown>[];  // NEW: raw query results for UI integration
}
```

Then in the tool executor, after `search_stands` or `query_operations` executes successfully, send a `show_in_ui` SSE event:

```typescript
// In search_stands handler, after successful query:
ctx.sendSse?.("show_in_ui", {
  target: "stands",
  standIds: result.data?.map(r => r.stand_id as string) ?? [], // IDs from ToolResult.data
  filters: { /* the filter criteria used */ }
});

// In query_operations handler:
ctx.sendSse?.("show_in_ui", {
  target: "operations",
  filters: { years: args.years, types: args.types, /* ... */ }
});
```

### T5.3 — Handle event on client

**Modify:** `src/lib/chat/sse-client.ts`

Three changes needed in the browser-side SSE parser — the event never reaches `ChatPanel.tsx` without these:

1. **Add to SseEventType union (line 3-13):**
   ```typescript
   | "show_in_ui"
   ```

2. **Add callback to SseCallbacks interface (after line 25):**
   ```typescript
   onShowInUi?: (payload: ShowInUiPayload) => void;
   ```

3. **Add case to switch statement (after line 100):**
   ```typescript
   case "show_in_ui":
     callbacks.onShowInUi?.(data as ShowInUiPayload);
     break;
   ```

**Define the payload type** (near the top of sse-client.ts):
```typescript
export interface ShowInUiPayload {
  target: "stands" | "operations";
  standIds?: string[];
  filters?: Record<string, unknown>;
}
```

**Modify:** `src/components/chat/ChatPanel.tsx`

Register the callback when calling `streamChat`:

```typescript
// In ChatPanel.tsx, add to the streamChat callbacks object:
onShowInUi: (payload) => {
  // Switch to the target tab
  useForestStore.getState().setActiveMainTab(payload.target as MainTab);

  if (payload.target === "stands") {
    if (payload.standIds?.length) {
      // Highlight the matching stands
      useForestStore.getState().setHighlightedStands(payload.standIds);
    }
    if (payload.filters) {
      // Push filter criteria to StandList's filter bar — via tab slice
      useForestStore.getState().setAiStandFilters(payload.filters);
    }
  }

  if (payload.target === "operations" && payload.filters) {
    // Push filter criteria to OperationList's filter bar — via tab slice
    useForestStore.getState().setAiOperationFilters(payload.filters);
  }
},
```

### T5.4 — AI-applied filter state

**Modify:** `src/lib/store/tab-slice.ts` (created in T1.1)

Add TWO filter slots — one for stands, one for operations — to the tab slice (NOT visualization-slice, since these only serve list components, not charts):

```typescript
export interface TabSlice {
  // ... existing (activeMainTab, setActiveMainTab) ...
  aiStandFilters: Record<string, unknown> | null;
  setAiStandFilters: (filters: Record<string, unknown> | null) => void;
  aiOperationFilters: Record<string, unknown> | null;
  setAiOperationFilters: (filters: Record<string, unknown> | null) => void;
}
```

**Modify:** `src/lib/store/index.ts` — ensure `ForestStore` type includes the new `TabSlice` fields (it will via `TabSlice & ...`).

StandList reads `aiStandFilters` and applies them to its filter state (species, dev_class, age range, area range, etc.) via a `useEffect` (see T2b).

OperationList reads `aiOperationFilters` and applies them to its filter state.

**Filter shape convention:**

For stands (`aiStandFilters`):
```typescript
{
  species?: string[];            // e.g. ["pine", "spruce"]
  development_classes?: string[]; // e.g. ["regeneration_ready"]
  site_types?: string[];         // e.g. ["mesic"]
  age_min?: number;
  age_max?: number;
  area_min?: number;
  area_max?: number;
  volume_min?: number;
  volume_max?: number;
}
```

For operations (`aiOperationFilters`):
```typescript
{
  years?: number[];              // e.g. [2030, 2031, 2032, 2033, 2034, 2035]
  types?: string[];              // e.g. ["clear_cut"]
  stand_ids?: string[];
  species?: string[];
  income_min?: number;
  income_max?: number;
  // etc.
}
```

These shapes are a **subset** of the `search_stands` and `query_operations` tool parameter schemas — including only the filter dimensions that list UIs can display. Beyond what's shown, tools also support `basal_area`, `height`, `diameter`, `growth`, `removal_m3`, and `cost` range filters, none of which have UI controls in this phase.

### T5.5 — System prompt update

**Modify:** `src/lib/chat/system-prompt.ts`

Add instructions for the AI about when to show data in UI tabs:

```
When the user asks to "show" or "list" stands or operations (e.g., "show me all clear-cuts from 2030-2035"):
1. Call search_stands or query_operations with appropriate filters
2. The results will automatically appear in the relevant tab (Stands or Operations)
3. Briefly acknowledge what was shown — don't re-list all the data in text
```

**Verify:**
1. In chat: "show me all clear-cuts from 2030-2035" → operations tab opens with year + type filters applied, only matching ops visible
2. In chat: "show me pine stands older than 60 years" → stands tab opens with species=pine + age>60 filters applied in the filter bar, only matching stands visible
3. In chat: "show me regeneration-ready spruce stands larger than 1 hectare" → stands tab with combined filters (dev_class + species + area)
4. Chat responses are brief ("Showing 8 pine stands older than 60 years in the Stands tab")
5. Filters can be cleared manually in the UI after AI applies them (removable chips)

---

## T6: Smoke Tests

**Objective:** Add minimal smoke tests for all new components to prevent regressions.

**Time estimate:** 0.5h

### T6.1 — MainTabBar test

**Create:** `src/__tests__/components/MainTabBar.test.tsx`

```typescript
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MainTabBar from "@/components/layout/MainTabBar";

// Need to mock the Zustand store
import { useForestStore } from "@/lib/store";

describe("MainTabBar", () => {
  it("renders three tabs", () => {
    render(<MainTabBar />);
    expect(screen.getByText("Map")).toBeDefined();
    expect(screen.getByText("Stands")).toBeDefined();
    expect(screen.getByText("Operations")).toBeDefined();
  });

  it("highlights active tab", () => {
    useForestStore.getState().setActiveMainTab("stands");
    render(<MainTabBar />);
    const standsBtn = screen.getByText("Stands");
    // Verify using accessible attributes, not CSS class names (which are fragile to Tailwind changes)
    expect(standsBtn.getAttribute("aria-current")).toBe("page");
  });

  it("switches tab on click", () => {
    render(<MainTabBar />);
    fireEvent.click(screen.getByText("Operations"));
    expect(useForestStore.getState().activeMainTab).toBe("operations");
  });
});
```

### T6.2 — StandList smoke test

**Create:** `src/__tests__/components/StandList.test.tsx`

**⚠️ Pitfall:** These tests assume the StandList component capitalizes `main_species` for display and renders the chevron as a text character (▶/▼). If the implementation uses raw DB values (`pine` not `Pine`) or SVG-based chevrons, update the test assertions accordingly — `screen.getByText("Pine")` becomes `screen.getByText("pine")`, and `screen.getByText("▶")` becomes a data-testid lookup.

```typescript
describe("StandList", () => {
  it("renders without crash when store has compartments", () => {
    // Seed store with minimal compartments
    useForestStore.getState().setCompartments([
      { id: "1", stand_id: "1", main_species: "pine", area_ha: 2.5, volume_m3: 300, age_years: 45, development_class: "mature_thinning", site_type: "mesic", /* ... */ }
    ]);
    render(<StandList />);
    expect(screen.getByText("1")).toBeDefined(); // stand_id
    expect(screen.getByText("Pine")).toBeDefined(); // capitalized main_species
  });

  it("shows empty state when no compartments", () => {
    useForestStore.getState().setCompartments([]);
    render(<StandList />);
    expect(screen.getByText(/no stands/i)).toBeDefined();
  });

  it("expands/collapses on chevron click", () => {
    useForestStore.getState().setCompartments([/* stand with species */]);
    useForestStore.getState().setCompartmentSpecies([/* species for stand "1" */]);
    render(<StandList />);
    // Click chevron
    fireEvent.click(screen.getByText("▶"));
    // Species row should appear
    expect(screen.getByText(/spruce/i)).toBeDefined();
  });
});
```

### T6.3 — OperationList smoke test

**Create:** `src/__tests__/components/OperationList.test.tsx`

```typescript
describe("OperationList", () => {
  it("renders without crash when store has operations", () => {
    useForestStore.getState().setOperations([
      { id: "op1", compartment_id: "1", forest_id: "f1", type: "clear_cut", year: 2030, removal_pct: 100, income_eur: 15000, cost_eur: null, notes: null, created_by: "ai", created_at: "", updated_at: "" }
    ]);
    useForestStore.getState().setCompartments([
      { id: "1", stand_id: "5", /* ... */ }
    ]);
    render(<OperationList />);
    expect(screen.getByText("Clear Cut")).toBeDefined();
    expect(screen.getByText("+15000")).toBeDefined();
  });

  it("shows empty state when no operations", () => {
    useForestStore.getState().setOperations([]);
    render(<OperationList />);
    expect(screen.getByText(/no operations/i)).toBeDefined();
  });

  it("filters by year range", () => {
    // Populate with operations spanning multiple years
    // Set yearFrom=2030, yearTo=2030
    // Verify only 2030 operations visible
  });
});
```

**Verify:** `npx vitest run` — all new + existing tests pass (target: 201+ tests)

---

## Verification Checklist

### T0 — Chart opacity
- [ ] Create a chart with stand_dimension
- [ ] Click stand on map → chart dims all bars except that stand's bar
- [ ] Click chart bar → map highlights stand with gold outline
- [ ] Click background → all highlights clear, all bars full opacity

### T1 — Tab infrastructure
- [ ] `npx vitest run` — all tests pass (198 existing + new smoke tests)
- [ ] `npm run build` — compiles
- [ ] Three tabs visible: Map, Stands, Operations
- [ ] Map tab active by default, shows map
- [ ] **Map tab uses CSS visibility** — switching away and back is instant (no re-init)
- [ ] Switching tabs works, no console errors
- [ ] Medium/small screen layouts functional

### T2a — Hierarchical Stand List (Tree Table)
- [ ] Stands tab shows all 161 stands
- [ ] Click chevron → species + operations appear indented
- [ ] Click another stand's chevron → first collapses
- [ ] "Show on map" button → switches to Map tab, stand selected
- [ ] **"Show on map" before map loads** → queued, applied when map ready (T1.5)
- [ ] Column sort: click "Area" → sorts by area
- [ ] Dark mode: tree table colors adapt

### T2b — Stand List Filter Bar
- [ ] Filter by species dropdown → only pine/spruce/etc stands shown
- [ ] Filter by age range → ">60" filters correctly
- [ ] Filter by area range → ">2 ha" filters correctly
- [ ] Combined filters: species=pine + age>60 → intersection (AND logic)
- [ ] Active filters show as removable chips
- [ ] **AI filter push → all expanded stands collapse** (filter is a new context)

### T3 — Operation List
- [ ] Operations tab shows all operations
- [ ] Year range filter: 2030-2035 → filters correctly
- [ ] Type filter: select "clear_cut" → only clearcuts
- [ ] Combined filters work (intersection)
- [ ] Active filters show as removable chips
- [ ] "Show on map" button works (including race condition handling)
- [ ] Empty state shows prompt to generate plan

### T4 — Cross-component highlighting
- [ ] Click stand in StandList → map highlights, charts update
- [ ] Click operation in OperationList → map highlights stand, **list row highlights blue** (not chart — see T4.1 rationale)
- [ ] Click bar in chart → map highlights, both lists highlight matching rows
- [ ] Click stand on map → charts update, lists highlight
- [ ] Click map background → all highlights clear
- [ ] Toggle: clicking same stand twice → deselects

### T5 — AI chat integration
- [ ] Ask AI "show me all clear-cuts from 2030-2035" → Operations tab opens with year + type filters applied
- [ ] Ask AI "show me pine stands older than 60 years" → Stands tab opens with species=pine + age>60 filters applied
- [ ] AI responses are brief ("Showing 8 pine stands older than 60 years in the Stands tab")
- [ ] Filters can be cleared manually after AI applies them

### T6 — Tests
- [ ] `npx vitest run` — MainTabBar, StandList, OperationList smoke tests pass
- [ ] No regressions in existing 198 tests

---

## Out of Scope

- URL sync for active tab (e.g., `/forest/123?tab=stands`)
- Bulk selection or batch operations in list views
- CSV/Excel export
- Tab persistence across page reloads
- Operation editing from list views (edit still via chat only)
- Expanding all stands at once ("Expand All" button)
- Custom column visibility toggles
