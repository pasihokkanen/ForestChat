// src/lib/ai/chart-engine.ts
// Phase 4b: Deterministic chart data recomputation from declarative query configs.
//
// Charts should be specified, not computed at AI-time. The AI describes what
// data to source and how to transform it — this engine executes that spec
// deterministically via the authenticated Supabase client (RLS applies).

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ChartQueryConfig {
  source: "operations" | "compartments" | "plan_metadata";
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
    /** Multiply result by this factor after aggregation (e.g. -1 for costs). */
    multiply?: number;
  }>;
  filters?: Record<string, unknown>;
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
}

export interface ChartEngineResult {
  data: Record<string, unknown>[];
  computedAt: string;
}

// ─── Computed Fields ─────────────────────────────────────────────────

interface ComputedFieldDef {
  /** Which raw DB columns must be fetched to compute this field */
  sources: string[];
  /** Which table each source belongs to ("source" | joined table alias) */
  sourceTables: Record<string, "source" | "compartments">;
  /** Compute the synthetic value from a raw row */
  compute: (row: Record<string, unknown>) => number;
}

const COMPUTED_FIELDS: Record<string, ComputedFieldDef> = {
  removal_m3: {
    sources: ["volume_m3", "removal_pct"],
    sourceTables: {
      volume_m3: "compartments",
      removal_pct: "source",
    },
    compute: (row) =>
      ((row.volume_m3 as number) ?? 0) * ((row.removal_pct as number) ?? 0) / 100,
  },
};

const WHITELISTED_SOURCES = new Set([
  "operations",
  "compartments",
  "plan_metadata",
]);

const JOIN_PREFIX_MAP: Record<string, string> = {
  comp: "compartments",
};

const MAX_ROWS = 500; // safety limit — charts get cluttered beyond this

// ─── Helpers ─────────────────────────────────────────────────────────

/** Resolve a join-prefixed field name (e.g. "comp.main_species") to { table, field } */
function resolveJoinField(field: string): { table: string | null; field: string } {
  const dotIdx = field.indexOf(".");
  if (dotIdx === -1) return { table: null, field };
  const prefix = field.slice(0, dotIdx);
  const resolved = JOIN_PREFIX_MAP[prefix] ?? prefix;
  return { table: resolved, field: field.slice(dotIdx + 1) };
}

/** Build the Supabase .select() string from config fields */
function buildSelect(config: ChartQueryConfig): string {
  const fields = new Set<string>();

  // Group-by fields
  for (const g of config.aggregate) {
    const res = resolveJoinField(g.group_by);
    if (res.table === "compartments") {
      fields.add(`compartments(${res.field})`);
    } else {
      fields.add(res.field);
    }
  }

  // Value source columns (skip count which has no field)
  for (const v of config.values) {
    if (v.fn === "count") continue;

    // Check if this is a computed field
    const computed = COMPUTED_FIELDS[v.field];
    if (computed) {
      // Add source columns instead
      for (const src of computed.sources) {
        const srcTable = computed.sourceTables[src] ?? "source";
        if (srcTable === "compartments") {
          fields.add(`compartments(${src})`);
        } else {
          fields.add(src);
        }
      }
      continue;
    }

    const res = resolveJoinField(v.field);
    if (res.table === "compartments") {
      fields.add(`compartments(${res.field})`);
    } else {
      fields.add(res.field);
    }
  }

  // Extra join fields (for filters, etc.)
  if (config.join) {
    for (const f of config.join.fields) {
      fields.add(`compartments(${f})`);
    }
  }

  // Always include forest_id for scoping (but we use .eq filter, not select)
  // Sort field
  if (config.sort) {
    const res = resolveJoinField(config.sort.by);
    if (res.table === "compartments") {
      fields.add(`compartments(${res.field})`);
    } else {
      fields.add(res.field);
    }
  }

  return Array.from(fields).join(", ");
}

