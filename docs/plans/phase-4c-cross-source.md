# Phase 4c: Cross-Source Chart Queries

**Status:** Planned  
**Date:** 2026-05-31  
**Depends on:** Phase 4b (chart engine, query_config mode)

---

## Problem

The current chart engine supports only single-source queries (`source: "operations" | "compartments" | "compartment_species"`), with an optional one-way JOIN (`source → compartments`). This prevents charts that need data from multiple independent sources, such as:

1. **Species distribution filtered by compartment attributes** — e.g., "species distribution in regeneration-ready stands". Requires `compartment_species` data filtered by `compartments.development_class`. The JOIN exists (`compartment_id`) but filters don't resolve join-prefixed keys.

2. **Yearly growth + removal combined** — e.g., "waterfall showing yearly m³ of growth and removal". Growth (`compartments.growth_m3_per_ha × area_ha`) is a compartment-level constant; removal (`operations.removal_m3`) is year-keyed. Different tables, different granularities.

3. **Cumulative growth and removal as two lines** — same data as #2, rendered as a line chart.

---

## Design: `source: "cross"`

New query mode that runs N independent sub-queries, then merges their results on a common key.

### Type definitions

```ts
/** Cross-source query: runs sub-queries independently, merges on a common key. */
interface CrossQueryConfig {
  source: "cross";
  merge_on: string;
  merge_strategy?: "outer" | "inner";  // default: "outer"
  queries: SubQueryConfig[];
  sort?: { by: string; dir?: "asc" | "desc" };
}

/** A sub-query within a cross query. Same as ChartQueryConfig but without
 *  top-level sort (sorting happens after merge). */
interface SubQueryConfig {
  source: "operations" | "compartments" | "compartment_species";
  join?: {
    table: "compartments";
    on: "compartment_id";
    fields: string[];
  };
  aggregate: Array<{ group_by: string }>;
  values: Array<{
    field: string;
    as: string;
    fn: "sum" | "count" | "avg" | "min" | "max";
    multiply?: number;
    cumulative?: boolean;
  }>;
  filters?: Record<string, unknown>;
  limit?: number;
  /** If true, the sub-query produces a single row that broadcasts to ALL
   *  merge keys. Use for constants like total annual growth. */
  broadcast?: boolean;
}
```

### Pipeline

```
                     ┌──────────────────┐
                     │  CrossQueryConfig │
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        recomputeSubQ1  recomputeSubQ2  recomputeSubQ3
        (pipeline w/o    (pipeline w/o    (pipeline w/o
         cumulative)      cumulative)      cumulative)
              │               │               │
              ▼               ▼               ▼
         rows_q1[]       rows_q2[]       rows_q3[]
              │               │               │
              └───────────────┼───────────────┘
                              │
                     extractMergeKeys()
                    (collect all unique
                     merge_on values)
                              │
                              ▼
                       mergeResults()
                    (outer/inner merge
                     on merge_on key)
                              │
                              ▼
                       fillMergeGaps()
                    (year gaps if merge_on
                     is "year"; no-op
                     for other keys)
                              │
                              ▼
                     applyCumulative()
                    (post-merge, using
                     original sub-query
                     cumulative flags)
                              │
                              ▼
                         sort()
                    (by merge_on or
                     config.sort)
                              │
                              ▼
                     ChartEngineResult
```

**Important:** Sub-queries run through the existing `recomputeChartData` pipeline but with cumulative **stripped** from their value entries. Cumulative is deferred to post-merge because the rows haven't been aligned yet — cumulating independently would produce incorrect totals. The original cumulative flags are saved and applied after the merge step.

### Merge semantics

| Strategy | Behavior |
|----------|----------|
| `outer` (default) | Include all merge keys from all sub-queries. Missing values = `0`. |
| `inner` | Only include merge keys present in ALL sub-queries. |

**Broadcast:** When `broadcast: true`, the sub-query's result (must be a single row) is broadcast to every merge key collected from other sub-queries. Use for constants like total annual growth (same every year).

**Field naming:** Sub-queries must use distinct `as` names across the cross query. If two sub-queries produce the same output column name, the merge result is undefined (last writer wins).

### New computed field: `growth_m3_total`

For compartments source, computes total annual growth in m³:

```ts
growth_m3_total: {
  sources: ["growth_m3_per_ha", "area_ha"],
  sourceTables: { growth_m3_per_ha: "source", area_ha: "source" },
  compute: (row) =>
    ((row.growth_m3_per_ha as number) ?? 0) * ((row.area_ha as number) ?? 0),
}
```

