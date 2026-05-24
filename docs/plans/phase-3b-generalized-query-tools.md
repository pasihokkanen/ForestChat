# ForestChat — Phase 3b: Generalized Query & Batch Edit Tools

> **For Hermes:** Load subagent-driven-development skill before implementing. Use OpenCode CLI for coding subagents. Update this plan file to mark tasks as ✅ upon completion.

**Goal:** Fix the root cause of AI agent looping by replacing the narrow `year_operations` tool with a general-purpose `query_operations` tool, upgrading `search_stands` with the same flexible filter pattern, and adding `batch_update_operations` for bulk mutations. All three tools share a common filter idiom and support selective field return for token efficiency.

**Problem summary:** The current `year_operations` tool has two critical flaws:
1. It does **not return stand IDs** in its output (operations table stores `compartment_id` UUID, not `stand_id`) — the AI cannot see *which* stands are affected
2. It only queries a **single year** — the AI must call it repeatedly to see a range
3. Each of `add_operation` and `remove_operation` works on **one stand at a time** — moving 5 operations from 2026→2028 requires 10+ tool calls

Without stand IDs, the AI resorts to calling `get_stand` in a loop (O(n) queries for n stands), which is catastrophic for large properties (500+ stands).

**Solution:** Replace the narrow per-year tool with a general `query_operations` that accepts any combination of filters (years, types, stand IDs, species, income range, removal volume range, etc.) and returns operations JOINed with stand data — including stand IDs — in a single call. Add `batch_update_operations` to apply transformations in one transactional call. Upgrade `search_stands` with the same filter pattern and optional field control.

**Architecture:** Phase 3b modifies three files and adds one new file:
- Rewrite: `src/lib/ai/query-tools.ts` (T8.1 — expand search_stands, add query_operations, remove year_operations)
- Rewrite: `src/lib/ai/edit-tools.ts` (T8.2 — add batch_update_operations, keep add_operation and remove_operation)
- Rewrite: `src/lib/chat/tools.ts` (T8.4 — update tool definitions, remove year_operations, add query_operations and batch_update_operations)
- Update: `src/lib/ai/validation-tools.ts` (T8.3 — minor: ensure validators use the same JOIN pattern, no functional change)

**Estimated total effort:** 4-5 hours

**Prerequisites:**
- ✅ Phase 3a complete: existing T8.1 (query-tools.ts), T8.2 (edit-tools.ts), T8.3 (validation-tools.ts), T8.4 (tools.ts)
- ✅ Operations and compartments tables in Supabase with foreign key via `compartment_id`
- ✅ RLS policies active on both tables

---

## Tasks

### T8.1b — Upgrade `query-tools.ts`: expand search_stands, add query_operations, remove year_operations (1.5h)

**Objective:** Rewrite `src/lib/ai/query-tools.ts` to:
1. Upgrade `search_stands` with comprehensive filters + `fields` parameter
2. Replace `yearOperations` with `queryOperations` — general operation query with JOIN to compartments
3. Keep `getStand` and `planSummary` as-is (they work correctly for their niche)

**File:** `src/lib/ai/query-tools.ts`

#### 1a. Upgrade `searchStands`

**New signature:**

```typescript
export interface SearchStandsFilter {
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];
  age_min?: number;
  age_max?: number;
  area_min?: number;
  area_max?: number;
  volume_min?: number;
  volume_max?: number;
  basal_area_min?: number;
  basal_area_max?: number;
  height_min?: number;
  height_max?: number;
  diameter_min?: number;
  diameter_max?: number;
  growth_min?: number;
  growth_max?: number;
  fields?: string[];
}
```

**Filter mapping rules:**

All `*_min` / `*_max` pairs translate to `.gte()` / `.lte()` Supabase filters.

Arrays (`stand_ids`, `species`, `development_classes`, `site_types`) use `.in()` — Supabase supports `in` for array matching:

