# ForestChat — Phase 4b: Chart Creation & Auto-Update Rethink

**Status:** Draft v2.1
**Date:** 2026-05-27
**Author:** Systems Architect (via Hermes Agent)

**Changelog v2.1 (2026-05-27):**
- 🔴 C4: Fixed section 2.6.3 body — now describes deferred single-recompute after full AI turn, not per-mutation
- 🟡 S6: Fixed "Phase 6" → "Phase 4b" in migration SQL comment
- 🟡 S7: Fixed comparison table effort from "~13.5h" → "~14h"
- 🟡 S8: Removed duplicate SSE handler code block in section 2.8
- 🟡 S9: Added `recomputeAllCharts()` function specification (signature, location, error handling)
- 🟡 S10: Clarified `clear_charts` tool handler — now deletes directly from DB (not via removed `invalidateChartTabs`); client handler stays

**Changelog v2.0 (2026-05-27):**
- 🔴 C1: Added computed-field handling to chart engine (`removal_m3` = `volume_m3 × removal_pct / 100` — not a DB column)
- 🔴 C2: Updated `create_chart` handler to branch on `query_config` vs `data` (validation must skip `data` check when `query_config` present)
- 🟡 S1: Added `charts_refreshed` to SSE event types in both `sse.ts` (server) and `sse-client.ts`
- 🟡 S2: Deferred `recomputeAllCharts` to after full AI turn (not per-tool-call); single recompute per user message via `needsRecompute` flag
- 🟡 S4: Normalized title from "Phase 6" to "Phase 4b" to match filename
- 🟡 S5: Added database type + ChartTab interface updates to task breakdown (T1b)
- 🟢 M1: Added safety LIMIT (500 rows) to chart engine PostgREST queries
- 🟢 M2: Clarified `recompute_charts` tool as v2 extension (not in v1)
- 🟢 M3: Documented join field prefix mapping (`comp.` → joined table alias)

---

## 1. Problem Statement

### 1.1 Current architecture

```
User: "Create a yearly income bar chart"

  AI calls query_operations()              → fetches data from Supabase
  AI transforms data in-memory             → builds chart-ready JSON array
  AI calls create_chart({ chart_id, data, ... })  → stores static data blob

User: "Move stand 7 clearcut to 2030"

  AI calls remove_operation() + add_operation()
  → invalidateChartTabs() DELETES all chart_tabs from DB
  → Charts disappear from UI

User: "Recreate the yearly income chart"

  AI calls query_operations()              → fetches NEW data
  AI transforms data in-memory AGAIN       → builds chart-ready JSON array
  AI calls create_chart() again

  ⚠️ Second attempt may differ from first (different chart_id, different
     data shape, different color grouping, different data row order)
```

### 1.2 Root causes

| Issue | Why it happens |
|-------|---------------|
| **Charts disappear on edit** | `invalidateChartTabs()` deletes all chart data because the static JSON is now stale |
| **AI must recreate manually** | No automatic recomputation — the AI must repeat the entire fetch+transform pipeline |
| **Inconsistent recreation** | LLM non-determinism means the second chart often looks different (wrong colors, labels, missing data points) |
| **Error-prone** | Complex data transformation in LLM context window is unreliable — data truncation, off-by-ones, wrong aggregations |

### 1.3 Core insight

**Charts should be specified, not computed at AI-time.** The AI should describe *what data* to source, *how to transform it*, and *how to render it* — then a deterministic backend engine executes the data fetching and transformation. This decouples chart persistence from data freshness.

---

## 2. Proposed Architecture: Script-Backed Chart Config

### 2.1 New principle

```
"Chart data is a function of database state."

Instead of storing:      data: [ {year: 2026, income: 100000}, ... ]
Store this instead:      script: "load and transform data for this chart"
                         config: { x_key, y_key, type, title, ... }

On auto-update:          execute script → produce fresh data → update chart_tabs
```

### 2.2 Database changes

