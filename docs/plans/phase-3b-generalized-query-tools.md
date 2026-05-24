# ForestChat — Phase 3b: Generalized Query & Batch Edit Tools

> **For Hermes:** Load subagent-driven-development skill before implementing. Use OpenCode CLI for coding subagents. Update this plan file to mark tasks as ✅ upon completion.

**Version:** 2.0
**Date:** 2026-05-24
**Previous version:** 1.0 (original draft)

**Changelog v2.0:**
- Fixed output formatting bug: both field guards checked `"year"` instead of `year`/`type` separately
- Removed self-referencing exports (`export { ... } from "./query-tools"` inside query-tools.ts itself)
- Added `.limit()` safety to `queryOperations` (max 500)
- Made `fields` parameter reduce DB-level payload (dynamic `.select()`, not just text formatting)
- Fixed `batchUpdateOperations` transactionality claim — it's atomic per `.update()`, not cross-call
- Added `forest_id` filter to batch update step 2 for defense-in-depth
- Moved `speciesMap` and `SITE_MAP` to module scope for reuse
- Removed backward-compat concerns for old tool param schemas (dev phase — old sessions cleared)
- Added post-filter rationale for stand-level numeric ranges (same reliability reason as arrays)
- Included explicit tool description update in T8.4b task description
- Added verification steps for new features
- **v2.0 post-review fix:** Removed `removal_m3` from DB column map (`removal_m3` is computed from `volume_m3 × removal_pct / 100`, not stored). Moved `removal_m3_min/max` filters to JS post-filtering. Added `removal_m3` computed display in output formatting.
- **v2.0 post-review fix:** Generalized `formatStandResult` to handle all 13 field types via `STAND_FIELD_FORMATTERS` lookup map.
- **v2.0 post-review fix:** Fixed self-referencing export pattern in `edit-tools.ts` section (same fix as query-tools).

**Goal:** Fix the root cause of AI agent looping by replacing the narrow `year_operations` tool with a general-purpose `query_operations` tool, upgrading `search_stands` with the same flexible filter pattern, and adding `batch_update_operations` for bulk mutations. All three tools share a common filter idiom and support selective field return for token efficiency **and reduced DB payload**.

**Problem summary:** The current `year_operations` tool has two critical flaws:
1. It does **not return stand IDs** in its output (operations table stores `compartment_id` UUID, not `stand_id`) — the AI cannot see *which* stands are affected
2. It only queries a **single year** — the AI must call it repeatedly to see a range
3. Each of `add_operation` and `remove_operation` works on **one stand at a time** — moving 5 operations from 2026→2028 requires 10+ tool calls

Without stand IDs, the AI resorts to calling `get_stand` in a loop (O(n) queries for n stands), which is catastrophic for large properties (500+ stands).

**Solution:** Replace the narrow per-year tool with a general `query_operations` that accepts any combination of filters (years, types, stand IDs, species, income range, removal volume range, etc.) and returns operations JOINed with stand data — including stand IDs — in a single call. Add `batch_update_operations` to apply transformations in one call. Upgrade `search_stands` with the same filter pattern and optional field control that reduces both DB and token payloads.

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
1. Upgrade `search_stands` with comprehensive filters + `fields` parameter (DB-level column selection)
2. Replace `yearOperations` with `queryOperations` — general operation query with JOIN to compartments
3. Keep `getStand` and `planSummary` as-is (they work correctly for their niche)

**File:** `src/lib/ai/query-tools.ts`

#### 0. Module-level constants (extract for reuse)

Move inline maps to module scope so both `searchStands` and `queryOperations` can use them:

```typescript
const SPECIES_MAP: Record<string, string> = {
  mänty: "Mänty", pine: "Mänty",
  kuusi: "Kuusi", spruce: "Kuusi",
  rauduskoivu: "Rauduskoivu", birch: "Rauduskoivu", koivu: "Rauduskoivu",
  hieskoivu: "Hieskoivu",
  lehtikuusi: "Lehtikuusi", larch: "Lehtikuusi",
  harmaaleppä: "Harmaaleppä", alder: "Harmaaleppä",
};

const SITE_MAP: Record<string, string> = {
  tuore: "tuore", mesic: "tuore",
  lehtomainen: "lehtomainen", "herb-rich": "lehtomainen", "herb-rich heath": "lehtomainen",
  kuivahko: "kuivahko", "sub-xeric": "kuivahko",
  kuiva: "kuiva", xeric: "kuiva",
};
```

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
  fields?: string[];  // Also controls DB-level .select() — reduces payload
}
```

**Filter mapping rules:**

All `*_min` / `*_max` pairs translate to `.gte()` / `.lte()` Supabase filters.

Arrays (`stand_ids`, `species`, `development_classes`, `site_types`) use `.in()`:

```typescript
if (filters.stand_ids?.length) {
  query = query.in("stand_id", filters.stand_ids);
}
if (filters.species?.length) {
  const translated = filters.species.map(s => {
    const key = s.toLowerCase();
    return SPECIES_MAP[key] ?? s; // passthrough if already Finnish
  });
  query = query.in("main_species", translated);
}
if (filters.development_classes?.length) {
  query = query.in("development_class", filters.development_classes);
}
if (filters.site_types?.length) {
  const translated = filters.site_types.map(s => {
    const key = s.toLowerCase();
    return SITE_MAP[key] ?? s;
  });
  query = query.in("site_type", translated);
}
```

**⚠️ Type safety:** The AI may send a single string instead of an array (e.g., `species: "Mänty"` vs `species: ["Mänty"]`). Coerce at entry:

```typescript
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Usage:
if (toArray(filters.species).length) { ... }
```

This is defensive coding — old chat sessions are cleared in dev phase, but the AI model itself may occasionally send mistyped params.

**`fields` parameter — DB-level selection:**

If `fields` is provided and non-empty, build the `.select()` to only fetch those columns. This avoids pulling `geometry` (MB-scale GeoJSON) and `attributes` (large JSONB) over the wire. If no fields, use `*` (backward compatible).

```typescript
// Map user-facing field names to DB columns for SELECT
const COMP_FIELD_TO_COL: Record<string, string> = {
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

function buildCompSelect(fields?: string[]): string {
  if (!fields || fields.length === 0) return "*";
  const cols = fields.map(f => COMP_FIELD_TO_COL[f] ?? f);
  return cols.join(", ");
}

// At query time:
let query = supabase
  .from("compartments")
  .select(buildCompSelect(filters.fields))
  .eq("forest_id", forestId);
```

**Output format:**

After fetching, filter the result object to only the requested fields for the text response (even though the DB already limited columns):

```typescript
const STAND_FIELD_FORMATTERS: Record<string, (s: Compartment) => string> = {
  stand_id: s => `Stand ${s.stand_id}`,
  species: s => `${s.main_species ?? "?"}`,
  development_class: s => `${s.development_class ?? "?"}`,
  site_type: s => `${s.site_type ?? "?"}`,
  area_ha: s => `${s.area_ha?.toFixed(1)} ha`,
  age_years: s => `${s.age_years ?? "?"} y`,
  volume_m3: s => `${s.volume_m3?.toFixed(0)} m³`,
  basal_area: s => `${s.basal_area?.toFixed(1)} m²/ha`,
  avg_height: s => `${s.avg_height?.toFixed(1)} m`,
  avg_diameter: s => `${s.avg_diameter?.toFixed(1)} cm`,
  growth_m3_per_ha: s => `${s.growth_m3_per_ha?.toFixed(1)} m³/ha/y`,
  soil_type: s => `${s.soil_type ?? "?"}`,
  drainage_status: s => `${s.drainage_status ?? "?"}`,
};

function formatStandResult(stands: Compartment[], fields?: string[]): string {
  if (stands.length === 0) return "No matching stands found.";
  const lines = stands.map(s => {
    const parts: string[] = [];
    if (!fields || fields.length === 0) {
      // Default: show key fields
      parts.push(`Stand ${s.stand_id}`);
      parts.push(`${s.main_species ?? "?"}, ${s.development_class ?? "?"}`);
      parts.push(`${s.area_ha?.toFixed(1)} ha, ${s.age_years ?? "?"} y, ${s.volume_m3?.toFixed(0)} m³`);
    } else {
      // Show only requested fields, in order
      for (const f of fields) {
        const formatter = STAND_FIELD_FORMATTERS[f];
        if (formatter) parts.push(formatter(s));
      }
    }
    return `  ${parts.join(", ")}`;
  });
  return `Found ${stands.length} stand(s):\n${lines.join("\n")}`;
}
```

**Output example:**

```
Found 4 stand(s):
  Stand 5: Mänty, Varttunut kasvatusmetsikkö, 1.2 ha, 65 y, 180 m³
  Stand 12: Kuusi, Uudistuskypsä metsikkö, 2.1 ha, 82 y, 340 m³
```

(With `fields`: only show requested fields, in the same order as `fields` parameter.)

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

  // Field selection (controls both DB payload and text output)
  fields?: string[];
}
```

**Dynamic DB-level select based on `fields`:**

When `fields` is specified, only request those columns from the DB. This reduces:
- DB query time (less data to serialize)
- Network transfer (no geometry/attributes/jsonb blobs)
- Memory use

The select always includes the compartment columns needed for post-filtering, even if not in `fields`, so filter logic works correctly. Only user-requested fields appear in the text output.

```typescript
const OP_QUERY_FIELDS: Record<string, string> = {
  // user_facing → qualified_column
  stand_id: "compartments.stand_id",
  species: "compartments.main_species",
  development_class: "compartments.development_class",
  site_type: "compartments.site_type",
  stand_area_ha: "compartments.area_ha",
  stand_age_years: "compartments.age_years",
  year: "year",
  type: "type",
  removal_pct: "removal_pct",
  // removal_m3 is computed from volume_m3 × removal_pct / 100 — not a DB column
  income_eur: "income_eur",
  cost_eur: "cost_eur",
};

function buildOpSelect(fields?: string[]): string {
  if (!fields || fields.length === 0) return "*, compartments!inner(*)";

  const opCols = new Set<string>(["id"]); // id always needed for internal use
  const compCols = new Set<string>([
    // Always include stand-level columns needed for post-filtering
    "stand_id", "main_species", "development_class", "site_type", "area_ha", "age_years",
  ]);

  for (const f of fields) {
    if (f === "removal_m3") {
      // Computed field: volume_m3 × removal_pct / 100 — ensure deps are available
      opCols.add("removal_pct");
      compCols.add("volume_m3");
      continue;
    }
    const qualified = OP_QUERY_FIELDS[f];
    if (!qualified) continue;
    if (qualified.startsWith("compartments.")) {
      compCols.add(qualified.replace("compartments.", ""));
    } else {
      opCols.add(qualified);
    }
  }

  return `${[...opCols].join(", ")}, compartments!inner(${[...compCols].join(", ")})`;
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
    // Dynamic select: use buildOpSelect to only fetch needed columns
    let query = supabase
      .from("operations")
      .select(buildOpSelect(filters.fields))
      .eq("forest_id", forestId);

    // Apply operation-level filters (applied at DB level via PostgREST)
    if (filters.years?.length) {
      query = query.in("year", filters.years);
    }
    if (filters.types?.length) {
      query = query.in("type", filters.types);
    }
    if (filters.income_min !== undefined) query = query.gte("income_eur", filters.income_min);
    if (filters.income_max !== undefined) query = query.lte("income_eur", filters.income_max);
    if (filters.removal_pct_min !== undefined) query = query.gte("removal_pct", filters.removal_pct_min);
    if (filters.removal_pct_max !== undefined) query = query.lte("removal_pct", filters.removal_pct_max);
    if (filters.cost_min !== undefined) query = query.gte("cost_eur", filters.cost_min);
    if (filters.cost_max !== undefined) query = query.lte("cost_eur", filters.cost_max);

    const { data, error } = await query
      .order("year")
      .order("type")
      .limit(500); // Safety limit: prevents runaway queries on large properties

    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      return { success: true, result: "No matching operations found." };
    }

    // Step 2: Post-filter on stand-level fields
    // (Supabase .in()/.gte()/.lte() on joined columns is unreliable
    //  with some PostgREST versions, so apply in JS)
    let results = data as Array<Operation & { compartments: Compartment }>;

    if (filters.stand_ids?.length) {
      results = results.filter(r => filters.stand_ids!.includes(r.compartments.stand_id));
    }
    if (filters.species?.length) {
      const translated = filters.species.map(s => SPECIES_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.main_species ?? ""));
    }
    if (filters.development_classes?.length) {
      results = results.filter(r => filters.development_classes!.includes(r.compartments.development_class ?? ""));
    }
    if (filters.site_types?.length) {
      const translated = filters.site_types.map(s => SITE_MAP[s.toLowerCase()] ?? s);
      results = results.filter(r => translated.includes(r.compartments.site_type ?? ""));
    }
    if (filters.stand_age_min !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) >= filters.stand_age_min!);
    }
    if (filters.stand_age_max !== undefined) {
      results = results.filter(r => (r.compartments.age_years ?? 0) <= filters.stand_age_max!);
    }
    if (filters.stand_area_min !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) >= filters.stand_area_min!);
    }
    if (filters.stand_area_max !== undefined) {
      results = results.filter(r => (r.compartments.area_ha ?? 0) <= filters.stand_area_max!);
    }

    // removal_m3 is computed, not stored — post-filter in JS
    if (filters.removal_m3_min !== undefined || filters.removal_m3_max !== undefined) {
      results = results.filter(r => {
        const vol = r.compartments.volume_m3 ?? 0;
        const pct = r.removal_pct ?? 0;
        const m3 = Math.round(vol * pct / 100);
        if (filters.removal_m3_min !== undefined && m3 < filters.removal_m3_min) return false;
        if (filters.removal_m3_max !== undefined && m3 > filters.removal_m3_max) return false;
        return true;
      });
    }

    if (results.length === 0) {
      return { success: true, result: "No matching operations found (filtered by stand criteria)." };
    }

    // Step 3: Format output with selected fields (text-layer only — DB already limited)
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
      if (!filters.fields || filters.fields.includes("type")) {
        opParts.push(op.type);
      }
      if (!filters.fields || filters.fields.includes("removal_m3")) {
        const removalM3 = Math.round((comp.volume_m3 ?? 0) * (op.removal_pct ?? 0) / 100);
        const pctStr = op.removal_pct != null ? ` (${op.removal_pct}%)` : "";
        opParts.push(`removal ${removalM3} m³${pctStr}`);
      }
      // ... additional op fields as needed ...

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

**⚠️ Critical: The `!inner` JOIN** — Supabase's PostgREST uses `!inner` to filter operations that have a matching compartment. This guarantees we only return operations whose compartments exist (no orphaned operations). The qualified `compartments!inner(col1, col2)` returns only the needed compartment columns.

**⚠️ Post-filter rationale:** Stand-level array filters (`species[]`, `development_classes[]`, `site_types[]`, `stand_ids[]`) and numeric ranges (`stand_age_min/max`, `stand_area_min/max`) are applied in JavaScript after the DB query. This is a deliberate choice: PostgREST filtering on joined columns is reliable for simple `.eq()` but unreliable for `.in()` and range operators across PostgREST versions. For a typical property (~500 operations), the JS post-filter is instant.

**⚠️ Safety limit:** `.limit(500)` prevents the query from fetching an unbounded number of operations. For Pasi's 162-stand property with 20-year plan (~300-500 operations), this is sufficient. If the limit is hit, the response will be truncated — the user should narrow their filter.

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

**Exports from query-tools.ts:**

All functions are directly exported at their declaration sites. No re-export block needed:

```typescript
export async function getStand(...)      // unchanged
export async function searchStands(...)   // upgraded — new filter interface + fields
export async function planSummary(...)    // unchanged
export async function queryOperations(...) // new — replaces yearOperations
// yearOperations removed
```

The importer in `tool-executor.ts` updates accordingly:

```typescript
// Before:
import { getStand, searchStands, planSummary, yearOperations } from "../ai/query-tools";
// After:
import { getStand, searchStands, planSummary, queryOperations } from "../ai/query-tools";
```

---

### T8.2b — Upgrade `edit-tools.ts`: add `batchUpdateOperations` (1.5h)

**Objective:** Add a `batchUpdateOperations` function that filters operations then applies an update. Keep `addOperation` and `removeOperation` as-is.

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
 * The `.update()` call is atomic at the DB level (single SQL UPDATE).
 * The find-then-update flow spans two HTTP calls; for true cross-call
 * transactionality, a Supabase Edge Function with PL/pgSQL would be needed.
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
3. **Enforce limit** — max 500 operations at a time. If >500, return error
4. **Atomic update** — use Supabase's `.update()` with `.in("id", ids)` and `.eq("forest_id", forestId)` — this is atomic at the DB level per update call. Each individual UPDATE runs in a single Postgres transaction.
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

// Execute update with forest_id for defense-in-depth (RLS also enforces it)
const { data, error } = await supabase
  .from("operations")
  .update(updatePayload)
  .in("id", ids)
  .eq("forest_id", forestId);
```

**Exports from edit-tools.ts:**

All functions are directly exported at their declaration sites. No re-export block needed:

```typescript
export async function addOperation(...)        // unchanged
export async function removeOperation(...)     // unchanged
export async function batchUpdateOperations(...) // new
```

---

### T8.4b — Update tool definitions in `tools.ts` + executor (0.75h)

**Objective:** Update `src/lib/chat/tools.ts` to:
1. Remove `year_operations` tool definition
2. Add `query_operations` tool definition with all filter parameters
3. Add `batch_update_operations` tool definition
4. Update `search_stands` tool definition with new parameters (all ranges, arrays, fields)
5. **Explicitly update the `search_stands` description** from the current "Search stands by criteria. All parameters optional." to the new comprehensive description

**Also update the tool executor handler** in `src/lib/chat/tool-executor.ts`:

```typescript
// Imports change:
// import { getStand, searchStands, planSummary, yearOperations } from "../ai/query-tools";
import { getStand, searchStands, planSummary, queryOperations } from "../ai/query-tools";

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
  description: "Search compartments (kuviot) by any combination of criteria. All parameters optional — omit to get all stands (useful for overview). Filter values can be in Finnish OR English (e.g. 'Mänty' or 'Pine', 'tuore' or 'mesic') — handler auto-translates. The fields parameter only returns the requested columns from the database, reducing response size.",
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
        description: "Which fields to return. Also limits the database query to only these columns. Omit for all fields. Example: ['stand_id', 'species', 'age_years']"
      },
    },
  },
}
```

#### `query_operations` — new definition

```typescript
{
  name: "query_operations",
  description: "Search planned operations by any combination of criteria. Returns each operation with full stand data (species, age, development class, etc.) via a single JOINed query. All parameters optional — omit years to search all years. Filter values in Finnish OR English — auto-translated. The fields parameter limits database columns AND response text for efficiency.",
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
        description: "Which fields to include in output. Also limits the database query to only these columns. Omit for all fields. Example: ['stand_id', 'year', 'type', 'income_eur']"
      },
    },
  },
}
```

#### `batch_update_operations` — new definition

```typescript
{
  name: "batch_update_operations",
  description: "Update multiple operations at once. Filter selects which operations to modify, update specifies what to change. Use this for bulk modifications like 'move all 2026 thinnings to 2028'. Each `.update()` call is atomic at the DB level. Max 500 operations per call.",
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
// - Filters by fields parameter (returns only requested fields at DB and text level)
// - Handles single-string species (coercion wrapper) gracefully
// - Returns "No matching stands" when nothing matches

// Tests for queryOperations:
// - Returns ops for specific years array
// - Returns ops with JOINed stand data (stand_id, species)
// - Filters by income range
// - Fields parameter limits both DB select and text output
// - Respects .limit(500) safety bound
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
| **forest_id on batch update** | `.eq("forest_id", forestId)` added to update query | Defense-in-depth alongside RLS |

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
| `search_stands` | 🔧 Upgrade | Expand filters + add fields parameter (DB+text) |
| `query_operations` | 🆕 Add | General operation query with JOIN + field-level DB select |
| `batch_update_operations` | 🆕 Add | Bulk mutations with safety limits |
| `get_stand` | ✅ Keep | Niche use (single stand deep-dive) |
| `plan_summary` | ✅ Keep | Niche use (aggregate numbers overview) |
| `add_operation` | ✅ Keep | Niche use (single operation add) |
| `remove_operation` | ✅ Keep | Niche use (single operation remove) |
| `validate_plan` | ✅ Keep | Unchanged |
| `check_harvest_sustainability` | ✅ Keep | Unchanged |

Total tools after Phase 3b: **10** (was 9 — add 2, remove 1)

**Impact on token count:** The system prompt grows slightly from the new tool definitions (~500 extra tokens), but each AI interaction uses 50-90% fewer tokens per query because:
- One `query_operations` call replaces 10 `year_operations` calls (for a full decade review)
- No subsequent `get_stand` calls to find stand IDs
- The `fields` parameter keeps both DB response and text output lean

---

## Verification

- [ ] `npm run build` — 0 TypeScript errors
- [ ] `npx vitest run src/lib/ai/__tests__/` — All tests pass
- [ ] Manual test in chat: "What operations are planned for 2026?" → returns stand IDs
- [ ] Manual test: "Move all 2026 harvests to 2028" → one batch_update call
- [ ] Manual test: "Show me all thinnings with income > 10 000€" → query_operations with income_min
- [ ] Manual test: search_stands with fields=['stand_id', 'species', 'volume_m3'] → only those fields returned (DB + text)
- [ ] Manual test: query_operations with fields=['stand_id', 'year', 'type'] → verify DB select is limited (check Supabase logs or network tab)
- [ ] batch_update_operations with invalid update field (`type`) → rejected with clear error
- [ ] batch_update_operations with >500 matching ops → rejected with clear error
- [ ] search_stands with single-string `species: "Mänty"` (without array) → handled gracefully