```typescript
if (filters.stand_ids?.length) {
  query = query.in("stand_id", filters.stand_ids);
}
if (filters.species?.length) {
  query = query.in("main_species", filters.species);
}
if (filters.development_classes?.length) {
  query = query.in("development_class", filters.development_classes);
}
if (filters.site_types?.length) {
  query = query.in("site_type", filters.site_types);
}
```

**Auto-translation from English to Finnish** (preserve the existing speciesMap + SITE_MAP logic, but upgrade them to handle arrays):

```typescript
// Translate each species in the array
if (filters.species?.length) {
  const translated = filters.species.map(s => {
    const key = s.toLowerCase();
    // Use existing speciesMap lookup
    return speciesMap[key] ?? s; // passthrough if already Finnish
  });
  query = query.in("main_species", translated);
}
```

**`fields` parameter:**

If `fields` is provided and non-empty, filter the output to only those fields. Otherwise return all default fields.

```typescript
const ALLOWED_FIELDS = [
  "stand_id", "species", "development_class", "site_type",
  "area_ha", "age_years", "volume_m3",
  "basal_area", "avg_height", "avg_diameter",
  "growth_m3_per_ha", "soil_type", "drainage_status"
];

function filterFields(stand: Compartment, fields?: string[]): Record<string, unknown> {
  if (!fields || fields.length === 0) {
    // Return all relevant fields
    return {
      stand_id: stand.stand_id,
      species: stand.main_species,
      development_class: stand.development_class,
      site_type: stand.site_type,
      area_ha: stand.area_ha,
      age_years: stand.age_years,
      volume_m3: stand.volume_m3,
      basal_area: stand.basal_area,
      avg_height: stand.avg_height,
      avg_diameter: stand.avg_diameter,
      growth_m3_per_ha: stand.growth_m3_per_ha,
      soil_type: stand.soil_type,
      drainage_status: stand.drainage_status,
    };
  }
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    // Map field names to DB column names
    const col = FIELD_TO_COLUMN[f] ?? f;
    result[f] = (stand as Record<string, unknown>)[col];
  }
  return result;
}
```

**Field name to DB column mapping:**

```typescript
const FIELD_TO_COLUMN: Record<string, string> = {
  stand_id: "stand_id",
  species: "main_species",
  development_class: "development_class",
  site_type: "site_type",
  area_ha: "area_ha",
  age_years: "age_years",
  volume_m3: "volume_m3",
  basal_area: "basal_area",
  avg_height: "avg_height",
  avg_diameter: "avg_diameter",
  growth_m3_per_ha: "growth_m3_per_ha",
  soil_type: "soil_type",
  drainage_status: "drainage_status",
};
```

**Output format:**

```
Found 4 stand(s):
  Stand 5: Mänty, Varttunut kasvatusmetsikkö, 1.2 ha, 65 y, 180 m³
  Stand 12: Kuusi, Uudistuskypsä metsikkö, 2.1 ha, 82 y, 340 m³
```

(Only show requested fields, in the same order as `fields` parameter.)

#### 1b. Remove `yearOperations`

Delete the `yearOperations` function entirely. It is replaced by `queryOperations`.

#### 1c. Add `queryOperations`

**New signature:**

```typescript
export interface QueryOperationsFilter {
  // Operation-level filters
  years?: number[];
  types?: string[];           // e.g. ["Päätehakkuu", "Harvennus"]

  // Stand-level filters (JOINed with compartments)
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];

  // Numeric ranges (operation-level)
  income_min?: number;
  income_max?: number;
  removal_m3_min?: number;
  removal_m3_max?: number;
  removal_pct_min?: number;
  removal_pct_max?: number;
  cost_min?: number;
  cost_max?: number;

  // Numeric ranges (stand-level)
  stand_age_min?: number;
  stand_age_max?: number;
  stand_area_min?: number;
  stand_area_max?: number;

  // Field selection
  fields?: string[];
}
```

**SQL/query implementation — the JOIN is the key:**