---

## Example: Species in regeneration-ready stands

```json
{
  "chart_id": "chart-species-regen",
  "title": "Species in Regeneration-Ready Stands",
  "type": "pie",
  "query_config": {
    "source": "compartment_species",
    "join": {
      "table": "compartments",
      "on": "compartment_id",
      "fields": ["development_class"]
    },
    "filters": {
      "comp.development_class": "regeneration_ready"
    },
    "aggregate": [{ "group_by": "species" }],
    "values": [{ "field": "area_ha", "as": "total_ha", "fn": "sum" }]
  },
  "name_key": "species",
  "y_key": "total_ha"
}
```

**Note:** This uses the existing single-source pipeline — just needs join-prefixed filter resolution (see Phase 4c.1 below).

---

## Example: Yearly growth + removal (waterfall)

```json
{
  "chart_id": "chart-growth-removal-waterfall",
  "title": "Yearly Growth and Removal (m³)",
  "type": "waterfall",
  "query_config": {
    "source": "cross",
    "merge_on": "year",
    "merge_strategy": "outer",
    "queries": [
      {
        "source": "operations",
        "join": {
          "table": "compartments",
          "on": "compartment_id",
          "fields": ["volume_m3"]
        },
        "aggregate": [{ "group_by": "year" }],
        "values": [{ "field": "removal_m3", "as": "removal", "fn": "sum" }],
        "filters": { "type": ["clear_cut", "thinning", "first_thinning", "selection_cutting"] }
      },
      {
        "source": "compartments",
        "aggregate": [],
        "values": [{ "field": "growth_m3_total", "as": "growth", "fn": "sum" }],
        "broadcast": true
      }
    ],
    "sort": { "by": "year" }
  },
  "x_key": "year",
  "y_key": "removal"
}
```

**Result:** Each row has `{ year, removal, growth }`. Growth is the same constant per year (broadcast). The waterfall can show growth as positive bars and removal as negative.

> **Note:** The waterfall chart component currently supports a single `y_key` value. To render both growth (+) and removal (−) in a single waterfall, the chart component needs multi-value waterfall support. This is a rendering concern — the cross-source pipeline correctly produces the data. A follow-up task (Phase 4c.5) should extend the waterfall component. Until then, growth + removal combined charts can use `stacked_bar` or `line` types which already support dual values via `y_key` + `y_key2`.

---

## Example: Cumulative growth + removal (line chart)

```json
{
  "chart_id": "chart-cumulative-growth-removal",
  "title": "Cumulative Growth and Removal (m³)",
  "type": "line",
  "query_config": {
    "source": "cross",
    "merge_on": "year",
    "merge_strategy": "outer",
    "queries": [
      {
        "source": "operations",
        "join": {
          "table": "compartments",
          "on": "compartment_id",
          "fields": ["volume_m3"]
        },
        "aggregate": [{ "group_by": "year" }],
        "values": [{ "field": "removal_m3", "as": "removal", "fn": "sum", "cumulative": true }],
        "filters": { "type": ["clear_cut", "thinning", "first_thinning", "selection_cutting"] }
      },
      {
        "source": "compartments",
        "aggregate": [],
        "values": [{ "field": "growth_m3_total", "as": "growth", "fn": "sum", "cumulative": true }],
        "broadcast": true
      }
    ],
    "sort": { "by": "year" }
  },
  "x_key": "year",
  "y_key": "removal",
  "y_key2": "growth"
}
```

---

## Implementation Plan

### Phase 4c.1: Join-prefixed filter resolution (~30 min)

**⚠️ Feasibility:** Supabase JS client's `.eq()` operates on the base table's columns. Filtering on an embedded/joined table's column (`compartments.development_class`) may require PostgREST's embedded resource filter syntax (`.filter("compartments.development_class", "eq", ...)`) instead of standard `.eq()`. This needs a spike during implementation to determine which API works.

**Fallback if `.eq()` doesn't work:** Use cross-source mode for this case — query 1 gets compartment IDs from `compartments` filtered by `development_class`, query 2 filters `compartment_species` by those IDs.

**File:** `src/lib/ai/chart-engine.ts`