**`chart_tabs` table — modified columns:**

```sql
-- NEW: Add query_config (JSONB) + computed_at columns; make data nullable
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS query_config JSONB;
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ;
ALTER TABLE chart_tabs ALTER COLUMN data DROP NOT NULL;
```

> **Note:** We keep `data` as a cache — the UI reads from it directly. The difference is that `data` is now a *computed cache* that gets refreshed on auto-update, not a static blob the AI wrote once.

---

### 2.3 How the chart data is specified: Query Config

Instead of raw SQL or Python scripts, the AI writes a **declarative Query Config** object. The chart engine translates this into safe PostgREST calls — the same Supabase JS client the rest of the codebase uses, with RLS still applying.

#### Why not SQL or Python?

| Option | Problem |
|--------|---------|
| **Raw SQL** | The existing architecture deliberately avoids raw SQL — all DB access goes through the Supabase JS client with RLS. Running AI-generated SQL via a `SECURITY DEFINER` Postgres function creates a bypass of RLS protections. Security mitigations (SELECT-only checks, regex injection filtering) are fragile — a determined prompt can generate SQL that passes regex gates but still extracts unintended data. Additionally, running raw SQL through `supabase.rpc()` adds another moving part that could fail silently. |
| **Python scripts** | The backend is pure Next.js TypeScript on Vercel serverless — it has no Python runtime. Adding Python execution would require a subprocess spawn (unavailable in Vercel serverless), a Python environment (Vercel doesn't ship Python), and a sandbox for arbitrary code execution. This would force a deployment target change (e.g., dedicated VM or Docker). |

#### Query Config — declarative and safe

The AI specifies: *which table, how to group, what to aggregate, optional filters*. The engine builds a standard PostgREST query, fetches the data via the authenticated Supabase client, aggregates it deterministically in JS, and stores the result in `chart_tabs.data`.

```typescript
// What the AI writes:
create_chart({
  chart_id: "chart-yearly-income",
  title: "Yearly Income by Type",
  type: "stacked_bar",
  query_config: {
    source: "operations",                    // which table to query
    aggregate: [
      { group_by: "year" },
      { group_by: "type" },
    ],
    values: [
      { field: "income_eur", as: "income", fn: "sum" }
    ],
  },
  // rendering config (static — never changes on auto-update)
  x_key: "year",
  y_key: "income",
  color_key: "type",
})
```

**What the engine does on auto-update:**

```typescript
// 1. Build a PostgREST query using the authenticated Supabase client:
const data = await supabase
  .from("operations")                          // whitelisted source table
  .select("year, type, income_eur")            // only needed fields
  .eq("forest_id", forestId)                   // scoped to user's forest
  .order("year")                               // deterministic ordering

// 2. Aggregate the raw rows in JS:
//    group_by: ["year", "type"]
//    value: sum(income_eur) as "income"
//    Result: [{ year: 2026, type: "Päätehakkuu", income: 120000 }, ...]

// 3. UPDATE chart_tabs SET data = fresh_result, computed_at = now()
```

#### Supported Query Config schema

```typescript
interface ChartQueryConfig {
  source: "operations" | "compartments" | "plan_metadata";

  // Optional join (limited to pre-defined joinable tables)
  join?: {
    table: "compartments";
    on: "compartment_id";         // FK column on source table
    fields: string[];             // which joined columns to include (prefixed)
  };

  // Aggregation spec
  aggregate: Array<{ group_by: string }>;
  values: Array<{
    field: string;                // column name (or computed, like "removal_m3")
    as: string;                   // output key in the chart data
    fn: "sum" | "count" | "avg" | "min" | "max";
  }>;

  // Optional filters (same patterns as QueryOperationsFilter)
  filters?: Record<string, unknown>;

  // Optional sort / limit
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;                 // max 50 (charts get cluttered beyond this)
}
```

#### Examples

| Chart | source | join | group_by | values |
|-------|--------|------|----------|--------|
| Yearly income by type | `operations` | — | `["year", "type"]` | sum(income_eur) → "income" |
| Yearly harvest volume | `operations` | — | `["year"]` | sum(removal_m3) → "volume" |
| Species area distribution | `compartments` | — | `["main_species"]` | sum(area_ha) → "total_ha" |
| Development class distribution | `compartments` | — | `["development_class"]` | count(*) → "count" |
| Income by tree species | `operations` | compartments on compartment_id | `["comp.main_species"]` | sum(income_eur) → "income" |
| Regeneration costs by year | `operations` | — | `["year"]` | sum(cost_eur) → "cost" |
| Top income stands | `operations` | compartments on compartment_id | `["comp.stand_id"]` | sum(income_eur) → "income" |
| Harvest volume by species | `operations` | compartments on compartment_id | `["comp.main_species"]` | sum(removal_m3) → "volume" |
| Plan totals (single row) | `plan_metadata` | — | none | all fields directly |

#### Computed fields

Several user-facing metric names are NOT database columns — they must be computed in JS from source columns. The engine handles this transparently:

| User-facing field | Source columns | Computation |
|---|---|---|
| `removal_m3` | `volume_m3` (from compartments) + `removal_pct` (from operations) | `volume_m3 × removal_pct / 100` per row, before aggregation |
| `area_ha` | Direct DB column on `compartments` | No computation needed |

**Engine behavior for computed fields:** When the Query Config references a computed field in `values`, the engine silently fetches the source columns (via dynamic `.select()`), computes the synthetic column per raw row, then runs the standard aggregate pipeline. The engine maintains a `COMPUTED_FIELDS` map:

```typescript
// In chart-engine.ts
const COMPUTED_FIELDS: Record<string, { sources: string[]; compute: (row: Record<string, unknown>) => number }> = {
  removal_m3: {
    sources: ["volume_m3", "removal_pct"],
    compute: (row) => ((row.volume_m3 as number) ?? 0) * ((row.removal_pct as number) ?? 0) / 100,
  },
};
```

**How this flows through the engine:**

```
1. Parse Query Config → detect removal_m3 in values
2. Add source columns (volume_m3, removal_pct) to the PostgREST .select()
3. Fetch raw rows from Supabase
4. For each row: row.removal_m3 = COMPUTED_FIELDS["removal_m3"].compute(row)
5. Standard aggregate pipeline (group_by + fn on the now-computed removal_m3)
```

This means a removal_m3 filter (`filters: { removal_m3_min: 30 }`) is applied as a JS post-filter after computation — never as `.gte("removal_m3", 30)` in PostgREST (which would fail).

#### Why this is safe

1. **No raw SQL** — The engine only generates PostgREST queries, the same way the existing query tools do. RLS is never bypassed.
2. **Source tables are whitelisted** — Only `operations`, `compartments`, and `plan_metadata` are allowed. No arbitrary table access.
3. **Join paths are pre-defined** — Not arbitrary SQL JOINs but a known FK relationship (`operations.compartment_id → compartments.id`). The engine knows how to build the Supabase join syntax.
4. **Filters follow the same pattern** as the existing `query_operations` tool — they've already been validated and hardened in production.
5. **No code execution** — No eval, no subprocess, no sandbox needed.
6. **Auth context preserved** — The Supabase client used is the same authenticated client the route handler uses. RLS policies apply to every row fetched.

### 2.4 The chart engine

```typescript
// src/lib/ai/chart-engine.ts
// Deterministic chart data recomputation from declarative query configs.

interface ChartQueryConfig {
  source: "operations" | "compartments" | "plan_metadata";
  join?: { table: "compartments"; on: "compartment_id"; fields: string[] };
  aggregate: Array<{ group_by: string }>;
  values: Array<{ field: string; as: string; fn: "sum" | "count" | "avg" | "min" | "max" }>;
  filters?: Record<string, unknown>;
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
}

/** Map user-facing join prefixes to the actual table alias in PostgREST nested queries. */
const JOIN_PREFIX_MAP: Record<string, string> = {
  "comp": "compartments",  // "comp.main_species" → compartments.main_species
};

interface ChartEngineResult {
  data: Record<string, unknown>[];
  computedAt: string;
}

export async function recomputeChartData(
  supabase: SupabaseClient,
  forestId: string,
  config: ChartQueryConfig
): Promise<ChartEngineResult> {
  // 1. Build PostgREST query from config
  // 2. Resolve computed fields → silently add source columns to .select()
  // 3. Fetch raw rows via authenticated Supabase client (RLS applies), MAX 500 rows
  // 4. Compute synthetic columns per raw row (e.g., removal_m3)
  // 5. Aggregate in JS (group_by + values)
  // 6. Sort + limit
  // 7. Return structured data
}

/**
 * Recompute all query_config-backed chart tabs for a forest.
 * Called once per user message after the AI agent loop completes (if any mutation occurred).
 * Skips legacy charts (those with data but no query_config).
 * Emits "charts_refreshed" SSE event on success.
 * Errors for individual charts are caught and logged — one broken chart doesn't block the rest.
 */
export async function recomputeAllCharts(
  supabase: SupabaseClient,
  forestId: string,
  sendSse?: (event: string, data: unknown) => void
): Promise<void> {
  // 1. SELECT chart_tabs WHERE forest_id = $1 AND query_config IS NOT NULL
  // 2. For each tab:
  //    a. Parse config: ChartQueryConfig = tab.query_config (type-cast from JSONB)
  //    b. Call recomputeChartData(supabase, forestId, config)
  //    c. On success: UPDATE chart_tabs SET data = result.data, computed_at = result.computedAt
  //    d. On error: console.error + continue (skip broken chart, don't block others)
  // 3. Emit "charts_refreshed" SSE with list of recomputed chart_ids
}
```

### 2.5 Auto-update flow (NEW)

```
MUTATION (add_operation, remove_operation, batch_update_operations, generate_plan)
  │
  ├── Execute mutation (existing)
  │
  └── Set needsRecompute flag ← (in route handler, not per-tool)
      
When AI turn completes (all tool calls for this user message processed):
  │
  ├── If needsRecompute is true:
  │    ├── Fetch all chart_tabs for this forest
  │    ├── For each tab with a query_config:
  │    │    ├── recomputeChartData(config) via Supabase client
  │    │    └── UPDATE chart_tabs SET data = fresh_data, computed_at = now()
  │    └── Emit SSE event: "charts_refreshed" { chart_ids: [...] }
  │         → Client refreshes chart data from Supabase
  │
  └── If needsRecompute is false:
       → Charts unchanged (user asked a read-only query)
```

**Why deferred, not per-mutation:** If the AI calls 3 mutation tools in one conversation turn, a per-tool recompute runs 3 times — the first 2 are wasted work. By setting a flag during the tool loop and running once after the full agent loop iteration completes, one user message = one recompute at most. The user sees charts update once, after the AI finishes processing their request.

**Route handler integration:**

```typescript
// In src/app/api/chat/route.ts — updated agent loop

const DATA_MUTATION_TOOLS = new Set([
  "add_operation", "remove_operation", "batch_update_operations", "generate_plan",
]);

let needsRecompute = false;

for (let iteration = 0; iteration < maxIterations; iteration++) {
  // ... tool execution loop (unchanged) ...

  for await (const chunk of streamChat(...)) {
    if (chunk.type === "tool_call") {
      const result = await executeTool(chunk.name, chunk.arguments, ctx);

      // Set flag if any mutation happened — but DON'T recompute yet
      if (result.success && DATA_MUTATION_TOOLS.has(chunk.name)) {
        needsRecompute = true;
      }
      // ... tool_end SSE, toolResults push, etc. ...
    }
  }

  if (toolResults.length === 0) break;
  // ... push results to openRouterMessages ...
}

// After ALL iterations: recompute once if any mutation happened
if (needsRecompute) {
  await recomputeAllCharts(ctx.supabase, ctx.forestId, ctx.sendSse);
}

// ... store final message, send done event ...
```

This replaces the old `invalidateChartTabs(ctx)` call that currently runs per-mutation at route.ts line 178-180.

### 2.6 New/modified tools

#### 2.6.1 `create_chart` — MODIFIED

The existing `create_chart` tool is **extended** — `data` becomes optional when `query_config` is provided. The handler branches on which mode is used:

```typescript
// In tool-executor.ts — create_chart handler (UPDATED)
create_chart: async (args, ctx) => {
  const { chart_id, title, type, query_config, data, x_key, y_key, ...rest } = args;

  if (!chart_id || typeof chart_id !== "string") {
    return { success: false, result: "", error: "chart_id is required" };
  }
  if (!VALID_CHART_TYPES.includes(type as string)) {
    return { success: false, result: "", error: `Invalid chart type: ${type}` };
  }

  // BRANCH: query_config mode (recommended)
  if (query_config) {
    // Compute initial data from the declarative config
    const result = await recomputeChartData(ctx.supabase, ctx.forestId, query_config as ChartQueryConfig);
    
    const chartTab = {
      id: chart_id as string,
      title: title as string,
      type: type as string,
      data: result.data,
      query_config,  // stored for future recomputes
      xKey: (x_key as string) ?? null,
      yKey: y_key as string,
      yKey2: (rest.y_key2 as string) ?? null,
      nameKey: (rest.name_key as string) ?? null,
      colorKey: (rest.color_key as string) ?? null,
      standDimension: (rest.stand_dimension as string) ?? null,
    };

    await ctx.supabase.from("chart_tabs").upsert({
      forest_id: ctx.forestId,
      chart_id: chartTab.id,
      title: chartTab.title,
      type: chartTab.type,
      data: chartTab.data,
      query_config: chartTab.query_config,
      computed_at: new Date().toISOString(),
      x_key: chartTab.xKey,
      y_key: chartTab.yKey,
      ...rest,
    }, { onConflict: "forest_id, chart_id" });

    ctx.sendSse?.("create_chart", chartTab);
    return {
      success: true,
      result: `✅ Chart "${title}" created (${type}, ${result.data.length} data points). Auto-updates when plan changes.`,
    };
  }

  // BRANCH: legacy static data mode
  if (!Array.isArray(data) || data.length === 0) {
    return { success: false, result: "", error: "data must be a non-empty array" };
  }

  const chartTab = {
    id: chart_id as string,
    title: title as string,
    type: type as string,
    data: data as Record<string, unknown>[],
    xKey: (x_key as string) ?? null,
    yKey: y_key as string,
    yKey2: (rest.y_key2 as string) ?? null,
    nameKey: (rest.name_key as string) ?? null,
    colorKey: (rest.color_key as string) ?? null,
    standDimension: (rest.stand_dimension as string) ?? null,
  };

  await ctx.supabase.from("chart_tabs").upsert({
    forest_id: ctx.forestId,
    chart_id: chartTab.id,
    title: chartTab.title,
    type: chartTab.type,
    data: chartTab.data,
    x_key: chartTab.xKey,
    y_key: chartTab.yKey,
    ...rest,
  }, { onConflict: "forest_id, chart_id" });

  ctx.sendSse?.("create_chart", chartTab);
  return {
    success: true,
    result: `✅ Chart "${title}" created (${type}, ${data.length} data points). The chart is now visible in the visualization panel.`,
  };
},
```

#### 2.6.2 `recompute_charts` — NEW (future extension, not in v1)

> **Note:** This tool is deferred to a future release. In v1, charts recompute automatically via the `needsRecompute` flag in the route handler. The AI can also call `clear_charts` + `create_chart` with new query_configs if the user explicitly asks to refresh. A dedicated `recompute_charts` tool is a convenience addition for v2.

```typescript
{
  name: "recompute_charts",
  description: `Force recompute all script-backed charts for the current forest. 
  Use when the user explicitly asks to refresh charts or after a data import.`,
  parameters: { type: "object", properties: {} }
}
```

#### 2.6.3 `invalidateChartTabs` — REPLACED

The old pattern (delete all chart_tabs on every mutation) is replaced by deferred auto-recomputation. Instead of nuking charts per-mutation, the route handler sets a `needsRecompute` flag during the tool loop and calls `recomputeAllCharts()` **once** after the full AI turn completes (see section 2.5). This means:

1. Charts are never deleted — they stay visible and update in-place
2. One recompute per user message regardless of how many mutations ran
3. Charts with `query_config` get fresh data; legacy charts (static data, no `query_config`) are skipped

`invalidateChartTabs` is removed from `tool-executor.ts` entirely. The `clear_charts` tool handler (which previously called it) is rewritten to delete chart_tabs directly from the DB and emit `clear_charts` SSE — the user-facing "clear all my charts" use case is preserved.

### 2.7 System prompt changes

Add to the system prompt instructions for when the AI creates charts:

```
When creating charts:
- ALWAYS use query_config-based charts so they auto-update when the plan changes.
- The query_config tells the backend what data to fetch and how to aggregate it.
- Available sources: operations (planned harvests), compartments (stand data), plan_metadata.
- Common query_config templates:
  - Yearly income by type:
    { source: "operations", aggregate: [{ group_by: "year" }, { group_by: "type" }],
      values: [{ field: "income_eur", as: "income", fn: "sum" }] }
  - Yearly harvest volume:
    { source: "operations", aggregate: [{ group_by: "year" }],
      values: [{ field: "removal_m3", as: "volume", fn: "sum" }] }
  - Species area distribution:
    { source: "compartments", aggregate: [{ group_by: "main_species" }],
      values: [{ field: "area_ha", as: "total_ha", fn: "sum" }] }
  - Income by tree species (with join):
    { source: "operations", join: { table: "compartments", on: "compartment_id", fields: ["main_species"] },
      aggregate: [{ group_by: "comp.main_species" }],
      values: [{ field: "income_eur", as: "income", fn: "sum" }] }
  - Regeneration costs by year:
    { source: "operations", aggregate: [{ group_by: "year" }],
      values: [{ field: "cost_eur", as: "cost", fn: "sum" }],
      filters: { types: ["Laikkumätästys", "Istutus", "Kuusen istutus", "Männyn istutus"] } }
- The chart's data will recompute automatically when the plan changes.
- Only use static data (no query_config) for charts that should NOT auto-update.
```

### 2.8 Frontend changes

#### SSE type updates (server + client)

**Server** (`src/lib/chat/sse.ts`): Add `"charts_refreshed"` to the SseEvent union:

```typescript
export interface SseEvent {
  event:
    | "chunk" | "tool_start" | "tool_end" | "done" | "error"
    | "select_stand" | "create_chart" | "remove_chart" | "clear_charts"
    | "charts_refreshed";  // ← NEW
  data: {
    // ... existing fields ...
    chart_ids?: string[];  // ← NEW: list of recomputed chart IDs
    [key: string]: unknown;
  };
}
```

**Client** (`src/lib/chat/sse-client.ts`): Add `charts_refreshed` to the SseEventType union and the parser switch:

```typescript
export type SseEventType = "chunk" | "tool_start" | "tool_end" | "done" | "error"
  | "select_stand" | "create_chart" | "remove_chart" | "clear_charts"
  | "charts_refreshed";  // ← NEW

// In SSE parser switch:
case "charts_refreshed":
  // Re-fetch chart tabs from Supabase to get recomputed data
  const { data: freshCharts } = await supabase
    .from("chart_tabs")
    .select("*")
    .eq("forest_id", forestId);
  setChartTabs(freshCharts);
  break;
```

#### SSE handler

The `charts_refreshed` handler is shown in the client code above. When received, the client re-fetches all chart tabs from Supabase — the recomputed data is already in the DB by the time this event fires (recomputation happens server-side before the event is emitted).

#### Chart card rendering

No changes needed — ChartCard already reads from `tab.data` which is now the recomputed data.

---

## 3. Implementation Plan

### 3.1 Task breakdown

|| # | Task | Files | Est. | Status |
||---|------|-------|------|--------|
|| **T1** | **Database migration** — Add `query_config` (JSONB), `computed_at` (TIMESTAMPTZ) columns to `chart_tabs`; make `data` nullable | `supabase/migrations/006_add_chart_query_config.sql` | 1h | ✅ 2026-05-27 |
|| **T1b** | **Type updates** — Add `query_config` and `computed_at` to `ChartTab` interface in Zustand visualization-slice; add `ChartQueryConfig` type to `src/types/database.ts`; add `ChartTab` interface fields for the new columns in the chart API types | `src/types/database.ts`, `src/lib/store.ts` (visualization slice) | 0.5h | ✅ 2026-05-27 |
|| **T2** | **Chart engine module** — `recomputeChartData()` that translates Query Config into PostgREST queries (with 500-row safety LIMIT), handles computed fields (`removal_m3` = `volume_m3 × removal_pct / 100`), fetches data via authenticated Supabase client, aggregates in JS, and returns structured data | `src/lib/ai/chart-engine.ts` | 3h | ✅ 2026-05-27 |
|| **T3** | **Modify tool definitions** — Update `create_chart` tool schema to accept `query_config` as alternative to `data` with `oneOf` validation | `src/lib/chat/tools.ts` | 1h | ✅ 2026-05-27 |
|| **T4** | **Modify tool executor** — Update `create_chart` handler to branch on `query_config` vs `data`; `query_config` mode calls `recomputeChartData()` for initial data and stores config in DB; legacy mode unchanged. Update `clear_charts` handler to delete chart_tabs directly from DB + emit `clear_charts` SSE (no longer calls `invalidateChartTabs` which is removed in T5) | `src/lib/chat/tool-executor.ts` | 2h | ✅ 2026-05-27 |
|| **T5** | **Auto-update logic** — Replace per-mutation `invalidateChartTabs()` with deferred `recomputeAllCharts()`: add `needsRecompute` flag in route handler, set it when mutation tools succeed, call `recomputeAllCharts()` once after the full agent loop iteration (not per tool call). Remove old `invalidateChartTabs` import and call site | `src/lib/ai/chart-engine.ts`, `src/lib/chat/tool-executor.ts`, `src/app/api/chat/route.ts` | 2h | ✅ 2026-05-27 |
|| **T6** | **Frontend SSE** — Add `charts_refreshed` to `SseEvent` union in `sse.ts` (server) and `SseEventType` in `sse-client.ts` (client); handle `charts_refreshed` event in SSE parser; keep existing `clear_charts` handler (user-facing tool, not auto-called on mutation anymore); add `onChartsRefreshed` callback to `SseCallbacks` | `src/lib/chat/sse.ts`, `src/lib/chat/sse-client.ts` | 1h | ✅ 2026-05-27 |
|| **T7** | **System prompt update** — Add Query Config chart-creation instructions with examples | `src/lib/chat/system-prompt.ts` | 0.5h | ✅ 2026-05-27 |
|| **T8** | **Tests** — `chart-engine.test.ts` for each Query Config variant (including computed field `removal_m3`); update `chart-tools.test.ts` for config-based creation (both query_config and legacy data modes); `recomputeAllCharts.test.ts` | `src/lib/ai/__tests__/chart-engine.test.ts`, update existing | 3h | ✅ 2026-06-03 |

**Total: ~14h**

### 3.2 Migration SQL

```sql
-- 006_add_chart_query_config.sql
-- ForestChat Phase 4b: Chart auto-update via declarative query configs

-- 1. Add query_config and computed_at columns; make data nullable
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS query_config JSONB;
ALTER TABLE chart_tabs ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ;
ALTER TABLE chart_tabs ALTER COLUMN data DROP NOT NULL;

-- 2. (Optional) Add an index for fast lookup of charts needing recompute
CREATE INDEX IF NOT EXISTS idx_chart_tabs_query_config
  ON chart_tabs(forest_id) WHERE query_config IS NOT NULL;
```

### 3.3 Key design decisions

| Decision | Rationale |
|----------|-----------|
| **Query Config over SQL/Python** | SQL would bypass RLS (needs a `SECURITY DEFINER` function with regex injection guards — fragile). Python is impossible in Vercel serverless. Query Config builds safe PostgREST queries through the authenticated Supabase client — no new attack surface. |
| **Inline JSON in `query_config` column** over file storage | Atomic with chart_tabs row, no file sync issues, easy backup/migration |
| **JS-side aggregation** over DB-side | PostgREST doesn't support SQL GROUP BY; we fetch raw rows and aggregate in JS. For typical forest data (<1000 rows per chart), this is instant. |
| **Recompute all on mutation** over lazy recompute | Simpler mental model: charts are always up-to-date. If a forest has many charts (>20), we can later optimize with selective recompute. |
| **Keep `data` as cache** | The UI already reads `data` directly. Changing the entire rendering pipeline would be riskier. We just recompute the data. |
| **Whitelisted source tables** | Only `operations`, `compartments`, and `plan_metadata` are valid sources — prevents the AI from querying auth tables or internal schemas through creative configs. |
| **Pre-defined join paths** | Only one join relationship (`operations.compartment_id → compartments`) is supported — the exact same JOIN the existing `query_operations` tool uses. No arbitrary joins. |

---

## 4. Future Extensions (Not in v1)

| Feature | When | Effort |
|---------|------|--------|
| Python script support | If a future chart type genuinely needs multi-step transforms (e.g., running growth simulation, Monte Carlo) | Would require deploying a Python microservice outside Vercel |
| Selective recompute | When a forest has 50+ charts and full recompute is slow | 2h (track which charts depend on which tables) |
| Run chart engine in a transaction | Ensure all chart data updates atomically with the mutation | 1h (wrap mutation + recompute in a Supabase RPC) |
| Chart description from AI | AI describes chart intent in natural language → backend auto-generates Query Config | Hard (LLM-generated structured data is unreliable) |
| New aggregation functions | percentile, median, variance | 1h (add to the fn enum in chart-engine.ts) |
| Edit chart config tool | User asks "change this chart to a pie chart" without recreating | 1h (update query_config/type fields in chart_tabs) |

---

## 5. Comparison: Current vs Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Chart data source** | Static JSON blob written by AI into `data` column | Declarative `query_config` stored in DB; `data` is recomputed cache |
| **Auto-update behavior** | Delete all `chart_tabs` rows → charts disappear → user asks AI to recreate | Recompute `data` column from `query_config` → charts refresh in-place |
| **Consistency** | Varies each time AI recreates (different IDs, colors, data shapes, missing rows) | Deterministic — same Query Config always produces same structure |
| **AI workload** | Must fetch data via `query_operations()` + transform in-memory + call `create_chart(data)` (3-5 tool calls per chart) | Writes one Query Config + calls `create_chart(query_config)` (2 tool calls) |
| **Error rate** | High — LLM hallucinations: wrong aggregations, data truncation, missing categories, off-by-ones | None — the JS aggregation engine is deterministic and correct |
| **Security** | Low risk (static data only) | No new risk — same Supabase JS client + RLS as existing tools |
| **Implementation effort** | Already done | ~14h |