```typescript
export async function queryOperations(
  supabase: SupabaseClient,
  forestId: string,
  filters: QueryOperationsFilter
): Promise<{ success: boolean; result: string; error?: string }> {
  try {
    // Step 1: Query operations with JOIN to compartments
    let query = supabase
      .from("operations")
      .select("*, compartments!inner(*)")
      .eq("forest_id", forestId);

    // Apply operation-level filters
    if (filters.years?.length) {
      query = query.in("year", filters.years);
    }
    if (filters.types?.length) {
      query = query.in("type", filters.types);
    }
    // ... income/removal/cost ranges via gte/lte ...

    const { data, error } = await query.order("year").order("type");
    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      return { success: true, result: "No matching operations found." };
    }

    // Step 2: Post-filter on stand-level fields (Supabase .in() on joined
    // columns is unreliable with some PostgREST versions, so apply in JS)
    let results = data as Array<Operation & { compartments: Compartment }>;

    if (filters.stand_ids?.length) {
      results = results.filter(r => filters.stand_ids!.includes(r.compartments.stand_id));
    }
    if (filters.species?.length) {
      results = results.filter(r => filters.species!.includes(r.compartments.main_species));
    }
    // ... similar for development_classes, site_types, stand_age_*, stand_area_* ...

    if (results.length === 0) {
      return { success: true, result: "No matching operations found (filtered by stand criteria)." };
    }

    // Step 3: Format output with selected fields
    const lines = [`Found ${results.length} operation(s):`];
    for (const op of results) {
      const comp = op.compartments;
      const parts: string[] = [];

      if (!filters.fields || filters.fields.includes("stand_id")) {
        parts.push(`Stand ${comp.stand_id}`);
      }
      if (!filters.fields || filters.fields.includes("species")) {
        parts.push(`${comp.main_species ?? "?"}`);
      }
      if (!filters.fields || filters.fields.includes("development_class")) {
        parts.push(`${comp.development_class ?? "?"}`);
      }
      if (!filters.fields || filters.fields.includes("stand_area_ha")) {
        parts.push(`${(comp.area_ha ?? 0).toFixed(1)} ha`);
      }
      if (!filters.fields || filters.fields.includes("stand_age_years")) {
        parts.push(`${comp.age_years ?? "?"} y`);
      }
      // Build the operation part
      const opParts: string[] = [];
      if (!filters.fields || filters.fields.includes("year")) {
        opParts.push(`${op.year}`);
      }
      if (!filters.fields || filters.fields.includes("year")) {
        opParts.push(op.type);
      }
      // ...

      const header = `  ${parts.join(", ")}`;
      const detail = opParts.length ? ` — ${opParts.join(", ")}` : "";
      lines.push(header + detail);
    }

    return { success: true, result: lines.join("\n") };
  } catch (err) {
    return {
      success: false,
      result: "",
      error: err instanceof Error ? err.message : "Failed to query operations",
    };
  }
}
```

**⚠️ Critical: The `!inner` JOIN** — Supabase's PostgREST uses `!inner` to filter operations that have a matching compartment. This guarantees we only return operations whose compartments exist (no orphaned operations). The `*` on `compartments!inner(*)` returns all compartment fields without needing a separate `select()` call.

**Output example (with `fields`):**

```
Found 3 operation(s):
  Stand 5: Mänty, Varttunut kasvatusmetsikkö — 2026, Harvennus, removal 50 m³ (28%), income 12 000 €
  Stand 45: Mänty, Uudistuskypsä metsikkö — 2030, Päätehakkuu, removal 340 m³ (100%), income 38 700 €
```

Without fields parameter (all fields):
```
Found 3 operation(s):
  Stand 5: Mänty, Varttunut kasvatusmetsikkö, tuore, 1.2 ha, 65 y, 180 m³ — 2026, Harvennus, removal 50 m³ (28%), income 12 000 €, growth 6.6 m³/y
  Stand 45: Mänty, Uudistuskypsä metsikkö, kuivahko, 2.1 ha, 82 y, 340 m³ — 2030, Päätehakkuu, removal 340 m³ (100%), income 38 700 €, growth 6.8 m³/y
```