- Modify `buildQuery()` filters loop to resolve join-prefixed filter keys
- `"comp.development_class"` → `compartments(development_class)` in Supabase `.eq()`/`.in()` calls (or use `.filter()` if `.eq()` doesn't support embedded resources)
- Reuse existing `resolveJoinField()` helper
- This enables `compartment_species` → `compartments` filtering without cross-source mode

**File:** `src/lib/chat/system-prompt.ts`

- Replace `main_species` templates (lines 95–97, 110–112) with `compartment_species` + join patterns
- Add mandatory rule: "For species distribution, always use `compartment_species` source unless user asks for 'main species' or 'dominant species'"
- Add template: filtered compartment_species by dev_class using join

### Phase 4c.2: `growth_m3_total` computed field (~15 min)

**File:** `src/lib/ai/chart-engine.ts`

- Add to `COMPUTED_FIELDS`: `growth_m3_total = growth_m3_per_ha × area_ha`
- Add `growth_m3_per_ha` and `area_ha` to `FIELD_ALIASES` if not already present

### Phase 4c.3: Cross-source pipeline (~2 hr)

**File:** `src/lib/ai/chart-engine.ts`

1. **Types** — Add `CrossQueryConfig`, `SubQueryConfig` interfaces
2. **`recomputeSubQuery()`** — Run a single sub-query through the existing pipeline. Extracted from `recomputeChartData()` as a reusable function. Accepts a `skipCumulative: boolean` parameter — when true, strips cumulative flags from value entries before running, so cumulative is deferred to the cross-pipeline post-merge step.
3. **`extractMergeKeys()`** — Collect unique `merge_on` values from all sub-query results
4. **`mergeResults()`** — For each merge key, combine matching rows from all sub-queries. Handle broadcast rows. **Error handling:** if any sub-query fails, fail the entire cross query — bubble up the first error (partial results would produce silently broken charts).
5. **`fillMergeGaps()`** — For outer merge, zero-fill missing values. When `merge_on === "year"`, uses the existing `fillYearGaps` logic to fill all integer years between min and max. For non-year merge keys, only fills merge keys present in the union of sub-queries (no synthetic keys).
6. **`applyCrossCumulative()`** — After merge, re-reads the original sub-query cumulative flags and applies `applyCumulative` to the merged rows. Cumulative must happen post-merge because rows from different sub-queries need to be aligned by merge key first.
7. **`recomputeCrossData()`** — Orchestrator: run sub-queries (with cumulative stripped) → extract keys → merge → fill gaps → apply cumulative from saved flags → sort
8. **Modify `recomputeChartData()`** — `if (config.source === "cross")` → delegate to `recomputeCrossData()`
9. **Update `recomputeAllCharts()`** — The `query_config` JSONB column may contain either `ChartQueryConfig` or `CrossQueryConfig`. Widen the type to `ChartQueryConfig | CrossQueryConfig` and use `config.source` as discriminator.

**File:** `src/lib/ai/__tests__/chart-engine.test.ts` (new)

- Test cross-merge with two sub-queries on the same key
- Test broadcast semantics
- Test outer vs inner merge
- Test cumulative after merge
- Test growth_m3_total computed field

### Phase 4c.4: System prompt updates (~30 min)

**File:** `src/lib/chat/system-prompt.ts`

- Add cross-source templates (growth+removal waterfall, cumulative growth+removal line)
- Update schema docs to mention `compartment_species` join capability
- Add `growth_m3_total` to computed fields section

---

## Migration

No DB migration needed. Existing single-source charts continue to work unchanged. The `source: "cross"` mode is additive.

---

## Risk: Model correctly using cross-source

Cross-source queries have more moving parts (N sub-queries, merge semantics, broadcast). The model may struggle to compose these correctly. Mitigations:
- Provide exact copy-paste templates in the system prompt (same pattern as existing templates)
- Keep the `detectChartIntent` fallback in `route.ts` for simpler queries; cross-source is for explicit user requests
- The `create_chart` tool description in `tools.ts` already has comprehensive docs — extend with cross-source section

---

## File manifest

| File | Change |
|------|--------|
| `src/lib/ai/chart-engine.ts` | Phase 4c.1–4c.3: join-prefixed filters, growth_m3_total, cross pipeline |
| `src/lib/ai/__tests__/chart-engine.test.ts` | Phase 4c.3: cross-source tests (new) |
| `src/lib/chat/system-prompt.ts` | Phase 4c.1 + 4c.4: updated templates and rules |
| `src/lib/chat/tools.ts` | Phase 4c.4: cross-source section in create_chart description |
