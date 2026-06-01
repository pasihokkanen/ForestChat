// src/lib/ai/chart-engine.ts
// Phase 4b: Deterministic chart data recomputation from declarative query configs.
// Phase 4c: Cross-source queries — merge results from multiple tables on a common key.
//
// Charts should be specified, not computed at AI-time. The AI describes what
// data to source and how to transform it — this engine executes that spec
// deterministically via the authenticated Supabase client (RLS applies).

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ChartQueryConfig {
  source: "operations" | "compartments" | "compartment_species" | "plan_metadata";
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
    /** When true, convert this value from period sums to cumulative running
     *  totals after aggregation. Only works on sorted data — the cumulative
     *  direction follows the sort order (typically year ascending). */
    cumulative?: boolean;
  }>;
  filters?: Record<string, unknown>;
  sort?: { by: string; dir?: "asc" | "desc" };
  limit?: number;
}

/** Cross-source query: runs N sub-queries independently, merges on a common key. */
export interface CrossQueryConfig {
  source: "cross";
  merge_on: string;
  merge_strategy?: "outer" | "inner";  // default: "outer"
  queries: SubQueryConfig[];
  sort?: { by: string; dir?: "asc" | "desc" };
}

/** A sub-query within a cross query. Same fields as ChartQueryConfig but
 *  without top-level sort (sorting happens after merge). */
export interface SubQueryConfig {
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

export type AnyQueryConfig = ChartQueryConfig | CrossQueryConfig;

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
  net_cashflow: {
    sources: ["income_eur", "cost_eur"],
    sourceTables: {
      income_eur: "source",
      cost_eur: "source",
    },
    compute: (row) =>
      ((row.income_eur as number) ?? 0) - ((row.cost_eur as number) ?? 0),
  },
  // Phase 4c.2: total annual growth in m³ for compartments source
  growth_m3_total: {
    sources: ["growth_m3_per_ha", "area_ha"],
    sourceTables: {
      growth_m3_per_ha: "source",
      area_ha: "source",
    },
    compute: (row) =>
      ((row.growth_m3_per_ha as number) ?? 0) * ((row.area_ha as number) ?? 0),
  },
  // Net volume change per operation: growth − removal. Positive = net growth,
  // negative = net removal. Designed for waterfall charts (growth up, removal down).
  net_volume_change: {
    sources: ["growth_m3_per_ha", "area_ha", "volume_m3", "removal_pct"],
    sourceTables: {
      growth_m3_per_ha: "compartments",
      area_ha: "compartments",
      volume_m3: "compartments",
      removal_pct: "source",
    },
    compute: (row) => {
      const growth = ((row.growth_m3_per_ha as number) ?? 0) * ((row.area_ha as number) ?? 0);
      const removal = ((row.volume_m3 as number) ?? 0) * ((row.removal_pct as number) ?? 0) / 100;
      return growth - removal;
    },
  },
};

const WHITELISTED_SOURCES = new Set([
  "operations",
  "compartments",
  "compartment_species",
  "plan_metadata",
  "cross",
]);

const JOIN_PREFIX_MAP: Record<string, string> = {
  comp: "compartments",
};

const MAX_ROWS = 500; // safety limit — charts get cluttered beyond this

// ─── Field Aliases ───────────────────────────────────────────────────

const FIELD_ALIASES: Record<string, string> = {
  // operations table
  income: "income_eur",
  cost: "cost_eur",
  removal: "removal_pct",
  // compartments table (also work when joined via comp.prefix)
  area: "area_ha",
  volume: "volume_m3",
  age: "age_years",
  height: "avg_height",
  diameter: "avg_diameter",
  growth: "growth_m3_per_ha",
  // compartment_species table
  species: "species",
  "tree_species": "species",
  "total_ha": "area_ha",
  "total_m3": "volume_m3",
  // common plural / shorthand mistakes
  "development_classes": "development_class",
  "dev_class": "development_class",
  "stand_type": "development_class",
};