**Export from query-tools.ts:**

```typescript
export { getStand } from "./query-tools";       // unchanged
export { searchStands } from "./query-tools";    // upgraded
export { planSummary } from "./query-tools";     // unchanged
export { queryOperations } from "./query-tools"; // new — replaces yearOperations
// yearOperations removed
```

---

### T8.2b — Upgrade `edit-tools.ts`: add `batchUpdateOperations` (1.5h)

**Objective:** Add a `batchUpdateOperations` function that filters operations then applies an update transactionally. Keep `addOperation` and `removeOperation` as-is.

**File:** `src/lib/ai/edit-tools.ts`

#### New function: `batchUpdateOperations`

```typescript
export interface BatchUpdateFilter {
  // Same filter structure as QueryOperationsFilter, minus the fields parameter
  years?: number[];
  types?: string[];
  stand_ids?: string[];
  species?: string[];
  development_classes?: string[];
  site_types?: string[];
  income_min?: number;
  income_max?: number;
  removal_m3_min?: number;
  removal_m3_max?: number;
  removal_pct_min?: number;
  removal_pct_max?: number;
  cost_min?: number;
  cost_max?: number;
  stand_age_min?: number;
  stand_age_max?: number;
  stand_area_min?: number;
  stand_area_max?: number;
}

export interface BatchUpdatePayload {
  year?: number;        // New year for the operations
  removal_pct?: number; // New removal percentage
  notes?: string;       // Update notes
}

/**
 * Batch-update operations matching a filter.
 * Only whitelisted fields can be updated (year, removal_pct, notes).
 * Runs in a transaction — all-or-nothing.
 * Maximum 500 operations per call (safety limit).
 */
export async function batchUpdateOperations(
  supabase: SupabaseClient,
  forestId: string,
  filter: BatchUpdateFilter,
  update: BatchUpdatePayload
): Promise<{ success: boolean; result: string; error?: string }> {
```

**Implementation steps:**

1. **Validate update payload** — reject any field not in whitelist (`year`, `removal_pct`, `notes`)
2. **Find matching operation IDs** — first pass: query operations with the same JOIN+filter logic as `queryOperations`, returning only `id` columns
3. **Enforce limit** — max 500 operations at a time. If >500, return error: "Too many operations ({count}). Narrow your filter."
4. **Transactional update** — use Supabase's `.update()` with `.in("id", ids)` — this is atomic at the DB level
5. **Return count** — "Updated {count} operation(s): moved 5 Harvennus from 2026 to 2028"

**⚠️ Safety constraints (enforce in server-side code):**

```typescript
const ALLOWED_UPDATE_FIELDS = new Set(["year", "removal_pct", "notes"]);
const MAX_BATCH_SIZE = 500;

// Validate update payload
for (const key of Object.keys(update)) {
  if (!ALLOWED_UPDATE_FIELDS.has(key)) {
    return {
      success: false,
      result: "",
      error: `Cannot update field "${key}". Allowed fields: year, removal_pct, notes`,
    };
  }
}

// Year validation — prevent setting year to the past
if (update.year !== undefined && update.year < 2025) {
  return {
    success: false,
    result: "",
    error: `Cannot set year to ${update.year}. Year must be >= 2025.`,
  };
}

// Enforce limit
if (ids.length > MAX_BATCH_SIZE) {
  return {
    success: false,
    result: "",
    error: `Too many operations (${ids.length}). Maximum is ${MAX_BATCH_SIZE}. Narrow your filter (e.g., specify a single year or type).`,
  };
}
```

**Export from edit-tools.ts:**