/** Build the raw Supabase query from config */
function buildQuery(
  supabase: SupabaseClient,
  forestId: string,
  config: ChartQueryConfig
) {
  const selectStr = buildSelect(config);
  let query = supabase
    .from(config.source)
    .select(selectStr)
    .eq("forest_id", forestId)
    .limit(MAX_ROWS);

  // Apply filters
  if (config.filters) {
    for (const [key, val] of Object.entries(config.filters)) {
      if (Array.isArray(val)) {
        query = query.in(key, val);
      } else if (val !== undefined && val !== null) {
        query = query.eq(key, val);
      }
    }
  }

  // Apply sort
  if (config.sort) {
    query = query.order(config.sort.by, {
      ascending: config.sort.dir !== "desc",
    });
  }

  return query;
}

/** Flatten nested join data from Supabase response into flat rows */
function flattenRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const flat: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        // This is a joined table result — flatten with prefix
        // e.g. "compartments": { "main_species": "Mänty" } → "main_species": "Mänty"
        // Also keep compartment_id for the on-join lookup
        const nested = val as Record<string, unknown>;
        for (const [nk, nv] of Object.entries(nested)) {
          flat[nk] = nv;
        }
      } else {
        flat[key] = val;
      }
    }
    return flat;
  });
}

/** Compute synthetic columns for each row */
function applyComputedFields(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  // Check which value fields are computed
  const computedFields = new Set<string>();
  for (const v of config.values) {
    if (COMPUTED_FIELDS[v.field]) {
      computedFields.add(v.field);
    }
  }

  if (computedFields.size === 0) return rows;

  return rows.map((row) => {
    const enriched = { ...row };
    computedFields.forEach((fieldName) => {
      const def = COMPUTED_FIELDS[fieldName];
      enriched[fieldName] = def.compute(row);
    });
    return enriched;
  });
}

/** Aggregate rows by group_by keys and apply aggregation functions */
function aggregateRows(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  // Build group key from aggregate.group_by fields
  const groupKeys = config.aggregate.map((g) => g.group_by);

  if (groupKeys.length === 0) {
    // No grouping — single row aggregation
    const result: Record<string, unknown> = {};
    for (const v of config.values) {
      result[v.as] = (aggregateFn(v.fn, rows, v.field)) * (v.multiply ?? 1);
    }
    return [result];
  }

  // Group rows by composite key
  const groups = new Map<string, { key: Record<string, unknown>; rows: Record<string, unknown>[] }>();

  for (const row of rows) {
    const compositeKey = groupKeys.map((k) => String(row[k] ?? "")).join("|");
    if (!groups.has(compositeKey)) {
      const keyObj: Record<string, unknown> = {};
      for (const k of groupKeys) {
        keyObj[k] = row[k];
      }
      groups.set(compositeKey, { key: keyObj, rows: [] });
    }
    groups.get(compositeKey)!.rows.push(row);
  }

  // Aggregate each group
  const result: Record<string, unknown>[] = [];
  groups.forEach((group) => {
    const aggregated: Record<string, unknown> = { ...group.key };
    for (const v of config.values) {
      aggregated[v.as] = (aggregateFn(v.fn, group.rows, v.field)) * (v.multiply ?? 1);
    }
    result.push(aggregated);
  });

  return result;
}

/** Apply an aggregation function to a field across rows */
function aggregateFn(
  fn: "sum" | "count" | "avg" | "min" | "max",
  rows: Record<string, unknown>[],
  field: string
): number {
  const values = rows
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && !isNaN(v));

  if (values.length === 0) return 0;

  switch (fn) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "count":
      return rows.length;
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return 0;
  }
}

/** Fill missing years in aggregated data with zero-value rows.
 *  When group_by is exactly ["year"] (simple single-group), this ensures every
 *  year between min/max gets a zero row so charts don't lose bars when
 *  operations are moved between years.
 *
 *  Does NOT fill gaps for multi-group configs (e.g., year + type for stacked
 *  bars) — those are rendered differently and gap filling would create spurious
 *  grouped bars in non-stacked chart types. */