function resolveFieldAlias(field: string): string {
  return FIELD_ALIASES[field] ?? field;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveJoinField(field: string): { table: string | null; field: string } {
  const dotIdx = field.indexOf(".");
  if (dotIdx === -1) return { table: null, field: resolveFieldAlias(field) };
  const prefix = field.slice(0, dotIdx);
  const resolved = JOIN_PREFIX_MAP[prefix] ?? prefix;
  const fieldPart = field.slice(dotIdx + 1);
  return { table: resolved, field: resolveFieldAlias(fieldPart) };
}

function buildSelect(config: ChartQueryConfig): string {
  const rawFields = new Set<string>();       // bare columns (no join prefix)
  const joinFields = new Map<string, Set<string>>();  // table → columns

  const addField = (col: string) => {
    const res = resolveJoinField(col);
    if (res.table) {
      if (!joinFields.has(res.table)) joinFields.set(res.table, new Set());
      joinFields.get(res.table)!.add(res.field);
    } else {
      rawFields.add(res.field);
    }
  };

  // Group-by fields
  for (const g of config.aggregate) {
    addField(g.group_by);
  }

  // Value source columns
  for (const v of config.values) {
    const fn = v.fn || "count";
    if (fn === "count") continue;

    const computed = COMPUTED_FIELDS[v.field];
    if (computed) {
      for (const src of computed.sources) {
        // computed.sourceTables tells us which table each source column
        // belongs to. "compartments" means the joined table; anything else
        // means the primary source table.
        const srcTable = computed.sourceTables[src] ?? "source";

        // When a join is configured, check if this source column is in the
        // join fields — even if sourceTables says "source" (written for the
        // case where the source IS compartments). Columns provided via join
        // must be fetched through the embedded resource, not as bare columns.
        const isJoinColumn = srcTable === "compartments"
          || (!!config.join && config.join.fields.includes(src));

        if (isJoinColumn) {
          if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
          joinFields.get("compartments")!.add(resolveFieldAlias(src));
        } else {
          rawFields.add(resolveFieldAlias(src));
        }
      }
      continue;
    }

    addField(v.field);
  }

  // Extra join fields
  if (config.join) {
    if (!joinFields.has("compartments")) joinFields.set("compartments", new Set());
    for (const f of config.join.fields) {
      joinFields.get("compartments")!.add(f);
    }
  }

  // Sort field
  if (config.sort) {
    const res = resolveJoinField(config.sort.by);
    if (res.table) {
      if (!joinFields.has(res.table)) joinFields.set(res.table, new Set());
      joinFields.get(res.table)!.add(res.field);
    } else {
      rawFields.add(res.field);
    }
  }

  // Build select string — merge all columns per join table into a single
  // embedded resource (e.g. "compartments(col1, col2, col3)") to avoid
  // duplicate alias errors in PostgREST.
  const parts: string[] = Array.from(rawFields);
  for (const [table, cols] of joinFields) {
    parts.push(`${table}(${Array.from(cols).join(", ")})`);
  }
  return parts.join(", ");
}
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

  // Apply filters — Phase 4c.1: resolve join-prefixed filter keys
  // (e.g. "comp.development_class") for embedded resource filtering
  if (config.filters) {
    for (const [key, val] of Object.entries(config.filters)) {
      // Check for join-prefixed filter key
      const joinResolved = resolveJoinField(key);
      if (joinResolved.table) {
        // Embedded resource filter via PostgREST path syntax
        const embeddedKey = `${joinResolved.table}.${joinResolved.field}`;
        if (Array.isArray(val)) {
          query = query.filter(embeddedKey, "in", `(${val.join(",")})`);
        } else if (val !== undefined && val !== null) {
          query = query.filter(embeddedKey, "eq", val);
        }
      } else {
        const resolvedKey = resolveFieldAlias(key);
        if (Array.isArray(val)) {
          query = query.in(resolvedKey, val);
        } else if (val !== undefined && val !== null) {
          query = query.eq(resolvedKey, val);
        }
      }
    }
  }

  // Apply sort
  if (config.sort) {
    const resolvedSortBy = resolveFieldAlias(config.sort.by);
    query = query.order(resolvedSortBy, {
      ascending: config.sort.dir !== "desc",
    });
  }

  return query;
}

function flattenRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const flat: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
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