```typescript
export { addOperation } from "./edit-tools";         // unchanged
export { removeOperation } from "./edit-tools";      // unchanged
export { batchUpdateOperations } from "./edit-tools"; // new
```

---

### T8.4b — Update tool definitions in `tools.ts` (0.75h)

**Objective:** Update `src/lib/chat/tools.ts` to:
1. Remove `year_operations` tool definition
2. Add `query_operations` tool definition with all filter parameters
3. Add `batch_update_operations` tool definition
4. Update `search_stands` tool definition with new parameters (all ranges, arrays, fields)

**Also update the tool executor handler** in `src/lib/chat/tool-executor.ts`:

```typescript
// Remove:
//   year_operations: async (args, ctx) => yearOperations(ctx.forestId, args.year as number),

// Add:
//   query_operations: async (args, ctx) => queryOperations(ctx.supabase, ctx.forestId, args),
//   batch_update_operations: async (args, ctx) => batchUpdateOperations(ctx.supabase, ctx.forestId, args.filter, args.update),
```

**Relevant tool executor code location** (from phase-3-ai-chat.md, line 584-590):

```typescript
const toolHandlers = {
  // ... existing handlers ...
  get_stand: async (args, ctx) => getStand(ctx.supabase, ctx.forestId, args.stand_id as string),
  search_stands: async (args, ctx) => searchStands(ctx.supabase, ctx.forestId, args),
  plan_summary: async (_args, ctx) => planSummary(ctx.supabase, ctx.forestId),
  year_operations: async (args, ctx) => yearOperations(ctx.supabase, ctx.forestId, args.year as number), // ← REMOVE
  // ... add below:
  query_operations: async (args, ctx) => queryOperations(ctx.supabase, ctx.forestId, args),
  batch_update_operations: async (args, ctx) => batchUpdateOperations(ctx.supabase, ctx.forestId, args.filter, args.update),
};
```

---

### Tool Definitions (for `tools.ts`)

#### `search_stands` — updated definition

```typescript
{
  name: "search_stands",
  description: "Search compartments (kuviot) by any combination of criteria. All parameters optional — omit to get all stands (useful for overview). Filter values can be in Finnish OR English (e.g. 'Mänty' or 'Pine', 'tuore' or 'mesic') — handler auto-translates.",
  parameters: {
    type: "object",
    properties: {
      stand_ids: { type: "array", items: { type: "string" }, description: "List of specific stand IDs, e.g. ['5', '12', '89.1']" },
      species: { type: "array", items: { type: "string" }, description: "Main tree species in Finnish or English, e.g. ['Mänty', 'Kuusi']" },
      development_classes: { type: "array", items: { type: "string" }, description: "e.g. ['Uudistuskypsä metsikkö', 'Varttunut kasvatusmetsikkö', 'Nuori kasvatusmetsikkö', 'Taimikko']" },
      site_types: { type: "array", items: { type: "string" }, description: "e.g. ['tuore', 'lehtomainen', 'kuivahko', 'kuiva']" },
      age_min: { type: "number" }, age_max: { type: "number" },
      area_min: { type: "number" }, area_max: { type: "number" },
      volume_min: { type: "number" }, volume_max: { type: "number" },
      basal_area_min: { type: "number" }, basal_area_max: { type: "number" },
      height_min: { type: "number" }, height_max: { type: "number" },
      diameter_min: { type: "number" }, diameter_max: { type: "number" },
      growth_min: { type: "number" }, growth_max: { type: "number" },
      fields: {
        type: "array", items: { type: "string", enum: ["stand_id", "species", "development_class", "site_type", "area_ha", "age_years", "volume_m3", "basal_area", "avg_height", "avg_diameter", "growth_m3_per_ha", "soil_type", "drainage_status"] },
        description: "Which fields to return. Omit for all fields (default). Example: ['stand_id', 'species', 'age_years']"
      },
    },
  },
}
```

#### `query_operations` — new definition