function fillYearGaps(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  // Only fill when the sole group_by is "year"
  if (
    config.aggregate.length !== 1 ||
    config.aggregate[0].group_by !== "year"
  ) {
    return rows;
  }

  if (rows.length < 2) return rows; // Need at least 2 rows for a range

  const existingYears = new Set<number>();
  for (const row of rows) {
    const y = Number(row["year"]);
    if (!isNaN(y)) existingYears.add(y);
  }

  if (existingYears.size < 2) return rows;

  const yearsArr = Array.from(existingYears);
  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);

  const result = [...rows];
  for (let y = minYear; y <= maxYear; y++) {
    if (existingYears.has(y)) continue;
    const zeroRow: Record<string, unknown> = { year: y };
    for (const v of config.values) {
      zeroRow[v.as] = 0;
    }
    result.push(zeroRow);
  }

  return result;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Recompute chart data from a declarative query config.
 * Translates the config into safe PostgREST queries via the authenticated
 * Supabase client, handles computed fields (e.g. removal_m3), and returns
 * structured chart-ready data.
 */
export async function recomputeChartData(
  supabase: SupabaseClient,
  forestId: string,
  config: ChartQueryConfig
): Promise<ChartEngineResult> {
  // 1. Validate source
  if (!WHITELISTED_SOURCES.has(config.source)) {
    throw new Error(`Invalid chart source: ${config.source}`);
  }

  // 2. Build and execute query
  const query = buildQuery(supabase, forestId, config);
  const { data: rawRows, error } = await query;

  if (error) {
    throw new Error(`Chart data query failed: ${error.message}`);
  }

  const rows = (rawRows as unknown as Record<string, unknown>[]) ?? [];

  // 3. Flatten nested join data
  const flatRows = flattenRows(rows);

  // 4. Compute synthetic columns (e.g. removal_m3)
  const computedRows = applyComputedFields(flatRows, config);

  // 5. Aggregate
  let aggregated = aggregateRows(computedRows, config);

  // 5b. Fill year gaps — ensure all years between min/max have rows (even if zero)
  aggregated = fillYearGaps(aggregated, config);

  // 6. Sort result — always sort, defaulting to first group_by field asc
  const effectiveSort = config.sort ?? (config.aggregate.length > 0
    ? { by: config.aggregate[0].group_by, dir: "asc" as const }
    : null);
  if (effectiveSort) {
    const sortBy = effectiveSort.by;
    const dir = effectiveSort.dir === "desc" ? -1 : 1;
    aggregated.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  }

  // 7. Apply limit
  if (config.limit && config.limit > 0) {
    aggregated = aggregated.slice(0, config.limit);
  }

  return {
    data: aggregated,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Recompute all query_config-backed chart tabs for a forest.
 * Called once per user message after the AI agent loop completes
 * (if any mutation occurred).
 *
 * Skips legacy charts (those with data but no query_config).
 * Emits "charts_refreshed" SSE event on success.
 * Errors for individual charts are caught and logged — one broken
 * chart doesn't block the rest.
 */
export async function recomputeAllCharts(
  supabase: SupabaseClient,
  forestId: string,
  sendSse?: (event: string, data: unknown) => void
): Promise<void> {
  // 1. Fetch all config-backed chart tabs for this forest
  const { data: tabs, error } = await supabase
    .from("chart_tabs")
    .select("chart_id, query_config, title")
    .eq("forest_id", forestId)
    .not("query_config", "is", null);

  if (error) {
    console.error("recomputeAllCharts: failed to fetch chart tabs:", error);
    return;
  }

  if (!tabs || tabs.length === 0) return;

  const recomputedIds: string[] = [];

  for (const tab of tabs) {
    try {
      const config = tab.query_config as ChartQueryConfig;
      const result = await recomputeChartData(supabase, forestId, config);

      await supabase
        .from("chart_tabs")
        .update({
          data: result.data,
          computed_at: result.computedAt,
        })
        .eq("forest_id", forestId)
        .eq("chart_id", tab.chart_id);

      recomputedIds.push(tab.chart_id);
    } catch (err) {
      console.error(
        `recomputeAllCharts: failed for chart "${tab.chart_id}" (${tab.title}):`,
        err
      );
      // Continue with remaining charts
    }
  }

  if (recomputedIds.length > 0) {
    sendSse?.("charts_refreshed", { chart_ids: recomputedIds });
  }
}