function applyComputedFields(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (rows.length === 0) return rows;

  // Only apply computed fields whose source columns are actually present
  // in the data (e.g., removal_m3 requires volume_m3 from a compartments join).
  const computedFields = new Set<string>();
  for (const v of config.values) {
    const def = COMPUTED_FIELDS[v.field];
    if (def && def.sources.every((s) => s in rows[0])) {
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

function aggregateRows(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (rows.length === 0) return [];

  const groupKeys = config.aggregate.map((g) => g.group_by);

  if (groupKeys.length === 0) {
    const result: Record<string, unknown> = {};
    for (const v of config.values) {
      result[v.as] = (aggregateFn(v.fn, rows, v.field)) * (v.multiply ?? 1);
    }
    return [result];
  }

  const groups = new Map<string, { key: Record<string, unknown>; rows: Record<string, unknown>[] }>();

  for (const row of rows) {
    if (groupKeys.some((k) => row[k] == null)) {
      console.log("[chart-engine] skipping row with null group_by key:", JSON.stringify(groupKeys), "row:", JSON.stringify(row));
      continue;
    }
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

function aggregateFn(
  fn: "sum" | "count" | "avg" | "min" | "max" | undefined,
  rows: Record<string, unknown>[],
  field: string
): number {
  const effectiveFn = fn || "count";

  if (effectiveFn === "count") return rows.length;

  const values = rows
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && !isNaN(v));

  if (values.length === 0) return 0;

  switch (effectiveFn) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
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

function fillYearGaps(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (config.aggregate.length === 0) return rows;
  if (config.aggregate[0].group_by !== "year") return rows;
  if (rows.length < 1) return rows;

  const existingYears = new Set<number>();
  for (const row of rows) {
    const y = Number(row["year"]);
    if (!isNaN(y)) existingYears.add(y);
  }
  if (existingYears.size < 1) return rows;

  const yearsArr = Array.from(existingYears);
  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);

  if (config.aggregate.length === 1) {
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

  const groupValues: Map<string, Set<string>> = new Map();
  for (let i = 1; i < config.aggregate.length; i++) {
    groupValues.set(config.aggregate[i].group_by, new Set());
  }
  for (const row of rows) {
    for (let i = 1; i < config.aggregate.length; i++) {
      const key = config.aggregate[i].group_by;
      const val = String(row[key] ?? "");
      groupValues.get(key)!.add(val);
    }
  }

  const existingKeys = new Set<string>();
  for (const row of rows) {
    const parts = [String(row["year"] ?? "")];
    for (let i = 1; i < config.aggregate.length; i++) {
      parts.push(String(row[config.aggregate[i].group_by] ?? ""));
    }
    existingKeys.add(parts.join("|"));
  }

  const result = [...rows];

  const dimValues: string[][] = [];
  for (let i = 1; i < config.aggregate.length; i++) {
    dimValues.push(Array.from(groupValues.get(config.aggregate[i].group_by)!));
  }

  function cartesianProduct(arrays: string[][]): string[][] {
    if (arrays.length === 0) return [[]];
    const [first, ...rest] = arrays;
    const restProduct = cartesianProduct(rest);
    const result: string[][] = [];
    for (const val of first) {
      for (const r of restProduct) {
        result.push([val, ...r]);
      }
    }
    return result;
  }

  for (let y = minYear; y <= maxYear; y++) {
    if (existingYears.has(y)) continue;

    for (const combo of cartesianProduct(dimValues)) {
      const key = [String(y), ...combo].join("|");
      if (existingKeys.has(key)) continue;

      const zeroRow: Record<string, unknown> = { year: y };
      for (let i = 1; i < config.aggregate.length; i++) {
        zeroRow[config.aggregate[i].group_by] = combo[i - 1];
      }
      for (const v of config.values) {
        zeroRow[v.as] = 0;
      }
      result.push(zeroRow);
    }
  }

  return result;
}

function shouldApplyCumulative(config: ChartQueryConfig): boolean {
  return config.values.some((v) => v.cumulative === true)
    && (config.sort !== undefined || (config.aggregate.length > 0 && config.aggregate[0].group_by === "year"));
}

function applyCumulative(
  rows: Record<string, unknown>[],
  config: ChartQueryConfig
): Record<string, unknown>[] {
  if (!shouldApplyCumulative(config)) return rows;

  const cumulativeFields = new Set<string>();
  for (const v of config.values) {
    if (v.cumulative) cumulativeFields.add(v.as);
  }
  if (cumulativeFields.size === 0) return rows;

  const sortKey = config.sort?.by ?? (config.aggregate.length > 0 ? config.aggregate[0].group_by : null);
  if (!sortKey) return rows;

  const secondaryKey = config.aggregate.length > 1 ? config.aggregate[1].group_by : null;

  if (secondaryKey) {
    const partitions = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = String(row[secondaryKey] ?? "__null__");
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key)!.push(row);
    }

    const result: Record<string, unknown>[] = [];
    partitions.forEach((partition) => {
      partition.sort((a, b) => String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? "")));
      const running: Record<string, number> = {};
      cumulativeFields.forEach((f) => { running[f] = 0; });
      for (const row of partition) {
        cumulativeFields.forEach((f) => {
          const val = Number(row[f]) || 0;
          running[f] += val;
          row[f] = running[f];
        });
        result.push(row);
      }
    });
    return result;
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va ?? "").localeCompare(String(vb ?? ""));
  });

  const running: Record<string, number> = {};
  cumulativeFields.forEach((f) => { running[f] = 0; });

  for (const row of sorted) {
    cumulativeFields.forEach((f) => {
      const val = Number(row[f]) || 0;
      running[f] += val;
      row[f] = running[f];
    });
  }

  return sorted;
}