```typescript
{
  name: "query_operations",
  description: "Search planned operations by any combination of criteria. Returns each operation with full stand data (species, age, development class, etc.) via a single JOINed query. All parameters optional — omit years to search all years. Filter values in Finnish OR English — auto-translated.",
  parameters: {
    type: "object",
    properties: {
      years: { type: "array", items: { type: "number" }, description: "List of specific years, e.g. [2026, 2028]. Returns operations in ANY of these years." },
      types: { type: "array", items: { type: "string" }, description: "Operation types, e.g. ['Päätehakkuu', 'Harvennus', 'Ensiharvennus', 'Taimikonhoito', 'Laikkumätästys']" },
      stand_ids: { type: "array", items: { type: "string" }, description: "Filter by stand IDs, e.g. ['5', '12']" },
      species: { type: "array", items: { type: "string" }, description: "Filter by main tree species" },
      development_classes: { type: "array", items: { type: "string" }, description: "Filter by development class" },
      site_types: { type: "array", items: { type: "string" }, description: "Filter by site type" },
      income_min: { type: "number" }, income_max: { type: "number" },
      removal_m3_min: { type: "number", description: "Minimum harvested volume in m³" }, removal_m3_max: { type: "number" },
      removal_pct_min: { type: "number" }, removal_pct_max: { type: "number" },
      cost_min: { type: "number" }, cost_max: { type: "number" },
      stand_age_min: { type: "number" }, stand_age_max: { type: "number" },
      stand_area_min: { type: "number" }, stand_area_max: { type: "number" },
      fields: {
        type: "array", items: { type: "string", enum: ["stand_id", "species", "development_class", "site_type", "stand_area_ha", "stand_age_years", "year", "type", "removal_pct", "removal_m3", "income_eur", "cost_eur"] },
        description: "Which fields to include in output. Omit for all fields. Example: ['stand_id', 'year', 'type', 'income_eur']"
      },
    },
  },
}
```

#### `batch_update_operations` — new definition

```typescript
{
  name: "batch_update_operations",
  description: "Update multiple operations at once. Filter selects which operations to modify, update specifies what to change. Use this for bulk modifications like 'move all 2026 thinnings to 2028'. Transactional — all operations succeed or none do. Max 500 operations per call.",
  parameters: {
    type: "object",
    properties: {
      filter: {
        type: "object",
        description: "Filter criteria matching the same structure as query_operations (years, types, stand_ids, etc.)",
        properties: {
          years: { type: "array", items: { type: "number" } },
          types: { type: "array", items: { type: "string" } },
          stand_ids: { type: "array", items: { type: "string" } },
          species: { type: "array", items: { type: "string" } },
          development_classes: { type: "array", items: { type: "string" } },
          site_types: { type: "array", items: { type: "string" } },
          income_min: { type: "number" }, income_max: { type: "number" },
          removal_m3_min: { type: "number" }, removal_m3_max: { type: "number" },
          removal_pct_min: { type: "number" }, removal_pct_max: { type: "number" },
          cost_min: { type: "number" }, cost_max: { type: "number" },
          stand_age_min: { type: "number" }, stand_age_max: { type: "number" },
          stand_area_min: { type: "number" }, stand_area_max: { type: "number" },
        },
      },
      update: {
        type: "object",
        description: "What to change. Only whitelisted fields: year, removal_pct, notes.",
        properties: {
          year: { type: "number", description: "New year for the operations (e.g., 2028)" },
          removal_pct: { type: "number", description: "New removal percentage (e.g., 28 for thinning)" },
          notes: { type: "string", description: "Update notes field" },
        },
      },
    },
    required: ["filter", "update"],
  },
}
```

---

### T10.1b — Tests (0.75h)

**Objective:** Write unit tests for the three upgraded/new tools.

**File:** `src/lib/ai/__tests__/query-tools.test.ts` (extend if exists)

