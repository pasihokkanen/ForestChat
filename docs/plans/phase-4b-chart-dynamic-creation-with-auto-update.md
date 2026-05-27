# ForestChat — Phase 6: Chart Creation & Auto-Update Rethink

**Status:** Draft v1.0
**Date:** 2026-05-27
**Author:** Systems Architect (via Hermes Agent)

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
  // 2. Fetch raw rows via authenticated Supabase client (RLS applies)
  // 3. Aggregate in JS (group_by + values)
  // 4. Sort + limit
  // 5. Return structured data
}
```

### 2.5 Auto-update flow (NEW)

```
MUTATION (add_operation, remove_operation, batch_update_operations, generate_plan)
  │
  ├── Execute mutation (existing)
  │
  └── On success:
       │
       ├── Fetch all chart_tabs for this forest
       │
       ├── For each tab with a query_config:
       │    ├── recomputeChartData(config) via Supabase client
       │    └── UPDATE chart_tabs SET data = fresh_data, computed_at = now()
       │
       └── Emit SSE event: "charts_refreshed" { chart_ids: [...] }
            → Client refreshes chart data from Supabase
```

This happens **server-side, in the background**, as part of the mutation handler. The AI doesn't need to know about it. The user sees chart data update in-place — no deletion, no recreation.

### 2.6 New/modified tools

#### 2.6.1 `create_chart` — MODIFIED

The existing `create_chart` tool is **extended** — `data` becomes optional when `query_config` is provided:

```typescript
{
  name: "create_chart",
  description: `Create a new chart tab. Two modes:
  
  A) Query-config based (recommended): Provide a query_config — the backend will
     fetch data from the database and recompute it automatically when the plan changes.
     Supported sources: operations, compartments, plan_metadata.
  
  B) Static data (legacy): Provide data directly as a JSON array.
     Charts created this way will NOT auto-update when the plan changes.`,
  parameters: {
    type: "object",
    properties: {
      chart_id:          { type: "string", description: "Unique ID, e.g. 'chart-yearly-income'" },
      title:             { type: "string", description: "Chart title" },
      type:              { type: "string", enum: [...] },
      query_config: {
        type: "object",
        description: `Declarative query spec for auto-updating charts.
        Example: { source: "operations", aggregate: [{ group_by: "year" },
        { group_by: "type" }], values: [{ field: "income_eur", as: "income", fn: "sum" }] }`,
        properties: {
          source: { type: "string", enum: ["operations", "compartments", "plan_metadata"] },
          aggregate: { type: "array", items: { type: "object", properties: { group_by: { type: "string" } } } },
          values: { type: "array", items: { type: "object", properties: {
            field: { type: "string" }, as: { type: "string" }, fn: { type: "string", enum: ["sum", "count", "avg", "min", "max"] }
          }}},
          join: { type: "object" },
          filters: { type: "object" },
          sort: { type: "object" },
          limit: { type: "number" },
        },
      },
      // Legacy static data (alternative to query_config)
      data:              { type: "array", items: { type: "object" }, description: "Static data (legacy — use query_config instead)" },
      x_key:             { type: "string" },
      y_key:             { type: "string" },
      y_key2:            { type: "string" },
      name_key:          { type: "string" },
      color_key:         { type: "string" },
      stand_dimension:   { type: "string" },
    },
    // Require EITHER query_config OR data
    oneOf: [
      { required: ["chart_id", "title", "type", "query_config", "y_key"] },
      { required: ["chart_id", "title", "type", "data", "y_key"] },
    ],
  }
}
```

#### 2.6.2 `recompute_charts` — NEW (optional)

```typescript
{
  name: "recompute_charts",
  description: `Force recompute all script-backed charts for the current forest. 
  Use when the user explicitly asks to refresh charts or after a data import.`,
  parameters: { type: "object", properties: {} }
}
```

#### 2.6.3 `invalidateChartTabs` — REPLACED

No more nuking charts on mutation. Instead, after every successful mutation, the route calls `recomputeAllCharts(ctx)` which:

1. Fetches all chart_tabs with a `query_config` for this forest
2. Runs `recomputeChartData()` on each one using the authenticated Supabase client
3. Updates `chart_tabs.data` and `computed_at` in the DB
4. Emits `charts_refreshed` SSE event to the client

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

#### SSE handler

Replace `clear_charts` event handling with `charts_refreshed`:

```typescript
// sse-client.ts — NEW event
case "charts_refreshed":
  // Re-fetch chart tabs from Supabase (or trust the updated data from SSE)
  const { data: freshCharts } = await supabase
    .from("chart_tabs")
    .select("*")
    .eq("forest_id", forestId);
  setChartTabs(freshCharts);
  break;
```

#### Chart card rendering

No changes needed — ChartCard already reads from `tab.data` which is now the recomputed data.

---

## 3. Implementation Plan

### 3.1 Task breakdown

| # | Task | Files | Est. |
|---|------|-------|------|
| **T1** | **Database migration** — Add `query_config` (JSONB), `computed_at` (TIMESTAMPTZ) columns to `chart_tabs`; make `data` nullable | `supabase/migrations/006_add_chart_query_config.sql` | 1h |
| **T2** | **Chart engine module** — `recomputeChartData()` that translates Query Config into PostgREST queries, fetches data via authenticated Supabase client, aggregates in JS, and returns structured data | `src/lib/ai/chart-engine.ts` | 3h |
| **T3** | **Modify tool definitions** — Update `create_chart` tool schema to accept `query_config` as alternative to `data` with `oneOf` validation | `src/lib/chat/tools.ts` | 1h |
| **T4** | **Modify tool executor** — Update `create_chart` handler to store `query_config` + config in `chart_tabs`, run initial `recomputeChartData()`, emit SSE event | `src/lib/chat/tool-executor.ts` | 2h |
| **T5** | **Auto-update logic** — Replace `invalidateChartTabs()` with `recomputeAllCharts()` that loops through chart_tabs with `query_config`, runs `recomputeChartData()` on each, updates `data` and `computed_at` | `src/lib/ai/chart-engine.ts`, `src/lib/chat/tool-executor.ts`, `src/app/api/chat/route.ts` | 2h |
| **T6** | **Frontend SSE** — Handle `charts_refreshed` event; update `sse.ts` type union | `src/lib/chat/sse.ts`, `src/lib/chat/sse-client.ts` | 1h |
| **T7** | **System prompt update** — Add Query Config chart-creation instructions with examples | `src/lib/chat/system-prompt.ts` | 0.5h |
| **T8** | **Tests** — `chart-engine.test.ts` for each Query Config variant; update `chart-tools.test.ts` for config-based creation; `recomputeAllCharts.test.ts` | `src/lib/ai/__tests__/chart-engine.test.ts`, update existing | 3h |

**Total: ~13.5h**

### 3.2 Migration SQL

```sql
-- 006_add_chart_query_config.sql
-- ForestChat Phase 6: Chart auto-update via declarative query configs

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
| **Implementation effort** | Already done | ~13.5h |