// ─── Phase 4c.3: Cross-Source Pipeline ───────────────────────────────

/** Extract unique merge key values from all sub-query results. */
function extractMergeKeys(
  mergeOn: string,
  subResults: Record<string, unknown>[][]
): Set<string> {
  const keys = new Set<string>();
  for (const rows of subResults) {
    for (const row of rows) {
      const val = row[mergeOn];
      if (val !== undefined && val !== null) {
        keys.add(String(val));
      }
    }
  }
  return keys;
}

/** Merge sub-query results on a common key.
 *  Handles broadcast rows (a single-row result fanned out to all merge keys). */
function mergeResults(
  mergeOn: string,
  strategy: "outer" | "inner",
  subResults: Record<string, unknown>[][],
  subConfigs: SubQueryConfig[]
): Record<string, unknown>[] {
  const allKeys = extractMergeKeys(mergeOn, subResults);

  // Collect all value column names for zero-fill
  const allValueColumns = new Set<string>();
  for (const sq of subConfigs) {
    for (const v of sq.values) {
      allValueColumns.add(v.as);
    }
  }

  const mergedMap = new Map<string, Record<string, unknown>>();

  for (const key of Array.from(allKeys)) {
    let merged: Record<string, unknown> = { [mergeOn]: isNaN(Number(key)) ? key : Number(key) };
    let allPresent = true;

    for (let i = 0; i < subResults.length; i++) {
      const subCfg = subConfigs[i];
      const rows = subResults[i];

      if (subCfg.broadcast && rows.length === 1) {
        // Broadcast: copy all fields from the single row to every merge key
        Object.assign(merged, rows[0]);
        // Remove merge_on from broadcast row so it doesn't overwrite
        delete merged[mergeOn];
        merged[mergeOn] = isNaN(Number(key)) ? key : Number(key);
      } else {
        const match = rows.find((r) => String(r[mergeOn]) === key);
        if (match) {
          // Copy value columns only (not the merge key, already set)
          for (const v of subCfg.values) {
            merged[v.as] = match[v.as] ?? 0;
          }
        } else {
          allPresent = false;
          // Zero-fill missing values
          for (const v of subCfg.values) {
            merged[v.as] = 0;
          }
        }
      }
    }

    if (strategy === "inner" && !allPresent) continue;

    mergedMap.set(key, merged);
  }

  return Array.from(mergedMap.values());
}

/** Fill gaps in merged results. When merge_on is "year", fills all integer
 *  years between min and max. Otherwise no-op. */
function fillMergeGaps(
  rows: Record<string, unknown>[],
  mergeOn: string,
  valueColumns: string[]
): Record<string, unknown>[] {
  if (mergeOn !== "year" || rows.length === 0) return rows;

  const existingYears = new Set<number>();
  for (const row of rows) {
    const y = Number(row[mergeOn]);
    if (!isNaN(y)) existingYears.add(y);
  }
  if (existingYears.size < 2) return rows;

  const yearsArr = Array.from(existingYears);
  const minYear = Math.min(...yearsArr);
  const maxYear = Math.max(...yearsArr);

  const result = [...rows];
  for (let y = minYear; y <= maxYear; y++) {
    if (existingYears.has(y)) continue;
    const zeroRow: Record<string, unknown> = { [mergeOn]: y };
    for (const col of valueColumns) {
      zeroRow[col] = 0;
    }
    result.push(zeroRow);
  }

  return result;
}

/** Apply cumulative transformation post-merge, using the original sub-query
 *  cumulative flags. Cumulative is deferred to post-merge because rows from
 *  different sub-queries must be aligned by merge key first. */