```typescript
import { describe, it, expect, vi } from "vitest";

// Tests for searchStands:
// - Returns all stands with no filters
// - Filters by stand_ids array
// - Filters by species array (Finnish + English)
// - Filters by age range (min + max)
// - Filters by fields parameter (returns only requested fields)
// - Returns "No matching stands" when nothing matches

// Tests for queryOperations:
// - Returns ops for specific years array
// - Returns ops with JOINed stand data (stand_id, species)
// - Filters by income range
// - Fields parameter limits output
// - Returns "No matching operations" when nothing matches

// Tests for batchUpdateOperations:
// - Updates matching ops to new year
// - Rejects invalid update fields (forest_id, type, etc.)
// - Rejects year < 2025
// - Returns error when > 500 matches
// - Does not modify non-matching ops
```

---

## Security Model

| Layer | Mechanism | What it protects against |
|---|---|---|
| **RLS** | PostgreSQL row-level security on operations + compartments | User cannot access other users' data, regardless of tool |
| **forest_id injection** | Added server-side in every handler, never from AI input | AI cannot query/modify a different forest |
| **Update field whitelist** | Only `year`, `removal_pct`, `notes` are writable via batch | Prevents corruption of forest_id, compartment_id, type, created_by |
| **Year validation** | Reject year < 2025 | Prevents accidental scheduling in the past |
| **Max batch size** | 500 operations per batch_update | Prevents runaway updates from affecting entire plan |
| **Structured JSON filters** | No raw SQL strings | No injection vector — all filter values are typed literals |
| **Post-filter for stand fields** | JavaScript-side filtering after DB query for JOIN filters | Works around PostgREST join-filtering limitations, adds validation layer |

### Why NOT raw SQL

A tool that accepts a raw SQL WHERE clause would:
1. Be vulnerable to prompt injection (user says "ignore all filters and set year to 2099")
2. Allow access to any table via subqueries or JOINs
3. Break silently when the DB schema changes
4. Encourage the AI to write unindexed, expensive queries

The structured JSON filter approach is **strictly more secure** and equally expressive for the use cases that arise in forest planning conversations.

---

## Migration: Tool Changes Summary

| Tool | Action | Reason |
|---|---|---|
| `year_operations` | 🗑️ Remove | Replaced by query_operations |
| `search_stands` | 🔧 Upgrade | Expand filters + add fields parameter |
| `query_operations` | 🆕 Add | General operation query with JOIN |
| `batch_update_operations` | 🆕 Add | Bulk mutations |
| `get_stand` | ✅ Keep | Niche use (single stand deep-dive) |
| `plan_summary` | ✅ Keep | Niche use (aggregate numbers overview) |
| `add_operation` | ✅ Keep | Niche use (single operation add) |
| `remove_operation` | ✅ Keep | Niche use (single operation remove) |
| `validate_plan` | ✅ Keep | Unchanged |
| `check_harvest_sustainability` | ✅ Keep | Unchanged |
| `generate_plan` | ✅ Keep | Unchanged |

Total tools after Phase 3b: **10** (was 9 — add 2, remove 1)

**Impact on token count:** The system prompt grows slightly from the new tool definitions (~500 extra tokens), but each AI interaction uses 50-90% fewer tokens per query because:
- One `query_operations` call replaces 10 `year_operations` calls (for a full decade review)
- No subsequent `get_stand` calls to find stand IDs
- The `fields` parameter keeps output lean

---

## Verification

- [ ] `npm run build` — 0 TypeScript errors
- [ ] `npx vitest run src/lib/ai/__tests__/` — All tests pass
- [ ] Manual test in chat: "What operations are planned for 2026?" → returns stand IDs
- [ ] Manual test: "Move all 2026 harvests to 2028" → one batch_update call
- [ ] Manual test: "Show me all thinnings with income > 10 000€" → query_operations with income_min
- [ ] Manual test: search_stands with fields=['stand_id', 'species', 'volume_m3'] → only those fields returned
- [ ] batch_update_operations with invalid update field (`type`) → rejected with clear error