function applyCrossCumulative(
  rows: Record<string, unknown>[],
  mergeOn: string,
  subConfigs: SubQueryConfig[]
): Record<string, unknown>[] {
  // Collect which output columns should be cumulative
  const cumulativeColumns = new Set<string>();
  for (const sq of subConfigs) {
    for (const v of sq.values) {
      if (v.cumulative) cumulativeColumns.add(v.as);
    }
  }

  if (cumulativeColumns.size === 0) return rows;

  // Sort by merge key ascending for correct cumulative direction
  const sorted = [...rows].sort((a, b) => {
    const va = a[mergeOn];
    const vb = b[mergeOn];
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va ?? "").localeCompare(String(vb ?? ""));
  });

  const running: Record<string, number> = {};
  cumulativeColumns.forEach((col) => { running[col] = 0; });

  for (const row of sorted) {
    cumulativeColumns.forEach((col) => {
      const val = Number(row[col]) || 0;
      running[col] += val;
      row[col] = running[col];
    });
  }

  return sorted;
}

/** Run a single sub-query through the existing pipeline.
 *  When skipCumulative is true, strips cumulative flags before running
 *  (cumulative is deferred to post-merge in the cross pipeline). */
async function recomputeSubQuery(
  supabase: SupabaseClient,
  forestId: string,
  subConfig: SubQueryConfig,
  skipCumulative: boolean
): Promise<Record<string, unknown>[]> {
  // Build a ChartQueryConfig from the sub-query config
  const values = skipCumulative
    ? subConfig.values.map((v) => ({ ...v, cumulative: undefined }))
    : subConfig.values;

  const config: ChartQueryConfig = {
    source: subConfig.source,
    join: subConfig.join,
    aggregate: subConfig.aggregate,
    values: values as ChartQueryConfig["values"],
    filters: subConfig.filters,
    limit: subConfig.limit,
    // Sub-queries don't have their own sort — sorting happens post-merge.
    // But fillYearGaps needs the implied sort from group_by for year detection.
  };

  // 1. Validate
  if (!WHITELISTED_SOURCES.has(config.source)) {
    throw new Error(`Invalid chart source: ${config.source}`);
  }
  if (!config.aggregate || !Array.isArray(config.aggregate)) {
    throw new Error("config.aggregate is required and must be an array");
  }
  if (!config.values || !Array.isArray(config.values)) {
    throw new Error("config.values is required and must be an array");
  }
  for (const v of config.values) {
    if (!v.field || !v.as) {
      throw new Error(`Each value entry needs field and as — got: ${JSON.stringify(v)}`);
    }
  }

  // 2. Build and execute query
  const query = buildQuery(supabase, forestId, config);
  const { data: rawRows, error } = await query;

  if (error) {
    throw new Error(`Sub-query (${config.source}) failed: ${error.message}`);
  }

  const rows = (rawRows as unknown as Record<string, unknown>[]) ?? [];

  // 3-6. Pipeline
  const flatRows = flattenRows(rows);
  const computedRows = applyComputedFields(flatRows, config);
  let aggregated = aggregateRows(computedRows, config);
  aggregated = fillYearGaps(aggregated, config);

  // Sort by first group_by
  const effectiveSort = config.aggregate.length > 0
    ? { by: config.aggregate[0].group_by, dir: "asc" as string }
    : null;
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

  // Cumulative is skipped when skipCumulative=true (stripped from values above),
  // but we still call applyCumulative in case skipCumulative=false for standalone use.
  if (!skipCumulative) {
    aggregated = applyCumulative(aggregated, config);
  }

  if (config.limit && config.limit > 0) {
    aggregated = aggregated.slice(0, config.limit);
  }

  return aggregated;
}

/** Run a cross-source query: execute all sub-queries, merge on common key,
 *  fill gaps, and apply deferred cumulative. */
async function recomputeCrossData(
  supabase: SupabaseClient,
  forestId: string,
  config: CrossQueryConfig
): Promise<ChartEngineResult> {
  const strategy = config.merge_strategy ?? "outer";

  // 1. Run all sub-queries (cumulative stripped, applied post-merge)
  const subResults: Record<string, unknown>[][] = [];
  for (const subCfg of config.queries) {
    const rows = await recomputeSubQuery(supabase, forestId, subCfg, true);
    subResults.push(rows);
  }

  // 2. Merge on common key
  let merged = mergeResults(config.merge_on, strategy, subResults, config.queries);

  // 3. Fill gaps
  const allValueColumns = new Set<string>();
  for (const sq of config.queries) {
    for (const v of sq.values) {
      allValueColumns.add(v.as);
    }
  }
  merged = fillMergeGaps(merged, config.merge_on, Array.from(allValueColumns));

  // 4. Apply deferred cumulative
  merged = applyCrossCumulative(merged, config.merge_on, config.queries);

  // 5. Sort
  if (config.sort) {
    const sortBy = config.sort.by;
    const dir = config.sort.dir === "desc" ? -1 : 1;
    merged.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va ?? "").localeCompare(String(vb ?? "")) * dir;
    });
  } else {
    // Default sort by merge key ascending
    const sortBy = config.merge_on;
    merged.sort((a, b) => {
      const va = a[sortBy];
      const vb = b[sortBy];
      if (typeof va === "number" && typeof vb === "number") return (va as number) - (vb as number);
      return String(va ?? "").localeCompare(String(vb ?? ""));
    });
  }

  return {
    data: merged,
    computedAt: new Date().toISOString(),
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Recompute chart data from a declarative query config.
 * Translates the config into safe PostgREST queries via the authenticated
 * Supabase client, handles computed fields (e.g. removal_m3), and returns
 * structured chart-ready data.
 *
 * Phase 4c: dispatches to cross-source pipeline when source === "cross".
 */
export async function recomputeChartData(
  supabase: SupabaseClient,
  forestId: string,
  config: AnyQueryConfig
): Promise<ChartEngineResult> {
  // Phase 4c.3: cross-source dispatch
  if (config.source === "cross") {
    return recomputeCrossData(supabase, forestId, config as CrossQueryConfig);
  }

  // Existing single-source pipeline
  const sc = config as ChartQueryConfig;

  // 1. Validate source
  if (!WHITELISTED_SOURCES.has(sc.source)) {
    throw new Error(`Invalid chart source: ${sc.source}`);
  }

  // 1b. Validate required fields
  if (!sc.aggregate || !Array.isArray(sc.aggregate)) {
    throw new Error("config.aggregate is required and must be an array");
  }
  if (!sc.values || !Array.isArray(sc.values)) {
    throw new Error("config.values is required and must be an array — e.g. values: [{ field: \"volume_m3\", as: \"volume\", fn: \"sum\" }]");
  }
  for (const v of sc.values) {
    if (!v.field || !v.as) {
      throw new Error(`Each value entry needs field and as — got: ${JSON.stringify(v)}`);
    }
  }

  // 2. Build and execute query
  const query = buildQuery(supabase, forestId, sc);
  const { data: rawRows, error } = await query;

  if (error) {
    throw new Error(`Chart data query failed: ${error.message}`);
  }

  const rows = (rawRows as unknown as Record<string, unknown>[]) ?? [];

  // 3. Flatten nested join data
  const flatRows = flattenRows(rows);

  // 4. Compute synthetic columns (e.g. removal_m3)
  const computedRows = applyComputedFields(flatRows, sc);

  // 5. Aggregate
  let aggregated = aggregateRows(computedRows, sc);

  // 5b. Fill year gaps
  aggregated = fillYearGaps(aggregated, sc);

  // 6. Sort result
  const effectiveSort = sc.sort ?? (sc.aggregate.length > 0
    ? { by: sc.aggregate[0].group_by, dir: "asc" as string }
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

  // 6b. Apply cumulative
  aggregated = applyCumulative(aggregated, sc);

  // 7. Apply limit
  if (sc.limit && sc.limit > 0) {
    aggregated = aggregated.slice(0, sc.limit);
  }

  return {
    data: aggregated,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Recompute all query_config-backed chart tabs for a forest.
 * Called once per user message after the AI agent loop completes.
 * Phase 4c: supports both single-source and cross-source configs.
 */
export async function recomputeAllCharts(
  supabase: SupabaseClient,
  forestId: string,
  sendSse?: (event: string, data: unknown) => void
): Promise<void> {
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
      // Phase 4c: widened type — query_config may be ChartQueryConfig or CrossQueryConfig
      const config = tab.query_config as AnyQueryConfig;
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
    }
  }

  if (recomputedIds.length > 0) {
    sendSse?.("charts_refreshed", { chart_ids: recomputedIds });
  }
}
